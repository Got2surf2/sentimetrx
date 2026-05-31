// lib/recordings/extract.ts
//
// Audio extraction + multi-file stitch via ffmpeg in a Vercel Sandbox.
// Per spec § 3.3.
//
// Why Sandbox: native ffmpeg, no 300s Functions timeout, isolates per-job VMs.
// Why signed-URL-in-signed-URL-out: GoPro source files run 1–10GB each and
// must never pass through the worker's memory.
//
// Flow per recording:
//   1. Load recording_files (sort_order ASC) + mint signed READ URL per source
//      and signed UPLOAD URL per per-file output + stitched output.
//   2. Boot a Sandbox (snapshot if FFMPEG_SANDBOX_SNAPSHOT_ID is set,
//      otherwise fresh + dnf install ffmpeg).
//   3. For each file: curl down, ffmpeg → canonical 16kHz mono mp3, ffprobe
//      duration, curl up to its signed upload URL.
//   4. ffmpeg concat all per-file mp3s into stitched.mp3, curl up.
//   5. Update recording_files (audio_storage_path, duration_sec,
//      upload_status='extracted') and recordings (source_duration_sec).
//
// Cost: Sandbox time ≈ duration × ~0.3 (heavily I/O bound on downloads).
// Tracked at the call site via the elapsed wall-clock + per-stage cents in
// the queue worker; this module does not write to recordings.cost_cents
// directly — extraction is essentially free vs. the ASR + Claude legs.

import 'server-only'
import { Sandbox } from '@vercel/sandbox'
import { createServiceRoleClient } from '@/lib/supabase/server'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const READ_URL_TTL_SEC = 60 * 60                         // 1h covers slow downloads + ffmpeg
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000                // 60min ceiling per extract job
const SNAPSHOT_ID = process.env.FFMPEG_SANDBOX_SNAPSHOT_ID
const SANDBOX_RUNTIME = 'node24' as const

// Canonical audio target — 16kHz mono mp3 at 32kbps. ~14MB per 60min of speech;
// fits Whisper's 25MB limit comfortably and is the standard for ASR.
const FFMPEG_AUDIO_FLAGS = '-vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 32k'

export interface ExtractInput {
  recording_id: string
  org_id: string
}

export interface ExtractedFile {
  recording_file_id: string
  original_filename: string
  audio_storage_path: string
  duration_sec: number
}

export interface ExtractResult {
  per_file: ExtractedFile[]
  stitched_path: string
  source_duration_sec: number
  elapsed_ms: number
}

interface FileWithUrls {
  id: string
  original_filename: string
  storage_path: string
  is_video: boolean
  sort_order: number
  output_path: string                     // <org_id>/<recording_id>/audio/<basename>.mp3
  download_url: string
  upload_url: string
}

