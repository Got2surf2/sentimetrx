import { describe, it, expect } from 'vitest'
import { buildPredictor, projectRecovery, type PredReview, type PredOutlet } from '@/lib/outletPredictor'

// The predictor is a pure, deterministic engine for the "recover your 1–3★
// guests" frame. Two layers: brand over-representation drivers (strategic) and
// per-outlet PEER QUARTILES on each theme (operational). Synthetic data with a
// KNOWN structure verifies it recovers both.

const THEMES = ['Order Accuracy', 'Food', 'Loyalty & Brand Experience']

// total reviews; `low` are 1–3★. `lowOrder` of the bad reviews cite Order
// Accuracy (a problem topic — absent in good reviews). Food is in half of ALL
// reviews (neutral). Loyalty is in `lowLoyal` of the bad reviews (an outcome).
function outletReviews(placeId: string, total: number, low: number, lowOrder: number, lowLoyal = 0): PredReview[] {
  const out: PredReview[] = []
  for (let i = 0; i < total; i++) {
    const isLow = i < low
    const order = isLow && i < lowOrder
    const food = i % 2 === 0
    const loyal = isLow && i < lowLoyal
    out.push({ placeId, rating: isLow ? 2 : 5, themes: [order, food, loyal] })
  }
  return out
}

// A spread of outlets so quartiles are meaningful: A is the worst (high 1–3★ and
// high order-accuracy problems), the rest progressively cleaner.
function fleet(): { reviews: PredReview[]; outlets: PredOutlet[] } {
  const specs: [string, number, number, number][] = [
    ['A', 120, 60, 40], ['B', 120, 30, 12], ['C', 120, 18, 5],
    ['D', 120, 12, 3], ['E', 120, 8, 2], ['F', 120, 4, 1],
  ]
  const reviews = specs.flatMap(([id, t, low, ord]) => outletReviews(id, t, low, ord))
  const outlets: PredOutlet[] = specs.map(([id]) => ({ placeId: id, label: `Brand — ${id}town`, reviews: 120, rating: null }))
  return { reviews, outlets }
}

