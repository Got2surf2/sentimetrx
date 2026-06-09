// lib/asr/hybrid.ts
//
// Hybrid alignment (WhisperX-style): Whisper text as authoritative content,
// Deepgram speaker turn boundaries as authoritative diarization. Per spec
// § 3.4: ~$0.013/min combined. 60-min meeting ≈ $0.78.
//
// Algorithm:
//   For each Whisper segment, find the Deepgram utterance with the largest
//   time-overlap (majority-overlap rule). Assign that utterance's speaker
//   label to the Whisper segment. If no Deepgram utterance overlaps, leave
//   the speaker undefined.
//
// Confidence: take the Whisper confidence (text is Whisper's authority).
// Time bounds: Whisper's start/end (its segmentation is finer-grained).

import 'server-only'
import type { AsrVendor, TranscriptSegment } from '@/lib/recordings/types'
import type { WhisperResult } from '@/lib/asr/whisper'
import type { DeepgramResult } from '@/lib/asr/deepgram'

export interface HybridResult {
  vendor: AsrVendor              // always 'hybrid'
  segments: TranscriptSegment[]
  language_detected: string | null
  raw_response: unknown
  duration_sec: number | null
  cost_cents: number
}

export function alignHybrid(whisper: WhisperResult, deepgram: DeepgramResult): HybridResult {
  const dgSegments = deepgram.segments
  const segments: TranscriptSegment[] = whisper.segments.map(w => {
    const match = bestOverlapSegment(w.start, w.end, dgSegments)
    if (!match) return w
    return {
      ...w,
      speaker: match.speaker,
      ...(typeof match.channel === 'number' ? { channel: match.channel } : {}),
    }
  })

  return {
    vendor: 'hybrid',
    segments,
    language_detected: whisper.language_detected ?? deepgram.language_detected,
    raw_response: {
      whisper: whisper.raw_response,
      deepgram: deepgram.raw_response,
    },
    duration_sec: whisper.duration_sec ?? deepgram.duration_sec,
    cost_cents: whisper.cost_cents + deepgram.cost_cents,
  }
}

/** Find the Deepgram utterance (speaker + source channel) overlapping a window most. */
function bestOverlapSegment(
  wStart: number,
  wEnd: number,
  dgSegments: TranscriptSegment[],
): TranscriptSegment | null {
  let best: TranscriptSegment | null = null
  let bestOverlap = 0
  for (const d of dgSegments) {
    if (d.end < wStart) continue
    if (d.start > wEnd) break        // dg segments sorted by start; we can stop
    if (!d.speaker) continue
    const overlap = Math.max(0, Math.min(d.end, wEnd) - Math.max(d.start, wStart))
    if (overlap > bestOverlap) {
      bestOverlap = overlap
      best = d
    }
  }
  return best
}
