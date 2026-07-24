import { describe, it, expect } from 'vitest'
import { nudgeSegmentStart, splitSegmentAt, mergeSegmentUp, MIN_SEG_SEC } from '@/lib/recordings/segmentEdits'
import type { TranscriptSegment } from '@/lib/recordings/types'

const seg = (start: number, end: number, text: string, speaker?: string): TranscriptSegment =>
  ({ start, end, text, speaker })

describe('nudgeSegmentStart', () => {
  it('moves the start and carries the previous turn end to the shared boundary', () => {
    const segs = [seg(0, 5, 'A', 'S1'), seg(5, 10, 'B', 'S2')]
    const out = nudgeSegmentStart(segs, 1, -1)     // B starts 1s earlier
    expect(out[1].start).toBe(4)
    expect(out[0].end).toBe(4)                     // boundary moved with it
    expect(out[0].start).toBe(0)                   // untouched
    expect(segs[1].start).toBe(5)                  // input not mutated
  })

  it('clamps so neither segment collapses below the minimum', () => {
    const segs = [seg(0, 5, 'A', 'S1'), seg(5, 10, 'B', 'S2')]
    const tooFar = nudgeSegmentStart(segs, 1, -100) // cannot cross prev.start
    expect(tooFar[1].start).toBe(MIN_SEG_SEC)
    const tooLate = nudgeSegmentStart(segs, 1, 100) // cannot pass its own end
    expect(tooLate[1].start).toBe(10 - MIN_SEG_SEC)
  })

  it('is a no-op for the first segment boundary and out-of-range indices', () => {
    const segs = [seg(0, 5, 'A'), seg(5, 10, 'B')]
    expect(nudgeSegmentStart(segs, 0, -1)[0].start).toBe(0)  // idx 0 has no prior turn; delta<0 clamps to 0
    expect(nudgeSegmentStart(segs, 9, -1)).toBe(segs)        // out of range → same ref
  })
})

describe('splitSegmentAt', () => {
  it('splits text at the cursor and interpolates the boundary time', () => {
    const segs = [seg(10, 20, 'hello there. goodbye now', 'S1')]  // len 24
    const out = splitSegmentAt(segs, 0, 12)                       // split after "hello there."
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe('hello there.')
    expect(out[1].text).toBe('goodbye now')
    expect(out[0].end).toBe(15)                                  // 10 + 10*(12/24)
    expect(out[1].start).toBe(15)
    expect(out[0].speaker).toBe('S1')                            // first keeps the speaker
    expect(out[1].speaker).toBeUndefined()                      // second left to assign
  })

  it('is a no-op at either text end or a whitespace-only split', () => {
    const segs = [seg(0, 5, 'hello world')]
    expect(splitSegmentAt(segs, 0, 0)).toBe(segs)
    expect(splitSegmentAt(segs, 0, 11)).toBe(segs)               // caret at very end
  })

  it('shifts the second half source_offset by the elapsed time', () => {
    const s: TranscriptSegment = { start: 10, end: 20, text: 'aaaaa bbbbb', source_file: 'clip.mp3', source_offset: 100 }
    const out = splitSegmentAt([s], 0, 6)                        // split after "aaaaa "
    expect(out[0].source_offset).toBe(100)
    expect(out[1].source_offset).toBeCloseTo(100 + (out[1].start - 10))
    expect(out[1].source_file).toBe('clip.mp3')
  })
})

describe('mergeSegmentUp', () => {
  it('joins a segment into the previous one (span + text), keeping the prior speaker', () => {
    const segs = [seg(0, 4, 'first half', 'S1'), seg(4, 9, 'second half', 'S2')]
    const out = mergeSegmentUp(segs, 1)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ start: 0, end: 9, text: 'first half second half', speaker: 'S1' })
  })

  it('inherits the merged-in speaker only when the previous was unassigned', () => {
    const segs = [seg(0, 4, 'um', undefined), seg(4, 9, 'the real point', 'S3')]
    expect(mergeSegmentUp(segs, 1)[0].speaker).toBe('S3')
  })

  it('is a no-op for the first segment or an out-of-range index', () => {
    const segs = [seg(0, 4, 'a'), seg(4, 9, 'b')]
    expect(mergeSegmentUp(segs, 0)).toBe(segs)
    expect(mergeSegmentUp(segs, 5)).toBe(segs)
  })
})
