// Theme-driven "biggest levers" predictor for a multi-location brand.
//
// Given each rated text-review's star rating and which THEMES it negatively
// mentions, fit a de-biased model of how much each theme drags the rating, then
// translate that into the highest-impact, peer-relative actions for each outlet
// and for the brand as a whole. Feeds the per-outlet report ("what to fix here,
// and who to learn from") and the brand executive summary ("why you need us").
//
// MODEL (v2, de-biased). Multivariate ridge regression of star rating on
// theme-negative dummies:
//     rating ≈ β0 + Σ_T β_T · 1[review negatively mentions T]
//     drag(T) = −β_T   (a negative mention lowers the rating, so β_T < 0)
// Ridge (L2, intercept unpenalized, λ by 5-fold CV) splits the credit when
// several complaints co-occur in one review — the naive univariate severity
// (mean-rating gap) double-counts that shared variance and overstates each
// theme. We keep ridge-LINEAR (not logistic) because the outcome is a continuous
// 1–5★ rating and the whole what-if is ★-denominated: β_T is already the ★-drag.
//
// Theme membership + whole-review polarity are computed upstream EXACTLY as in
// lib/outletReport.ts, so this engine and the Leaderboard agree on what a
// "negative <theme> mention" is. Whole-review polarity means co-firing themes
// within one bad review; ridge mitigates but cannot fully separate them, so
// treat output as a PRIORITIZATION signal, not a causal ★ guarantee.

// ─── inputs (plain data — no server/db deps, unit-testable) ───

// One rated text-review: its star rating and, per theme (by index into
// `themeLabels`), whether it negatively mentions that theme.
export type PredReview = { placeId: string; rating: number; neg: boolean[] }

// Outlet metadata for labels, volume floors and exemplar selection.
export type PredOutlet = { placeId: string; label: string; reviews: number; rating: number | null }

// A negative example quote for (outlet, theme), surfaced from upstream
// accumulators — "what to fix", in a guest's own words.
export type PredExample = { placeId: string; theme: string; quote: string }

export type PredictorInput = {
  themeLabels: string[]
  reviews: PredReview[]
  outlets: PredOutlet[]
  examples?: PredExample[]
  minOutletReviews?: number // outlet stability floor (default 30)
  minDriverN?: number       // theme needs this many chain-wide negs to be trusted (default 40)
  exemplarMinReviews?: number // a credible mentor needs this much volume (default 60)
}

// ─── outputs ───

export type ThemeDrag = {
  theme: string
  dragV1: number // naive univariate ★-drag (for transparency)
  dragV2: number // de-biased ridge ★-drag (the one we use)
  shrink: number // (dragV1 − dragV2) / dragV1 — how inflated v1 was by co-occurrence
  negN: number   // chain-wide negative mentions
  thin: boolean  // below minDriverN → drag not trusted for what-ifs
}

export type Exemplar = { placeId: string; label: string; negRate: number; rating: number | null }

export type OutletLever = {
  theme: string
  outletNegRate: number // this outlet's negative-mention rate on the theme
  peerMedian: number    // chain median negative-mention rate
  gap: number           // outletNegRate − peerMedian (reducible share)
  lift: number          // projected ★ gain if brought to peer median (gap × drag)
  drag: number          // de-biased ★-drag of the theme
  exemplar: Exemplar | null // peer to learn from (low neg-rate at real volume)
  quote: string | null  // a negative guest quote for this theme at this outlet
}

// One outlet's contribution to a brand lever (a worst-offender on that theme).
export type LeverOutlet = { placeId: string; label: string; negRate: number; lift: number }

export type BrandLever = {
  theme: string
  drag: number
  negN: number
  chainLift: number          // vol-weighted ★ the brand gains if EVERY outlet hits peer median
  peerMedian: number         // peer median negative-mention rate for the theme
  outletsAboveMedian: number // # outlets dragging this theme below the peer median
  topOutlets: LeverOutlet[]  // biggest contributors (where to focus), top 3
}

// One outlet's brand-plan row: headline numbers + its single biggest lever.
// Powers the "where to start" hot-list on the brand improvement plan.
export type OutletSummary = {
  placeId: string
  label: string
  reviews: number
  rating: number | null
  ratingDelta: number // vs the volume-weighted chain average
  topLever: { theme: string; lift: number } | null
  totalLift: number   // sum of this outlet's lever lifts (upper bound)
}

export type PredictorModel = {
  lambda: number
  r2: number
  intercept: number
  population: number // # rated text-reviews the model was fit on
  chainAvg: number   // vol-weighted chain star average (outlets above the floor)
}

export type OutletPredictor = {
  available: boolean
  model: PredictorModel
  themeDrag: ThemeDrag[]    // sorted by de-biased drag desc
  brandLevers: BrandLever[] // sorted by chainLift desc
  peerMedians: Record<string, number>
  exemplars: Record<string, Exemplar | null>
  // Per-outlet top levers, keyed by placeId (already sorted by lift desc).
  outletLevers: Record<string, OutletLever[]>
  outletSummaries: OutletSummary[] // brand-plan hot-list, worst rating first
}

