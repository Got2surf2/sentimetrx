import { describe, it, expect } from 'vitest'
import { alignHybrid } from '@/lib/asr/hybrid'
import type { WhisperResult } from '@/lib/asr/whisper'
import type { DeepgramResult } from '@/lib/asr/deepgram'

// Hybrid uses Whisper text as authoritative content and Deepgram for speaker +
// (for split-mic stereo) the source channel. These cover the channel-stamping
// added for RØDE per-mic separation (sql/122).

function whisper(segments: WhisperResult['segments']): WhisperResult {
  return { vendor: 'whisper', segments, language_detected: 'en', raw_response: {}, duration_sec: 10, cost_cents: 1 }
}
function deepgram(segments: DeepgramResult['segments']): DeepgramResult {
  return { vendor: 'deepgram', segments, language_detected: 'en', raw_response: {}, duration_sec: 10, cost_cents: 1 }
}

describe('alignHybrid — per-mic channel propagation', () => {
  it('carries the source channel from the best-overlap Deepgram utterance onto the Whisper segment', () => {
    const w = whisper([{ start: 0, end: 4, text: 'hello there' }])
    const dg = deepgram([{ start: 0, end: 4, speaker: 'S2', channel: 1, text: 'hello there' }])
    const { segments } = alignHybrid(w, dg)
    expect(segments[0].speaker).toBe('S2')
    expect(segments[0].channel).toBe(1)
  })

  it('omits channel entirely for a mono (no-channel) Deepgram source', () => {
    const w = whisper([{ start: 0, end: 4, text: 'hello there' }])
    const dg = deepgram([{ start: 0, end: 4, speaker: 'S1', text: 'hello there' }])
    const { segments } = alignHybrid(w, dg)
    expect(segments[0].speaker).toBe('S1')
    expect('channel' in segments[0]).toBe(false)
  })

  it('picks the channel of the majority-overlapping utterance when two mics overlap a window', () => {
    const w = whisper([{ start: 0, end: 10, text: 'crosstalk window' }])
    const dg = deepgram([
      { start: 0, end: 2, speaker: 'S1', channel: 0, text: 'brief' },
      { start: 2, end: 10, speaker: 'S2', channel: 1, text: 'dominant' },
    ])
    const { segments } = alignHybrid(w, dg)
    expect(segments[0].channel).toBe(1)
  })
})
