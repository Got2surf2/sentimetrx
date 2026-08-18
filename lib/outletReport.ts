import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verbatimSupports, pickSupportingSentence, type VerbatimPremise } from '@/lib/verbatimGuard'
import { logError } from '@/lib/log'
import { lexiconScore } from '@/lib/themeUtils'
import { buildPredictor, type OutletPredictor, type PredReview, type PredExample } from '@/lib/outletPredictor'
import {
  hierarchyLevels, buildHierarchy, findNode, breadcrumb, nodesAtDepth, pathOf, pluralLevel, UNASSIGNED,
  type HierarchyLevel,
} from '@/lib/hierarchy'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'

// Per-outlet "vs peers" summary report.
//
// For a multi-location brand (one dataset, many outlets), compare a single
// outlet to the rest of its outlets ("peers") on:
//   1. Headline star rating — per-outlet avg vs chain avg + percentile rank.
//   2. THEMES — the dataset's theme model (TextMine). For each theme, match the
//      outlet's reviews by keyword, score sentiment per matched review, and
//      compare the outlet's net-positive rate to the chain's.
//   3. DIMENSIONS — the fixed 7-axis restaurant taxonomy. For each taxonomy sub
//      (e.g. attribute:speed), the outlet's net-positive rate vs the chain's,
//      from the per-field taxonomy assertions ({ axis, sub, polarity, evidence }).
// Both comparisons surface where the outlet EXCELS (beats peers) and NEEDS WORK.
//
// Outlets are keyed by Google place_id (several share the same name + city, so
// the human name alone is ambiguous). Taxonomy assertions ride on each flat
// row's embedded data._tx blocks (sql/151) — no join needed.

const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const

// Stability floors: ignore thin samples that would produce noisy deltas.
const MIN_N_OUTLET = 6    // matched reviews/assertions for this item at this outlet
const MIN_N_CHAIN = 20    // across all outlets
const MIN_POLAR_SHARE = 0.3  // item must carry real opinion, not pure mentions
const DELTA_THRESHOLD = 0.08 // min gap vs peers to count as a strength/weakness

// Fleet position (snapshot KPI) ranks an outlet against only the higher-volume
// stores, so a tiny-sample location can't claim a flattering rank — matches the
// PDF's "#12 of 20 stores ≥200 reviews".
const FLEET_MIN = 200
// What the outlet-level fleet rank is measured against (shown on the KPI tile).
const FLEET_PEER_NOUN = `stores ≥${FLEET_MIN} reviews`
// A theme must clear this many of THIS outlet's mentions to appear in the
// absolute theme table (the "mentions" column shows n, so thin rows stay honest).
const MIN_THEME_MENTIONS = 10

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// "2024-10-17 …" / "2024-10" → "Oct 2024".
function fmtMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso || '')
  return m ? `${MONTHS[Number(m[2])] || m[2]} ${m[1]}` : ''
}

const READ_ORDER: Record<ReadVerdict, number> = { FIX: 0, WATCH: 1, SOLID: 2, STRENGTH: 3 }

// Absolute per-theme verdict from the outlet's own avg★ + %negative on that
// theme. Thresholds are calibrated to reproduce the Bareburger snapshot PDF
// (FIX < 4.0★ or ≥35% neg; WATCH < 4.35★ or ≥18% neg; STRENGTH ≥ 4.53★ & ≤12%
// neg; else SOLID). Absolute, not peer-relative — this is the GM-facing "how
// does this theme actually score" read.
function themeRead(avgStar: number, pctNegative: number): ReadVerdict {
  if (avgStar < 4.0 || pctNegative >= 0.35) return 'FIX'
  if (avgStar < 4.35 || pctNegative >= 0.18) return 'WATCH'
  if (avgStar >= 4.53 && pctNegative <= 0.12) return 'STRENGTH'
  return 'SOLID'
}

// Qualitative fleet band from an outlet's rank among the ≥200-review stores
// (rank 1 = best). "#12 of 20" → frac 0.58 → "Lower-mid" (matches the PDF).
function fleetBand(rank: number, total: number): string {
  if (total <= 1) return 'Sole high-volume store'
  const frac = (rank - 1) / (total - 1)
  if (frac < 0.2) return 'Top tier'
  if (frac < 0.4) return 'Upper-mid'
  if (frac < 0.55) return 'Mid'
  if (frac < 0.8) return 'Lower-mid'
  return 'Bottom tier'
}

// Plain-English band for the owner-response KPI.
function ownerResponseBand(rate: number): string {
  if (rate >= 0.8) return 'Strong — keep it up'
  if (rate >= 0.5) return 'Good — keep replying'
  if (rate >= 0.2) return 'Inconsistent — reply more'
  return 'Low — start replying'
}

export type OutletOption = { placeId: string; label: string; sublabel: string; reviews: number }

export type ThemeDelta = {
  sub: string
  axis: string
  label: string
  category: string
  outletNet: number   // (pos - neg) / total for this outlet
  chainNet: number
  delta: number       // outletNet - chainNet
  n: number           // matched reviews/assertions for this item at this outlet
  quote: string | null
}

// One comparison axis (themes or dimensions).
export type ComparisonBlock = {
  available: boolean       // is the underlying data present at all?
  analyzedReviews: number  // # of THIS outlet's reviews that matched ≥1 item
  strengths: ThemeDelta[]
  weaknesses: ThemeDelta[]
}

// Monthly avg-rating point: this outlet vs the whole network.
export type TrendPoint = { month: string; outletAvg: number | null; networkAvg: number }

// ─── Absolute snapshot types (GM-facing "Location Performance Snapshot") ──────

export type ReadVerdict = 'FIX' | 'WATCH' | 'SOLID' | 'STRENGTH'

// One row of the "what guests talk about — and how it scores" table. Absolute
// per-theme figures for THIS outlet (not peer-relative).
export type ThemeTableRow = {
  theme: string
  mentions: number      // this outlet's reviews mentioning the theme
  avgStar: number       // avg rating of those mentions
  pctNegative: number   // share of mentions rated ≤3★
  read: ReadVerdict
}

// One-star bucket of the outlet's rating distribution. `net` = how the rest of
// the network scores this star bucket (min / avg / max of each outlet's share),
// drawn as markers so the GM sees this location vs the system on every bar.
export type RatingBucket = { star: number; count: number; pct: number; net: { min: number; avg: number; max: number } }

// A real 4–5★ verbatim used in "what guests consistently praise".
export type PraiseVerbatim = { theme: string; rating: number; quote: string }

// Fleet position among the higher-volume stores only.
// `peerNoun` names what the rank is against, so the tile reads truthfully at
// every rung ("stores ≥200 reviews" for an outlet, "regions" for a region).
export type FleetPosition = { rank: number; total: number; band: string; peerNoun: string }

// Rolling recent-window rating vs the outlet's all-time average.
export type RecentTrend = { count: number; avg: number; direction: 'up' | 'down' | 'flat' }

