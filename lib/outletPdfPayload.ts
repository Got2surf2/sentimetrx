// lib/outletPdfPayload.ts
//
// The contract between the Outlet Deep-Dive PAGE and its PDF.
//
// The page (app/analyze/[datasetId]/outlet-report/page.tsx) already computes
// every number the document needs and ships it to the browser. So the export
// route stopped recomputing it — a full `dataset_rows_flat` scan plus, on a cold
// cache, a second Sonnet call, which is how one download measured 52s of
// application time — and now just typesets what the page POSTs back.
//
// That trade is deliberate: the figures become client-ASSERTED rather than
// server-derived. It is safe because the document is rendered for, and returned
// only to, the authenticated requester; it is never stored, shared, or served to
// anyone else. A caller who posts nonsense gets their own nonsense PDF.
//
// What is NOT safe to assume is that the body is well-formed. `parseOutletPdfPayload`
// coerces every field, because the builder interpolates numbers into UNQUOTED
// CSS (`style="width:${w}%"`, `left:calc(50% + ${arm}% + 5px)`) — server-computed
// numbers were safe there and POSTed ones are not.
//
// Deliberately NOT validated: cross-field arithmetic (distribution summing to 1,
// rank ≤ outletCount, problemRate vs peerPercentile). Re-deriving those would be
// a second implementation of computeOutletReport — exactly what this deletes.

import type {
  OutletSelected, OutletSnapshot, RatingBucket, ThemeTableRow, ReadVerdict,
  PraiseVerbatim, ThemeDelta, ComparisonBlock, TrendPoint,
} from '@/lib/outletReport'
import type { ActionPlan, PlanPriority, PlanVerbatim } from '@/lib/outletActionPlan'
import type { ThemeStanding, Exemplar, OutletSummary, PredictorModel, WhatIfView, ThemeTrend } from '@/lib/outletPredictor'

export type OutletPdfPayload = {
  outlet: string              // place_id — must equal selected.placeId
  brand: string
  networkSize: number         // report.outlets.length
  outletCount: number         // predictor.outletSummaries.length
  selected: OutletSelected    // snapshot, dimensions, trend, narrative, lowQuotes
  plan: ActionPlan | null
  // "Deeper analysis" — every field nullable/emptyable, so a payload without
  // them still typesets the snapshot half of the document.
  levers: ThemeStanding[]
  strengths: ThemeStanding[]
  summary: OutletSummary | null
  model: PredictorModel | null
  brandDrivers: string[]   // ALL the chain's systemic drivers, not just the top one
  whatIf: WhatIfView | null
  unitLabel?: string
}

// Body size the route accepts before it will even JSON.parse. A real payload is
// tens of KB; the only thing an oversized one can buy is Chrome CPU.
export const MAX_PDF_BODY_CHARS = 2_000_000

// ─── coercion primitives ─────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Finite number or the default — NaN/Infinity/strings all collapse to `d`. */
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

const str = (v: unknown, max = 600, d = ''): string => (typeof v === 'string' ? v.slice(0, max) : d)

const strOrNull = (v: unknown, max = 600): string | null => (typeof v === 'string' ? v.slice(0, max) : null)

/** Map an array through an element parser. Malformed elements are DROPPED, not fatal. */
function arr<T>(v: unknown, f: (x: unknown) => T | null, cap: number): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const el of v.slice(0, cap)) {
    const parsed = f(el)
    if (parsed !== null) out.push(parsed)
  }
  return out
}

const numArr = (v: unknown, cap: number): number[] =>
  Array.isArray(v) ? v.slice(0, cap).map((x) => num(x)) : []

// ─── element parsers ─────────────────────────────────────────────────────────

const READS: ReadVerdict[] = ['FIX', 'WATCH', 'SOLID', 'STRENGTH']
const read = (v: unknown): ReadVerdict =>
  (typeof v === 'string' && (READS as string[]).includes(v) ? v : 'SOLID') as ReadVerdict

function bucket(v: unknown): RatingBucket | null {
  if (!isObj(v)) return null
  const n = isObj(v.net) ? v.net : {}
  return {
    star: num(v.star), count: num(v.count), pct: num(v.pct),
    net: { min: num(n.min), avg: num(n.avg), max: num(n.max) },
  }
}

function themeRow(v: unknown): ThemeTableRow | null {
  if (!isObj(v)) return null
  return {
    theme: str(v.theme, 120), mentions: num(v.mentions), avgStar: num(v.avgStar),
    pctNegative: num(v.pctNegative), read: read(v.read),
  }
}

