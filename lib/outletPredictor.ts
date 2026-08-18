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

export type PredReview = { placeId: string; rating: number; themes: boolean[]; month?: string } // month = YYYY-MM (for trends)
export type PredOutlet = { placeId: string; label: string; reviews: number; rating: number | null; ratingN?: number } // rating = avg over ALL rated rows; ratingN = that all-rows rated count
export type PredExample = { placeId: string; theme: string; quote: string; rating?: number }

export type PredictorInput = {
  themeLabels: string[]
  reviews: PredReview[]
  outlets: PredOutlet[]
  examples?: PredExample[]         // 1–3★ quotes per outlet×theme (weakness evidence)
  positiveExamples?: PredExample[] // 4–5★ quotes per outlet×theme (strength evidence)
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
  exemplars: Exemplar[] // top 3–5 peers to learn from on this theme (best first)
  quote: string | null  // a verbatim 1–3★ quote from this outlet citing the theme
  // Detractors this outlet would win back by moving THIS theme alone to the peer
  // median — the honest measure of "work this first". Deliberately solo and
  // therefore conservative: projectRecovery gates each review by its
  // LEAST-improved theme, so a review that also cites something you're not
  // fixing counts for nothing. A theme with a wide peer gap but heavy
  // co-occurrence lands near zero, which is the correct signal — on its own it
  // buys you little. See the what-if block for the combined scenario.
  soloRecovery: number
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

// Interactive what-if data for one outlet: its 1–3★ reviews as ACTIONABLE-theme
// index sets, plus the outlet's current per-theme problem rate. The client
// toggles themes + a target and recomputes "detractors recovered" live.
export type OutletWhatIf = {
  reviews13: number[][] // per 1–3★ review, the actionable-theme indices it cites
  currentRate: number[] // this outlet's problem rate per actionable theme (index-aligned)
  totalReviews: number // text-bearing review count (the recoverable pool / lowRate denominator)
  ratedReviews: number // ALL rated rows (the denominator for projecting the all-reviews avg ★)
  lowCount: number
  lowRate: number
  avg: number          // outlet's current avg star rating — over ALL rated rows (ties to Google)
  detractorAvg: number // mean rating of its 1–3★ reviews (where a recovered detractor leaves from)
  happyAvg: number     // mean rating of its 4–5★ reviews (where a recovered detractor lands)
}

// The assembled per-outlet what-if VIEW — `OutletWhatIf` widened with the
// peer benchmarks + trends the page joins in (outletReport/page.tsx). Declared
// here, next to its two sources, because both the interactive panel and the
// PDF's static equivalent consume it and a server lib must not import a type
// out of a `'use client'` component.
export type WhatIfView = {
  themes: string[]          // actionable theme names (index-aligned)
  reviews13: number[][]     // each 1–3★ review's actionable-theme indices
  currentRate: number[]     // this outlet's problem rate per theme
  medianRate: number[]      // peer-median problem rate per theme
  bestRate: number[]        // best-quartile problem rate per theme
  worstRate: number[]       // worst-in-class problem rate per theme (the right anchor)
  totalReviews: number      // text-bearing reviews (the recoverable pool / lowRate denominator)
  ratedReviews: number      // ALL rated rows (denominator for projecting the all-reviews avg ★)
  lowCount: number
  lowRate: number
  avg: number               // outlet's current avg star rating — over ALL rated rows (ties to Google)
  detractorAvg: number      // mean rating of its 1–3★ reviews
  happyAvg: number          // mean rating of its 4–5★ reviews
  otherRatings: number[]    // every OTHER outlet's avg star (for the conventional rank)
  currentRank: number       // 1 = best (highest avg star)
  outletCount: number
  trends: (ThemeTrend | null)[]  // brand-level QoQ trend per theme (index-aligned)
  trendBasis: { recent: string; prior: string } | null
}

export type ThemeTrend = { direction: 'up' | 'down' | 'flat'; recentRate: number; priorRate: number }

// "Detractors recovered" if the outlet moved each theme's problem rate from
// `currentRate[i]` to `targetRate[i]` (per-theme target — what each slider sets).
// Honest about co-occurrence: a review flips only if EVERY theme it cites is
// being improved, and it's gated by its LEAST-improved theme (min reduction). So
// a review that also cites a theme left at its current rate stays a detractor,
// and the recovery scales with how far you actually move the binding theme.
export function projectRecovery(
  reviews13: number[][], currentRate: number[], targetRate: number[],
): number {
  let recovered = 0
  for (const r of reviews13) {
    if (!r.length) continue
    let min = Infinity
    for (const i of r) {
      const red = currentRate[i] > 0 ? Math.max(0, (currentRate[i] - targetRate[i]) / currentRate[i]) : 0
      if (red < min) min = red
    }
    recovered += min === Infinity ? 0 : min
  }
  return recovered
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
  ratingRank: number    // CONVENTIONAL rank by avg star: 1 = best (highest), N = worst
  topIssue: { theme: string; peerPercentile: number } | null // the theme this outlet ranks WORST on vs peers (by percentile, not by impact)
  weaknessCount: number // # bottom-quartile actionable themes
}

export type PredictorModel = {
  population: number      // text-bearing reviews analyzed (lowRate / recovery denominator)
  ratedPopulation: number // ALL rated reviews (denominator for projecting the all-reviews brand avg ★)
  chainAvg: number        // brand avg ★ over ALL rated rows (ties to Google)
  detractorAvg: number // brand mean rating of 1–3★ reviews (for the playbook avg-★ projection)
  happyAvg: number     // brand mean rating of 4–5★ reviews
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
  themeExemplars: Record<string, Exemplar[]>      // per theme, top 3–5 performers to learn from
  themeTargets: { theme: string; medianRate: number; bestRate: number; worstRate: number }[] // per actionable theme, peer-median + best-quartile + worst-in-class problem rate
  outletWhatIf: Record<string, OutletWhatIf>      // per outlet, interactive what-if input
  allLowRates: number[]                           // every outlet's current 1–3★ rate (for live rank recompute)
  allRatings: number[]                            // every outlet's avg star rating (for the conventional 1=best rank)
  // Brand-level QoQ trend per actionable theme — problem rate in the most recent
  // full quarter vs the prior one. Brand-wide (per-outlet per-quarter is too
  // sparse to trust). trendBasis is null when there isn't enough dated data.
  themeTrends: Record<string, { direction: 'up' | 'down' | 'flat'; recentRate: number; priorRate: number }>
  trendBasis: { recent: string; prior: string } | null
  recommendedActions: RecommendedAction[] // greedy impact-ranked playbook (de-duplicated)
  // For each over-represented OUTCOME theme (loyalty/brand), the operational
  // themes most correlated with it among 1–3★ reviews — i.e. what drives the
  // loyalty erosion (so "fix the drivers and loyalty follows" gets specific).
  outcomeCorrelations: { outcome: string; n: number; drivers: { theme: string; coShare: number; lift: number }[] }[]
}

// Lagging-outcome themes — predicted BY the operational drivers, not directly
// actionable by a store manager (you fix loyalty by fixing order accuracy,
// food, service…). Matched on theme name.
const OUTCOME_RE = /loyalty|brand experience|brand[- ]?love|retention|net promoter|\bnps\b|would (not )?recommend/i

// ─── recommended actions (greedy, impact-ranked, de-duplicated) ───

export type RecommendedAction = {
  kind: 'outlet' | 'theme'
  recovered: number    // MARGINAL detractors this action wins back (beyond prior actions)
  cumulative: number   // running total across the playbook
  rec: { i: number; w: number }[] // per-review recovery (review index → weight) so a
                                   // client can re-compute the de-duplicated total for any selected subset
  // outlet turnaround:
  placeId?: string
  label?: string
  weaknessThemes?: string[]
  // theme program:
  theme?: string
  cohort?: number      // # bottom-quartile outlets the program touches
  trend?: 'up' | 'down' | 'flat'
}

type ActionCand = {
  meta: Omit<RecommendedAction, 'recovered' | 'cumulative' | 'rec'>
  rec: { id: string; w: number }[] // per-review recovery weight this action provides
}

// Greedy set-cover over the brand's 1–3★ review pool. Each round picks the
// action with the highest MARGINAL recovery (beyond what's already been won
// back), so the playbook is additive, not double-counted. Outlet turnarounds
// fix all of an outlet's themes to median; theme programs fix one theme at its
// bottom-quartile cohort (and so only recover that-theme-only reviews).
export function buildRecommendedActions(args: {
  outlets: { placeId: string; label: string; reviews13: number[][]; redToMedian: number[]; weaknessThemes: string[] }[]
  actionableThemes: string[]
  themeCohorts: Record<string, string[]>          // theme → bottom-quartile placeIds
  themeTrends: Record<string, { direction: 'up' | 'down' | 'flat' }>
  maxActions?: number
  minMarginal?: number
}): RecommendedAction[] {
  const maxActions = args.maxActions ?? 8
  const minMarginal = args.minMarginal ?? 2
  const byId = new Map(args.outlets.map((o) => [o.placeId, o]))
  const cands: ActionCand[] = []

  // Outlet turnarounds: recovery gated by each review's least-improved theme.
  for (const o of args.outlets) {
    if (!o.reviews13.length || !o.redToMedian.some((r) => r > 0)) continue
    const rec: { id: string; w: number }[] = []
    o.reviews13.forEach((themeIdxs, k) => {
      if (!themeIdxs.length) return
      let min = Infinity
      for (const i of themeIdxs) { const r = o.redToMedian[i] || 0; if (r < min) min = r }
      if (min > 0) rec.push({ id: `${o.placeId}#${k}`, w: min })
    })
    if (rec.length) cands.push({ meta: { kind: 'outlet', placeId: o.placeId, label: o.label, weaknessThemes: o.weaknessThemes }, rec })
  }

  // Theme programs: recover only single-theme (T-only) reviews at the cohort.
  args.actionableThemes.forEach((t, ti) => {
    const cohort = args.themeCohorts[t] || []
    if (cohort.length < 2) return
    const rec: { id: string; w: number }[] = []
    for (const pid of cohort) {
      const o = byId.get(pid); if (!o) continue
      o.reviews13.forEach((themeIdxs, k) => {
        if (themeIdxs.length === 1 && themeIdxs[0] === ti) { const w = o.redToMedian[ti] || 0; if (w > 0) rec.push({ id: `${pid}#${k}`, w }) }
      })
    }
    if (rec.length) cands.push({ meta: { kind: 'theme', theme: t, cohort: cohort.length, trend: args.themeTrends[t]?.direction }, rec })
  })

  const recovered = new Map<string, number>()
  const out: (Omit<RecommendedAction, 'rec'> & { _rec: { id: string; w: number }[] })[] = []
  let cumulative = 0
  const pool = [...cands]
  for (let round = 0; round < maxActions && pool.length; round++) {
    let bestI = -1, bestMarg = 0
    for (let i = 0; i < pool.length; i++) {
      let m = 0
      for (const { id, w } of pool[i].rec) m += Math.max(0, w - (recovered.get(id) || 0))
      if (m > bestMarg) { bestMarg = m; bestI = i }
    }
    if (bestI < 0 || bestMarg < minMarginal) break
    const chosen = pool.splice(bestI, 1)[0]
    for (const { id, w } of chosen.rec) recovered.set(id, Math.max(recovered.get(id) || 0, w))
    cumulative += bestMarg
    out.push({ ...chosen.meta, recovered: bestMarg, cumulative, _rec: chosen.rec })
  }
  // Remap the recovered-review string keys (only across the chosen actions) to
  // compact integer indices, so the client can union-merge any selected subset.
  const idIdx = new Map<string, number>(); let nextIdx = 0
  for (const a of out) for (const r of a._rec) if (!idIdx.has(r.id)) idIdx.set(r.id, nextIdx++)
  return out.map(({ _rec, ...a }) => ({ ...a, rec: _rec.map((r) => ({ i: idIdx.get(r.id)!, w: r.w })) }))
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
  const MIN_THEME_SIGNAL = 20   // chain-wide 1–3★ mentions for a theme to be peer-ranked
  const BOTTOM_PCTL = 75        // ≥ this percentile (worse than ≥75% of peers) ⇒ weakness
  const TOP_PCTL = 25           // ≤ this percentile ⇒ strength
  const themes = input.themeLabels
  const K = themes.length
  const revs = input.reviews
  const n = revs.length

  const empty: OutletPredictor = {
    available: false,
    model: { population: n, ratedPopulation: 0, chainAvg: 0, detractorAvg: 0, happyAvg: 0, lowRate: 0, lowCount: 0, bestLowRate: 0, worstLowRate: 0, medianLowRate: 0, targetLowRate: 0, projectedLowRate: 0 },
    drivers: [], brandLevers: [], outcomeSignals: [], actionableThemes: [], exemplars: [],
    outletSummaries: [], outletLevers: {}, outletStrengths: {}, themeFocus: {}, themeExemplars: {},
    themeTargets: [], outletWhatIf: {}, allLowRates: [], allRatings: [], themeTrends: {}, trendBasis: null, recommendedActions: [],
    outcomeCorrelations: [],
  }
  if (!K || n < 50) return empty

  // Brand avg ★ over ALL rated rows (every review with a rating, incl. rating-only)
  // so it ties back to Google / exports — weighted by each outlet's all-rows rated
  // count. Falls back to the text-pool mean when the input carries no all-rows
  // rating (e.g. unit-test fixtures with rating:null), preserving prior behaviour.
  const outletMetaForAvg = input.outlets.filter((o) => o.rating != null && (o.ratingN ?? 0) > 0)
  const ratedPopulation = outletMetaForAvg.reduce((s, o) => s + (o.ratingN || 0), 0)
  const chainAvg = ratedPopulation
    ? outletMetaForAvg.reduce((s, o) => s + (o.rating as number) * (o.ratingN || 0), 0) / ratedPopulation
    : mean(revs.map((r) => r.rating))
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
  const actFullIdx = actionableIdx.map((x) => x.j) // full-themes index per actionable theme
  type Agg = {
    placeId: string; reviews: number; avg: number; ratedN: number; lowCount: number; lowRate: number
    detractorAvg: number; happyAvg: number
    problemRate: Record<string, number>; shareInBad: Record<string, number>; badCount: Record<string, number>
    reviews13: number[][] // 1–3★ reviews as actionable-theme index sets (for what-if)
  }
  const aggs: Agg[] = []
  for (const [pid, rs] of byOutlet) {
    if (rs.length < minOutletReviews) continue
    const low = rs.filter((r) => r.rating <= LOW_MAX)
    const high = rs.filter((r) => r.rating > LOW_MAX)
    const problemRate: Record<string, number> = {}, shareInBad: Record<string, number> = {}, badCount: Record<string, number> = {}
    for (let j = 0; j < K; j++) {
      const c = low.filter((r) => r.themes[j]).length
      badCount[themes[j]] = c
      problemRate[themes[j]] = c / rs.length
      shareInBad[themes[j]] = low.length ? c / low.length : 0
    }
    const reviews13 = low.map((r) => actFullIdx.map((j, i) => (r.themes[j] ? i : -1)).filter((i) => i >= 0))
    // Display rating = the outlet's avg over ALL rated rows (from the scan, ties
    // to Google), not the text-only review mean. Fall back to the text mean when
    // the input carries no all-rows rating (unit-test fixtures). The 1–3★/4–5★
    // cohort means (detractorAvg/happyAvg) and lowRate stay over the text pool —
    // they drive the recovery model, which only acts on reviews with comments.
    const meta = outletMeta.get(pid)
    const allRowsAvg = meta && meta.rating != null ? meta.rating : mean(rs.map((r) => r.rating))
    const ratedN = meta && (meta.ratingN ?? 0) > 0 ? (meta.ratingN as number) : rs.length
    aggs.push({
      placeId: pid, reviews: rs.length, avg: allRowsAvg, ratedN, lowCount: low.length, lowRate: low.length / rs.length,
      detractorAvg: mean(low.map((r) => r.rating)), happyAvg: mean(high.map((r) => r.rating)),
      problemRate, shareInBad, badCount, reviews13,
    })
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
  }

  // Per-theme "learn from" — the top 3–5 performers ON THAT THEME (top-quartile,
  // at real volume), best first, tie-broken by review volume (proven at scale).
  // A LIST, not one pick: the top performers are ~tied at zero problems, so a
  // single pick collapses to whichever outlet is best overall and gets
  // recommended for every theme. A handful gives the GM real, varied options.
  const themeExemplars: Record<string, Exemplar[]> = {}
  for (const t of themeRanked) {
    themeExemplars[t] = eligible
      .filter((o) => (themePctl[t]?.get(o.placeId) ?? 100) <= TOP_PCTL)
      .sort((a, b) => a.problemRate[t] - b.problemRate[t] || b.reviews - a.reviews)
      .slice(0, 5)
      .map((o) => ({ placeId: o.placeId, label: labelOf(o.placeId), lowRate: o.lowRate, rating: o.avg }))
  }

  // Per-theme peer targets. Computed HERE, ahead of the weakness cards, because
  // each card now reports what closing its own gap to the median would recover.
  const p25 = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * 0.25)] : 0 }
  const themeTargets = actionableThemes.map((t) => {
    const rates = aggs.map((o) => o.problemRate[t])
    return { theme: t, medianRate: median(rates), bestRate: p25(rates), worstRate: Math.max(0, ...rates) }
  })
  const medianByIdx = themeTargets.map((t) => t.medianRate)
  const idxOfTheme = new Map(actionableThemes.map((t, i) => [t, i]))

  // ── Per-outlet weaknesses (bottom quartile) + strengths (top quartile). ──
  // Weakness cards quote a 1–3★ review (the complaint); strength cards quote a
  // 4–5★ review (the praise) — pass the matching quote map per context.
  const negQuote = new Map<string, string>()
  for (const e of input.examples || []) negQuote.set(`${e.placeId}|${e.theme}`, e.quote)
  const posQuote = new Map<string, string>()
  for (const e of input.positiveExamples || []) posQuote.set(`${e.placeId}|${e.theme}`, e.quote)
  // What moving ONE theme to the peer median wins back, holding everything else
  // where it is. Same pure projectRecovery the what-if panel uses.
  const soloRecoveryOf = (o: Agg, cur: number[], t: string): number => {
    const i = idxOfTheme.get(t)
    if (i == null || !o.reviews13.length) return 0
    const target = cur.map((c, k) => (k === i ? Math.min(c, medianByIdx[i]) : c))
    return projectRecovery(o.reviews13, cur, target)
  }
  const standing = (o: Agg, t: string, qmap: Map<string, string>, cur: number[]): ThemeStanding => ({
    theme: t, problemRate: o.problemRate[t], peerPercentile: themePctl[t]?.get(o.placeId) ?? 0,
    shareInBad: o.shareInBad[t], cohortSize: (themeFocus[t] || []).length,
    exemplars: themeExemplars[t] || [], quote: qmap.get(`${o.placeId}|${t}`) || null,
    soloRecovery: soloRecoveryOf(o, cur, t),
  })
  const outletLevers: Record<string, ThemeStanding[]> = {}
  const outletStrengths: Record<string, ThemeStanding[]> = {}
  for (const o of aggs) {
    const ranked = actionableThemes.filter((t) => themeRanked.has(t))
    const cur = actionableThemes.map((t) => o.problemRate[t])
    // Ordered by what fixing each one actually WINS BACK, not by how deep into
    // the worst tail it sits (2026-08-18, owner). Peer percentile answers "how
    // unusual is this?"; it does not answer "what do I do first?" — a theme can
    // be bottom-10% and still touch fewer guests than a bottom-25% one. Ties and
    // outlets with no 1–3★ pool fall back to the old percentile order.
    outletLevers[o.placeId] = ranked
      .filter((t) => (themePctl[t]?.get(o.placeId) ?? 0) >= BOTTOM_PCTL && o.problemRate[t] > 0)
      .map((t) => standing(o, t, negQuote, cur))
      .sort((a, b) => b.soloRecovery - a.soloRecovery || b.peerPercentile - a.peerPercentile || b.problemRate - a.problemRate)
    outletStrengths[o.placeId] = ranked
      .filter((t) => (themePctl[t]?.get(o.placeId) ?? 100) <= TOP_PCTL)
      .map((t) => standing(o, t, posQuote, cur))
      .sort((a, b) => a.peerPercentile - b.peerPercentile)
  }

  const outletSummaries: OutletSummary[] = aggs.map((o) => {
    const w = outletLevers[o.placeId] || []
    const worstRanked = w.length
      ? [...w].sort((a, b) => b.peerPercentile - a.peerPercentile || b.problemRate - a.problemRate)[0]
      : null
    return {
      placeId: o.placeId, label: labelOf(o.placeId), reviews: o.reviews, rating: o.avg,
      lowRate: o.lowRate, lowCount: o.lowCount, gapToTarget: Math.max(0, o.lowRate - targetLowRate),
      lowRateRank: 0, ratingRank: 0, // assigned below
      // PINNED to the worst PERCENTILE, deliberately not `w[0]`. The lever cards
      // are now ordered by recovery impact (2026-08-18), but this field is
      // rendered under the label "Worst-ranked issue (vs all outlets)" on Brand
      // Health and in two decks — letting it follow the new order would make
      // that column say something it doesn't mean.
      topIssue: worstRanked ? { theme: worstRanked.theme, peerPercentile: worstRanked.peerPercentile } : null,
      weaknessCount: w.length,
    }
  }).sort((a, b) => b.lowRate - a.lowRate)
  outletSummaries.forEach((o, i) => { o.lowRateRank = i + 1 })
  // Conventional star-rating rank: 1 = best (highest avg). Independent of the
  // 1–3★-rate sort above.
  const allRatings = aggs.map((o) => o.avg)
  outletSummaries.forEach((o) => { o.ratingRank = 1 + allRatings.filter((r) => r > (o.rating ?? -1)).length })

  // ── Interactive what-if inputs. Per actionable theme, the peer-median and
  // best-quartile problem rate (the targets); per outlet, its 1–3★ review
  // theme-sets + current per-theme problem rate. ──
  const outletWhatIf: Record<string, OutletWhatIf> = {}
  for (const o of aggs) {
    outletWhatIf[o.placeId] = {
      reviews13: o.reviews13,
      currentRate: actionableThemes.map((t) => o.problemRate[t]),
      totalReviews: o.reviews, ratedReviews: o.ratedN, lowCount: o.lowCount, lowRate: o.lowRate,
      avg: o.avg, detractorAvg: o.detractorAvg, happyAvg: o.happyAvg,
    }
  }
  const allLowRates = aggs.map((o) => o.lowRate)

  // ── Brand-level QoQ trend per actionable theme. Problem rate in the most
  // recent full quarter (≥ MIN_Q reviews) vs the prior qualifying quarter. ──
  const MIN_Q = 40
  const quarterOf = (mo: string): string | null => {
    const m = /^(\d{4})-(\d{2})$/.exec(mo || '')
    if (!m) return null
    return `${m[1]}Q${Math.floor((Number(m[2]) - 1) / 3) + 1}`
  }
  const byQuarter = new Map<string, PredReview[]>()
  for (const r of revs) { const q = r.month ? quarterOf(r.month) : null; if (!q) continue; const a = byQuarter.get(q) || []; a.push(r); byQuarter.set(q, a) }
  const qualQuarters = [...byQuarter.entries()].filter(([, rs]) => rs.length >= MIN_Q).map(([q]) => q).sort()
  const themeTrends: Record<string, { direction: 'up' | 'down' | 'flat'; recentRate: number; priorRate: number }> = {}
  let trendBasis: { recent: string; prior: string } | null = null
  if (qualQuarters.length >= 2) {
    const recent = qualQuarters[qualQuarters.length - 1], prior = qualQuarters[qualQuarters.length - 2]
    trendBasis = { recent, prior }
    const rate = (rs: PredReview[], j: number) => rs.filter((r) => r.rating <= LOW_MAX && r.themes[j]).length / rs.length
    for (const { t, j } of actionableIdx) {
      const recentRate = rate(byQuarter.get(recent)!, j), priorRate = rate(byQuarter.get(prior)!, j)
      const d = recentRate - priorRate
      // Directional only on a meaningful move — ≥0.5pp absolute AND ≥25% relative
      // — so noise on a ~1% base rate reads "flat", not a false trend.
      const rel = priorRate > 0 ? Math.abs(d) / priorRate : (recentRate > 0 ? 1 : 0)
      const sig = Math.abs(d) >= 0.005 && rel >= 0.25
      themeTrends[t] = { direction: sig ? (d > 0 ? 'up' : 'down') : 'flat', recentRate, priorRate }
    }
  }

  // ── Recommended actions: greedy, impact-ranked, de-duplicated playbook. ──
  const medByIdx = themeTargets.map((t) => t.medianRate)
  const recommendedActions = buildRecommendedActions({
    outlets: aggs.map((o) => ({
      placeId: o.placeId,
      label: labelOf(o.placeId),
      reviews13: o.reviews13,
      redToMedian: actionableThemes.map((t, i) => { const c = o.problemRate[t]; return c > 0 ? Math.max(0, (c - medByIdx[i]) / c) : 0 }),
      weaknessThemes: (outletLevers[o.placeId] || []).map((l) => l.theme),
    })),
    actionableThemes,
    themeCohorts: Object.fromEntries(actionableThemes.map((t) => [t, (themeFocus[t] || []).map((f) => f.placeId)])),
    themeTrends,
  })

  // ── Outcome→driver correlation (BRAND-LEVEL; per-outlet is far too sparse).
  // For each over-represented outcome theme, the operational themes most
  // correlated with it among 1–3★ reviews (co-occurrence lift vs base rate). ──
  const lowBaseShare: Record<number, number> = {}
  for (const { j } of actionableIdx) lowBaseShare[j] = lows.length ? lows.filter((r) => r.themes[j]).length / lows.length : 0
  const outcomeCorrelations: OutletPredictor['outcomeCorrelations'] = []
  for (let oj = 0; oj < K; oj++) {
    if (!OUTCOME_RE.test(themes[oj])) continue
    const loN = lows.filter((r) => r.themes[oj])
    if (loN.length < 15) continue // too few to be even directional
    const driverCorr = actionableIdx.map(({ t, j }) => {
      const coShare = loN.filter((r) => r.themes[j]).length / loN.length
      return { theme: t, coShare, lift: lowBaseShare[j] > 0 ? coShare / lowBaseShare[j] : 0 }
    }).sort((a, b) => b.lift - a.lift)
    outcomeCorrelations.push({ outcome: themes[oj], n: loN.length, drivers: driverCorr })
  }

  return {
    available: true,
    model: { population: n, ratedPopulation: ratedPopulation || n, chainAvg, detractorAvg: mean(lows.map((r) => r.rating)), happyAvg: mean(highs.map((r) => r.rating)), lowRate, lowCount: lows.length, bestLowRate, worstLowRate, medianLowRate, targetLowRate, projectedLowRate },
    drivers, brandLevers, outcomeSignals, actionableThemes, exemplars,
    outletSummaries, outletLevers, outletStrengths, themeFocus, themeExemplars,
    themeTargets, outletWhatIf, allLowRates, allRatings, themeTrends, trendBasis, recommendedActions,
    outcomeCorrelations,
  }
}
