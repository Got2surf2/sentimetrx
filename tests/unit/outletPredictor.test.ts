import { describe, it, expect } from 'vitest'
import { buildPredictor, projectRecovery, buildRecommendedActions, type PredReview, type PredOutlet } from '@/lib/outletPredictor'

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

  it('projectRecovery: gated by least-improved theme, co-occurrence honest', () => {
    // Themes 0,1 driven to 0 (full fix); theme 2 left at its current rate.
    const current = [0.20, 0.10, 0.05], target = [0, 0, 0.05]
    const reviews: number[][] = [
      [0],     // theme 0 cut 100% → fully recovered
      [1],     // theme 1 cut 100% → fully recovered
      [0, 1],  // both improved → min reduction 1 → recovered
      [0, 2],  // theme 2 unchanged → min reduction 0 → stays a detractor
      [],      // no actionable theme → not counted
    ]
    expect(projectRecovery(reviews, current, target)).toBeCloseTo(3, 6)
    // Half-fix theme 0 → reviews citing it recover ~50%.
    expect(projectRecovery([[0]], [0.20], [0.10])).toBeCloseTo(0.5, 6)
    // Gated by the LEAST-improved theme: cut 0 by 80%, theme 1 by 20% → min 20%.
    expect(projectRecovery([[0, 1]], [0.10, 0.10], [0.02, 0.08])).toBeCloseTo(0.2, 6)
    // A review citing a theme left unchanged is never recovered.
    expect(projectRecovery([[0, 2]], current, target)).toBe(0)
  })

  it('conventional rating rank (1 = best avg) + worst-in-class + avg-projection inputs', () => {
    const { reviews, outlets } = fleet()
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 10 })
    const best = p.outletSummaries.find((o) => o.placeId === 'F')!  // fewest 1–3★ → highest avg
    const worst = p.outletSummaries.find((o) => o.placeId === 'A')! // most 1–3★ → lowest avg
    expect(best.ratingRank).toBe(1)
    expect(worst.ratingRank).toBe(p.outletSummaries.length)
    // themeTargets carries the worst-in-class anchor (the max problem rate).
    const oa = p.themeTargets.find((t) => t.theme === 'Order Accuracy')!
    expect(oa.worstRate).toBeCloseTo(p.outletWhatIf['A'].currentRate[0], 6) // A is worst on it
    // outletWhatIf carries the avg components for the star projection.
    expect(p.outletWhatIf['A'].detractorAvg).toBeCloseTo(2, 6)
    expect(p.outletWhatIf['A'].happyAvg).toBeCloseTo(5, 6)
    expect(p.allRatings.length).toBe(p.outletSummaries.length)
  })

  it('buildRecommendedActions: greedy, impact-ranked, de-duplicated', () => {
    // A: 4 reviews fully recoverable (redToMedian 1 on theme 0). B: 3 single-theme
    // reviews on theme 1. Theme 1 has a 2-outlet cohort {B, C} so it's a candidate.
    const actions = buildRecommendedActions({
      outlets: [
        { placeId: 'A', label: 'Brand — A', reviews13: [[0], [0], [0], [0]], redToMedian: [1, 0], weaknessThemes: ['T0'] },
        { placeId: 'B', label: 'Brand — B', reviews13: [[1], [1], [1]], redToMedian: [0, 1], weaknessThemes: ['T1'] },
        { placeId: 'C', label: 'Brand — C', reviews13: [[1], [1]], redToMedian: [0, 1], weaknessThemes: ['T1'] },
      ],
      actionableThemes: ['T0', 'T1'],
      themeCohorts: { T0: ['A'], T1: ['B', 'C'] },
      themeTrends: {},
      minMarginal: 1,
    })
    // Biggest first: turning around A recovers 4; the T1 program recovers 5 (3+2).
    expect(actions[0].kind).toBe('theme')
    expect(actions[0].theme).toBe('T1')
    expect(actions[0].recovered).toBeCloseTo(5, 6)
    expect(actions[1].placeId).toBe('A')
    expect(actions[1].recovered).toBeCloseTo(4, 6)
    expect(actions[1].cumulative).toBeCloseTo(9, 6) // additive, no double-count
    // Each action ships per-review recovery (`rec`); the union over ALL actions
    // (max weight per review) equals the greedy cumulative total — so the client
    // can recompute any selected subset's de-duplicated total.
    const best = new Map<number, number>()
    for (const a of actions) for (const r of a.rec) best.set(r.i, Math.max(best.get(r.i) || 0, r.w))
    let union = 0; best.forEach((w) => { union += w })
    expect(union).toBeCloseTo(actions[actions.length - 1].cumulative, 6)
  })

  it('outcomeCorrelations: brand-level, ranks the operational theme loyalty erosion travels with', () => {
    // Theme 2 = 'Loyalty & Brand Experience' (outcome). In bad reviews it
    // co-occurs heavily with theme 0 (Order Accuracy) and never with theme 1.
    const reviews: PredReview[] = []
    for (let i = 0; i < 300; i++) {
      const low = i < 90
      // 20 bad reviews cite loyalty; of those, 16 also cite Order Accuracy.
      const loyalty = low && i < 20
      const order = low && (i < 16 || (i >= 30 && i < 50)) // co-occurs with loyalty + some standalone
      const food = low && i >= 60 && i < 80                 // never with loyalty
      reviews.push({ placeId: i % 2 ? 'A' : 'B', rating: low ? 2 : 5, themes: [order, food, loyalty] })
    }
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: 'Brand — A', reviews: 150, rating: null },
      { placeId: 'B', label: 'Brand — B', reviews: 150, rating: null },
    ]
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, exemplarMinReviews: 100, minDriverBadN: 5 })
    const corr = p.outcomeCorrelations.find((c) => c.outcome === 'Loyalty & Brand Experience')
    expect(corr).toBeTruthy()
    expect(corr!.n).toBe(20)
    expect(corr!.drivers[0].theme).toBe('Order Accuracy') // most-correlated operational theme
    expect(corr!.drivers[0].lift).toBeGreaterThan(corr!.drivers[1].lift)
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
