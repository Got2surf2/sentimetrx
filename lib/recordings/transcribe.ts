// lib/recordings/transcribe.ts
//
// Vendor dispatch from a recording row → ASR result → recording_transcripts row.
// Reads the stitched mp3 at <org_id>/<recording_id>/audio/stitched.mp3 in the
// recordings bucket (written by lib/recordings/extract.ts). Picks the vendor
// via lib/asr/router unless the recording carries an explicit asr_strategy
// override.
//
// Per spec § 3.4. Single worker per recording at a time (queue-serialized),
// so the read-then-write on recordings.cost_cents is not racy in practice.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resolveAsrVendor } from '@/lib/asr/router'
import { transcribeWhisper, type WhisperResult } from '@/lib/asr/whisper'
import { transcribeDeepgram, type DeepgramResult } from '@/lib/asr/deepgram'
import { alignHybrid } from '@/lib/asr/hybrid'
import type {
  AsrVendor,
  RecordingRow,
  TranscriptSegment,
} from '@/lib/recordings/types'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const SIGNED_URL_TTL_SEC = 60 * 30                  // Deepgram batch fetches the URL itself; 30min covers polling
const WHISPER_MAX_BYTES = 25 * 1024 * 1024          // OpenAI hard limit; chunking for > 25MB deferred (TODO)

const stitchedPath = (org_id: string, recording_id: string) =>
  `${org_id}/${recording_id}/audio/stitched.mp3`

export interface TranscribeInput {
  recording: Pick<
    RecordingRow,
    'id' | 'org_id' | 'language' | 'session_type' | 'setup_inputs' | 'asr_strategy'
  >
}

export interface TranscribeResult {
  transcript_id: string
  vendor: AsrVendor
  language_detected: string | null
  segments: TranscriptSegment[]
  duration_sec: number | null
  word_count: number
  cost_cents: number
}

export async function transcribeRecording(input: TranscribeInput): Promise<TranscribeResult> {
  const { recording } = input
  const vendor = pickVendor(recording)
  const service = createServiceRoleClient()
  const path = stitchedPath(recording.org_id, recording.id)

  const dispatched = await dispatchVendor(vendor, recording.language, service, path)

  const word_count = countWords(dispatched.segments)

  const { data: tRow, error: tErr } = await service
    .from('recording_transcripts')
    .upsert(
      {
        recording_id: recording.id,
        org_id: recording.org_id,
        vendor,
        language_detected: dispatched.language_detected,
        segments: dispatched.segments,
        raw_response: dispatched.raw_response,
        word_count,
        duration_sec: dispatched.duration_sec,
        cost_cents: dispatched.cost_cents,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'recording_id' },
    )
    .select('id')
    .single()

  if (tErr || !tRow) {
    throw new Error(`recording_transcripts upsert failed: ${tErr?.message ?? 'no row returned'}`)
  }

  // Record the resolved vendor + accumulate transcription cost on the recording.
  // Stage-serialized by the queue, so read-modify-write is safe here.
  const { data: rRow } = await service
    .from('recordings')
    .select('cost_cents')
    .eq('id', recording.id)
    .eq('org_id', recording.org_id)
    .single()
  const currentCost = (rRow?.cost_cents as number | undefined) ?? 0

  const { error: updErr } = await service
    .from('recordings')
    .update({
      asr_vendor_chosen: vendor,
      cost_cents: currentCost + dispatched.cost_cents,
    })
    .eq('id', recording.id)
    .eq('org_id', recording.org_id)
  if (updErr) {
    throw new Error(`recordings update after transcribe failed: ${updErr.message}`)
  }

  return {
    transcript_id: tRow.id as string,
    vendor,
    language_detected: dispatched.language_detected,
    segments: dispatched.segments,
    duration_sec: dispatched.duration_sec,
    word_count,
    cost_cents: dispatched.cost_cents,
  }
}

// ── Vendor dispatch ──────────────────────────────────────────────────────────