function praise(v: unknown): PraiseVerbatim | null {
  if (!isObj(v)) return null
  return { theme: str(v.theme, 120), rating: num(v.rating), quote: str(v.quote) }
}

function delta(v: unknown): ThemeDelta | null {
  if (!isObj(v)) return null
  return {
    sub: str(v.sub, 120), axis: str(v.axis, 60), label: str(v.label, 120), category: str(v.category, 60),
    outletNet: num(v.outletNet), chainNet: num(v.chainNet), delta: num(v.delta), n: num(v.n),
    quote: strOrNull(v.quote),
  }
}

function block(v: unknown): ComparisonBlock {
  if (!isObj(v)) return { available: false, analyzedReviews: 0, strengths: [], weaknesses: [] }
  return {
    available: v.available === true,
    analyzedReviews: num(v.analyzedReviews),
    strengths: arr(v.strengths, delta, 40),
    weaknesses: arr(v.weaknesses, delta, 40),
  }
}

function trendPoint(v: unknown): TrendPoint | null {
  if (!isObj(v)) return null
  return {
    month: str(v.month, 12),
    outletAvg: typeof v.outletAvg === 'number' && Number.isFinite(v.outletAvg) ? v.outletAvg : null,
    networkAvg: num(v.networkAvg),
  }
}

function planVerbatim(v: unknown): PlanVerbatim | null {
  if (!isObj(v)) return null
  return { rating: num(v.rating), quote: str(v.quote) }
}

function priority(v: unknown): PlanPriority | null {
  if (!isObj(v)) return null
  return {
    tag: str(v.tag, 60), title: str(v.title, 200), theme: str(v.theme, 120),
    diagnosis: str(v.diagnosis, 900),
    verbatims: arr(v.verbatims, planVerbatim, 4),
    actions: arr(v.actions, (x) => (typeof x === 'string' ? x.slice(0, 400) : null), 8),
  }
}

function plan(v: unknown): ActionPlan | null {
  if (!isObj(v)) return null
  const priorities = arr(v.priorities, priority, 6)
  if (!priorities.length) return null
  return { priorities, keepDoing: str(v.keepDoing, 900), generatedAt: str(v.generatedAt, 40) }
}

function exemplar(v: unknown): Exemplar | null {
  if (!isObj(v)) return null
  return {
    placeId: str(v.placeId, 200), label: str(v.label, 200), lowRate: num(v.lowRate),
    rating: typeof v.rating === 'number' && Number.isFinite(v.rating) ? v.rating : null,
  }
}

function standing(v: unknown): ThemeStanding | null {
  if (!isObj(v)) return null
  return {
    theme: str(v.theme, 120), problemRate: num(v.problemRate), peerPercentile: num(v.peerPercentile),
    shareInBad: num(v.shareInBad), cohortSize: num(v.cohortSize),
    exemplars: arr(v.exemplars, exemplar, 5),
    quote: strOrNull(v.quote),
    soloRecovery: num(v.soloRecovery),
  }
}

function summary(v: unknown): OutletSummary | null {
  if (!isObj(v)) return null
  return {
    placeId: str(v.placeId, 200), label: str(v.label, 200), reviews: num(v.reviews),
    rating: typeof v.rating === 'number' && Number.isFinite(v.rating) ? v.rating : null,
    lowRate: num(v.lowRate), lowCount: num(v.lowCount), gapToTarget: num(v.gapToTarget),
    lowRateRank: num(v.lowRateRank), ratingRank: num(v.ratingRank),
    topIssue: isObj(v.topIssue)
      ? { theme: str(v.topIssue.theme, 120), peerPercentile: num(v.topIssue.peerPercentile) }
      : null,
    weaknessCount: num(v.weaknessCount),
  }
}

function model(v: unknown): PredictorModel | null {
  if (!isObj(v)) return null
  return {
    population: num(v.population), ratedPopulation: num(v.ratedPopulation), chainAvg: num(v.chainAvg),
    detractorAvg: num(v.detractorAvg), happyAvg: num(v.happyAvg),
    lowRate: num(v.lowRate), lowCount: num(v.lowCount),
    bestLowRate: num(v.bestLowRate), worstLowRate: num(v.worstLowRate),
    medianLowRate: num(v.medianLowRate), targetLowRate: num(v.targetLowRate),
    projectedLowRate: num(v.projectedLowRate),
  }
}

function themeTrend(v: unknown): ThemeTrend | null {
  if (!isObj(v)) return null
  const d = v.direction
  return {
    direction: d === 'up' || d === 'down' ? d : 'flat',
    recentRate: num(v.recentRate), priorRate: num(v.priorRate),
  }
}

