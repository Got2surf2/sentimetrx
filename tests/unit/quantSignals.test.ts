import { describe, it, expect } from 'vitest'
import { buildQuantSignals } from '@/lib/quantSignals'
import { computeInsightAlerts } from '@/lib/insightAlerts'

// 12 monthly buckets ending 2026-06. The auto window splits the span into
// thirds: recent = months 8–11, prior(comparison) = months 4–7, oldest 0–3
// excluded. So set the value per third to control the recent-vs-prior contrast.
const MONTHS = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

function trendRows(field: string, recentVals: (i: number) => number[], priorVals: (i: number) => number[], dateField = 'review_date') {
  const out: Record<string, unknown>[] = []
  MONTHS.forEach((ym, i) => {
    const vals = i >= 8 ? recentVals(i) : (i >= 4 ? priorVals(i) : [4.4, 4.4])
    for (const v of vals) out.push({ [field]: v, [dateField]: ym + '-15' })
  })
  return out
}
const flat = (v: number, n = 5) => () => Array(n).fill(v)

describe('buildQuantSignals', () => {
  it('produces a recent-vs-prior signal for a rating field', () => {
    const r = trendRows('rating', flat(4.1), flat(4.6))
    const { signals } = buildQuantSignals(r, 'review_date', [{ key: 'rating', label: 'Overall rating', isRating: true }])
    expect(signals).toHaveLength(1)
    expect(signals[0].avg).toBe(4.1)        // recent window
    expect(signals[0].prior!.avg).toBe(4.6) // prior window
  })

  it('feeds the alert engine → a deteriorating rating alert', () => {
    const r = trendRows('rating', flat(4.1), flat(4.6))
    const { signals, windowLabel } = buildQuantSignals(r, 'review_date', [{ key: 'rating', label: 'Overall rating', isRating: true }])
    const alerts = computeInsightAlerts({ quant: signals, windowLabel })
    expect(alerts[0].kind).toBe('deteriorating')
    expect(alerts[0].lens).toBe('quant')
    expect(alerts[0].detail).toContain('★4.6→★4.1')
  })

  it('emits no trend without usable dates', () => {
    const r = Array(10).fill(0).map((_, i) => ({ rating: 3 + (i % 3) }))
    const { signals } = buildQuantSignals(r, null, [{ key: 'rating', label: 'Rating', isRating: true }])
    expect(signals[0].prior).toBeUndefined()
    expect(computeInsightAlerts({ quant: signals })).toHaveLength(0)
  })

  it('skips a field below the min-sample floor', () => {
    const r = [{ x: 1 }, { x: 2 }, { x: 3 }]
    const { signals } = buildQuantSignals(r, null, [{ key: 'x', label: 'X' }])
    expect(signals).toHaveLength(0)
  })

  it('detects a low-score-tail surge on ratings', () => {
    // recent months carry many 1★; prior months almost none
    const r = trendRows('rating', () => [1, 1, 1, 5, 5], () => [5, 5, 5, 5, 5])
    const { signals, windowLabel } = buildQuantSignals(r, 'review_date', [{ key: 'rating', label: 'Overall rating', isRating: true }])
    const alerts = computeInsightAlerts({ quant: signals, windowLabel })
    expect(alerts.some(a => a.detail.includes('bottom-box share'))).toBe(true)
  })
})
