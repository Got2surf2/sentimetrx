// lib/asr/whisper.ts
//
// OpenAI Whisper batch transcription. Multilingual-strong, no diarization.
// Per spec § 3.4: $0.006/min. 60-min meeting ≈ $0.36.
//
// Input: a signed Storage URL pointing at the stitched mp3 (≤25MB) OR raw
// bytes for the chunked path. The caller chunks oversize files into ≤24MB
// segments with 2s overlap and stitches results with offsets.

import 'server-only'
import type { AsrVendor, TranscriptSegment } from '@/lib/recordings/types'

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions'
const WHISPER_MODEL = 'whisper-1'
const WHISPER_USD_PER_MINUTE = 0.006

export interface WhisperResult {
  vendor: AsrVendor              // always 'whisper' from this adapter
  segments: TranscriptSegment[]
  language_detected: string | null
  raw_response: unknown
  duration_sec: number | null
  cost_cents: number
}

export interface WhisperInput {
  audioBytes: Uint8Array | Buffer
  filename: string                // for the multipart payload
  language?: string               // BCP-47 hint (e.g. 'en', 'es'); omitted → auto-detect
  /** When chunking, offset added to every segment.start/end so the merged transcript is contiguous. */
  segmentOffsetSec?: number
  /** When chunking, record the original source file name on each segment for the audio viewer. */
  sourceFile?: string
}

export async function transcribeWhisper(input: WhisperInput): Promise<WhisperResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for Whisper transcription')

  const form = new FormData()
  const audioBuffer = input.audioBytes instanceof Buffer
    ? input.audioBytes
    : Buffer.from(input.audioBytes)
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' })
  form.append('file', blob, input.filename)
  form.append('model', WHISPER_MODEL)
  form.append('response_format', 'verbose_json')   // gives per-segment timestamps
  if (input.language) form.append('language', input.language)

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Whisper API ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json() as {
    text: string
    language?: string
    duration?: number
    segments?: Array<{
      start: number
      end: number
      text: string
      avg_logprob?: number
    }>
  }

  const offset = input.segmentOffsetSec ?? 0
  const segments: TranscriptSegment[] = (data.segments ?? []).map(s => ({
    start: s.start + offset,
    end: s.end + offset,
    text: s.text.trim(),
    confidence: typeof s.avg_logprob === 'number'
      ? Math.max(0, Math.min(1, Math.exp(s.avg_logprob)))
      : undefined,
    ...(input.sourceFile ? { source_file: input.sourceFile, source_offset: s.start } : {}),
  }))

  const durationSec = data.duration ?? null
  const cost_cents = durationSec
    ? Math.ceil((durationSec / 60) * WHISPER_USD_PER_MINUTE * 100)
    : 0

  return {
    vendor: 'whisper',
    segments,
    language_detected: data.language ?? null,
    raw_response: data,
    duration_sec: durationSec ? Math.round(durationSec) : null,
    cost_cents,
  }
}

/**
 * Merge transcripts from chunked Whisper calls. Caller passes each chunk's
 * result; we concatenate segments (already offset-corrected by the per-chunk
 * `segmentOffsetSec`) and sum costs.
 */
export function mergeWhisperChunks(chunks: WhisperResult[]): WhisperResult {
  if (chunks.length === 0) {
    return {
      vendor: 'whisper',
      segments: [],
      language_detected: null,
      raw_response: { chunks: [] },
      duration_sec: 0,
      cost_cents: 0,
    }
  }
  const segments = chunks.flatMap(c => c.segments).sort((a, b) => a.start - b.start)
  return {
    vendor: 'whisper',
    segments,
    language_detected: chunks[0].language_detected,
    raw_response: { chunks: chunks.map(c => c.raw_response) },
    duration_sec: chunks.reduce((sum, c) => sum + (c.duration_sec ?? 0), 0),
    cost_cents: chunks.reduce((sum, c) => sum + c.cost_cents, 0),
  }
}
