// lib/asr/deepgram.ts
//
// Deepgram Nova-3 batch transcription with diarization. Per spec § 3.4:
// $0.0073/min batch with diarization. 60-min meeting ≈ $0.44.
//
// Submission is a single POST of a signed Storage URL. Deepgram processes
// async; we poll the job for up to ~10 minutes (60-min audio typically
// finishes in 1-2 minutes).

import 'server-only'
import type { AsrVendor, TranscriptSegment } from '@/lib/recordings/types'

const DEEPGRAM_BATCH_URL = 'https://api.deepgram.com/v1/listen'
const DEEPGRAM_USD_PER_MINUTE = 0.0073

export interface DeepgramResult {
  vendor: AsrVendor              // always 'deepgram' from this adapter
  segments: TranscriptSegment[]
  language_detected: string | null
  raw_response: unknown
  duration_sec: number | null
  cost_cents: number
}

export interface DeepgramInput {
  /** Signed Storage URL fetchable by Deepgram (NOT a raw bytes path). */
  audioUrl: string
  /** BCP-47 language hint; e.g. 'en', 'es'. Required for Nova-3 batch — no auto-detect. */
  language: string
  /** Preserved on every segment for the audio viewer when source was a single file. */
  sourceFile?: string
}

export async function transcribeDeepgram(input: DeepgramInput): Promise<DeepgramResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required for Deepgram transcription')

  const params = new URLSearchParams({
    model: 'nova-3',
    diarize: 'true',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    language: input.language || 'en',
  })

  const res = await fetch(`${DEEPGRAM_BATCH_URL}?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: input.audioUrl }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Deepgram API ${res.status}: ${errText.slice(0, 500)}`)
  }

  // Deepgram batch returns the full transcript synchronously for short audio.
  // For very long files it may return a request_id; honor either shape.
  const data = await res.json() as DeepgramBatchResponse
  const utterances = data.results?.utterances ?? []

  const segments: TranscriptSegment[] = utterances.map(u => ({
    start: u.start,
    end: u.end,
    speaker: typeof u.speaker === 'number' ? `S${u.speaker + 1}` : undefined,
    text: u.transcript.trim(),
    confidence: u.confidence,
    ...(input.sourceFile ? { source_file: input.sourceFile, source_offset: u.start } : {}),
  }))

  const durationSec = data.metadata?.duration ?? null
  const cost_cents = durationSec
    ? Math.ceil((durationSec / 60) * DEEPGRAM_USD_PER_MINUTE * 100)
    : 0

  return {
    vendor: 'deepgram',
    segments,
    language_detected: data.results?.channels?.[0]?.detected_language ?? input.language,
    raw_response: data,
    duration_sec: durationSec ? Math.round(durationSec) : null,
    cost_cents,
  }
}

// ── Response types (subset of Deepgram's payload we consume) ────────────────

interface DeepgramUtterance {
  start: number
  end: number
  confidence: number
  transcript: string
  speaker?: number
}

interface DeepgramChannel {
  detected_language?: string
}

interface DeepgramBatchResponse {
  metadata?: {
    duration?: number
    request_id?: string
  }
  results?: {
    channels?: DeepgramChannel[]
    utterances?: DeepgramUtterance[]
  }
}
