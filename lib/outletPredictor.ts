// Theme-driven "recover your 1–3★ guests" predictor for a multi-location brand.
//
// FRAME (chosen 2026-06-22, replacing the earlier severity/★-per-mention model).
// A brand's average star rating is dragged down by its low-rated (1–3★) reviews
// — its "detractors". The opportunity is to move those guests up. This engine:
//
//   1. OPPORTUNITY — the brand's 1–3★ rate and, crucially, its SPREAD across
//      outlets (e.g. 1.4% at the best outlet vs 40% at the worst). The spread is
//      operational inconsistency you can close — the headline, no modeling.
//   2. DRIVERS — which themes are DISPROPORTIONATELY present when guests are
//      unhappy, measured as over-representation = P(theme | 1–3★) / P(theme |
//      4–5★). This controls for base rate: a theme that's just talked about a
//      lot (e.g. food) shows ~1×; the real drivers are >1×. Raw "share of bad
//      reviews" is a TRAP — it just echoes which topics are loudest overall.
//   3. WHERE TO START — outlets ranked by their ABSOLUTE 1–3★ rate (not "below
//      the median", which is tautological), with the driver themes their own
//      unhappy guests cite most.
//   4. LEARN FROM — the genuinely low-1–3★ outlets (the best operators).
//   5. POTENTIAL — framed as closing an outlet's 1–3★ gap to the best
//      performers (a best-quartile benchmark), never a fabricated "+X★".
//
// Theme membership = keyword match on review text (same matchers as the
// leaderboard). Low = rating ≤ 3. Associational, not causal — a prioritization
// signal that benchmarks outlets against their own peers.

// ─── inputs (plain data — no server/db deps, unit-testable) ───

// One rated text-review: its star rating and, per theme (by index into
// `themeLabels`), whether its text mentions that theme (keyword present).
export type PredReview = { placeId: string; rating: number; themes: boolean[] }

export type PredOutlet = { placeId: string; label: string; reviews: number; rating: number | null }

// A representative quote from a 1–3★ review mentioning (theme) at (outlet).
export type PredExample = { placeId: string; theme: string; quote: string }

export type PredictorInput = {
  themeLabels: string[]
  reviews: PredReview[]
  outlets: PredOutlet[]
  examples?: PredExample[]
  minOutletReviews?: number   // outlet stability floor (default 30)
  minDriverBadN?: number      // theme needs this many 1–3★ mentions to rank as a driver (default 20)
  driverLift?: number         // over-representation threshold to count as a driver (default 1.2)
  exemplarMinReviews?: number // a credible "learn from" outlet needs this volume (default 60)
}

// ─── outputs ───

const LOW_MAX = 3 // rating ≤ 3 ⇒ a low-rated / detractor review

export type ThemeDriver = {
  theme: string
  pBad: number      // share of 1–3★ reviews mentioning the theme
  pGood: number     // share of 4–5★ reviews mentioning it
  lift: number      // pBad / pGood — over-representation among unhappy guests
  nBad: number      // 1–3★ reviews mentioning it (chain-wide)
  isDriver: boolean // lift ≥ driverLift AND nBad ≥ minDriverBadN
}

export type Exemplar = { placeId: string; label: string; lowRate: number; rating: number | null }

export type OutletLever = {
  theme: string
  shareInBad: number // share of THIS outlet's 1–3★ reviews citing the theme
  brandLift: number  // brand-wide over-representation (why it's a real driver)
  exemplar: Exemplar | null
  quote: string | null
}

export type OutletSummary = {
  placeId: string
  label: string
  reviews: number
  rating: number | null
  lowRate: number    // share of this outlet's reviews that are 1–3★
  lowCount: number
  gapToTarget: number // max(0, lowRate − targetLowRate) — reducible bad-review share
  topDriver: { theme: string; shareInBad: number } | null
}

