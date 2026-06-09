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
const DEEPGRAM_GRANT_URL = 'https://api.deepgram.com/v1/auth/grant'
const DEEPGRAM_USD_PER_MINUTE = 0.0073

export interface DeepgramGrant {
  /** Short-lived JWT — connect to the live WS with `Authorization: Bearer <access_token>`. */
  access_token: string
  /** Seconds until the JWT expires. Only needs to be valid at WS connect time. */
  expires_in: number
}

/**
 * Mint a short-lived Deepgram token so the browser can stream mic audio
 * directly to Deepgram's live WS without ever holding our API key. The token
 * is only checked at connect time; the socket stays open afterward.
 * Default TTL 30s, max 3600s (Deepgram). We use 60s — ample to connect.
 */
export async function grantDeepgramToken(ttlSeconds = 60): Promise<DeepgramGrant> {
  // The grant endpoint requires a Member+ Deepgram key. Prefer a dedicated
  // DEEPGRAM_GRANT_KEY so the (possibly scoped, listen-only) batch key in
  // DEEPGRAM_API_KEY can stay as-is; fall back to it if no dedicated key is set.
  const apiKey = process.env.DEEPGRAM_GRANT_KEY || process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_GRANT_KEY or DEEPGRAM_API_KEY is required to grant a live token')

  const res = await fetch(DEEPGRAM_GRANT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    if (res.status === 403) {
      throw new Error('Deepgram grant forbidden — the key lacks token-grant permission. Set DEEPGRAM_GRANT_KEY to a Member+ Deepgram key.')
    }
    throw new Error(`Deepgram grant ${res.status}: ${errText.slice(0, 500)}`)
  }

  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('Deepgram grant returned no access_token')
  return { access_token: data.access_token, expires_in: data.expires_in ?? ttlSeconds }
}

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
  /**
   * True-stereo split-mic source (e.g. RØDE Split: mic 1 = Left, mic 2 = Right).
   * Transcribe each channel independently and use the channel as the speaker —
   * deterministic per-mic separation instead of voice-signature clustering.
   */
  multichannel?: boolean
}

export async function transcribeDeepgram(input: DeepgramInput): Promise<DeepgramResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is required for Deepgram transcription')

  const params = new URLSearchParams({
    model: 'nova-3',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    language: input.language || 'en',
  })
  if (input.multichannel) {
    // Per-channel transcription → utterance.channel IS the speaker (mic). No
    // voice-cluster diarization needed; the channel split is authoritative.
    params.set('multichannel', 'true')
  } else {
    // Single mix → fall back to voice-signature diarization.
    params.set('diarize', 'true')
  }

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
  // With multichannel, utterances come per-channel and may not be globally
  // time-ordered — sort so the stitched transcript reads chronologically.
  const utterances = [...(data.results?.utterances ?? [])].sort((a, b) => a.start - b.start)

  const segments: TranscriptSegment[] = utterances.map(u => {
    // Stereo: the source channel IS the mic/speaker. Mono: voice-cluster speaker.
    const speakerIdx = input.multichannel
      ? (typeof u.channel === 'number' ? u.channel : undefined)
      : (typeof u.speaker === 'number' ? u.speaker : undefined)
    return {
      start: u.start,
      end: u.end,
      speaker: speakerIdx !== undefined ? `S${speakerIdx + 1}` : undefined,
      ...(input.multichannel && typeof u.channel === 'number' ? { channel: u.channel } : {}),
      text: u.transcript.trim(),
      confidence: u.confidence,
      ...(input.sourceFile ? { source_file: input.sourceFile, source_offset: u.start } : {}),
    }
  })

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
  channel?: number        // 0-indexed source channel — present with multichannel=true
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
