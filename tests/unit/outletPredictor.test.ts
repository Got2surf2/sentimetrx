import { describe, it, expect } from 'vitest'
import { buildPredictor, type PredReview, type PredOutlet } from '@/lib/outletPredictor'

// The predictor is a pure, deterministic engine (ridge regression of star rating
// on theme-negative flags → de-biased per-theme ★-drag → peer-relative levers).
// Synthetic data with a KNOWN structure verifies the model recovers it.

const THEMES = ['Service', 'Food']

// Build n reviews for an outlet. `service`/`food` = how many of them negatively
// mention that theme (the rest are clean 5★). A negative Service review is 1★, a
// negative Food review is 2★; reviews negative on both are 1★.
function outletReviews(placeId: string, total: number, service: number, food: number): PredReview[] {
  const out: PredReview[] = []
  for (let i = 0; i < total; i++) {
    const negS = i < service
    const negF = i >= total - food // pack food-negatives at the tail (some overlap with service if ranges meet)
    const rating = negS && negF ? 1 : negS ? 1 : negF ? 2 : 5
    out.push({ placeId, rating, neg: [negS, negF] })
  }
  return out
}

describe('outletPredictor — buildPredictor', () => {
  it('returns unavailable below the minimum population', () => {
    const p = buildPredictor({ themeLabels: THEMES, reviews: [], outlets: [] })
    expect(p.available).toBe(false)
  })

  it('recovers per-theme ★-drag and ranks the worse driver first', () => {
    // Two outlets. Service negatives are more severe (1★) and more frequent.
    const reviews = [
      ...outletReviews('A', 100, 25, 10), // laggard: lots of service complaints
      ...outletReviews('B', 100, 5, 8),   // cleaner on service
    ]
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: "Brand — Atown, CA", reviews: 100, rating: null },
      { placeId: 'B', label: "Brand — Btown, CA", reviews: 100, rating: null },
    ]
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, minDriverN: 10, exemplarMinReviews: 50 })
    expect(p.available).toBe(true)

    // Service drag should exceed Food drag (1★ vs 2★ negatives → bigger drop).
    const service = p.themeDrag.find((d) => d.theme === 'Service')!
    const food = p.themeDrag.find((d) => d.theme === 'Food')!
    expect(service.dragV2).toBeGreaterThan(food.dragV2)
    expect(service.dragV2).toBeGreaterThan(1) // meaningful drag, not ~0

    // Brand levers sorted by chain lift, Service is the top lever.
    expect(p.brandLevers[0]?.theme).toBe('Service')

    // Outlet A (the laggard) has Service as its #1 lever with positive lift.
    const aLevers = p.outletLevers['A'] || []
    expect(aLevers[0]?.theme).toBe('Service')
    expect(aLevers[0]?.lift).toBeGreaterThan(0)

    // The exemplar for Service is the cleaner outlet B, not A.
    expect(p.exemplars['Service']?.placeId).toBe('B')
  })

  it('de-biases co-occurrence: v2 drag < v1 severity when complaints co-fire', () => {
    // Most negative reviews flag BOTH themes (strong but imperfect co-occurrence,
    // like a globally-bad review). Univariate severity credits each theme the
    // full drop; ridge splits the shared variance, shrinking both below v1.
    const reviews: PredReview[] = []
    for (let i = 0; i < 200; i++) {
      let negS = false, negF = false, rating = 5
      if (i < 35) { negS = true; negF = true; rating = 1 } // co-fire
      else if (i < 43) { negS = true; rating = 1 }          // service only
      else if (i < 50) { negF = true; rating = 2 }          // food only
      reviews.push({ placeId: 'A', rating, neg: [negS, negF] })
    }
    const outlets: PredOutlet[] = [{ placeId: 'A', label: 'Brand — Atown', reviews: 200, rating: null }]
    const p = buildPredictor({ themeLabels: THEMES, reviews, outlets, minDriverN: 10, exemplarMinReviews: 50 })
    for (const d of p.themeDrag) {
      expect(d.dragV2).toBeLessThan(d.dragV1) // co-occurrence inflation removed
      expect(d.shrink).toBeGreaterThan(0)     // some credit was shared
    }
  })

  it('attaches example quotes to the matching outlet+theme lever', () => {
    const reviews = [...outletReviews('A', 100, 30, 5), ...outletReviews('B', 100, 4, 4)]
    const outlets: PredOutlet[] = [
      { placeId: 'A', label: 'Brand — Atown', reviews: 100, rating: null },
      { placeId: 'B', label: 'Brand — Btown', reviews: 100, rating: null },
    ]
    const p = buildPredictor({
      themeLabels: THEMES, reviews, outlets, minDriverN: 10, exemplarMinReviews: 50,
      examples: [{ placeId: 'A', theme: 'Service', quote: 'staff was rude' }],
    })
    const aService = (p.outletLevers['A'] || []).find((l) => l.theme === 'Service')
    expect(aService?.quote).toBe('staff was rude')
  })
})