export async function extractRecording(input: ExtractInput): Promise<ExtractResult> {
  const startedAt = Date.now()
  const service = createServiceRoleClient()

  const files = await loadFilesWithUrls(service, input)
  if (files.length === 0) {
    throw new Error(`extract: no recording_files for recording ${input.recording_id}`)
  }

  const stitchedPath = `${input.org_id}/${input.recording_id}/audio/stitched.mp3`
  const stitchedUploadUrl = await freshUploadUrl(service, stitchedPath)

  const sandbox = await bootSandbox()
  try {
    const perFile: ExtractedFile[] = []
    for (const f of files) {
      const local = `/tmp/in_${f.sort_order}${extOf(f.original_filename)}`
      const out = `/tmp/out_${f.sort_order}.mp3`

      await runOrThrow(sandbox, ['sh', '-c', `curl -fsSL '${shellQuote(f.download_url)}' -o '${local}'`],
        `download ${f.original_filename}`)

      await runOrThrow(sandbox, ['sh', '-c', `ffmpeg -y -i '${local}' ${FFMPEG_AUDIO_FLAGS} '${out}'`],
        `ffmpeg ${f.original_filename}`)

      const duration = await probeDurationSec(sandbox, out)

      await runOrThrow(sandbox, [
        'sh', '-c',
        `curl -fsS -X PUT -H 'Content-Type: audio/mpeg' -H 'x-upsert: true' ` +
        `--data-binary @${out} '${shellQuote(f.upload_url)}'`,
      ], `upload ${f.original_filename}.mp3`)

      // Free the source after we're done with it — keep /tmp from filling on large meetings.
      await runOrThrow(sandbox, ['sh', '-c', `rm -f '${local}'`], `cleanup ${f.original_filename}`)

      perFile.push({
        recording_file_id: f.id,
        original_filename: f.original_filename,
        audio_storage_path: f.output_path,
        duration_sec: duration,
      })
    }

    // Stitch — `concat` demuxer is the right one when all inputs share the same codec params,
    // which they do after our canonical re-encode above.
    const listLines = files
      .map(f => `file '/tmp/out_${f.sort_order}.mp3'`)
      .join('\n')
    await runOrThrow(sandbox, ['sh', '-c', `cat > /tmp/list.txt <<'EOF'\n${listLines}\nEOF`],
      'write concat list')

    if (files.length === 1) {
      // Single file = stitched. Skip concat to avoid a needless re-encode.
      await runOrThrow(sandbox, ['sh', '-c', `cp /tmp/out_${files[0].sort_order}.mp3 /tmp/stitched.mp3`],
        'single-file alias')
    } else {
      await runOrThrow(sandbox, ['sh', '-c',
        `ffmpeg -y -f concat -safe 0 -i /tmp/list.txt -c copy /tmp/stitched.mp3`,
      ], 'ffmpeg concat')
    }

    await runOrThrow(sandbox, ['sh', '-c',
      `curl -fsS -X PUT -H 'Content-Type: audio/mpeg' -H 'x-upsert: true' ` +
      `--data-binary @/tmp/stitched.mp3 '${shellQuote(stitchedUploadUrl)}'`,
    ], 'upload stitched.mp3')

    await writeBackDbRows(service, input, perFile)

    const source_duration_sec = perFile.reduce((sum, f) => sum + f.duration_sec, 0)
    return {
      per_file: perFile,
      stitched_path: stitchedPath,
      source_duration_sec,
      elapsed_ms: Date.now() - startedAt,
    }
  } finally {
    await sandbox.stop().catch(() => undefined)
  }
}

// ── DB plumbing ──────────────────────────────────────────────────────────────

async function loadFilesWithUrls(
  service: ReturnType<typeof createServiceRoleClient>,
  input: ExtractInput,
): Promise<FileWithUrls[]> {
  const { data, error } = await service
    .from('recording_files')
    .select('id, original_filename, storage_path, is_video, sort_order')
    .eq('recording_id', input.recording_id)
    .eq('org_id', input.org_id)
    .order('sort_order', { ascending: true })

  if (error) throw new Error(`recording_files load failed: ${error.message}`)
  const rows = data ?? []
  if (rows.length === 0) return []

  const out: FileWithUrls[] = []
  for (const r of rows) {
    const downloadUrl = await freshReadUrl(service, r.storage_path as string)
    const outPath = `${input.org_id}/${input.recording_id}/audio/${stripExt(r.original_filename as string)}.mp3`
    const uploadUrl = await freshUploadUrl(service, outPath)
    out.push({
      id: r.id as string,
      original_filename: r.original_filename as string,
      storage_path: r.storage_path as string,
      is_video: r.is_video as boolean,
      sort_order: r.sort_order as number,
      output_path: outPath,
      download_url: downloadUrl,
      upload_url: uploadUrl,
    })
  }
  return out
}

async function writeBackDbRows(
  service: ReturnType<typeof createServiceRoleClient>,
  input: ExtractInput,
  perFile: ExtractedFile[],
): Promise<void> {
  for (const f of perFile) {
    const { error } = await service
      .from('recording_files')
      .update({
        audio_storage_path: f.audio_storage_path,
        duration_sec: f.duration_sec,
        upload_status: 'extracted',
      })
      .eq('id', f.recording_file_id)
      .eq('org_id', input.org_id)
    if (error) throw new Error(`recording_files update failed for ${f.recording_file_id}: ${error.message}`)
  }

  const source_duration_sec = perFile.reduce((sum, f) => sum + f.duration_sec, 0)
  const { error: rErr } = await service
    .from('recordings')
    .update({ source_duration_sec })
    .eq('id', input.recording_id)
    .eq('org_id', input.org_id)
  if (rErr) throw new Error(`recordings update failed: ${rErr.message}`)
}

