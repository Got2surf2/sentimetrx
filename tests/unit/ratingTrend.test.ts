import { describe, it, expect } from 'vitest'
import { buildRatingTrend, type RatingTrendInput } from '@/lib/ratingTrend'

// Build a monthly series: start ym, then [avg, n] per consecutive month.
function months(start: string, pairs: [number, number][]): { ym: string; sum: number; n: number }[] {
  let [y, m] = start.split('-').map(Number)
  return pairs.map(([avg, n]) => {
    const ym = `${y}-${String(m).padStart(2, '0')}`
    m++; if (m > 12) { m = 1; y++ }
    return { ym, sum: avg * n, n }
  })
}

describe('buildRatingTrend', () => {
  it('returns null with fewer than two series that have data', () => {
    const inputs: RatingTrendInput[] = [
      { name: 'A', focus: true, monthlyRatings: months('2024-01', [[4.2, 50], [4.3, 50]]) },
      { name: 'B', focus: false },   // no data
    ]
    expect(buildRatingTrend(inputs)).toBeNull()
  })

  it('builds per-series points + a recent-vs-prior delta', () => {
    // 24 months each; brand A slides, brand B climbs.
    const a = months('2024-01', Array.from({ length: 24 }, (_, i) => [4.6 - i * 0.03, 40] as [number, number]))
    const b = months('2024-01', Array.from({ length: 24 }, (_, i) => [3.8 + i * 0.02, 40] as [number, number]))
    const model = buildRatingTrend([
      { name: 'Capital Grille', focus: true, monthlyRatings: a },
      { name: 'Nobu', focus: false, monthlyRatings: b },
    ])!
    expect(model).not.toBeNull()
    expect(model.series).toHaveLength(2)
    expect(model.series[0].focus).toBe(true)
    expect(model.keys.length).toBeGreaterThan(1)
    // focus brand's recent window should be below its prior (it slid)
    const aDelta = model.deltas.find(d => d.name === 'Capital Grille')!
    expect(aDelta.recentAvg).not.toBeNull()
    expect(aDelta.priorAvg).not.toBeNull()
    expect(aDelta.delta!).toBeLessThan(0)
    const bDelta = model.deltas.find(d => d.name === 'Nobu')!
    expect(bDelta.delta!).toBeGreaterThan(0)
  })

  it('buckets to quarters for a multi-year span and clamps the y-axis to stars', () => {
    const a = months('2022-01', Array.from({ length: 40 }, () => [4.4, 30] as [number, number]))
    const b = months('2022-01', Array.from({ length: 40 }, () => [4.1, 30] as [number, number]))
    const model = buildRatingTrend([
      { name: 'A', focus: true, monthlyRatings: a },
      { name: 'B', focus: false, monthlyRatings: b },
    ])!
    expect(model.unit).toBe('quarter')
    expect(model.keys[0]).toMatch(/^\d{4}-Q[1-4]$/)
    expect(model.yMin).toBeGreaterThanOrEqual(1)
    expect(model.yMax).toBeLessThanOrEqual(5)
    expect(model.yMin).toBeLessThan(model.yMax)
  })

  it('suppresses a delta when a window is too thin (min-reviews guard)', () => {
    const a = months('2025-01', [[4.5, 100], [4.5, 100], [4.4, 100], [4.4, 2]])   // last bucket tiny
    const b = months('2025-01', [[4.0, 100], [4.0, 100], [4.0, 100], [4.0, 100]])
    const model = buildRatingTrend([
      { name: 'A', focus: true, monthlyRatings: a },
      { name: 'B', focus: false, monthlyRatings: b },
    ], { minBucketReviews: 20 })!
    const aDelta = model.deltas.find(d => d.name === 'A')!
    // recent window only has the 2-review month → below the floor → null
    expect(aDelta.recentAvg).toBeNull()
  })
})