function whatIf(v: unknown): WhatIfView | null {
  if (!isObj(v)) return null
  const themes = arr(v.themes, (x) => (typeof x === 'string' ? x.slice(0, 120) : null), 40)
  if (!themes.length) return null
  const n = themes.length
  // Index-aligned rate vectors: pad/truncate to the theme count so a short one
  // can't leave `currentRate[i]` undefined and NaN the whole projection.
  const rates = (x: unknown): number[] => {
    const a = numArr(x, n)
    while (a.length < n) a.push(0)
    return a
  }
  const currentRate = rates(v.currentRate)
  return {
    themes,
    // Drop out-of-range theme indices for the same reason.
    reviews13: arr(v.reviews13, (r) => (Array.isArray(r) ? r.slice(0, 40).map((i) => num(i, -1)).filter((i) => Number.isInteger(i) && i >= 0 && i < n) : null), 20_000),
    currentRate,
    medianRate: rates(v.medianRate),
    bestRate: rates(v.bestRate),
    worstRate: rates(v.worstRate),
    totalReviews: num(v.totalReviews), ratedReviews: num(v.ratedReviews),
    lowCount: num(v.lowCount), lowRate: num(v.lowRate),
    avg: num(v.avg), detractorAvg: num(v.detractorAvg), happyAvg: num(v.happyAvg),
    otherRatings: numArr(v.otherRatings, 5_000),
    currentRank: num(v.currentRank), outletCount: num(v.outletCount),
    trends: Array.isArray(v.trends) ? v.trends.slice(0, n).map(themeTrend) : [],
    trendBasis: isObj(v.trendBasis)
      ? { recent: str(v.trendBasis.recent, 40), prior: str(v.trendBasis.prior, 40) }
      : null,
  }
}

function snapshot(v: unknown): OutletSnapshot {
  const o = isObj(v) ? v : {}
  return {
    asOf: str(o.asOf, 40), dateRange: str(o.dateRange, 80),
    distribution: arr(o.distribution, bucket, 10),
    fiveStarShare: num(o.fiveStarShare), detractorShare: num(o.detractorShare),
    ownerResponseRate: num(o.ownerResponseRate), ownerResponseBand: str(o.ownerResponseBand, 80),
    recent: isObj(o.recent)
      ? { count: num(o.recent.count), avg: num(o.recent.avg), direction: o.recent.direction === 'up' ? 'up' : o.recent.direction === 'down' ? 'down' : 'flat' }
      : null,
    fleet: isObj(o.fleet)
      ? { rank: num(o.fleet.rank), total: num(o.fleet.total), band: str(o.fleet.band, 80), peerNoun: str(o.fleet.peerNoun, 80) }
      : null,
    themeTable: arr(o.themeTable, themeRow, 40),
    praiseChips: arr(o.praiseChips, (x) => (typeof x === 'string' ? x.slice(0, 120) : null), 20),
    praiseVerbatims: arr(o.praiseVerbatims, praise, 20),
  }
}

// ─── the parser ──────────────────────────────────────────────────────────────

/**
 * Narrow an untrusted POST body to a renderable payload. Returns null ONLY when
 * the document has no subject — a caller with a well-formed `selected.placeId`
 * matching the requested outlet always gets a document, however sparse.
 */
export function parseOutletPdfPayload(body: unknown, outlet: string): OutletPdfPayload | null {
  if (!isObj(body)) return null
  if (typeof body.brand !== 'string') return null
  if (!isObj(body.selected)) return null
  const sel = body.selected
  if (typeof sel.placeId !== 'string' || !sel.placeId) return null
  if (sel.placeId !== outlet) return null

  const selected: OutletSelected = {
    placeId: sel.placeId.slice(0, 200),
    name: str(sel.name, 200), address: str(sel.address, 300), location: str(sel.location, 200),
    reviews: num(sel.reviews), rating: num(sel.rating), chainRating: num(sel.chainRating),
    ratingDelta: num(sel.ratingDelta), percentile: num(sel.percentile),
    rank: num(sel.rank), outletCount: num(sel.outletCount),
    narrative: str(sel.narrative, 2_000),
    trend: arr(sel.trend, trendPoint, 200),
    themes: block(sel.themes),
    dimensions: block(sel.dimensions),
    snapshot: snapshot(sel.snapshot),
    lowQuotes: arr(sel.lowQuotes, (q) => (isObj(q) ? { theme: str(q.theme, 120), quote: str(q.quote) } : null), 40),
  }

  return {
    outlet,
    brand: body.brand.slice(0, 200),
    networkSize: num(body.networkSize),
    outletCount: num(body.outletCount),
    selected,
    plan: plan(body.plan),
    levers: arr(body.levers, standing, 20),
    strengths: arr(body.strengths, standing, 20),
    summary: summary(body.summary),
    model: model(body.model),
    brandDrivers: arr(body.brandDrivers, (x) => (typeof x === 'string' ? x.slice(0, 120) : null), 12),
    whatIf: whatIf(body.whatIf),
    unitLabel: typeof body.unitLabel === 'string' ? body.unitLabel.slice(0, 40) : undefined,
  }
}