// The absolute snapshot block for the selected outlet — everything the PDF's
// page-1 "Location Performance Snapshot" renders.
export type OutletSnapshot = {
  asOf: string                 // report month, e.g. "May 2026" (latest review month)
  dateRange: string            // "Apr 2021 – May 2026" (this outlet's review span)
  distribution: RatingBucket[] // 5★ → 1★
  fiveStarShare: number        // c5 / rated
  detractorShare: number       // (c1 + c2) / rated  (≤2★)
  ownerResponseRate: number    // reviews with a non-empty owner reply / reviews
  ownerResponseBand: string
  recent: RecentTrend | null   // recent-window avg + direction vs all-time
  fleet: FleetPosition | null  // rank among ≥200-review stores
  themeTable: ThemeTableRow[]  // worst READ first
  praiseChips: string[]        // top SOLID/STRENGTH theme labels (deterministic)
  praiseVerbatims: PraiseVerbatim[]
}

export type OutletReport = {
  brand: string
  outlets: OutletOption[]
  selected: {
    placeId: string
    name: string         // LOCATION name (city, state) — NOT the brand (which is `brand`)
    address: string
    location: string
    reviews: number
    rating: number
    chainRating: number
    ratingDelta: number
    percentile: number   // 0-100, share of outlets this one beats on rating
    rank: number         // 1 = best (among all rated outlets)
    outletCount: number
    narrative: string
    trend: TrendPoint[]
    themes: ComparisonBlock
    dimensions: ComparisonBlock
    snapshot: OutletSnapshot   // absolute GM-facing snapshot (PDF page 1)
    lowQuotes: { theme: string; quote: string }[] // one real 1–3★ verbatim per theme (action-plan evidence)
  } | null
}

// The selected outlet, non-null. `OutletReport['selected']` is inlined in
// several places (the PDF builder, the Deeper-analysis tabs); naming it once
// keeps those in step — notably the POSTed PDF payload, whose whole point is
// that the page and the document agree on the shape.
export type OutletSelected = NonNullable<OutletReport['selected']>

// ─── Cross-outlet leaderboard types ──────────────────────────────────────────

// One outlet's standing on a single theme/dimension item.
export type LeaderRow = {
  placeId: string
  label: string
  net: number           // (pos - neg) / total for this item at this outlet
  n: number             // matched reviews/assertions for this item at this outlet
  rating: number | null // outlet's avg star rating (for context)
}

// One theme or dimension item, with outlets ranked by net-positive rate.
export type LeaderItem = {
  key: string
  axis: string
  label: string
  category: string
  chainNet: number     // net-positive rate across the whole chain (baseline)
  chainN: number       // total matched reviews/assertions chain-wide
  qualifying: number   // # outlets that cleared the stability floor for this item
  truncated: boolean   // true when only the top-10 + bottom-10 are carried
  ranked: LeaderRow[]  // sorted desc by net; full list unless truncated
}

export type OutletLeaderboard = {
  outletCount: number
  defaultK: number     // outlets to show per side by default (slider start)
  maxK: number         // slider ceiling
  themes: LeaderItem[]
  dimensions: LeaderItem[]
}

type Example = { full: string; ev: string }
type Acc = { pos: number; neg: number; total: number; exPos: Example | null; exNeg: Example | null }
const newAcc = (): Acc => ({ pos: 0, neg: 0, total: 0, exPos: null, exNeg: null })
const net = (a: Acc) => (a.total ? (a.pos - a.neg) / a.total : 0)

// Taxonomy verdicts ride on each flat row's embedded data._tx block (sql/151):
// one entry per classified field, each carrying axis/sub/polarity/evidence.
type TaxAssertion = { axis: string; sub: string; polarity?: string; evidence?: string }

// A dataset flat row: the numeric id plus the review JSON blob we read fields off.
type RowData = {
  place_id?: string
  location_name?: string
  location?: string
  location_city?: string
  location_state?: string
  location_address?: string
  rating?: number | string | null
  review_text?: string
  review_date?: string
  owner_response?: string
  _tx?: { f?: Record<string, { as?: TaxAssertion[] }> }
}
type FlatRow = { id: number | string; data: RowData }

// One theme in the dataset's stored theme model (dataset_state.theme_model).
type ThemeModelEntry = { id?: string; name?: string; label?: string; keywords?: string[] }

// The taxonomy classifier is purely keyword-based, so the cleanliness keyword
// "dirty" false-fires on menu items ("dirty soda", "dirty cherry cola") and the
// idiom "dirty look(s)". Drop those from the Clean axis. (Proper fix is vocab-level.)
const DIRTY_NOISE = /dirty\s+(soda|cola|cherry|orange|martini|chai|lemonade|fries|drink|water|horchata)|dirty\s+looks?/i
function isNoiseAssertion(a: TaxAssertion): boolean {
  return a?.sub === 'clean' && a?.polarity === 'neg' && DIRTY_NOISE.test(a?.evidence || '')
}

const CATEGORY: Record<string, string> = {
  touchpoint: 'Service', attribute: 'Experience', product: 'Food',
  beverage: 'Drinks', ambiance: 'Atmosphere', context: 'Context', outcome: 'Loyalty',
}

