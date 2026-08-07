import { describe, it, expect } from 'vitest'
import { computeInsightAlerts, computeDimensionAlerts, dimensionsToSignals, themesToSignals, type AlertSignal, type QuantSignal } from '@/lib/insightAlerts'
import type { TaxonomyRollup, SubStat } from '@/lib/taxonomyRollup'

function sub(p: Partial<SubStat> & { axis: string; sub: string; count: number }): SubStat {
  return { rate: 0, pos: 0, neg: 0, posPct: null, avgRating: null, sentBasis: null, ...p }
}
function rollup(p: Partial<TaxonomyRollup> & { subs: SubStat[] }): TaxonomyRollup {
  return { classifiedRows: 1000, withSignal: 1000, overallAvgRating: 4.3, axes: [], alerts: [], alertRows: 0, ...p }
}
function sig(p: Partial<AlertSignal> & { lens: 'theme' | 'dimension'; label: string; count: number }): AlertSignal {
  return { key: p.lens + ':' + p.label, rate: 0, posPct: null, avgRating: null, ...p }
}

describe('computeInsightAlerts — static (themes + dimensions)', () => {
  it('flags a high-volume, low-positive signal as a pain point regardless of lens', () => {
    const a = computeInsightAlerts({ overallAvgRating: 4.3, baselineRows: 1000, signals: [
      sig({ lens: 'theme', label: 'Wait Times', count: 240, posPct: 35, avgRating: 3.2 }),
    ] })
    expect(a[0].kind).toBe('pain')
    expect(a[0].lens).toBe('theme')
    expect(a[0].title).toBe('Wait Times')
    expect(a[0].detail).toContain('240 mentions')
  })

  it('flags a high-positive signal as a bright spot', () => {
    const a = computeInsightAlerts({ baselineRows: 1000, signals: [sig({ lens: 'dimension', label: 'Server Warmth', count: 180, posPct: 90, avgRating: 4.7 })] })
    expect(a[0].kind).toBe('bright')
  })

  it('always surfaces safety first', () => {
    const a = computeInsightAlerts({ baselineRows: 1000, safety: [{ tag: 'food-safety', count: 7 }],
      signals: [sig({ lens: 'dimension', label: 'Steak', count: 300, posPct: 20 })] })
    expect(a[0].kind).toBe('safety')
    expect(a[0].detail).toContain('7 reviews')
  })

  it('respects the adaptive min-mention floor', () => {
    const a = computeInsightAlerts({ baselineRows: 5000, signals: [sig({ lens: 'theme', label: 'x', count: 6, posPct: 10 })] })
    expect(a).toHaveLength(0)   // floor = max(8, 2% of 5000 = 100)
  })

  it('merges and dedupes across lenses, ranked by severity', () => {
    const a = computeInsightAlerts({ baselineRows: 1000, signals: [
      sig({ lens: 'theme', label: 'Value', count: 90, posPct: 40 }),
      sig({ lens: 'dimension', label: 'Steak', count: 200, posPct: 30 }),
    ] })
    expect(a.length).toBe(2)
    expect(a[0].title).toBe('Steak')   // higher volume + more negative ranks first
  })
})

describe('computeInsightAlerts — trend tier (via signal.prior)', () => {
  it('flags a deteriorating signal', () => {
    const a = computeInsightAlerts({ windowLabel: 'last 2 quarters', signals: [
      sig({ lens: 'theme', label: 'Parking', count: 80, posPct: 48, prior: { count: 90, rate: 8, posPct: 64, avgRating: null } }),
    ] })
    expect(a[0].kind).toBe('deteriorating')
    expect(a[0].detail).toContain('64%→48% positive')
  })

  it('flags a heating-up signal (volume rising, sentiment stable)', () => {
    const a = computeInsightAlerts({ windowLabel: 'last 2 quarters', signals: [
      sig({ lens: 'dimension', label: 'Reservations', count: 60, rate: 6, posPct: 40, prior: { count: 20, rate: 2, posPct: 42, avgRating: null } }),
    ] })
    expect(a.some(x => x.kind === 'heating')).toBe(true)
    expect(a.find(x => x.kind === 'heating')!.detail).toContain('2%→6% of comments')
  })
})

describe('computeInsightAlerts — quant lens', () => {
  it('flags a falling rating with before→after', () => {
    const q: QuantSignal = { key: 'rating', label: 'Overall rating', avg: 4.1, n: 800, isRating: true, prior: { avg: 4.5, n: 700 } }
    const a = computeInsightAlerts({ windowLabel: 'last 2 quarters', quant: [q] })
    expect(a[0].kind).toBe('deteriorating')
    expect(a[0].lens).toBe('quant')
    expect(a[0].detail).toContain('★4.5→★4.1')
  })

  it('flags a rising non-rating numeric by relative change', () => {
    const q: QuantSignal = { key: 'nps', label: 'NPS', avg: 62, n: 300, prior: { avg: 50, n: 280 } }
    const a = computeInsightAlerts({ quant: [q] })
    expect(a[0].kind).toBe('improving')
    expect(a[0].detail).toContain('50→62')
  })

  it('ignores a sub-threshold numeric move', () => {
    const q: QuantSignal = { key: 'rating', label: 'Overall rating', avg: 4.45, n: 800, isRating: true, prior: { avg: 4.5, n: 700 } }
    expect(computeInsightAlerts({ quant: [q] })).toHaveLength(0)   // 0.05 < 0.2 floor
  })

  it('flags a low-score tail surge', () => {
    const q: QuantSignal = { key: 'rating', label: 'Overall rating', avg: 4.0, n: 800, isRating: true, lowPctRecent: 22, lowPctPrior: 12 }
    const a = computeInsightAlerts({ windowLabel: 'last 2 quarters', quant: [q] })
    expect(a.some(x => x.kind === 'pain' && x.detail.includes('12%→22%'))).toBe(true)
  })
})

describe('adapters', () => {
  it('dimensionsToSignals maps subs (+ prior) and computeDimensionAlerts still works', () => {
    const a = computeDimensionAlerts(rollup({ subs: [sub({ axis: 'product', sub: 'steak-temperature', count: 234, posPct: 38, avgRating: 3.1 })] }))
    expect(a[0].kind).toBe('pain')
    expect(a[0].title).toBe('Steak Temperature')
    const sigs = dimensionsToSignals(rollup({ subs: [sub({ axis: 'product', sub: 'steak', count: 10, rate: 1 })] }))
    expect(sigs[0].lens).toBe('dimension')
    expect(sigs[0].key).toBe('dimension:product:steak')
  })

  it('themesToSignals tags lens=theme', () => {
    const sigs = themesToSignals([{ label: 'Wait Times', count: 50, rate: 5, posPct: 40, avgRating: 3.2 }])
    expect(sigs[0].lens).toBe('theme')
    expect(sigs[0].key).toBe('theme:wait times')
  })
})
