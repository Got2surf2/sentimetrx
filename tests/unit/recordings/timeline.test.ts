import { describe, it, expect } from 'vitest'
import { packLanes, buildTimelineModel } from '@/lib/recordings/timeline'

describe('packLanes', () => {
  it('keeps sequential (non-overlapping) spans all on lane 0', () => {
    const { lanes, laneCount } = packLanes([
      { start: 0, end: 10 }, { start: 10, end: 20 }, { start: 25, end: 30 },
    ])
    expect(lanes).toEqual([0, 0, 0])
    expect(laneCount).toBe(1)
  })

  it('bumps an overlapping span to a second lane (the #10/#11 case)', () => {
    // #10: 1435-1465 nests inside #11: 1443-1602 → distinct lanes.
    const { lanes, laneCount } = packLanes([
      { start: 1435, end: 1465 }, { start: 1443, end: 1602 }, { start: 1729, end: 1801 },
    ])
    expect(lanes).toEqual([0, 1, 0])   // third span no longer overlaps → back to lane 0
    expect(laneCount).toBe(2)
  })
})

describe('buildTimelineModel', () => {
  it('returns null when no pair has a start time', () => {
    expect(buildTimelineModel([{ start_sec: null, end_sec: null }], 600)).toBeNull()
  })

  it('numbers chronologically and assigns lanes for overlaps', () => {
    const model = buildTimelineModel([
      { start_sec: 1443, end_sec: 1602 },  // out of order on purpose
      { start_sec: 17, end_sec: 203 },
      { start_sec: 1435, end_sec: 1465 },
    ], 2760)!
    expect(model.count).toBe(3)
    expect(model.laneCount).toBe(2)
    // sorted by start: 17 (#1,L0), 1435 (#2,L0), 1443 (#3,L1 — overlaps #2)
    expect(model.segments.map(s => [s.index, s.lane, s.startSec])).toEqual([
      [1, 0, 17], [2, 0, 1435], [3, 1, 1443],
    ])
  })
})