// ─── Leaderboard PDF payload (2026-09-02 — replaces "print to PDF") ──────────
// Same client-asserted-figures rationale as above: the page computed and
// rendered `lb`; the export posts it back and the route only typesets. The
// document returns to the requester alone.

export interface LeaderRowP { label: string; net: number; n: number; rating: number | null }
export interface LeaderItemP {
  label: string; category: string
  chainNet: number; chainN: number; qualifying: number
  ranked: LeaderRowP[]
}
export interface LeaderboardPdfPayload {
  brand: string
  outletCount: number
  k: number                    // outlets per side, as the page showed
  themes: LeaderItemP[]
  dimensions: LeaderItemP[]
}

function leaderRow(v: unknown): LeaderRowP | null {
  if (!isObj(v)) return null
  const label = str(v.label, 160)
  if (!label) return null
  return { label, net: num(v.net), n: num(v.n), rating: typeof v.rating === 'number' && Number.isFinite(v.rating) ? v.rating : null }
}

function leaderItem(v: unknown): LeaderItemP | null {
  if (!isObj(v)) return null
  const label = str(v.label, 120)
  if (!label) return null
  return {
    label, category: str(v.category, 60),
    chainNet: num(v.chainNet), chainN: num(v.chainN), qualifying: num(v.qualifying),
    ranked: arr(v.ranked, leaderRow, 40),
  }
}

export function parseLeaderboardPdfPayload(body: unknown): LeaderboardPdfPayload | null {
  if (!isObj(body)) return null
  if (typeof body.brand !== 'string') return null
  const themes = arr(body.themes, leaderItem, 60)
  const dimensions = arr(body.dimensions, leaderItem, 80)
  if (themes.length === 0 && dimensions.length === 0) return null
  return {
    brand: str(body.brand, 120, 'Brand'),
    outletCount: num(body.outletCount),
    k: Math.min(Math.max(Math.round(num(body.k, 3)), 1), 10),
    themes, dimensions,
  }
}

// ─── Hierarchy-rung PDF payload (Network / Region / District roll-up) ────────

export interface HierarchyChildP { key: string; outlets: number; reviews: number; rating: number | null }
export interface HierarchyOutletP { label: string; sublabel: string; reviews: number }
export interface HierarchyPdfPayload {
  brand: string
  name: string                 // node display name ("Network" at the root)
  levelLabel: string
  childLevelLabel: string | null
  crumbs: string[]             // path labels, root → this node
  reviews: number
  rating: number
  outletCount: number
  networkOutlets: number
  strayOutlets: number
  snapshot: OutletSnapshot
  children: HierarchyChildP[]
  outlets: HierarchyOutletP[]
}

function hierChild(v: unknown): HierarchyChildP | null {
  if (!isObj(v)) return null
  const key = str(v.key, 120)
  if (!key) return null
  return { key, outlets: num(v.outlets), reviews: num(v.reviews), rating: typeof v.rating === 'number' && Number.isFinite(v.rating) ? v.rating : null }
}

function hierOutlet(v: unknown): HierarchyOutletP | null {
  if (!isObj(v)) return null
  const label = str(v.label, 160)
  if (!label) return null
  return { label, sublabel: str(v.sublabel, 40), reviews: num(v.reviews) }
}

export function parseHierarchyPdfPayload(body: unknown): HierarchyPdfPayload | null {
  if (!isObj(body)) return null
  if (typeof body.brand !== 'string' || typeof body.name !== 'string') return null
  return {
    brand: str(body.brand, 120, 'Brand'),
    name: str(body.name, 160, 'Network'),
    levelLabel: str(body.levelLabel, 60, 'Network'),
    childLevelLabel: strOrNull(body.childLevelLabel, 60),
    crumbs: arr(body.crumbs, (x) => (typeof x === 'string' ? x.slice(0, 120) : null), 8),
    reviews: num(body.reviews),
    rating: num(body.rating),
    outletCount: num(body.outletCount),
    networkOutlets: num(body.networkOutlets),
    strayOutlets: num(body.strayOutlets),
    snapshot: snapshot(body.snapshot),
    children: arr(body.children, hierChild, 300),
    outlets: arr(body.outlets, hierOutlet, 1000),
  }
}