interface DispatchedTranscript {
  segments: TranscriptSegment[]
  language_detected: string | null
  raw_response: unknown
  duration_sec: number | null
  cost_cents: number
}

async function dispatchVendor(
  vendor: AsrVendor,
  language: string,
  service: ReturnType<typeof createServiceRoleClient>,
  path: string,
): Promise<DispatchedTranscript> {
  const lang = normalizeLang(language)

  if (vendor === 'whisper') {
    const bytes = await downloadBytes(service, path)
    assertWhisperFits(bytes.byteLength)
    return toDispatched(await transcribeWhisper({ audioBytes: bytes, filename: 'stitched.mp3', language: lang }))
  }

  if (vendor === 'deepgram') {
    const url = await signedUrl(service, path)
    return toDispatched(await transcribeDeepgram({ audioUrl: url, language: lang }))
  }

  // hybrid — run both, align text+speakers.
  const [bytes, url] = await Promise.all([downloadBytes(service, path), signedUrl(service, path)])
  assertWhisperFits(bytes.byteLength)
  const [whisper, deepgram] = await Promise.all([
    transcribeWhisper({ audioBytes: bytes, filename: 'stitched.mp3', language: lang }),
    transcribeDeepgram({ audioUrl: url, language: lang }),
  ])
  return toDispatched(alignHybrid(whisper, deepgram))
}

function toDispatched(r: WhisperResult | DeepgramResult | ReturnType<typeof alignHybrid>): DispatchedTranscript {
  return {
    segments: r.segments,
    language_detected: r.language_detected,
    raw_response: r.raw_response,
    duration_sec: r.duration_sec,
    cost_cents: r.cost_cents,
  }
}

function pickVendor(
  rec: Pick<RecordingRow, 'language' | 'session_type' | 'setup_inputs' | 'asr_strategy'>,
): AsrVendor {
  if (rec.asr_strategy === 'whisper') return 'whisper'
  if (rec.asr_strategy === 'deepgram') return 'deepgram'
  if (rec.asr_strategy === 'hybrid') return 'hybrid'
  return resolveAsrVendor({
    session_type: rec.session_type,
    language: rec.language,
    setup_inputs: rec.setup_inputs,
  })
}

function assertWhisperFits(bytes: number): void {
  if (bytes > WHISPER_MAX_BYTES) {
    // TODO: chunk via ffmpeg into ≤24MB segments with 2s overlap (spec § 3.4).
    // PM-1 audio at 32kbps mono mp3 is ~14MB for 60min, well under, so this
    // doesn't block the pilot — but longer / higher-quality meetings will hit it.
    throw new Error(
      `Stitched audio is ${bytes} bytes — exceeds Whisper's 25MB limit. ` +
      `Chunking is not yet implemented; pick a non-Whisper strategy or shorten the recording.`,
    )
  }
}

function normalizeLang(lang: string): string {
  // BCP-47 → primary subtag for vendor APIs that expect 'en' / 'es'.
  return (lang || 'en').split('-')[0].toLowerCase()
}

function countWords(segments: TranscriptSegment[]): number {
  let n = 0
  for (const s of segments) {
    if (!s.text) continue
    const words = s.text.split(/\s+/)
    for (const w of words) if (w) n++
  }
  return n
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function downloadBytes(
  service: ReturnType<typeof createServiceRoleClient>,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await service.storage.from(BUCKET).download(path)
  if (error || !data) {
    throw new Error(`storage download ${BUCKET}/${path} failed: ${error?.message ?? 'no data'}`)
  }
  const buf = await data.arrayBuffer()
  return new Uint8Array(buf)
}

async function signedUrl(
  service: ReturnType<typeof createServiceRoleClient>,
  path: string,
): Promise<string> {
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC)
  if (error || !data?.signedUrl) {
    throw new Error(`storage signed url ${BUCKET}/${path} failed: ${error?.message ?? 'no url'}`)
  }
  return data.signedUrl
}
