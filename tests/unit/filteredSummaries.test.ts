import { describe, it, expect } from 'vitest'
import { recomputeFilteredSummaries } from '@/components/analyze/ChartsModule'

// recomputeFilteredSummaries makes the summary-driven charts (plain Count/%
// bar, no-split Distribution, treemap, bubbles, waterfall) filter-aware by
// recounting the filtered rows, so they agree with the stacked/Average bars.
type F = { field: string; type: string }
const fields = [
  { field: 'Visit Type', type: 'categorical' },
  { field: 'Rating', type: 'numeric' },
  { field: '__mapped_Rating__', type: 'numeric' }, // virtual → must be skipped
] as F[]

describe('recomputeFilteredSummaries', () => {
  const rows = [
    { 'Visit Type': 'Dine In', Rating: '5' },
    { 'Visit Type': 'Dine In', Rating: '3' },
    { 'Visit Type': 'Take Out', Rating: '4' },
    { 'Visit Type': 'Take Out', Rating: ' ' },   // blank → skipped in both
    { 'Visit Type': '', Rating: '2' },            // blank category → skipped in counts
  ]

  it('recounts categorical + numeric from filtered rows (scale=1, whole dataset)', () => {
    const out = recomputeFilteredSummaries(rows as never, fields as never, {}, 1)
    expect(out['Visit Type'].counts).toEqual({ 'Dine In': 2, 'Take Out': 2 })
    expect(out['Visit Type'].nonNull).toBe(4)
    expect(out['Rating'].nonNull).toBe(4)          // 5,3,4,2 — the blank dropped
    expect(out['Rating'].avg).toBeCloseTo(3.5, 5)
    expect(out['Rating'].min).toBe(2)
    expect(out['Rating'].max).toBe(5)
    expect(out['__mapped_Rating__']).toBeUndefined() // virtual field skipped
  })

  it('scales COUNT surfaces but not means (sampled >50K path)', () => {
    const out = recomputeFilteredSummaries(rows as never, fields as never, {}, 2)
    expect(out['Visit Type'].counts).toEqual({ 'Dine In': 4, 'Take Out': 4 }) // ×2
    expect(out['Visit Type'].nonNull).toBe(8)
    expect(out['Rating'].nonNull).toBe(8)          // count scaled
    expect(out['Rating'].avg).toBeCloseTo(3.5, 5)  // mean UNSCALED
    expect(out['Rating'].max).toBe(5)              // extent unscaled
  })

  it('reuses the base histogram bin edges and recounts (scaled) into them', () => {
    const base = { Rating: { type: 'numeric', nonNull: 0, histogram: [
      { min: 0, max: 2.5, count: 0 }, { min: 2.5, max: 5, count: 0 },
    ] } }
    const out = recomputeFilteredSummaries(rows as never, fields as never, base as never, 2)
    // values 5,3,4,2 → bin[0]=[0,2.5): {2} → 1×2=2 ; bin[1]=[2.5,5]: {5,3,4} → 3×2=6
    expect(out['Rating'].histogram).toEqual([
      { min: 0, max: 2.5, count: 2 }, { min: 2.5, max: 5, count: 6 },
    ])
  })

  it('computes real interpolated quartiles (feed the distribution box + gauge bands)', () => {
    const out = recomputeFilteredSummaries(rows as never, fields as never, {}, 1)
    // sorted values 2,3,4,5 → p25 at k=0.75 → 2.75 ; p75 at k=2.25 → 4.25
    expect(out['Rating'].p25).toBeCloseTo(2.75, 5)
    expect(out['Rating'].p75).toBeCloseTo(4.25, 5)
  })
})