export type PredictorModel = {
  population: number   // rated text-reviews the model saw
  chainAvg: number     // mean star rating across the population
  lowRate: number      // brand 1–3★ rate
  lowCount: number
  bestLowRate: number  // best (lowest) outlet 1–3★ rate
  worstLowRate: number // worst (highest)
  medianLowRate: number
  targetLowRate: number    // best-quartile benchmark (the achievable target)
  projectedLowRate: number // brand 1–3★ rate if every outlet reached the target
}

export type OutletPredictor = {
  available: boolean
  model: PredictorModel
  drivers: ThemeDriver[]      // all themes, sorted by lift desc
  brandLevers: ThemeDriver[]  // drivers only (isDriver), by lift desc
  exemplars: Exemplar[]       // best operators (lowest 1–3★ rate), best first
  outletSummaries: OutletSummary[] // worst 1–3★ rate first
  outletLevers: Record<string, OutletLever[]> // per outlet, driver themes by shareInBad
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function buildPredictor(input: PredictorInput): OutletPredictor {
  const minOutletReviews = input.minOutletReviews ?? 30
  const minDriverBadN = input.minDriverBadN ?? 20
  const driverLift = input.driverLift ?? 1.2
  const exemplarMinReviews = input.exemplarMinReviews ?? 60
  const themes = input.themeLabels
  const K = themes.length
  const revs = input.reviews
  const n = revs.length

  const empty: OutletPredictor = {
    available: false,
    model: {
      population: n, chainAvg: 0, lowRate: 0, lowCount: 0,
      bestLowRate: 0, worstLowRate: 0, medianLowRate: 0, targetLowRate: 0, projectedLowRate: 0,
    },
    drivers: [], brandLevers: [], exemplars: [], outletSummaries: [], outletLevers: {},
  }
  if (!K || n < 50) return empty

  const chainAvg = mean(revs.map((r) => r.rating))
  const lows = revs.filter((r) => r.rating <= LOW_MAX)
  const highs = revs.filter((r) => r.rating > LOW_MAX)
  const lowRate = lows.length / n

  // ── Drivers: over-representation of each theme in bad vs good reviews. ──
  const drivers: ThemeDriver[] = themes.map((t, j) => {
    const nBad = lows.filter((r) => r.themes[j]).length
    const pBad = lows.length ? nBad / lows.length : 0
    const pGood = highs.length ? highs.filter((r) => r.themes[j]).length / highs.length : 0
    const lift = pGood > 0 ? pBad / pGood : (pBad > 0 ? Infinity : 0)
    return { theme: t, pBad, pGood, lift, nBad, isDriver: lift >= driverLift && nBad >= minDriverBadN }
  }).sort((a, b) => b.lift - a.lift)
  const brandLevers = drivers.filter((d) => d.isDriver)
  const driverSet = new Set(brandLevers.map((d) => d.theme))

  // ── Per-outlet aggregates (only outlets above the stability floor). ──
  const byOutlet = new Map<string, PredReview[]>()
  for (const r of revs) {
    const a = byOutlet.get(r.placeId) || []
    a.push(r); byOutlet.set(r.placeId, a)
  }
  const outletMeta = new Map(input.outlets.map((o) => [o.placeId, o]))
  type Agg = {
    placeId: string; reviews: number; avg: number
    lowCount: number; lowRate: number
    shareInBad: Record<string, number> // share of this outlet's bad reviews citing each theme
  }
  const aggs: Agg[] = []
  for (const [pid, rs] of byOutlet) {
    if (rs.length < minOutletReviews) continue
    const low = rs.filter((r) => r.rating <= LOW_MAX)
    const shareInBad: Record<string, number> = {}
    for (let j = 0; j < K; j++) shareInBad[themes[j]] = low.length ? low.filter((r) => r.themes[j]).length / low.length : 0
    aggs.push({ placeId: pid, reviews: rs.length, avg: mean(rs.map((r) => r.rating)), lowCount: low.length, lowRate: low.length / rs.length, shareInBad })
  }
  const totalN = aggs.reduce((s, o) => s + o.reviews, 0) || 1

  // Outlet 1–3★ spread + an achievable benchmark = the best-quartile mean rate.
  const sortedLow = aggs.map((o) => o.lowRate).sort((a, b) => a - b)
  const bestLowRate = sortedLow[0] ?? 0
  const worstLowRate = sortedLow[sortedLow.length - 1] ?? 0
  const medianLowRate = median(sortedLow)
  const qN = Math.max(1, Math.round(sortedLow.length * 0.25))
  const targetLowRate = mean(sortedLow.slice(0, qN))
  // Brand 1–3★ rate if every outlet came down to (at most) the target.
  const projectedLowRate = aggs.reduce((s, o) => s + Math.min(o.lowRate, targetLowRate) * o.reviews, 0) / totalN

  // ── Exemplars: best operators (lowest 1–3★ rate) at real volume. ──
  const eligible = aggs.filter((o) => o.reviews >= exemplarMinReviews)
  const bestOperators = [...eligible].sort((a, b) => a.lowRate - b.lowRate || (b.avg - a.avg))
  const exemplars: Exemplar[] = bestOperators.slice(0, 3).map((o) => ({
    placeId: o.placeId, label: outletMeta.get(o.placeId)?.label || o.placeId, lowRate: o.lowRate, rating: o.avg,
  }))
  // Per-theme exemplar: among the best operators, the one whose bad reviews least
  // cite that theme (a real best-practice owner of it), tie-broken by low 1–3★ rate.
  const themeExemplar: Record<string, Exemplar | null> = {}
  for (const t of themes) {
    const cand = [...eligible].sort((a, b) => a.shareInBad[t] - b.shareInBad[t] || (a.lowRate - b.lowRate))[0]
    themeExemplar[t] = cand ? { placeId: cand.placeId, label: outletMeta.get(cand.placeId)?.label || cand.placeId, lowRate: cand.lowRate, rating: cand.avg } : null
  }

  // ── Per-outlet levers: the driver themes its own unhappy guests cite most. ──
  const quoteFor = new Map<string, string>()
  for (const e of input.examples || []) quoteFor.set(`${e.placeId}|${e.theme}`, e.quote)
  const brandLiftOf: Record<string, number> = {}
  for (const d of drivers) brandLiftOf[d.theme] = d.lift

  const outletLevers: Record<string, OutletLever[]> = {}
  for (const o of aggs) {
    const levers = themes
      .filter((t) => driverSet.has(t) && o.shareInBad[t] > 0)
      .map((t) => ({
        theme: t,
        shareInBad: o.shareInBad[t],
        brandLift: brandLiftOf[t] ?? 0,
        exemplar: themeExemplar[t],
        quote: quoteFor.get(`${o.placeId}|${t}`) || null,
      } as OutletLever))
      .sort((a, b) => b.shareInBad - a.shareInBad)
    outletLevers[o.placeId] = levers
  }

  // ── Outlet hot-list (worst 1–3★ rate first). ──
  const outletSummaries: OutletSummary[] = aggs.map((o) => {
    const lever = (outletLevers[o.placeId] || [])[0]
    return {
      placeId: o.placeId,
      label: outletMeta.get(o.placeId)?.label || o.placeId,
      reviews: o.reviews,
      rating: o.avg,
      lowRate: o.lowRate,
      lowCount: o.lowCount,
      gapToTarget: Math.max(0, o.lowRate - targetLowRate),
      topDriver: lever ? { theme: lever.theme, shareInBad: lever.shareInBad } : null,
    }
  }).sort((a, b) => b.lowRate - a.lowRate)

  return {
    available: true,
    model: {
      population: n, chainAvg, lowRate, lowCount: lows.length,
      bestLowRate, worstLowRate, medianLowRate, targetLowRate, projectedLowRate,
    },
    drivers, brandLevers, exemplars, outletSummaries, outletLevers,
  }
}
