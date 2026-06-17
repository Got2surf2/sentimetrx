// lib/recordings/transcribeSpan.ts
//
// Targeted re-transcription of a single time span (docs/RECORDINGS.md §5.3) —
// the fix for a flagged "long quiet stretch" in the coverage report. Slices the
// stored stitched audio to [start_sec, end_sec], runs a fresh ASR pass on JUST
// that clip (isolating faint/quiet speech a full-file pass can gloss over), then
// folds the new segments back into recording_transcripts.segments at absolute
// offsets. Existing segments overlapping the span are dropped first so the span
// is replaced, not duplicated.
//
// Vendor: Whisper is the better default for quiet stretches (not VAD-gated, so
// it surfaces faint speech); Deepgram is offered as an alternative.
//
// Runs ffmpeg in a Vercel Sandbox (reuses lib/recordings/extract helpers), so
// this is a workflow step, not an inline route call.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { transcribeWhisper } from '@/lib/asr/whisper'
import { transcribeDeepgram } from '@/lib/asr/deepgram'
import { bootSandbox, runOrThrow, freshReadUrl, freshUploadUrl, shellQuote, BUCKET } from '@/lib/recordings/extract'
import type { TranscriptSegment } from '@/lib/recordings/types'

export type SpanVendor = 'whisper' | 'deepgram'

export async function transcribeSpan(
  recording_id: string,
  org_id: string,
  start_sec: number,
  end_sec: number,
  vendor: SpanVendor,
): Promise<{ added: number; removed: number }> {
  const service = createServiceRoleClient()

  const { data: rec } = await service
    .from('recordings')
    .select('id, language, cost_cents')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (!rec) throw new Error('recording not found')
  const language = (rec as { language?: string }).language || 'en'

  const start = Math.max(0, Math.floor(start_sec))
  const end = Math.max(start + 1, Math.ceil(end_sec))
  const dur = end - start

  const stitchedPath = `${org_id}/${recording_id}/audio/stitched.mp3`
  const spanPath = `${org_id}/${recording_id}/audio/_span_${start}_${end}.mp3`

  // 1. Slice [start, end] out of the stitched audio in a Sandbox (mp3 stream
  //    copy — fast, no re-encode), upload the clip to a temp Storage object.
  const readUrl = await freshReadUrl(service, stitchedPath)
  const spanUploadUrl = await freshUploadUrl(service, spanPath)
  const sandbox = await bootSandbox()
  try {
    await runOrThrow(sandbox, ['sh', '-c', `curl -fsSL '${shellQuote(readUrl)}' -o /tmp/full.mp3`], 'download stitched')
    await runOrThrow(sandbox, ['sh', '-c',
      `ffmpeg -y -ss ${start} -t ${dur} -i /tmp/full.mp3 -c copy /tmp/span.mp3`], 'slice span')
    await runOrThrow(sandbox, ['sh', '-c',
      `curl -fsS -X PUT -H 'Content-Type: audio/mpeg' -H 'x-upsert: true' --data-binary @/tmp/span.mp3 '${shellQuote(spanUploadUrl)}'`],
      'upload span')
  } finally {
    await sandbox.stop().catch(() => undefined)
  }

  // 2. ASR the clip. Deepgram fetches the signed URL; Whisper wants bytes.
  const spanReadUrl = await freshReadUrl(service, spanPath)
  const asr = vendor === 'deepgram'
    ? await transcribeDeepgram({ audioUrl: spanReadUrl, language })
    : await transcribeWhisper({
        audioBytes: Buffer.from(await (await fetch(spanReadUrl)).arrayBuffer()),
        filename: 'span.mp3',
        language,
      })

  // 3. Shift the clip-relative segment times back to absolute and tag them.
  const newSegs: TranscriptSegment[] = asr.segments.map(s => ({
    ...s,
    start: s.start + start,
    end: s.end + start,
    source_file: s.source_file ?? 'span re-transcribe',
  }))

  // 4. Merge: drop existing segments overlapping the span, add the new ones,
  //    re-sort by start, recompute word_count.
  const { data: tr } = await service
    .from('recording_transcripts')
    .select('id, segments')
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (!tr) throw new Error('transcript not found')
  const existing = ((tr as { segments?: TranscriptSegment[] }).segments ?? []) as TranscriptSegment[]
  const kept = existing.filter(s => !(s.start < end && s.end > start))
  const merged = [...kept, ...newSegs].sort((a, b) => a.start - b.start)
  const word_count = merged.reduce((n, s) => n + (s.text ? (s.text.match(/\b[\w']+\b/g)?.length ?? 0) : 0), 0)

  const { error: updErr } = await service
    .from('recording_transcripts')
    .update({ segments: merged, word_count })
    .eq('id', (tr as { id: string }).id)
    .eq('org_id', org_id)
  if (updErr) throw new Error(`transcript merge failed: ${updErr.message}`)

  // Accumulate the ASR cost (best-effort) and clean up the temp clip.
  if (asr.cost_cents) {
    const prior = (rec as { cost_cents?: number }).cost_cents ?? 0
    await service.from('recordings').update({ cost_cents: prior + asr.cost_cents }).eq('id', recording_id).eq('org_id', org_id)
  }
  await service.storage.from(BUCKET).remove([spanPath]).catch(() => undefined)

  return { added: newSegs.length, removed: existing.length - kept.length }
}