function humanize(sub: string): string {
  const s = sub.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Generic words that don't help identify WHICH location.
const GENERIC_NAME_WORDS = new Set(['restaurant', 'restaurants', 'grill', 'grille', 'cafe', 'bar', 'kitchen', 'the', 'llc', 'inc', 'co', 'company', 'and', 'bistro', 'eatery', 'house', 'reviews', 'review'])

// Display name for an outlet's h1. Prefer location_name when it carries
// location-specific words beyond the brand (e.g. "… Lake Nona") — that's the
// clearest "which location" signal. Fall back to "City, State" only when
// location_name is just the brand (e.g. "Rubio's Coastal Grill"), which would
// otherwise dupe the brand eyebrow.
function resolveLocationName(rawName: string, city: string, state: string, brandTokens: Set<string>): string {
  const cityState = [city, state].filter(Boolean).join(', ')
  const ln = (rawName || '').trim()
  if (ln) {
    const extra = ln.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !brandTokens.has(w) && !GENERIC_NAME_WORDS.has(w))
    if (extra.length > 0) return ln
  }
  return cityState || ln || 'Outlet'
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// A theme matches a review if any of its keywords appears as a whole word.
function themeMatcher(keywords: string[]): RegExp | null {
  const kws = (keywords || []).map((k) => String(k || '').trim()).filter(Boolean).map(escapeRe)
  if (!kws.length) return null
  return new RegExp('\\b(' + kws.join('|') + ')\\b', 'i')
}

// The classifier's `evidence` is a fixed-width window that starts/ends
// mid-word. Recover a readable full sentence: locate the evidence inside the
// original review and expand out to sentence boundaries. (Themes pass the whole
// review as evidence, so this just clamps to the first sentence.)
/**
 * The sentence around the evidence phrase in a real review.
 *
 * `requireEvidence` controls the fallback. When the phrase can't be located in
 * the review text the default is to return the review's FIRST sentence, which is
 * fine for "here is a 1–3★ verbatim" surfaces but WRONG where the quote is
 * presented as the evidence for a specific polarity: a negative dimension can
 * end up quoting a cheerful opening line ("Forgot how delicious the food is…"
 * under a ▼ weakness — seen on Ruth's Chris, 2026-08-18). Pass true to get null
 * instead, so the caller renders no quote rather than a contradictory one.
 */
function extractSentence(ex: Example | null, requireEvidence = false): string | null {
  if (!ex) return null
  const full = (ex.full || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const ev = (ex.ev || '').replace(/\s+/g, ' ').trim()
  if (!full) return ev || null
  const core = ev.length > 12 ? ev.slice(3, -3) : ev
  let i = full.toLowerCase().indexOf(core.toLowerCase())
  if (i < 0) i = full.toLowerCase().indexOf(ev.toLowerCase())
  if (i < 0) {
    if (requireEvidence) return null
    const first = full.split(/(?<=[.!?])\s/)[0] || full
    return clamp(first)
  }
  const end = i + core.length
  let start = 0
  for (let p = i - 1; p > 0; p--) {
    if (/[.!?]/.test(full[p]) && /\s/.test(full[p + 1] || ' ')) { start = p + 2; break }
  }
  let stop = full.length
  for (let p = end; p < full.length; p++) {
    if (/[.!?]/.test(full[p])) { stop = p + 1; break }
  }
  const out = clamp(full.slice(start, stop).trim())
  // Locating the phrase is not enough: `clamp` cuts at 180 chars, so a long
  // run-on sentence can be truncated BEFORE the evidence and still be returned
  // — which is how a ▼ weakness ended up quoting "Forgot how delicious the food
  // is". Under requireEvidence the quote must actually contain what it evidences.
  if (requireEvidence && !out.toLowerCase().includes(core.toLowerCase())) return null
  return out
}

/**
 * A quote for a surface whose premise is a POLARITY.
 *
 * Prefer the sentence around the classifier's evidence — it is the topically
 * relevant one — but only if it actually carries the premise. Otherwise take the
 * strongest-carrying sentence in the review, and if the review has none, return
 * null so the caller shows one fewer quote rather than one that argues the
 * opposite. See lib/verbatimGuard for why a rating check is not enough.
 */
function premiseQuote(full: string, ev: string, premise: VerbatimPremise): string | null {
  const evidenceSentence = extractSentence({ full, ev })
  if (verbatimSupports(evidenceSentence, premise)) return evidenceSentence
  return pickSupportingSentence(full, premise)
}

function clamp(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim()
  // Drop leading punctuation left behind by the sentence-boundary walk — a tile
  // reading ", at the 39640 LBJ Freeway Location was very rude" looks broken on
  // a client deck even when the quote itself is right.
  out = out.replace(/^[\s,;:.!?)\]}"'\u2019\u201d\-–—]+/, '')
  if (out.length > 180) out = out.slice(0, 180).replace(/\s\S*$/, '') + '…'
  return out.charAt(0).toUpperCase() + out.slice(1)
}

async function pageAll<T = unknown>(table: string, cols: string, datasetId: string): Promise<T[]> {
  const sb = createServiceRoleClient()
  const out: T[] = []
  const size = 1000
  let from = 0

  while (true) {
    const { data, error } = await sb.from(table).select(cols).eq('dataset_id', datasetId).range(from, from + size - 1)
    if (error) throw error
    out.push(...((data as T[] | null) || []))
    if (!data || data.length < size) break
    from += size
  }
  return out
}

// Build strengths/weaknesses from a per-outlet + chain map of net-positive Accs.
function buildDeltas(
  outletSubs: Map<string, Acc>, chain: Map<string, Acc>,
  labelOf: (key: string) => { axis: string; sub: string; label: string; category: string },
): { strengths: ThemeDelta[]; weaknesses: ThemeDelta[] } {
  const deltas = [...outletSubs.entries()]
    .filter(([key, o]) => {
      const c = chain.get(key)
      if (!c) return false
      if (o.total < MIN_N_OUTLET || c.total < MIN_N_CHAIN) return false
      if ((c.pos + c.neg) / c.total < MIN_POLAR_SHARE) return false
      return true
    })
    .map(([key, o]) => {
      const meta = labelOf(key)
      const oNet = net(o)
      const cNet = net(chain.get(key)!)
      return {
        ...meta, outletNet: oNet, chainNet: cNet, delta: oNet - cNet, n: o.total,
        quote: null as string | null, _exPos: o.exPos, _exNeg: o.exNeg,
      } as ThemeDelta & { _exPos: Example | null; _exNeg: Example | null }
    })
  const strengths = deltas
    .filter((d) => d.delta >= DELTA_THRESHOLD && d.outletNet > 0)
    .sort((a, b) => b.delta - a.delta).slice(0, 4)
    .map((d) => ({ ...d, quote: premiseQuote(d._exPos?.full || '', d._exPos?.ev || '', 'positive') }))
    .map(({ _exPos, _exNeg, ...s }) => s)
  const weaknesses = deltas
    .filter((d) => d.delta <= -DELTA_THRESHOLD)
    .sort((a, b) => a.delta - b.delta).slice(0, 4)
    .map((d) => ({ ...d, quote: premiseQuote(d._exNeg?.full || '', d._exNeg?.ev || '', 'negative') }))
    .map(({ _exPos, _exNeg, ...w }) => w)
  // A review matching several themes can be captured as the example for each, so
  // the same verbatim would surface under multiple cards. Keep each quote on its
  // first (strongest-delta) card only; later repeats render without a quote.
  const seenQuote = new Set<string>()
  for (const d of [...weaknesses, ...strengths]) {
    if (!d.quote) continue
    const k = d.quote.trim().toLowerCase()
    if (seenQuote.has(k)) d.quote = null
    else seenQuote.add(k)
  }
  return { strengths, weaknesses }
}

// Plain-English summary of how the outlet compares to the network. Deterministic
// (no AI) — built from the computed rank/rating + top theme/dimension deltas.
function buildNarrative(opts: {
  name: string; rank: number; outletCount: number; percentile: number
  ratingDelta: number; chainRating: number
  themes: ComparisonBlock; dimensions: ComparisonBlock
}): string {
  const { name, rank, outletCount, percentile, ratingDelta, chainRating } = opts
  const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
  const sentences: string[] = []
  sentences.push(
    `${name} ranks #${rank} of ${outletCount} outlets on star rating (${ord(percentile)} percentile), ` +
    `${ratingDelta >= 0 ? '+' : ''}${ratingDelta.toFixed(2)}★ ${ratingDelta >= 0 ? 'above' : 'below'} the network average of ${chainRating.toFixed(2)}.`,
  )
  const ups = [...opts.themes.strengths, ...opts.dimensions.strengths].sort((a, b) => b.delta - a.delta).slice(0, 3).map((d) => d.label.toLowerCase())
  const downs = [...opts.themes.weaknesses, ...opts.dimensions.weaknesses].sort((a, b) => a.delta - b.delta).slice(0, 3).map((d) => d.label.toLowerCase())
  const list = (xs: string[]) => xs.length === 1 ? xs[0] : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
  if (ups.length && downs.length) sentences.push(`It stands out from its peers on ${list(ups)}, but trails them on ${list(downs)}.`)
  else if (ups.length) sentences.push(`It stands out from its peers on ${list(ups)}; nothing trails the network materially.`)
  else if (downs.length) sentences.push(`It trails its peers on ${list(downs)}; nothing stands out above the network.`)
  else sentences.push('On measured themes and dimensions it performs in line with the rest of the network.')
  return sentences.join(' ')
}

// Per-theme ABSOLUTE stats for one outlet (drives the snapshot theme table):
// mentions + avg★ + %≤3★, keyed by rating — distinct from themeSubs, which is
// net-positive lexicon sentiment for the peer-relative deltas.
type ThemeAbs = { mentions: number; ratingSum: number; ratingN: number; low: number }

type Outlet = {
  placeId: string; name: string; city: string; state: string; address: string
  reviews: number; ratingSum: number; ratingN: number
  dimClassified: number; themeMatched: number
  dimSubs: Map<string, Acc>; themeSubs: Map<string, Acc>
  ratingCounts: number[]        // [1★,2★,3★,4★,5★] counts
  ownerResponded: number        // reviews carrying a non-empty owner reply
  minDate: string; maxDate: string // this outlet's review-date span (YYYY-MM-DD)
  themeAbs: Map<string, ThemeAbs>
}

type Scan = {
  brand: string
  brandTokens: Set<string>
  outlets: Outlet[]
  outletsById: Map<string, Outlet>
  themeChain: Map<string, Acc>
  dimChain: Map<string, Acc>
  themeAvailable: boolean
  dimAvailable: boolean
  flat: FlatRow[]
  labelFor: (o: Outlet) => string
  themeLabels: string[]       // ordered theme labels (matchers) for the predictor
  reviewMatrix: PredReview[]  // per rated text-review: theme-membership vector
  lowExamples: PredExample[]  // one 1–3★ quote per (outlet, theme)
  highExamples: PredExample[] // one 4–5★ (praise) quote per (outlet, theme)
}

// One pass over a dataset's flat rows + taxonomy assertions, building the
// per-outlet and chain-level net-positive accumulators that BOTH the per-outlet
// report and the cross-outlet leaderboard read from (one scan, two views).
async function scanDataset(datasetId: string): Promise<Scan> {
  const sb = createServiceRoleClient()
  const { data: ds, error: dsErr } = await sb.from('datasets').select('name').eq('id', datasetId).maybeSingle()
  if (dsErr) void logError('outletReport.scanDataset', dsErr)
  const brand: string = ds?.name || 'Brand'
  const brandTokens = new Set<string>(brand.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const { data: stateRow, error: stateErr } = await sb.from('dataset_state').select('theme_model').eq('dataset_id', datasetId).maybeSingle()
  if (stateErr) void logError('outletReport.scanDataset', stateErr)
  // Theme labels live in `name` ("Food Quality & Taste"); older payloads used
  // `label`. Reading the wrong field collapses every theme to "Theme".
  const themeModel: ThemeModelEntry[] = (stateRow?.theme_model?.themes as ThemeModelEntry[]) || []
  const themeMatchers = themeModel
    .map((t) => ({ label: t.name || t.label || 'Theme', re: themeMatcher(t.keywords || []) }))
    .filter((t): t is { label: string; re: RegExp } => !!t.re)

  const flat = await pageAll<FlatRow>('dataset_rows_flat', 'id, data', datasetId)
  const byId = new Map<number, RowData>()
  for (const r of flat) byId.set(Number(r.id), r.data)

  // Taxonomy verdicts ride on the flat rows themselves (data._tx, sql/151) —
  // one entry per classified field; same (row, field) granularity the sidecar
  // table had.
  const tax: { row_id: number; assertions: TaxAssertion[] }[] = []
  for (const r of flat) {
    const fieldBlocks = (r.data as { _tx?: { f?: Record<string, { as?: TaxAssertion[] }> } })?._tx?.f
    if (!fieldBlocks) continue
    for (const block of Object.values(fieldBlocks)) {
      tax.push({ row_id: Number(r.id), assertions: block?.as ?? [] })
    }
  }

  const outlets = new Map<string, Outlet>()
  const getOutlet = (d: RowData): Outlet | null => {
    const placeId = d?.place_id
    if (!placeId) return null
    let o = outlets.get(placeId)
    if (!o) {
      o = {
        placeId,
        name: d.location_name || d.location || 'Outlet',
        city: d.location_city || '', state: d.location_state || '', address: d.location_address || '',
        reviews: 0, ratingSum: 0, ratingN: 0, dimClassified: 0, themeMatched: 0,
        dimSubs: new Map(), themeSubs: new Map(),
        ratingCounts: [0, 0, 0, 0, 0], ownerResponded: 0, minDate: '', maxDate: '',
        themeAbs: new Map(),
      }
      outlets.set(placeId, o)
    }
    return o
  }

  const dimChain = new Map<string, Acc>()
  const themeChain = new Map<string, Acc>()
  const themeLabels = themeMatchers.map((tm) => tm.label)
  const reviewMatrix: PredReview[] = []
  const lowExamples: PredExample[] = []
  const lowSeen = new Set<string>()
  const highExamples: PredExample[] = []
  const highSeen = new Set<string>()

  // Pass over flat rows: rating + review counts, AND theme matching/sentiment.
  for (const r of flat) {
    const d = r.data
    const o = getOutlet(d)
    if (!o) continue
    o.reviews++
    const rt = Number(d?.rating)
    if (rt) { o.ratingSum += rt; o.ratingN++ }
    const star = Math.round(rt)
    if (star >= 1 && star <= 5) o.ratingCounts[star - 1]++
    if ((d?.owner_response || '').trim()) o.ownerResponded++
    const day = String(d?.review_date || '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      if (!o.minDate || day < o.minDate) o.minDate = day
      if (!o.maxDate || day > o.maxDate) o.maxDate = day
    }

    if (themeMatchers.length) {
      const text = String(d?.review_text || '')
      if (text.trim()) {
        const { pos, neg } = lexiconScore(text)
        const polarity = pos > neg ? 'pos' : neg > pos ? 'neg' : 'neutral'
        const isLow = !!rt && rt <= 3
        const isHigh = !!rt && rt >= 4
        let matchedAny = false
        // Per-review theme-membership vector for the predictor (bare keyword
        // presence, same matchers as the leaderboard). The 1–3★ vs 4–5★ split
        // supplies the sentiment — the predictor measures over-representation of
        // each theme among low-rated reviews, not bare presence alone.
        const themeFlags = new Array(themeMatchers.length).fill(false)
        for (let ti = 0; ti < themeMatchers.length; ti++) {
          const tm = themeMatchers[ti]
          // exec (not test) so we know WHERE the theme keyword matched — the
          // quote is then the sentence CONTAINING that keyword (sentence-level
          // attribution), not just the review's first sentence, so a quote
          // filed under a theme is actually about that theme.
          const km = tm.re.exec(text)
          if (!km) continue
          matchedAny = true
          themeFlags[ti] = true
          // Absolute per-theme figures for the snapshot table (rating-keyed).
          const ta = o.themeAbs.get(tm.label) || (o.themeAbs.set(tm.label, { mentions: 0, ratingSum: 0, ratingN: 0, low: 0 }), o.themeAbs.get(tm.label)!)
          ta.mentions++
          if (rt) { ta.ratingSum += rt; ta.ratingN++; if (rt <= 3) ta.low++ }
          const ev = km[0]
          // Capture one representative quote per (outlet, theme) from a 1–3★
          // review — "what unhappy guests said", for the Action Plan.
          if (isLow) {
            const k = `${o.placeId}|${tm.label}`
            if (!lowSeen.has(k)) {
              // Premise: "what UNHAPPY guests said". A 1–3★ review whose first
              // sentence is "I got seated fast!" must not fill this slot.
              const q = premiseQuote(text, ev, 'negative')
              if (q) { lowSeen.add(k); lowExamples.push({ placeId: o.placeId, theme: tm.label, quote: q }) }
            }
          } else if (isHigh && polarity === 'pos') {
            // A 4–5★ review citing the theme = "what guests praise" — strength evidence.
            const k = `${o.placeId}|${tm.label}`
            if (!highSeen.has(k)) {
              // Premise: "what guests PRAISE".
              const q = premiseQuote(text, ev, 'positive')
              if (q) { highSeen.add(k); highExamples.push({ placeId: o.placeId, theme: tm.label, quote: q, rating: rt }) }
            }
          }
          const key = tm.label
          const cu = themeChain.get(key) || (themeChain.set(key, newAcc()), themeChain.get(key)!)
          const ou = o.themeSubs.get(key) || (o.themeSubs.set(key, newAcc()), o.themeSubs.get(key)!)
          cu.total++; ou.total++
          if (polarity === 'pos') { cu.pos++; ou.pos++; if (!ou.exPos) ou.exPos = { full: text, ev: text } }
          else if (polarity === 'neg') { cu.neg++; ou.neg++; if (!ou.exNeg) ou.exNeg = { full: text, ev: text } }
        }
        if (matchedAny) o.themeMatched++
        if (rt) reviewMatrix.push({ placeId: o.placeId, rating: rt, themes: themeFlags, month: String(d?.review_date || '').slice(0, 7) || undefined })
      }
    }
  }

  // Dimension sentiment from taxonomy assertions.
  for (const t of tax) {
    const d = byId.get(Number(t.row_id))
    if (!d) continue
    const o = getOutlet(d)
    if (!o) continue
    o.dimClassified++
    for (const a of (t.assertions || [])) {
      if (!(AXES as readonly string[]).includes(a.axis)) continue
      if (isNoiseAssertion(a)) continue
      const key = `${a.axis}:${a.sub}`
      const cu = dimChain.get(key) || (dimChain.set(key, newAcc()), dimChain.get(key)!)
      const ou = o.dimSubs.get(key) || (o.dimSubs.set(key, newAcc()), o.dimSubs.get(key)!)
      cu.total++; ou.total++
      if (a.polarity === 'pos') { cu.pos++; ou.pos++; if (!ou.exPos && a.evidence) ou.exPos = { full: d.review_text || '', ev: a.evidence } }
      else if (a.polarity === 'neg') { cu.neg++; ou.neg++; if (!ou.exNeg && a.evidence) ou.exNeg = { full: d.review_text || '', ev: a.evidence } }
    }
  }

  // Disambiguate display labels for same-name/same-city outlets.
  const nameCity = new Map<string, number>()
  for (const o of outlets.values()) {
    const k = `${o.name}|${o.city}`
    nameCity.set(k, (nameCity.get(k) || 0) + 1)
  }
  const labelFor = (o: Outlet) => {
    const base = o.city ? `${o.name} — ${o.city}, ${o.state}` : o.name
    const dupe = (nameCity.get(`${o.name}|${o.city}`) || 0) > 1
    return dupe && o.address ? `${base} (${o.address.split(',')[0]})` : base
  }

  return {
    brand, brandTokens,
    outlets: [...outlets.values()], outletsById: outlets,
    themeChain, dimChain,
    themeAvailable: themeMatchers.length > 0,
    dimAvailable: tax.length > 0,
    flat, labelFor,
    themeLabels, reviewMatrix, lowExamples, highExamples,
  }
}

// ─── Snapshot units ──────────────────────────────────────────────────────────
//
// The snapshot is computed over a UNIT: either a single outlet, or several
// outlets merged into one (a hierarchy node — a district, a region, the whole
// network). Every field here is additive, which is the reason the SAME snapshot
// can be rolled up a rung without inventing a per-level metric: a region's
// rating distribution is literally the sum of its stores' distributions.
//
// This is the subset of `Outlet` that computeSnapshot reads. Keeping it narrow
// means a merged unit can't be mistakenly fed to the peer-relative path, which
// needs per-outlet lexicon accumulators that do NOT merge meaningfully.
type SnapshotUnit = {
  placeIds: Set<string>   // the outlets this unit covers — one, or many
  reviews: number; ratingSum: number; ratingN: number
  ratingCounts: number[]
  ownerResponded: number
  minDate: string; maxDate: string
  themeAbs: Map<string, ThemeAbs>
}

function unitOf(o: Outlet): SnapshotUnit {
  return {
    placeIds: new Set([o.placeId]),
    reviews: o.reviews, ratingSum: o.ratingSum, ratingN: o.ratingN,
    ratingCounts: o.ratingCounts, ownerResponded: o.ownerResponded,
    minDate: o.minDate, maxDate: o.maxDate, themeAbs: o.themeAbs,
  }
}

// Merge outlets into one unit. Counts add; the date span is the union; theme
// figures add per theme, so a rolled-up theme row is the same ratio computed
// over more reviews — NOT an average of averages, which would weight a 40-review
// store the same as a 4,000-review one.
function mergeUnits(members: Outlet[]): SnapshotUnit {
  const u: SnapshotUnit = {
    placeIds: new Set(), reviews: 0, ratingSum: 0, ratingN: 0,
    ratingCounts: [0, 0, 0, 0, 0], ownerResponded: 0, minDate: '', maxDate: '',
    themeAbs: new Map(),
  }
  for (const o of members) {
    u.placeIds.add(o.placeId)
    u.reviews += o.reviews; u.ratingSum += o.ratingSum; u.ratingN += o.ratingN
    u.ownerResponded += o.ownerResponded
    for (let i = 0; i < 5; i++) u.ratingCounts[i] += o.ratingCounts[i]
    if (o.minDate && (!u.minDate || o.minDate < u.minDate)) u.minDate = o.minDate
    if (o.maxDate && (!u.maxDate || o.maxDate > u.maxDate)) u.maxDate = o.maxDate
    for (const [theme, a] of o.themeAbs) {
      const t = u.themeAbs.get(theme) || (u.themeAbs.set(theme, { mentions: 0, ratingSum: 0, ratingN: 0, low: 0 }), u.themeAbs.get(theme)!)
      t.mentions += a.mentions; t.ratingSum += a.ratingSum; t.ratingN += a.ratingN; t.low += a.low
    }
  }
  return u
}

const unitRating = (u: SnapshotUnit): number => (u.ratingN ? u.ratingSum / u.ratingN : 0)

// Recent-window rating vs all-time for a unit: the trailing 12 months of its
// reviews (falling back to its most-recent 30% when a year is too thin), with an
// up/down/flat arrow vs the unit's all-time average. One extra pass over the
// unit's flat rows — powers the snapshot's "last N: 4.79 ▲" chip.
function recentTrend(flat: FlatRow[], placeIds: Set<string>, allTimeAvg: number): RecentTrend | null {
  const dated: { d: string; r: number }[] = []
  for (const row of flat) {
    if (!row.data?.place_id || !placeIds.has(row.data.place_id)) continue
    const r = Number(row.data?.rating); if (!r) continue
    const d = String(row.data?.review_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    dated.push({ d, r })
  }
  if (dated.length < 30) return null
  dated.sort((a, b) => (a.d < b.d ? 1 : -1)) // newest first
  const YEAR_MS = 365 * 24 * 3600 * 1000
  const cutoff = Date.parse(dated[0].d) - YEAR_MS
  let recent = dated.filter((x) => Date.parse(x.d) >= cutoff)
  if (recent.length < 30) recent = dated.slice(0, Math.max(30, Math.round(dated.length * 0.3)))
  const avg = recent.reduce((s, x) => s + x.r, 0) / recent.length
  const direction: RecentTrend['direction'] = avg - allTimeAvg >= 0.05 ? 'up' : avg - allTimeAvg <= -0.05 ? 'down' : 'flat'
  return { count: recent.length, avg, direction }
}

// Build the absolute GM-facing snapshot (PDF page 1) for a unit — one outlet, or
// a rolled-up hierarchy node. `peers` are the units at the SAME rung (all stores
// network-wide for an outlet; all regions network-wide for a region), which is
// what makes the distribution markers and the rank mean the same thing at every
// level: "this one against the range of its own kind".
function computeSnapshot(
  target: SnapshotUnit, peers: SnapshotUnit[], outletRating: number,
  flat: FlatRow[], highExamples: PredExample[],
  // `rankable: false` when the target is not a member of the peer set — the
  // Network total is not one of its own stores, and ranking an aggregate among
  // its parts always lands near the weighted middle, so the position would be an
  // artifact of the arithmetic rather than a finding.
  peer: { noun: string; rankable: boolean },
): OutletSnapshot {
  const ratedN = target.ratingN || 1
  // Per-star network markers = min / avg / max of each peer's share of that
  // star bucket, over peers with a stable sample (≥30 rated; falls back to all
  // rated if too few qualify) so a tiny outlet at 0%/100% can't skew the range.
  const NET_MIN_N = 30
  const rated = peers.filter((o) => o.ratingN > 0)
  const statOutlets = (() => {
    const q = rated.filter((o) => o.ratingN >= NET_MIN_N)
    return q.length >= 2 ? q : rated
  })()
  const netStat = (i: number): { min: number; avg: number; max: number } => {
    const shares = statOutlets.map((o) => o.ratingCounts[i] / o.ratingN)
    if (!shares.length) return { min: 0, avg: 0, max: 0 }
    return { min: Math.min(...shares), avg: shares.reduce((a, b) => a + b, 0) / shares.length, max: Math.max(...shares) }
  }
  const distribution: RatingBucket[] = [5, 4, 3, 2, 1].map((s) => ({ star: s, count: target.ratingCounts[s - 1], pct: target.ratingCounts[s - 1] / ratedN, net: netStat(s - 1) }))
  const fiveStarShare = target.ratingCounts[4] / ratedN
  const detractorShare = (target.ratingCounts[0] + target.ratingCounts[1]) / ratedN
  const ownerRate = target.reviews ? target.ownerResponded / target.reviews : 0

  const fleetOutlets = rated.filter((o) => o.reviews >= FLEET_MIN)
  let fleet: FleetPosition | null = null
  if (peer.rankable && target.reviews >= FLEET_MIN && fleetOutlets.length >= 2) {
    const rank = fleetOutlets.filter((o) => o.ratingSum / o.ratingN > outletRating).length + 1
    fleet = { rank, total: fleetOutlets.length, band: fleetBand(rank, fleetOutlets.length), peerNoun: peer.noun }
  }

  const themeTable: ThemeTableRow[] = [...target.themeAbs.entries()]
    .filter(([, a]) => a.mentions >= MIN_THEME_MENTIONS && a.ratingN > 0)
    .map(([theme, a]) => {
      const avgStar = a.ratingSum / a.ratingN
      const pctNegative = a.low / a.ratingN
      return { theme, mentions: a.mentions, avgStar, pctNegative, read: themeRead(avgStar, pctNegative) }
    })
    .sort((a, b) => READ_ORDER[a.read] - READ_ORDER[b.read] || a.avgStar - b.avgStar)

  const goodThemes = themeTable.filter((t) => t.read === 'STRENGTH' || t.read === 'SOLID').sort((a, b) => b.avgStar - a.avgStar)
  const goodSet = new Set(goodThemes.map((t) => t.theme))
  const praiseChips = goodThemes.slice(0, 4).map((t) => t.theme)
  // Dedup by quote — a review citing several themes is captured once per theme,
  // so the same verbatim can surface under multiple themes; keep the first (its
  // best-verdict theme, since good-theme rows are sorted first).
  const seenQuote = new Set<string>()
  const praiseVerbatims: PraiseVerbatim[] = highExamples
    .filter((e) => target.placeIds.has(e.placeId) && e.quote)
    // Good-theme praise first, then the most enthusiastic (5★ over 4★) — a 4★ can
    // carry a mild gripe, so lead with the wholehearted quotes.
    .sort((a, b) => ((goodSet.has(b.theme) ? 1 : 0) - (goodSet.has(a.theme) ? 1 : 0)) || ((b.rating ?? 5) - (a.rating ?? 5)))
    .filter((e) => { const k = e.quote.trim().toLowerCase(); if (seenQuote.has(k)) return false; seenQuote.add(k); return true })
    .slice(0, 3)
    .map((e) => ({ theme: e.theme, rating: e.rating ?? 5, quote: e.quote }))

  return {
    asOf: fmtMonth(target.maxDate),
    dateRange: target.minDate && target.maxDate ? `${fmtMonth(target.minDate)} – ${fmtMonth(target.maxDate)}` : '',
    distribution, fiveStarShare, detractorShare,
    ownerResponseRate: ownerRate, ownerResponseBand: ownerResponseBand(ownerRate),
    recent: recentTrend(flat, target.placeIds, outletRating), fleet, themeTable, praiseChips, praiseVerbatims,
  }
}

// Per-outlet "vs peers" report — derived from a single scan.
function buildReport(scan: Scan, selectedPlaceId?: string): OutletReport {
  const { brand, brandTokens, themeChain, dimChain, flat, labelFor } = scan
  const all = scan.outlets
  const options: OutletOption[] = all
    .map((o) => ({ placeId: o.placeId, label: labelFor(o), sublabel: `${o.ratingN ? (o.ratingSum / o.ratingN).toFixed(1) : '—'}★`, reviews: o.reviews }))
    .sort((a, b) => b.reviews - a.reviews)

  const targetId = selectedPlaceId && scan.outletsById.has(selectedPlaceId) ? selectedPlaceId : options[0]?.placeId
  const target = targetId ? scan.outletsById.get(targetId)! : null

  let selected: OutletReport['selected'] = null
  if (target) {
    const rated = all.filter((o) => o.ratingN > 0)
    const chainRatingAll = rated.reduce((s, o) => s + o.ratingSum, 0) / Math.max(1, rated.reduce((s, o) => s + o.ratingN, 0))
    const outletRating = target.ratingN ? target.ratingSum / target.ratingN : 0
    const avgList = rated.map((o) => o.ratingSum / o.ratingN).sort((a, b) => a - b)
    const beats = avgList.filter((r) => r < outletRating).length
    const percentile = avgList.length > 1 ? Math.round((100 * beats) / (avgList.length - 1)) : 100
    const rank = rated.filter((o) => o.ratingSum / o.ratingN > outletRating).length + 1

    const themeDeltas = buildDeltas(target.themeSubs, themeChain, (key) => ({ axis: 'theme', sub: key, label: key, category: 'Theme' }))
    const dimDeltas = buildDeltas(target.dimSubs, dimChain, (key) => {
      const [axis, sub] = key.split(':')
      return { axis, sub, label: humanize(sub), category: CATEGORY[axis] || axis }
    })

    const themes: ComparisonBlock = { available: scan.themeAvailable, analyzedReviews: target.themeMatched, ...themeDeltas }
    const dimensions: ComparisonBlock = { available: scan.dimAvailable, analyzedReviews: target.dimClassified, ...dimDeltas }

    // Location name (h1) is the city/state — NOT the brand (location_name is the
    // brand for these review sets, which dupes the brand eyebrow). Address goes
    // to the subtitle.
    const locName = resolveLocationName(target.name, target.city, target.state, brandTokens)

    // Monthly avg-rating trend: this outlet vs the whole network. One pass over
    // flat rows (review_date → YYYY-MM), keep the last 24 months that have data.
    const monthly = new Map<string, { oSum: number; oN: number; nSum: number; nN: number }>()
    for (const r of flat) {
      const rt = Number(r.data?.rating)
      if (!rt) continue
      const month = String(r.data?.review_date || '').slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) continue
      const m = monthly.get(month) || { oSum: 0, oN: 0, nSum: 0, nN: 0 }
      monthly.set(month, m)
      m.nSum += rt; m.nN++
      if (r.data?.place_id === target.placeId) { m.oSum += rt; m.oN++ }
    }
    const trend: TrendPoint[] = [...monthly.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : 1)
      .map(([month, m]) => ({ month, outletAvg: m.oN ? m.oSum / m.oN : null, networkAvg: m.nSum / m.nN }))
      .slice(-24)

    selected = {
      placeId: target.placeId,
      name: locName,
      address: target.address,
      location: [target.city, target.state].filter(Boolean).join(', '),
      reviews: target.reviews,
      rating: outletRating,
      chainRating: chainRatingAll,
      ratingDelta: outletRating - chainRatingAll,
      percentile, rank, outletCount: rated.length,
      themes, dimensions, trend,
      narrative: buildNarrative({ name: locName, rank, outletCount: rated.length, percentile, ratingDelta: outletRating - chainRatingAll, chainRating: chainRatingAll, themes, dimensions }),
      snapshot: computeSnapshot(unitOf(target), rated.map(unitOf), outletRating, flat, scan.highExamples, { noun: FLEET_PEER_NOUN, rankable: true }),
      lowQuotes: scan.lowExamples.filter((e) => e.placeId === target.placeId && e.quote).map((e) => ({ theme: e.theme, quote: e.quote })),
    }
  }

  return { brand, outlets: options, selected }
}

// ─── Cross-outlet leaderboard (top/bottom outlets per theme & dimension) ──────

// For each theme and each dimension item, rank the outlets that clear the
// stability floor by their net-positive rate, so a viewer sees the top/bottom
// performers per item (the inverse of the per-outlet report). The client slices
// top-K / bottom-K from `ranked`; we carry at most top-10 + bottom-10 per item.
function buildLeaderboard(scan: Scan): OutletLeaderboard {
  const outletCount = scan.outlets.length
  const ratingOf = (o: Outlet): number | null => (o.ratingN ? o.ratingSum / o.ratingN : null)

  const itemsFrom = (
    chain: Map<string, Acc>,
    subsOf: (o: Outlet) => Map<string, Acc>,
    metaOf: (key: string) => { axis: string; label: string; category: string },
  ): LeaderItem[] => {
    const items: LeaderItem[] = []
    for (const [key, c] of chain) {
      // Item must carry real, chain-wide opinion (same floors as the report).
      if (c.total < MIN_N_CHAIN) continue
      if ((c.pos + c.neg) / c.total < MIN_POLAR_SHARE) continue
      const rows: LeaderRow[] = []
      for (const o of scan.outlets) {
        const a = subsOf(o).get(key)
        if (!a || a.total < MIN_N_OUTLET) continue
        rows.push({ placeId: o.placeId, label: scan.labelFor(o), net: net(a), n: a.total, rating: ratingOf(o) })
      }
      if (rows.length < 2) continue
      rows.sort((a, b) => (b.net !== a.net ? b.net - a.net : b.n - a.n))
      const qualifying = rows.length
      const truncated = qualifying > 20
      const ranked = truncated ? [...rows.slice(0, 10), ...rows.slice(-10)] : rows
      items.push({ key, ...metaOf(key), chainNet: net(c), chainN: c.total, qualifying, truncated, ranked })
    }
    items.sort((a, b) => b.chainN - a.chainN)
    return items
  }

  const themes = scan.themeAvailable
    ? itemsFrom(scan.themeChain, (o) => o.themeSubs, (key) => ({ axis: 'theme', label: key, category: 'Theme' }))
    : []
  const dimensions = scan.dimAvailable
    ? itemsFrom(scan.dimChain, (o) => o.dimSubs, (key) => {
        const [axis, sub] = key.split(':')
        return { axis, label: humanize(sub), category: CATEGORY[axis] || axis }
      })
    : []

  // Default per side: 3 for ≤15 outlets, else ~20% capped at 7. Slider can show more/less.
  const defaultK = outletCount <= 15 ? 3 : Math.min(7, Math.round(outletCount * 0.2))
  const maxK = Math.min(10, Math.max(3, Math.floor(outletCount / 2)))
  return { outletCount, defaultK, maxK, themes, dimensions }
}

export async function computeOutletReport(datasetId: string, selectedPlaceId?: string): Promise<OutletReport> {
  return buildReport(await scanDataset(datasetId), selectedPlaceId)
}

// Chain-wide leaderboard (its own view — NOT a tab in the per-outlet report).
export async function computeOutletLeaderboard(datasetId: string): Promise<OutletLeaderboard> {
  return buildLeaderboard(await scanDataset(datasetId))
}

// Theme-driven "recover your 1–3★ guests" predictor (per-outlet actions + brand
// drivers). Example quotes come from 1–3★ reviews captured during the scan.
function buildPredictorFromScan(scan: Scan): OutletPredictor {
  return buildPredictor({
    themeLabels: scan.themeLabels,
    reviews: scan.reviewMatrix,
    outlets: scan.outlets.map((o) => ({
      placeId: o.placeId, label: scan.labelFor(o), reviews: o.reviews,
      rating: o.ratingN ? o.ratingSum / o.ratingN : null, ratingN: o.ratingN,
    })),
    examples: scan.lowExamples,
    positiveExamples: scan.highExamples,
  })
}

export async function computeOutletPredictor(datasetId: string): Promise<OutletPredictor> {
  return buildPredictorFromScan(await scanDataset(datasetId))
}

// Per-outlet report + its predictor levers from ONE scan (the report page needs
// both; avoids scanning the dataset twice).
export async function computeOutletReportWithPredictor(
  datasetId: string, selectedPlaceId?: string,
): Promise<{ report: OutletReport; predictor: OutletPredictor }> {
  const scan = await scanDataset(datasetId)
  return { report: buildReport(scan, selectedPlaceId), predictor: buildPredictorFromScan(scan) }
}

// ─── Rolled-up hierarchy report (Network → Region → District → Outlet) ────────

// One node one rung below the one being viewed — the row a viewer clicks to
// drill in.
export type HierarchyChild = {
  key: string        // this node's own value, e.g. "New York"
  path: string[]     // full path from the root — what the link carries
  outlets: number    // locations under it
  reviews: number
  rating: number | null
}

export type HierarchyReport = {
  brand: string
  name: string                    // node display name ("Network" at the root)
  path: string[]
  crumbs: { label: string; levelLabel: string; path: string[] }[]
  levelLabel: string              // what THIS node is ("Network", "Region", …)
  childLevelLabel: string | null  // what its children are; null at the last rung
  reviews: number
  rating: number
  outletCount: number             // locations under this node
  networkOutlets: number
  children: HierarchyChild[]      // empty at the deepest rung
  outlets: OutletOption[]         // member locations, listed at the deepest rung
  snapshot: OutletSnapshot
  strayOutlets: number            // locations whose rows disagree on their path
}

// Assign each outlet ONE path, and count the outlets whose rows disagree.
//
// ⭐ The tree is built over OUTLETS, not raw rows, so every number on the page
// reconciles by construction: a node's review count is exactly the sum of its
// member outlets' reviews, and the locations listed at the deepest rung are
// exactly the ones that were summed. Building it over rows instead would let a
// store whose rows carry two different districts contribute to both, and the
// rung totals would then quietly exceed the network total.
//
// A store's region is a property of the store, so disagreement means dirty data
// (a typo in one row's District). We take the outlet's most common path and
// REPORT the count of stray outlets rather than silently picking one.
function outletPaths(scan: Scan, levels: HierarchyLevel[]): { paths: Map<string, string[]>; stray: number } {
  const tallies = new Map<string, Map<string, { path: string[]; n: number }>>()
  for (const r of scan.flat) {
    const placeId = r.data?.place_id
    if (!placeId) continue
    const path = pathOf(r.data as Record<string, unknown>, levels)
    const key = path.join('')
    const t = tallies.get(placeId) || (tallies.set(placeId, new Map()), tallies.get(placeId)!)
    const e = t.get(key) || (t.set(key, { path, n: 0 }), t.get(key)!)
    e.n++
  }
  const paths = new Map<string, string[]>()
  let stray = 0
  for (const [placeId, t] of tallies) {
    if (t.size > 1) stray++
    const best = [...t.values()].sort((a, b) => b.n - a.n)[0]
    paths.set(placeId, best.path)
  }
  return { paths, stray }
}

// The same snapshot, computed over the outlets under one node of the hierarchy.
// Returns null when the dataset has no usable hierarchy, or the path names a
// node that doesn't exist.
export async function computeHierarchyReport(
  datasetId: string, fields: SchemaFieldConfig[] | undefined, path: string[],
): Promise<HierarchyReport | null> {
  const levels = hierarchyLevels(fields)
  if (levels.length < 2) return null

  const scan = await scanDataset(datasetId)
  const { paths, stray } = outletPaths(scan, levels)

  // One synthetic record per outlet → node.rowCount is the OUTLET count.
  const outletRows = scan.outlets.map((o) => {
    const p = paths.get(o.placeId) || levels.map(() => UNASSIGNED)
    return Object.fromEntries(levels.map((l, i) => [l.field, p[i]]))
  })
  const root = buildHierarchy(outletRows, levels)
  const node = findNode(root, path)
  if (!node) return null

  // Members of any node = outlets whose assigned path carries that prefix.
  const membersOf = (p: string[]): Outlet[] => scan.outlets.filter((o) => {
    const op = paths.get(o.placeId)
    if (!op) return false
    for (let i = 0; i < p.length; i++) if (op[i] !== p[i]) return false
    return true
  })

  const members = membersOf(path)
  const target = mergeUnits(members)
  const rating = unitRating(target)

  // Peers = every node at the SAME depth, network-wide — the exact analogue of
  // the outlet view comparing one store against every store, not just the ones
  // beside it. At the root there is no same-kind peer, so the markers fall back
  // to the range across individual locations (what "network" means there).
  const depth = path.length
  const sameRung = depth === 0 ? [] : nodesAtDepth(root, depth)
  const peers: SnapshotUnit[] = depth === 0
    ? scan.outlets.filter((o) => o.ratingN > 0).map(unitOf)
    : sameRung.map((n) => mergeUnits(membersOf(n.path)))

  // The node's standing among its same-rung peers is carried by the snapshot's
  // Fleet Position tile (rank + qualitative band), so it isn't computed twice.
  const levelLabel = depth === 0 ? 'Network' : (levels[depth - 1]?.label || `Level ${depth}`)

  const childLevel = levels[depth] || null
  const children: HierarchyChild[] = node.children.map((c) => {
    const m = membersOf(c.path)
    const u = mergeUnits(m)
    return { key: c.key, path: c.path, outlets: c.rowCount, reviews: u.reviews, rating: u.ratingN ? unitRating(u) : null }
  })

  // Only the deepest rung lists individual locations — above it the children ARE
  // the drill-down, and listing every store as well would double the page.
  const outlets: OutletOption[] = childLevel ? [] : members
    .map((o) => ({ placeId: o.placeId, label: scan.labelFor(o), sublabel: `${o.ratingN ? (o.ratingSum / o.ratingN).toFixed(1) : '—'}★`, reviews: o.reviews }))
    .sort((a, b) => b.reviews - a.reviews)

  return {
    brand: scan.brand,
    name: depth === 0 ? 'Network' : path[path.length - 1],
    path,
    crumbs: breadcrumb(root, path, levels),
    levelLabel,
    childLevelLabel: childLevel ? childLevel.label : null,
    reviews: target.reviews,
    rating,
    outletCount: members.length,
    networkOutlets: scan.outlets.length,
    children,
    outlets,
    snapshot: computeSnapshot(target, peers, rating, scan.flat, scan.highExamples,
      { noun: pluralLevel(levelLabel).toLowerCase(), rankable: depth > 0 }),
    strayOutlets: stray,
  }
}
