// Theme-driven "recover your 1–3★ guests" predictor for a multi-location brand.
//
// FRAME (chosen 2026-06-22). A brand's average is dragged down by its low-rated
// (1–3★) reviews; the goal is moving those guests up. Two complementary layers:
//
//   STRATEGIC (brand) — which themes are over-represented in 1–3★ vs 4–5★
//     reviews chain-wide (lift = P(theme|1–3★) ÷ P(theme|4–5★)). This controls
//     for base rate (a loud-but-neutral topic ≈1×) and surfaces the one or two
//     SYSTEMIC drivers. Outcome themes (loyalty / brand experience) are lagging
//     symptoms, not levers, so they're reported separately, never as a driver.
//
//   OPERATIONAL (outlet × theme) — PEER QUARTILES. For each actionable theme,
//     rank outlets by their PROBLEM RATE = share of the outlet's reviews that are
//     1–3★ AND cite the theme. An outlet in the BOTTOM quartile (worst peers) on
//     a theme has a real, fixable weakness there; TOP quartile = a strength /
//     who-to-learn-from. This is peer-relative, shows MULTIPLE issues per outlet,
//     never returns "diffuse", and the bottom-quartile outlets for a theme are
//     exactly "who to focus on" for it.
//
// Theme membership = keyword match on review text (same matchers as the
// leaderboard). Low = rating ≤ 3. Associational, not causal.

// ─── inputs (plain data — no server/db deps, unit-testable) ───

export type PredReview = { placeId: string; rating: number; themes: boolean[] }
export type PredOutlet = { placeId: string; label: string; reviews: number; rating: number | null }
export type PredExample = { placeId: string; theme: string; quote: string }

export type PredictorInput = {
  themeLabels: string[]
  reviews: PredReview[]
  outlets: PredOutlet[]
  examples?: PredExample[]
  minOutletReviews?: number   // outlet stability floor (default 30)
  minDriverBadN?: number      // theme needs this many 1–3★ mentions to rank as a brand driver (default 20)
  driverLift?: number         // over-representation threshold for a brand driver (default 1.2)
  exemplarMinReviews?: number // a credible "learn from" outlet needs this volume (default 60)
}

const LOW_MAX = 3 // rating ≤ 3 ⇒ a low-rated / detractor review

// ─── strategic layer (brand) ───

export type ThemeDriver = {
  theme: string
  pBad: number      // share of 1–3★ reviews mentioning the theme
  pGood: number     // share of 4–5★ reviews mentioning it
  lift: number      // pBad / pGood — over-representation among unhappy guests
  nBad: number      // 1–3★ reviews mentioning it (chain-wide)
  isOutcome: boolean
  isDriver: boolean // lift ≥ driverLift AND nBad ≥ minDriverBadN AND actionable
}

export type Exemplar = { placeId: string; label: string; lowRate: number; rating: number | null }

// ─── operational layer (outlet × theme, peer quartiles) ───

// One theme standing for an outlet — its peer rank on that theme.
export type ThemeStanding = {
  theme: string
  problemRate: number   // share of the outlet's reviews that are 1–3★ and cite the theme
  peerPercentile: number // 0–100, % of outlets this one is WORSE than (higher = worse)
  shareInBad: number    // share of the outlet's 1–3★ reviews citing the theme (context)
  cohortSize: number    // # outlets in the bottom quartile on this theme (the peer cohort)
  exemplar: Exemplar | null // a top-quartile (best) peer on this theme — who to learn from
  quote: string | null  // a verbatim 1–3★ quote from this outlet citing the theme
}

// Keep the historical name `OutletLever` (consumers import it) = a weakness.
export type OutletLever = ThemeStanding

// One outlet to focus on for a theme (the brand "slide per theme" view).
export type OutletFocus = {
  placeId: string
  label: string
  lowRate: number
  problemRate: number
  peerPercentile: number
}

export type OutletSummary = {
  placeId: string
  label: string
  reviews: number
  rating: number | null
  lowRate: number
  lowCount: number
  gapToTarget: number
  lowRateRank: number   // 1 = the brand's highest 1–3★ rate (worst); N = best
  topIssue: { theme: string; peerPercentile: number } | null // worst-quartile theme
  weaknessCount: number // # bottom-quartile actionable themes
}

export type PredictorModel = {
  population: number
  chainAvg: number
  lowRate: number
  lowCount: number
  bestLowRate: number
  worstLowRate: number
  medianLowRate: number
  targetLowRate: number
  projectedLowRate: number
}

export type OutletPredictor = {
  available: boolean
  model: PredictorModel
  drivers: ThemeDriver[]        // all themes by over-representation lift desc
  brandLevers: ThemeDriver[]    // ACTIONABLE systemic drivers (isDriver), by lift desc
  outcomeSignals: ThemeDriver[] // over-represented OUTCOME themes — symptoms, not levers
  actionableThemes: string[]    // operational themes (non-outcome), original order
  exemplars: Exemplar[]         // best operators (lowest 1–3★ rate), best first
  outletSummaries: OutletSummary[] // worst 1–3★ rate first
  outletLevers: Record<string, ThemeStanding[]>   // per outlet, BOTTOM-quartile themes (weaknesses), worst first
  outletStrengths: Record<string, ThemeStanding[]> // per outlet, TOP-quartile themes, best first
  themeFocus: Record<string, OutletFocus[]>       // per theme, bottom-quartile outlets, worst first
}