describe('outletPredictor — buildPredictor (1–3★ recovery, peer quartiles)', () => {
  it('returns unavailable below the minimum population', () => {
    expect(buildPredictor({ themeLabels: THEMES, reviews: [], outlets: [] }).available).toBe(false)
  })

  it('measures the 1–3★ rate and spread, worst-first', () => {
    const { reviews, outlets } = fleet()
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 10 })
    expect(p.available).toBe(true)
    expect(p.model.worstLowRate).toBeCloseTo(0.5, 5)   // A: 60/120
    expect(p.model.bestLowRate).toBeCloseTo(0.033, 2)  // F: 4/120
    expect(p.outletSummaries[0].placeId).toBe('A')     // worst first
    expect(p.exemplars[0]?.placeId).toBe('F')          // best operator
  })

  it('flags the over-represented theme as a driver and excludes the outcome theme', () => {
    const specs: [string, number, number, number, number][] = [['A', 200, 80, 50, 30], ['B', 200, 20, 8, 4]]
    const reviews = specs.flatMap(([id, t, low, ord, loy]) => outletReviews(id, t, low, ord, loy))
    const outlets: PredOutlet[] = specs.map(([id]) => ({ placeId: id, label: `Brand — ${id}`, reviews: 200, rating: null }))
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 10, driverLift: 1.2 })
    expect(p.brandLevers.map((d) => d.theme)).toContain('Order Accuracy')
    expect(p.brandLevers.map((d) => d.theme)).not.toContain('Food')                    // loud-but-neutral
    expect(p.brandLevers.map((d) => d.theme)).not.toContain('Loyalty & Brand Experience') // outcome, excluded
    // Loyalty IS over-represented but reported as an outcome signal, never a lever.
    expect(p.outcomeSignals.map((d) => d.theme)).toContain('Loyalty & Brand Experience')
    expect(p.actionableThemes).not.toContain('Loyalty & Brand Experience')
  })

  it('peer-ranks outlets per theme: worst outlet is a bottom-quartile weakness, best is a strength', () => {
    const { reviews, outlets } = fleet()
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 10 })
    // A is the worst on Order Accuracy → bottom quartile → a weakness, not a strength.
    const aW = p.outletLevers['A'] || []
    expect(aW.some((l) => l.theme === 'Order Accuracy')).toBe(true)
    expect(aW.every((l) => l.theme !== 'Loyalty & Brand Experience')).toBe(true) // outcome never a weakness
    expect(p.outletStrengths['A']?.some((l) => l.theme === 'Order Accuracy')).toBe(false)
    // F is the best → Order Accuracy is a strength, not a weakness.
    expect(p.outletStrengths['F']?.some((l) => l.theme === 'Order Accuracy')).toBe(true)
    expect((p.outletLevers['F'] || []).some((l) => l.theme === 'Order Accuracy')).toBe(false)
    // themeFocus lists the bottom-quartile outlets for the theme, A worst-first.
    expect(p.themeFocus['Order Accuracy']?.[0]?.placeId).toBe('A')
  })

  it('gives a LIST of top performers per theme to learn from (not one outlet for everything)', () => {
    const TWO = ['T1', 'T2']
    const rv = (id: string, total: number, low: number, t1: number, t2: number): PredReview[] =>
      Array.from({ length: total }, (_, i) => {
        const isLow = i < low
        return { placeId: id, rating: isLow ? 2 : 5, themes: [isLow && i < t1, isLow && i >= low - t2 && i < low] }
      })
    const specs: [string, number, number, number, number][] = [
      ['A', 120, 40, 30, 30], ['B', 120, 30, 20, 20], ['C', 120, 24, 12, 12],
      ['D', 120, 18, 6, 6], ['E', 120, 10, 2, 2], ['F', 120, 6, 0, 0],
    ]
    const reviews = specs.flatMap(([id, t, low, a, b]) => rv(id, t, low, a, b))
    const outlets: PredOutlet[] = specs.map(([id]) => ({ placeId: id, label: `Brand — ${id}`, reviews: 120, rating: null }))
    const p = buildPredictor({ themeLabels: TWO, reviews, outlets, exemplarMinReviews: 100 })
    // themeExemplars is a list of distinct top performers (best-on-theme first).
    expect((p.themeExemplars['T1'] || []).length).toBeGreaterThanOrEqual(2)
    const ids = (p.themeExemplars['T1'] || []).map((e) => e.placeId)
    expect(new Set(ids).size).toBe(ids.length) // all distinct
    expect(ids[0]).toBe('F') // cleanest on T1 leads
    // The weakness card carries the same list.
    const aT1 = (p.outletLevers['A'] || []).find((l) => l.theme === 'T1')
    expect(aT1?.exemplars.length).toBeGreaterThanOrEqual(2)
  })

  it('projectRecovery: confined reviews only, scaled to target (co-occurrence honest)', () => {
    // Theme 0 current rate 0.20 → target 0 (full fix); theme 1 current 0.10 → target 0.
    const current = [0.20, 0.10], target = [0, 0]
    const reviews: number[][] = [
      [0],     // confined to theme 0 → fully recovered (cut 100%)
      [1],     // confined to theme 1 → fully recovered
      [0, 1],  // both selected → recovered
      [0, 2],  // cites theme 2 (NOT selected) → stays a detractor
      [],      // no actionable theme → not counted
    ]
    const sel = new Set([0, 1])
    // 3 confined reviews ([0],[1],[0,1]), each cut 100% → recovered ≈ 3.
    expect(projectRecovery(reviews, sel, current, target)).toBeCloseTo(3, 6)
    // Half-fix theme 0 (target = half its current) → its confined reviews recover ~50%.
    const half = projectRecovery([[0]], new Set([0]), [0.20], [0.10])
    expect(half).toBeCloseTo(0.5, 6)
    // A review citing an unselected theme is never recovered.
    expect(projectRecovery([[0, 2]], sel, current, target)).toBe(0)
  })

  it('attaches a quote to the matching outlet+theme weakness', () => {
    const { reviews, outlets } = fleet()
    const p = buildPredictor({
      themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 10,
      examples: [{ placeId: 'A', theme: 'Order Accuracy', quote: 'they got my order wrong again' }],
    })
    const lever = (p.outletLevers['A'] || []).find((l) => l.theme === 'Order Accuracy')
    expect(lever?.quote).toBe('they got my order wrong again')
  })
})
