import { describe, it, expect } from 'vitest'
import { buildThemeSignals } from '@/lib/themeSignals'
import { computeInsightAlerts, themesToSignals } from '@/lib/insightAlerts'

// 12 monthly buckets ending 2026-06. The 'auto' window splits the span into
// thirds: recent = months 8–11, prior(comparison) = months 4–7, oldest 0–3
// excluded — same fixture shape as quantSignals.test.ts.
const MONTHS = ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']

// Rows per (month, rating) — text always mentions "service" so the theme
// matches. 4 rows/month so the recent window clears MIN_N even though the
// boundary drops the exact-max-timestamp bucket (same quirk quantSignals has).
function rows(recentRating: number, priorRating: number, text = 'the service was notable') {
  const out: Record<string, unknown>[] = []
  MONTHS.forEach((ym, i) => {
    const r = i >= 8 ? recentRating : (i >= 4 ? priorRating : 4)
    for (let k = 0; k < 4; k++) out.push({ comment: text, rating: r, review_date: ym + '-15' })
  })
  return out
}
const SERVICE = [{ label: 'Service', keywords: ['service'] }]

describe('buildThemeSignals', () => {
  it('derives real pos/neg + avg ★ from rated rows (no dates → full-period snapshot)', () => {
    const r = [
      { comment: 'great service', rating: 5 },
      { comment: 'good service', rating: 4 },
      { comment: 'ok service', rating: 3 },
      { comment: 'bad service', rating: 1 },
    ]
    const { signals } = buildThemeSignals({ themes: SERVICE, rows: r, textKeys: ['comment'], ratingKey: 'rating' })
    expect(signals).toHaveLength(1)
    expect(signals[0].count).toBe(4)
    // pos = ratings≥4 (2), neg = ratings≤2 (1) → 67% positive; 3 is neutral.
    expect(signals[0].posPct).toBe(67)
    expect(signals[0].avgRating).toBe(3.3)
    expect(signals[0].prior).toBeNull()
  })

  it('leaves posPct null when there is no rating field (no invented precision)', () => {
    const r = [{ comment: 'service was slow' }, { comment: 'love the service' }]
    const { signals } = buildThemeSignals({ themes: SERVICE, rows: r, textKeys: ['comment'] })
    expect(signals[0].posPct).toBeNull()
    expect(signals[0].avgRating).toBeNull()
  })

  it('produces a recent-vs-prior trend when dates are present', () => {
    const r = rows(2, 5)   // recent window worse than prior
    const { signals, windowLabel } = buildThemeSignals({ themes: SERVICE, rows: r, textKeys: ['comment'], ratingKey: 'rating', dateKey: 'review_date' })
    expect(windowLabel).toBeTruthy()
    expect(signals[0].prior).not.toBeNull()
    expect(signals[0].avgRating).toBe(2)        // recent window
    expect(signals[0].prior!.avgRating).toBe(5) // prior window
  })

  it('feeds the alert engine → a deteriorating theme alert', () => {
    const r = rows(2, 5)
    const { signals, windowLabel } = buildThemeSignals({ themes: SERVICE, rows: r, textKeys: ['comment'], ratingKey: 'rating', dateKey: 'review_date' })
    const alerts = computeInsightAlerts({ signals: themesToSignals(signals), windowLabel, minMentions: 4 })
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0].lens).toBe('theme')
    expect(alerts[0].kind).toBe('deteriorating')
  })

  it('skips themes with no keyword matches', () => {
    const r = [{ comment: 'the food was great', rating: 5 }]
    const { signals } = buildThemeSignals({ themes: SERVICE, rows: r, textKeys: ['comment'], ratingKey: 'rating' })
    expect(signals).toHaveLength(0)
  })
})