// ─── tiny linear algebra (k ≈ themes+1, exact Gaussian elimination) ───

function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const pv = M[c][c] || 1e-9
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / pv
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-9))
}

// Ridge normal equations. X is n×k with col 0 = intercept (1s); intercept is
// left unpenalized. Returns β (length k).
function ridge(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0].length
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0))
  const Xty = new Array(k).fill(0)
  for (let i = 0; i < X.length; i++) {
    const xi = X[i], yi = y[i]
    for (let a = 0; a < k; a++) {
      Xty[a] += xi[a] * yi
      const xa = xi[a]
      for (let b = a; b < k; b++) {
        const v = xa * xi[b]
        XtX[a][b] += v
        if (b !== a) XtX[b][a] += v
      }
    }
  }
  for (let a = 1; a < k; a++) XtX[a][a] += lambda
  return solve(XtX, Xty)
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ─── the predictor ───

export function buildPredictor(input: PredictorInput): OutletPredictor {
  const minOutletReviews = input.minOutletReviews ?? 30
  const minDriverN = input.minDriverN ?? 40
  const exemplarMinReviews = input.exemplarMinReviews ?? 60
  const themes = input.themeLabels
  const K = themes.length
  const revs = input.reviews
  const n = revs.length

  const empty: OutletPredictor = {
    available: false,
    model: { lambda: 0, r2: 0, intercept: 0, population: n, chainAvg: 0 },
    themeDrag: [], brandLevers: [], peerMedians: {}, exemplars: {}, outletLevers: {}, outletSummaries: [],
  }
  if (!K || n < 50) return empty

  const overall = mean(revs.map((r) => r.rating))
  const negN = themes.map((_, j) => revs.filter((r) => r.neg[j]).length)

  // v1 univariate severity (kept for transparency / "shrink").
  const dragV1 = themes.map((_, j) => {
    const w = revs.filter((r) => r.neg[j]), wo = revs.filter((r) => !r.neg[j])
    return mean(wo.map((r) => r.rating)) - mean(w.map((r) => r.rating))
  })

  // v2 ridge: design matrix [intercept, theme-neg dummies].
  const X = revs.map((r) => [1, ...r.neg.map((b) => (b ? 1 : 0))])
  const y = revs.map((r) => r.rating)
  const grid = [0, 0.3, 1, 3, 10, 30, 100, 300]
  const cvRMSE = (lambda: number) => {
    let se = 0, cnt = 0
    for (let f = 0; f < 5; f++) {
      const Xtr: number[][] = [], ytr: number[] = []
      for (let i = 0; i < n; i++) if (i % 5 !== f) { Xtr.push(X[i]); ytr.push(y[i]) }
      const beta = ridge(Xtr, ytr, lambda)
      for (let i = 0; i < n; i++) if (i % 5 === f) {
        const yh = X[i].reduce((s, xv, k) => s + xv * beta[k], 0)
        se += (y[i] - yh) ** 2; cnt++
      }
    }
    return Math.sqrt(se / cnt)
  }
  const lambda = grid.map((l) => ({ l, r: cvRMSE(l) })).sort((a, b) => a.r - b.r)[0].l
  const beta = ridge(X, y, lambda)
  const dragV2 = themes.map((_, j) => -beta[j + 1])
  const yhat = X.map((xi) => xi.reduce((s, xv, k) => s + xv * beta[k], 0))
  const ssRes = y.reduce((s, yi, i) => s + (yi - yhat[i]) ** 2, 0)
  const ssTot = y.reduce((s, yi) => s + (yi - overall) ** 2, 0)
  const r2 = ssTot ? 1 - ssRes / ssTot : 0

  const themeDrag: ThemeDrag[] = themes.map((t, j) => ({
    theme: t,
    dragV1: dragV1[j],
    dragV2: dragV2[j],
    shrink: dragV1[j] ? (dragV1[j] - dragV2[j]) / dragV1[j] : 0,
    negN: negN[j],
    thin: negN[j] < minDriverN,
  })).sort((a, b) => b.dragV2 - a.dragV2)

  // Per-outlet aggregates (only outlets above the stability floor).
  const byOutlet = new Map<string, PredReview[]>()
  for (const r of revs) {
    const a = byOutlet.get(r.placeId) || []
    a.push(r); byOutlet.set(r.placeId, a)
  }
  const outletMeta = new Map(input.outlets.map((o) => [o.placeId, o]))
  type Agg = { placeId: string; reviews: number; avg: number; negRate: number[] }
  const aggs: Agg[] = []
  for (const [pid, rs] of byOutlet) {
    if (rs.length < minOutletReviews) continue
    aggs.push({
      placeId: pid, reviews: rs.length, avg: mean(rs.map((r) => r.rating)),
      negRate: themes.map((_, j) => rs.filter((r) => r.neg[j]).length / rs.length),
    })
  }
  const totalN = aggs.reduce((s, o) => s + o.reviews, 0) || 1
  const chainAvg = aggs.reduce((s, o) => s + o.avg * o.reviews, 0) / totalN

  // Peer median negative-rate per theme.
  const peerMed = themes.map((_, j) => median(aggs.map((o) => o.negRate[j])))
  // Only translate drag into ★ for themes with enough chain-wide negatives, and
  // floor at 0 (a "negative mention raising the rating" is noise, not a lever).
  const dragUse = themes.map((_, j) => (negN[j] >= minDriverN ? Math.max(0, dragV2[j]) : 0))

  // Exemplar per theme: the credible mentor = lowest negative-rate among outlets
  // with real volume (≥ exemplarMinReviews), tie-broken by higher star rating
  // then higher volume — so tiny outlets at a fluke 0% don't win.
  const exemplars: Record<string, Exemplar | null> = {}
  themes.forEach((t, j) => {
    const cand = aggs
      .filter((o) => o.reviews >= exemplarMinReviews)
      .map((o) => ({ o, m: outletMeta.get(o.placeId) }))
      .sort((a, b) =>
        a.o.negRate[j] - b.o.negRate[j] ||
        (b.o.avg - a.o.avg) ||
        (b.o.reviews - a.o.reviews))[0]
    exemplars[t] = cand
      ? { placeId: cand.o.placeId, label: cand.m?.label || cand.o.placeId, negRate: cand.o.negRate[j], rating: cand.o.avg }
      : null
  })

  // Brand levers: vol-weighted chain ★ gained if every outlet hits peer median,
  // plus how many outlets drag it and the biggest offenders (where to focus).
  const brandLevers: BrandLever[] = themes.map((t, j) => {
    let lift = 0
    for (const o of aggs) lift += Math.max(0, o.negRate[j] - peerMed[j]) * dragUse[j] * o.reviews
    const contributors: LeverOutlet[] = aggs
      .map((o) => ({ placeId: o.placeId, label: outletMeta.get(o.placeId)?.label || o.placeId, negRate: o.negRate[j], lift: Math.max(0, o.negRate[j] - peerMed[j]) * dragUse[j] }))
      .filter((c) => c.lift > 0)
      .sort((a, b) => b.lift - a.lift)
    return {
      theme: t, drag: dragV2[j], negN: negN[j], chainLift: lift / totalN,
      peerMedian: peerMed[j], outletsAboveMedian: contributors.length, topOutlets: contributors.slice(0, 3),
    }
  }).filter((d) => dragUse[themes.indexOf(d.theme)] > 0)
    .sort((a, b) => b.chainLift - a.chainLift)

  // Per-outlet levers (top reducible themes), with exemplar + example quote.
  const quoteFor = new Map<string, string>()
  for (const e of input.examples || []) quoteFor.set(`${e.placeId}|${e.theme}`, e.quote)
  const peerMediansObj: Record<string, number> = {}
  themes.forEach((t, j) => { peerMediansObj[t] = peerMed[j] })

  const outletLevers: Record<string, OutletLever[]> = {}
  for (const o of aggs) {
    const levers = themes.map((t, j) => {
      const gap = Math.max(0, o.negRate[j] - peerMed[j])
      return {
        theme: t,
        outletNegRate: o.negRate[j],
        peerMedian: peerMed[j],
        gap,
        lift: gap * dragUse[j],
        drag: dragV2[j],
        exemplar: exemplars[t],
        quote: quoteFor.get(`${o.placeId}|${t}`) || null,
      } as OutletLever
    }).filter((l) => l.lift > 0).sort((a, b) => b.lift - a.lift)
    outletLevers[o.placeId] = levers
  }

  // Brand-plan hot-list: every outlet with its headline numbers + biggest lever,
  // worst rating first (where guest experience needs the most help).
  const outletSummaries: OutletSummary[] = aggs.map((o) => {
    const levers = outletLevers[o.placeId] || []
    return {
      placeId: o.placeId,
      label: outletMeta.get(o.placeId)?.label || o.placeId,
      reviews: o.reviews,
      rating: o.avg,
      ratingDelta: o.avg - chainAvg,
      topLever: levers[0] ? { theme: levers[0].theme, lift: levers[0].lift } : null,
      totalLift: levers.reduce((s, l) => s + l.lift, 0),
    }
  }).sort((a, b) => (a.rating ?? 99) - (b.rating ?? 99))

  return {
    available: true,
    model: { lambda, r2, intercept: beta[0], population: n, chainAvg },
    themeDrag, brandLevers, peerMedians: peerMediansObj, exemplars, outletLevers, outletSummaries,
  }
}
