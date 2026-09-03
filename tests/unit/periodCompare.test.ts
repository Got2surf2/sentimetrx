// tests/unit/periodCompare.test.ts
// Period-over-period comparison math (lib/periodCompare) behind the Charts
// "Compare periods" control. Pins the calendar-exact alignment (gaps filled,
// sparse data can't shift the window), both modes' window selection, the
// honest-null rules, and the delta summary's weighting.

import { describe, it, expect } from 'vitest'
import { shiftBucket, fillBuckets, buildPeriodComparison } from '@/lib/periodCompare'

describe('shiftBucket / fillBuckets', () => {
  it('shifts months across year boundaries', () => {
    expect(shiftBucket('2026-01', 'month', -1)).toBe('2025-12')
    expect(shiftBucket('2025-11', 'month', 3)).toBe('2026-02')
  })

  it('shifts quarters and weeks on their grids', () => {
    expect(shiftBucket('2026-Q1', 'quarter', -2)).toBe('2025-Q3')
    expect(shiftBucket('2026-08-31', 'week', -1)).toBe('2026-08-24') // Mondays stay Mondays
  })

  it('fills the complete sequence including empty buckets', () => {
    expect(fillBuckets('2025-11', '2026-02', 'month')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(fillBuckets('2026-Q3', '2027-Q1', 'quarter')).toEqual(['2026-Q3', '2026-Q4', '2027-Q1'])
  })
})

function months(from: string, n: number): string[] {
  const out = [from]
  for (let i = 1; i < n; i++) out.push(shiftBucket(from, 'month', i))
  return out
}

describe('buildPeriodComparison — prev mode', () => {
  it('splits the filled span into equal halves and aligns bucket-for-bucket', () => {
    const dates = months('2025-01', 12)
    const counts = dates.map((_, i) => 100 + i) // 100..111
    const r = buildPeriodComparison({ dates, counts, unit: 'month', mode: 'prev', metric: false })!
    expect(r.x).toEqual(months('2025-07', 6))
    expect(r.comparisonKeys).toEqual(months('2025-01', 6))
    expect(r.current).toEqual([106, 107, 108, 109, 110, 111])
    expect(r.comparison).toEqual([100, 101, 102, 103, 104, 105])
    expect(r.label).toBe('vs previous 6 months')
    expect(r.delta.currentTotal).toBe(651)
    expect(r.delta.priorTotal).toBe(615)
    expect(r.delta.pctChange).toBeCloseTo(5.85, 1)
  })

  it('a missing bucket is a real 0 in count mode — the gap cannot shift alignment', () => {
    const dates = ['2025-01', '2025-02', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08'] // 2025-03 absent
    const counts = [10, 10, 10, 10, 10, 10, 10]
    const r = buildPeriodComparison({ dates, counts, unit: 'month', mode: 'prev', metric: false })!
    expect(r.x).toEqual(['2025-05', '2025-06', '2025-07', '2025-08'])
    expect(r.comparisonKeys).toEqual(['2025-01', '2025-02', '2025-03', '2025-04'])
    expect(r.comparison).toEqual([10, 10, 0, 10])
  })

  it('returns null when a side would have fewer than 4 buckets', () => {
    const dates = months('2025-01', 6)
    expect(buildPeriodComparison({ dates, counts: dates.map(() => 1), unit: 'month', mode: 'prev', metric: false })).toBeNull()
  })
})

describe('buildPeriodComparison — yoy mode', () => {
  it('compares the trailing year against the same calendar window one year back', () => {
    const dates = months('2024-01', 30) // 2024-01 .. 2026-06
    const counts = dates.map((_, i) => i)
    const r = buildPeriodComparison({ dates, counts, unit: 'month', mode: 'yoy', metric: false })!
    expect(r.x).toEqual(months('2025-07', 12))
    expect(r.comparisonKeys).toEqual(months('2024-07', 12))
    expect(r.label).toBe('vs same period last year')
  })

  it('caps the current window to available pre-year history', () => {
    const dates = months('2025-01', 17) // 17 months: only 5 have a full year behind them
    const r = buildPeriodComparison({ dates, counts: dates.map(() => 2), unit: 'month', mode: 'yoy', metric: false })!
    expect(r.x).toHaveLength(5)
    expect(r.x[0]).toBe('2026-01')
    expect(r.comparisonKeys[0]).toBe('2025-01')
  })

  it('returns null without a year of history', () => {
    const dates = months('2026-01', 10)
    expect(buildPeriodComparison({ dates, counts: dates.map(() => 5), unit: 'month', mode: 'yoy', metric: false })).toBeNull()
  })

  it('quarter yoy: 2026-Q3 compares against 2025-Q3', () => {
    const dates = fillBuckets('2024-Q1', '2026-Q3', 'quarter')
    const r = buildPeriodComparison({ dates, counts: dates.map(() => 8), unit: 'quarter', mode: 'yoy', metric: false })!
    expect(r.x[r.x.length - 1]).toBe('2026-Q3')
    expect(r.comparisonKeys[r.comparisonKeys.length - 1]).toBe('2025-Q3')
  })
})

describe('metric mode', () => {
  it('per-bucket y is the average, empty buckets are gaps, and the delta is count-weighted', () => {
    const dates = months('2025-01', 8)
    const counts = [2, 2, 2, 2, 1, 3, 0, 2]
    const sums = [8, 8, 8, 8, 5, 9, null, 10] // avgs: 4,4,4,4,5,3,gap,5
    const r = buildPeriodComparison({ dates, counts, sums, unit: 'month', mode: 'prev', metric: true })!
    expect(r.current).toEqual([5, 3, null, 5])
    expect(r.comparison).toEqual([4, 4, 4, 4])
    // Weighted: current (5+9+10)/(1+3+2) = 4 ; prior 32/8 = 4
    expect(r.delta.currentTotal).toBe(4)
    expect(r.delta.priorTotal).toBe(4)
    expect(r.delta.pctChange).toBe(0)
  })
})