// Lagging-outcome themes — predicted BY the operational drivers, not directly
// actionable by a store manager (you fix loyalty by fixing order accuracy,
// food, service…). Matched on theme name.
const OUTCOME_RE = /loyalty|brand experience|brand[- ]?love|retention|net promoter|\bnps\b|would (not )?recommend/i

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
  const MIN_THEME_SIGNAL = 20   // chain-wide 1–3★ mentions for a theme to be peer-ranked
  const BOTTOM_PCTL = 75        // ≥ this percentile (worse than ≥75% of peers) ⇒ weakness
  const TOP_PCTL = 25           // ≤ this percentile ⇒ strength
  const themes = input.themeLabels
  const K = themes.length
  const revs = input.reviews
  const n = revs.length

  const empty: OutletPredictor = {
    available: false,
    model: { population: n, chainAvg: 0, lowRate: 0, lowCount: 0, bestLowRate: 0, worstLowRate: 0, medianLowRate: 0, targetLowRate: 0, projectedLowRate: 0 },
    drivers: [], brandLevers: [], outcomeSignals: [], actionableThemes: [], exemplars: [],
    outletSummaries: [], outletLevers: {}, outletStrengths: {}, themeFocus: {},
  }
  if (!K || n < 50) return empty

  const chainAvg = mean(revs.map((r) => r.rating))
  const lows = revs.filter((r) => r.rating <= LOW_MAX)
  const highs = revs.filter((r) => r.rating > LOW_MAX)
  const lowRate = lows.length / n

  // ── Strategic: brand over-representation drivers. ──
  const drivers: ThemeDriver[] = themes.map((t, j) => {
    const nBad = lows.filter((r) => r.themes[j]).length
    const pBad = lows.length ? nBad / lows.length : 0
    const pGood = highs.length ? highs.filter((r) => r.themes[j]).length / highs.length : 0
    const lift = pGood > 0 ? pBad / pGood : (pBad > 0 ? Infinity : 0)
    const isOutcome = OUTCOME_RE.test(t)
    return { theme: t, pBad, pGood, lift, nBad, isOutcome, isDriver: lift >= driverLift && nBad >= minDriverBadN && !isOutcome }
  }).sort((a, b) => b.lift - a.lift)
  const brandLevers = drivers.filter((d) => d.isDriver)
  const outcomeSignals = drivers.filter((d) => d.isOutcome && d.lift >= driverLift && d.nBad >= minDriverBadN)
  const actionableIdx = themes.map((t, j) => ({ t, j })).filter((x) => !OUTCOME_RE.test(x.t))
  const actionableThemes = actionableIdx.map((x) => x.t)

  // ── Per-outlet aggregates. problemRate[T] = share of the outlet's reviews
  // that are 1–3★ AND cite T (how often it produces a T-citing unhappy guest). ──
  const byOutlet = new Map<string, PredReview[]>()
  for (const r of revs) { const a = byOutlet.get(r.placeId) || []; a.push(r); byOutlet.set(r.placeId, a) }
  const outletMeta = new Map(input.outlets.map((o) => [o.placeId, o]))
  type Agg = {
    placeId: string; reviews: number; avg: number; lowCount: number; lowRate: number
    problemRate: Record<string, number>; shareInBad: Record<string, number>; badCount: Record<string, number>
  }
  const aggs: Agg[] = []
  for (const [pid, rs] of byOutlet) {
    if (rs.length < minOutletReviews) continue
    const low = rs.filter((r) => r.rating <= LOW_MAX)
    const problemRate: Record<string, number> = {}, shareInBad: Record<string, number> = {}, badCount: Record<string, number> = {}
    for (let j = 0; j < K; j++) {
      const c = low.filter((r) => r.themes[j]).length
      badCount[themes[j]] = c
      problemRate[themes[j]] = c / rs.length
      shareInBad[themes[j]] = low.length ? c / low.length : 0
    }
    aggs.push({ placeId: pid, reviews: rs.length, avg: mean(rs.map((r) => r.rating)), lowCount: low.length, lowRate: low.length / rs.length, problemRate, shareInBad, badCount })
  }
  const totalN = aggs.reduce((s, o) => s + o.reviews, 0) || 1

  // 1–3★ spread + best-quartile target.
  const sortedLow = aggs.map((o) => o.lowRate).sort((a, b) => a - b)
  const bestLowRate = sortedLow[0] ?? 0
  const worstLowRate = sortedLow[sortedLow.length - 1] ?? 0
  const medianLowRate = median(sortedLow)
  const qN = Math.max(1, Math.round(sortedLow.length * 0.25))
  const targetLowRate = mean(sortedLow.slice(0, qN))
  const projectedLowRate = aggs.reduce((s, o) => s + Math.min(o.lowRate, targetLowRate) * o.reviews, 0) / totalN

  // Brand "who does it well" exemplars (lowest 1–3★ rate at volume).
  const eligible = aggs.filter((o) => o.reviews >= exemplarMinReviews)
  const exemplars: Exemplar[] = [...eligible].sort((a, b) => a.lowRate - b.lowRate || (b.avg - a.avg)).slice(0, 3)
    .map((o) => ({ placeId: o.placeId, label: outletMeta.get(o.placeId)?.label || o.placeId, lowRate: o.lowRate, rating: o.avg }))

  // ── Peer quartiles per ACTIONABLE theme (with enough chain signal). ──
  const labelOf = (pid: string) => outletMeta.get(pid)?.label || pid
  const themePctl: Record<string, Map<string, number>> = {} // theme → placeId → percentile (0–100, worse)
  const themeRanked = new Set<string>()
  const themeBestPeer: Record<string, Exemplar | null> = {}
  const themeFocus: Record<string, OutletFocus[]> = {}
  for (const t of actionableThemes) {
    const chainBad = aggs.reduce((s, o) => s + o.badCount[t], 0)
    if (chainBad < MIN_THEME_SIGNAL || aggs.length < 4) continue
    themeRanked.add(t)
    const rates = aggs.map((o) => o.problemRate[t])
    const pctl = new Map<string, number>()
    for (const o of aggs) {
      const worseThan = rates.filter((r) => r < o.problemRate[t]).length
      pctl.set(o.placeId, aggs.length > 1 ? (100 * worseThan) / (aggs.length - 1) : 0)
    }
    themePctl[t] = pctl
    // Bottom-quartile outlets = who to focus on for this theme.
    themeFocus[t] = aggs
      .filter((o) => (pctl.get(o.placeId) ?? 0) >= BOTTOM_PCTL && o.problemRate[t] > 0)
      .sort((a, b) => b.problemRate[t] - a.problemRate[t])
      .map((o) => ({ placeId: o.placeId, label: labelOf(o.placeId), lowRate: o.lowRate, problemRate: o.problemRate[t], peerPercentile: pctl.get(o.placeId) ?? 0 }))
    // Best peer on this theme (top quartile, real volume) = who to learn from.
    const best = [...eligible].filter((o) => (pctl.get(o.placeId) ?? 100) <= TOP_PCTL)
      .sort((a, b) => a.problemRate[t] - b.problemRate[t] || a.lowRate - b.lowRate)[0]
    themeBestPeer[t] = best ? { placeId: best.placeId, label: labelOf(best.placeId), lowRate: best.lowRate, rating: best.avg } : null
  }

  // ── Per-outlet weaknesses (bottom quartile) + strengths (top quartile). ──
  const quoteFor = new Map<string, string>()
  for (const e of input.examples || []) quoteFor.set(`${e.placeId}|${e.theme}`, e.quote)
  const standing = (o: Agg, t: string): ThemeStanding => ({
    theme: t, problemRate: o.problemRate[t], peerPercentile: themePctl[t]?.get(o.placeId) ?? 0,
    shareInBad: o.shareInBad[t], cohortSize: (themeFocus[t] || []).length,
    exemplar: themeBestPeer[t] || null, quote: quoteFor.get(`${o.placeId}|${t}`) || null,
  })
  const outletLevers: Record<string, ThemeStanding[]> = {}
  const outletStrengths: Record<string, ThemeStanding[]> = {}
  for (const o of aggs) {
    const ranked = actionableThemes.filter((t) => themeRanked.has(t))
    outletLevers[o.placeId] = ranked
      .filter((t) => (themePctl[t]?.get(o.placeId) ?? 0) >= BOTTOM_PCTL && o.problemRate[t] > 0)
      .map((t) => standing(o, t))
      .sort((a, b) => b.peerPercentile - a.peerPercentile || b.problemRate - a.problemRate)
    outletStrengths[o.placeId] = ranked
      .filter((t) => (themePctl[t]?.get(o.placeId) ?? 100) <= TOP_PCTL)
      .map((t) => standing(o, t))
      .sort((a, b) => a.peerPercentile - b.peerPercentile)
  }

  const outletSummaries: OutletSummary[] = aggs.map((o) => {
    const w = outletLevers[o.placeId] || []
    return {
      placeId: o.placeId, label: labelOf(o.placeId), reviews: o.reviews, rating: o.avg,
      lowRate: o.lowRate, lowCount: o.lowCount, gapToTarget: Math.max(0, o.lowRate - targetLowRate),
      lowRateRank: 0, // assigned after the worst-first sort below
      topIssue: w[0] ? { theme: w[0].theme, peerPercentile: w[0].peerPercentile } : null,
      weaknessCount: w.length,
    }
  }).sort((a, b) => b.lowRate - a.lowRate)
  outletSummaries.forEach((o, i) => { o.lowRateRank = i + 1 })

  return {
    available: true,
    model: { population: n, chainAvg, lowRate, lowCount: lows.length, bestLowRate, worstLowRate, medianLowRate, targetLowRate, projectedLowRate },
    drivers, brandLevers, outcomeSignals, actionableThemes, exemplars,
    outletSummaries, outletLevers, outletStrengths, themeFocus,
  }
}