// ── Supabase signed URL helpers ──────────────────────────────────────────────

async function freshReadUrl(
  service: ReturnType<typeof createServiceRoleClient>,
  path: string,
): Promise<string> {
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, READ_URL_TTL_SEC)
  if (error || !data?.signedUrl) {
    throw new Error(`signed read url for ${BUCKET}/${path} failed: ${error?.message ?? 'no url'}`)
  }
  return data.signedUrl
}

async function freshUploadUrl(
  service: ReturnType<typeof createServiceRoleClient>,
  path: string,
): Promise<string> {
  // Remove any prior object at this path so the signed upload URL (single-PUT) doesn't 409 on retry.
  await service.storage.from(BUCKET).remove([path]).catch(() => undefined)
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) {
    throw new Error(`signed upload url for ${BUCKET}/${path} failed: ${error?.message ?? 'no url'}`)
  }
  return data.signedUrl
}

// ── Sandbox helpers ──────────────────────────────────────────────────────────

async function bootSandbox(): Promise<InstanceType<typeof Sandbox>> {
  const sandbox = SNAPSHOT_ID
    ? await Sandbox.create({
        source: { type: 'snapshot', snapshotId: SNAPSHOT_ID },
        timeout: SANDBOX_TIMEOUT_MS,
      })
    : await Sandbox.create({ runtime: SANDBOX_RUNTIME, timeout: SANDBOX_TIMEOUT_MS })

  if (!SNAPSHOT_ID) {
    // Cold-boot install. Adds ~30s before the first ffmpeg call — set
    // FFMPEG_SANDBOX_SNAPSHOT_ID to skip this in production.
    await runOrThrow(sandbox, ['sh', '-c',
      `sudo dnf install -y --skip-broken ffmpeg-free 2>&1 || sudo dnf install -y --skip-broken ffmpeg 2>&1`,
    ], 'install ffmpeg')
  }
  return sandbox
}

async function runOrThrow(
  sandbox: InstanceType<typeof Sandbox>,
  argv: string[],
  label: string,
): Promise<{ stdout: string; stderr: string }> {
  const [cmd, ...args] = argv
  const result = await sandbox.runCommand(cmd, args)
  const stdout = await result.stdout()
  const stderr = await (result.stderr?.() ?? Promise.resolve(''))
  // Sandbox SDK reports exit code via the result object — surface a useful error
  // message including stderr tail when it's non-zero.
  const exitCode = (result as { exitCode?: number }).exitCode ?? 0
  if (exitCode !== 0) {
    throw new Error(`${label} failed (exit ${exitCode}): ${stderr.slice(-500) || stdout.slice(-500)}`)
  }
  return { stdout, stderr }
}

async function probeDurationSec(
  sandbox: InstanceType<typeof Sandbox>,
  path: string,
): Promise<number> {
  const r = await runOrThrow(sandbox, [
    'sh', '-c',
    `ffprobe -v error -show_entries format=duration -of csv=p=0 '${path}'`,
  ], `ffprobe ${path}`)
  const n = parseFloat(r.stdout.trim())
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ffprobe returned invalid duration for ${path}: "${r.stdout.trim()}"`)
  }
  return Math.round(n)
}

// ── Misc ─────────────────────────────────────────────────────────────────────

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(dot) : ''
}

/**
 * Single-quote-safe shell escaper. We pass user-derived paths and signed URLs
 * into `sh -c` strings, so we have to neutralize any embedded single quote.
 * Strategy: close the quote, escape the literal, reopen — `'\''`.
 */
function shellQuote(s: string): string {
  return s.replace(/'/g, `'\\''`)
}
