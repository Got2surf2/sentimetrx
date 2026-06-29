import { describe, it, expect } from 'vitest'
import { computeDimensionAlerts } from '@/lib/dimensionAlerts'
import type { TaxonomyRollup, SubStat } from '@/lib/taxonomyRollup'

function sub(p: Partial<SubStat> & { axis: string; sub: string; count: number }): SubStat {
  return { rate: 0, pos: 0, neg: 0, posPct: null, avgRating: null, ...p }
}
function rollup(p: Partial<TaxonomyRollup> & { subs: SubStat[] }): TaxonomyRollup {
  return { classifiedRows: 1000, withSignal: 1000, overallAvgRating: 4.3, axes: [], alerts: [], alertRows: 0, ...p }
}

describe('computeDimensionAlerts — static tier', () => {
  it('flags a high-volume, low-positive sub as a pain point', () => {
    const a = computeDimensionAlerts(rollup({ subs: [sub({ axis: 'product', sub: 'steak-temperature', count: 234, posPct: 38, avgRating: 3.1 })] }))
    expect(a).toHaveLength(1)
    expect(a[0].kind).toBe('pain')
    expect(a[0].title).toBe('Steak Temperature')
    expect(a[0].n).toBe(234)
    expect(a[0].detail).toContain('234 mentions')
    expect(a[0].detail).toContain('38% positive')
  })

  it('flags a high-volume, high-positive sub as a bright spot', () => {
    const a = computeDimensionAlerts(rollup({ subs: [sub({ axis: 'touchpoint', sub: 'service-warmth', count: 188, posPct: 91, avgRating: 4.7 })] }))
    expect(a[0].kind).toBe('bright')
  })

  it('flags a sub whose rating drags well below the overall avg even if posPct is ok', () => {
    const a = computeDimensionAlerts(rollup({ overallAvgRating: 4.5, subs: [sub({ axis: 'context', sub: 'wait-time', count: 120, posPct: 60, avgRating: 3.2 })] }))
    expect(a[0].kind).toBe('pain')
  })

  it('respects the adaptive min-mention floor (a tiny blip is not an alert)', () => {
    const a = computeDimensionAlerts(rollup({ classifiedRows: 5000, subs: [sub({ axis: 'product', sub: 'x', count: 6, posPct: 10 })] }))
    expect(a).toHaveLength(0)   // floor = max(8, 2% of 5000 = 100)
  })

  it('always surfaces safety alerts, ranked first, above pain', () => {
    const a = computeDimensionAlerts(rollup({
      alerts: [{ tag: 'food-safety', count: 7 }],
      subs: [sub({ axis: 'product', sub: 'steak', count: 300, posPct: 20 })],
    }))
    expect(a[0].kind).toBe('safety')
    expect(a[0].detail).toContain('7 reviews')
    expect(a.some(x => x.kind === 'pain')).toBe(true)
  })

  it('caps the list to max while keeping all safety flags', () => {
    const subs = Array.from({ length: 20 }, (_, i) => sub({ axis: 'product', sub: 'p' + i, count: 100 + i, posPct: 20 }))
    const a = computeDimensionAlerts(rollup({ alerts: [{ tag: 'safety', count: 2 }], subs }), { max: 5 })
    expect(a.filter(x => x.kind === 'safety')).toHaveLength(1)
    expect(a.length).toBeLessThanOrEqual(5)
  })
})

describe('computeDimensionAlerts — trend tier', () => {
  const base = rollup({ subs: [] })
  const win = 'last 2 quarters'

  it('flags a deteriorating sub (posPct dropped) with before→after', () => {
    const recent = rollup({ subs: [sub({ axis: 'context', sub: 'wait-time', count: 80, posPct: 48, rate: 8 })] })
    const prior = rollup({ subs: [sub({ axis: 'context', sub: 'wait-time', count: 90, posPct: 64, rate: 8 })] })
    const a = computeDimensionAlerts(base, { trend: { recent, prior, windowLabel: win } })
    expect(a[0].kind).toBe('deteriorating')
    expect(a[0].detail).toContain('64%→48% positive')
  })

  it('flags a heating-up sub (mention share climbing, sentiment stable)', () => {
    // posPct held ~flat (42→40) so only the volume-rise fires, not deteriorating.
    const recent = rollup({ subs: [sub({ axis: 'outcome', sub: 'reservations', count: 60, posPct: 40, rate: 6 })] })
    const prior = rollup({ subs: [sub({ axis: 'outcome', sub: 'reservations', count: 20, posPct: 42, rate: 2 })] })
    const a = computeDimensionAlerts(base, { trend: { recent, prior, windowLabel: win } })
    expect(a.some(x => x.kind === 'heating')).toBe(true)
    const h = a.find(x => x.kind === 'heating')!
    expect(h.detail).toContain('2%→6% of reviews')
    expect(h.detail).toContain('skewing negative')
  })

  it('a sub that both heats up AND sours collapses to one deteriorating alert', () => {
    const recent = rollup({ subs: [sub({ axis: 'outcome', sub: 'reservations', count: 60, posPct: 40, rate: 6 })] })
    const prior = rollup({ subs: [sub({ axis: 'outcome', sub: 'reservations', count: 20, posPct: 55, rate: 2 })] })
    const a = computeDimensionAlerts(base, { trend: { recent, prior, windowLabel: win } })
    expect(a.filter(x => x.title === 'Reservations')).toHaveLength(1)
    expect(a[0].kind).toBe('deteriorating')
  })

  it('flags an improving sub and does not double-list it as something else', () => {
    const recent = rollup({ subs: [sub({ axis: 'ambiance', sub: 'decor', count: 70, posPct: 78, rate: 7 })] })
    const prior = rollup({ subs: [sub({ axis: 'ambiance', sub: 'decor', count: 65, posPct: 55, rate: 7 })] })
    const a = computeDimensionAlerts(base, { trend: { recent, prior, windowLabel: win } })
    const decor = a.filter(x => x.title === 'Decor')
    expect(decor).toHaveLength(1)
    expect(decor[0].kind).toBe('improving')
  })
})
