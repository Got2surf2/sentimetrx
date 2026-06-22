import { describe, it, expect } from 'vitest'
import { buildPredictor, type PredReview, type PredOutlet } from '@/lib/outletPredictor'

// The predictor is a pure, deterministic engine for the "recover your 1–3★
// guests" frame: brand 1–3★ rate + spread, theme drivers by over-representation
// in bad-vs-good reviews, and per-outlet levers. Synthetic data with a KNOWN
// structure verifies it recovers that structure.

const THEMES = ['Order Accuracy', 'Food'] // Order Accuracy = real driver, Food = loud-but-neutral

// total reviews; `low` are 1–3★. Order Accuracy is cited only in bad reviews
// (`lowOrder` of them) → rare in happy reviews → a real driver. Food is cited in
// HALF of all reviews regardless of rating → ~1× over-representation → a loud-
// but-neutral topic, NOT a driver.
function outletReviews(placeId: string, total: number, low: number, lowOrder: number): PredReview[] {
  const out: PredReview[] = []
  for (let i = 0; i < total; i++) {
    const isLow = i < low
    const order = isLow && i < lowOrder
    const food = i % 2 === 0
    out.push({ placeId, rating: isLow ? 2 : 5, themes: [order, food] })
  }
  return out
}

describe('outletPredictor — buildPredictor (1–3★ recovery frame)', () => {
  it('returns unavailable below the minimum population', () => {
    const p = buildPredictor({ themeLabels: THEMES, reviews: [], outlets: [] })
    expect(p.available).toBe(false)
  })

  it('measures the 1–3★ rate and its spread across outlets', () => {
    const reviews = [
      ...outletReviews('A', 100, 40, 20), // 40% bad — the laggard
      ...outletReviews('B', 100, 5, 2),    // 5% bad — the exemplar
    ]
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: 'Brand — Atown, CA', reviews: 100, rating: null },
      { placeId: 'B', label: 'Brand — Btown, CA', reviews: 100, rating: null },
    ]
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 50, minDriverBadN: 10 })
    expect(p.available).toBe(true)
    expect(p.model.lowRate).toBeCloseTo(0.225, 3) // 45 of 200
    expect(p.model.worstLowRate).toBeCloseTo(0.40, 5)
    expect(p.model.bestLowRate).toBeCloseTo(0.05, 5)
    // Worst-first hot-list, and the best outlet is the exemplar.
    expect(p.outletSummaries[0].placeId).toBe('A')
    expect(p.exemplars[0]?.placeId).toBe('B')
  })

  it('flags the over-represented theme as a driver and the loud-but-neutral one as not', () => {
    // Order Accuracy: common in bad, absent in good → high lift → driver.
    // Food: equally common in bad and good → ~1× → NOT a driver.
    const reviews = [
      ...outletReviews('A', 200, 60, 40),
      ...outletReviews('B', 200, 20, 10),
    ]
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: 'Brand — Atown', reviews: 200, rating: null },
      { placeId: 'B', label: 'Brand — Btown', reviews: 200, rating: null },
    ]
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 50, minDriverBadN: 10, driverLift: 1.2 })
    const order = p.drivers.find((d) => d.theme === 'Order Accuracy')!
    const food = p.drivers.find((d) => d.theme === 'Food')!
    expect(order.lift).toBeGreaterThan(food.lift)
    expect(order.isDriver).toBe(true)
    expect(food.isDriver).toBe(false)          // loud topic, not a differentiator
    expect(p.brandLevers.map((d) => d.theme)).toContain('Order Accuracy')
    expect(p.brandLevers.map((d) => d.theme)).not.toContain('Food')
  })

  it('per-outlet levers surface only driver themes the outlet’s unhappy guests cite, with quotes', () => {
    const reviews = [
      ...outletReviews('A', 200, 60, 40),
      ...outletReviews('B', 200, 20, 10),
    ]
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: 'Brand — Atown', reviews: 200, rating: null },
      { placeId: 'B', label: 'Brand — Btown', reviews: 200, rating: null },
    ]
    const p = buildPredictor({
      themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 50, minDriverBadN: 10, driverLift: 1.2,
      examples: [{ placeId: 'A', theme: 'Order Accuracy', quote: 'they got my order wrong again' }],
    })
    const aLevers = p.outletLevers['A'] || []
    expect(aLevers.length).toBeGreaterThan(0)
    expect(aLevers.every((l) => l.theme !== 'Food')).toBe(true) // non-drivers excluded
    const order = aLevers.find((l) => l.theme === 'Order Accuracy')
    expect(order?.quote).toBe('they got my order wrong again')
    expect(order?.exemplar).toBeTruthy()
  })
})
