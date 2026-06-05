import { describe, it, expect } from 'vitest'
import { buildTranscriptRoles, tightenSpansFromTranscript, traceActionItem } from '@/lib/recordings/transcriptRoles'

const seg = (start: number, text: string) => ({ start, end: start + 3, text })
const pair = (start_sec: number, end_sec: number, question: string, answer: string) => ({
  start_sec, end_sec, unit_type: 'qa_pair' as const, payload: { question, answer } as any,
})

describe('buildTranscriptRoles', () => {
  it('splits a pair monotonically at the question→answer boundary via word overlap', () => {
    const segments = [
      seg(10, 'how will you protect the lake drainage'),  // question
      seg(13, 'that is my main concern about drainage'),  // question
      seg(16, 'good question the drainage permits are handled by the county'), // answer
      seg(19, 'we get permits like everybody else'),       // answer
    ]
    const pairs = [pair(10, 22,
      'How will you protect the lake drainage? That is my main concern.',
      'Good question — the drainage permits are handled by the county; we get permits like everybody else.')]
    const roles = buildTranscriptRoles(segments, pairs)
    expect(roles.get(10)).toBe('question')
    expect(roles.get(13)).toBe('question')
    expect(roles.get(16)).toBe('answer')
    expect(roles.get(19)).toBe('answer')
  })

  it('leaves segments outside any pair span unmarked', () => {
    const segments = [seg(0, 'host housekeeping remarks'), seg(100, 'unrelated chatter')]
    const pairs = [pair(50, 60, 'a question', 'an answer')]
    const roles = buildTranscriptRoles(segments, pairs)
    expect(roles.has(0)).toBe(false)
    expect(roles.has(100)).toBe(false)
  })

  it('ignores non-qa_pair rows (e.g. action_item) and pairs without a start', () => {
    const segments = [seg(5, 'some content here about roads')]
    const actionItem = { start_sec: 5, end_sec: 8, unit_type: 'action_item' as const, payload: { description: 'do x' } as any }
    const noStart = { start_sec: null, end_sec: null, unit_type: 'qa_pair' as const, payload: { question: 'q', answer: 'a' } as any }
    const roles = buildTranscriptRoles(segments, [actionItem, noStart])
    expect(roles.size).toBe(0)
  })
})

describe('tightenSpansFromTranscript', () => {
  it('de-overlaps pairs by anchoring spans to their matched segments (global assignment)', () => {
    const segments = [
      seg(10, 'alpha question about parking lot access'),  // A question
      seg(20, 'alpha answer the parking lot is full now'),  // A answer
      seg(30, 'beta question about the budget shortfall'),  // B question
      seg(40, 'beta answer we have budget funds reserved'), // B answer
    ]
    // Loose spans overlap (A 10-35 ⊃ B's start 25); tightening must separate them.
    const pairs = [
      pair(10, 35, 'alpha question about parking lot access', 'alpha answer the parking lot is full now'),
      pair(25, 45, 'beta question about the budget shortfall', 'beta answer we have budget funds reserved'),
    ]
    const out = tightenSpansFromTranscript(segments, pairs)
    expect(out[0]).toEqual({ start_sec: 10, end_sec: 23 })   // A: its two segments only
    expect(out[1]).toEqual({ start_sec: 30, end_sec: 43 })   // B: 30 no longer stolen into A
    expect((out[0] as any).end_sec).toBeLessThanOrEqual((out[1] as any).start_sec)  // no overlap
  })

  it('falls back to the estimate when a pair matches no segment; null for non-pairs', () => {
    const segments = [seg(0, 'totally unrelated filler chatter')]
    const noMatch = pair(100, 130, 'a precise question', 'a precise answer')
    const action = { start_sec: 5, end_sec: 8, unit_type: 'action_item' as const, payload: { description: 'x' } as any }
    const out = tightenSpansFromTranscript(segments, [noMatch, action])
    expect(out[0]).toEqual({ start_sec: 100, end_sec: 130 })  // estimate kept
    expect(out[1]).toBeNull()
  })
})

describe('traceActionItem', () => {
  it('anchors on the distinctive-content window, ignoring filler segments', () => {
    const segments = [
      seg(0, 'and the the so yeah'),                                       // filler
      seg(10, 'we should investigate the Wekiva Parkway freight diversion'), // content
      seg(20, 'staff will look at Apopka freight numbers'),                 // content
      seg(30, 'okay thanks everyone'),                                      // filler
    ]
    const t = traceActionItem(segments, 'Staff to investigate Wekiva Parkway freight diversion from Apopka')
    expect(t).not.toBeNull()
    expect(t!.anchorStart).toBeGreaterThanOrEqual(10)
    expect(t!.anchorStart).toBeLessThanOrEqual(20)
  })

  it('returns null when nothing distinctive matches (no fabricated trace)', () => {
    const segments = [seg(0, 'and the the so yeah okay'), seg(5, 'right we will go now')]
    expect(traceActionItem(segments, 'Investigate the Wekiva Parkway freight diversion from Apopka')).toBeNull()
  })
})
