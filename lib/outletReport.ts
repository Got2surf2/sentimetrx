import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { lexiconScore } from '@/lib/themeUtils'
import { buildPredictor, type OutletPredictor, type PredReview, type PredExample } from '@/lib/outletPredictor'

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
// the human name alone is ambiguous). Taxonomy assertions join to flat rows by
// dataset_rows_flat.id === dataset_row_field_taxonomy.row_id.

const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const

// Stability floors: ignore thin samples that would produce noisy deltas.
const MIN_N_OUTLET = 6    // matched reviews/assertions for this item at this outlet
const MIN_N_CHAIN = 20    // across all outlets
const MIN_POLAR_SHARE = 0.3  // item must carry real opinion, not pure mentions
const DELTA_THRESHOLD = 0.08 // min gap vs peers to count as a strength/weakness

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
    rank: number         // 1 = best
    outletCount: number
    narrative: string
    trend: TrendPoint[]
    themes: ComparisonBlock
    dimensions: ComparisonBlock
  } | null
}

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

// The taxonomy classifier is purely keyword-based, so the cleanliness keyword
// "dirty" false-fires on menu items ("dirty soda", "dirty cherry cola") and the
// idiom "dirty look(s)". Drop those from the Clean axis. (Proper fix is vocab-level.)
const DIRTY_NOISE = /dirty\s+(soda|cola|cherry|orange|martini|chai|lemonade|fries|drink|water|horchata)|dirty\s+looks?/i
function isNoiseAssertion(a: any): boolean {
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
function extractSentence(ex: Example | null): string | null {
  if (!ex) return null
  const full = (ex.full || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const ev = (ex.ev || '').replace(/\s+/g, ' ').trim()
  if (!full) return ev || null
  const core = ev.length > 12 ? ev.slice(3, -3) : ev
  let i = full.toLowerCase().indexOf(core.toLowerCase())
  if (i < 0) i = full.toLowerCase().indexOf(ev.toLowerCase())
  if (i < 0) {
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
  return clamp(full.slice(start, stop).trim())
}

function clamp(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim()
  if (out.length > 180) out = out.slice(0, 180).replace(/\s\S*$/, '') + '…'
  return out.charAt(0).toUpperCase() + out.slice(1)
}

async function pageAll(table: string, cols: string, datasetId: string): Promise<any[]> {
  const sb = createServiceRoleClient()
  const out: any[] = []
  const size = 1000
  let from = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await sb.from(table).select(cols).eq('dataset_id', datasetId).range(from, from + size - 1)
    if (error) throw error
    out.push(...(data || []))
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
    .map((d) => ({ ...d, quote: extractSentence((d as any)._exPos) }))
    .map(({ _exPos, _exNeg, ...s }: any) => s)
  const weaknesses = deltas
    .filter((d) => d.delta <= -DELTA_THRESHOLD)
    .sort((a, b) => a.delta - b.delta).slice(0, 4)
    .map((d) => ({ ...d, quote: extractSentence((d as any)._exNeg) }))
    .map(({ _exPos, _exNeg, ...w }: any) => w)
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

type Outlet = {
  placeId: string; name: string; city: string; state: string; address: string
  reviews: number; ratingSum: number; ratingN: number
  dimClassified: number; themeMatched: number
  dimSubs: Map<string, Acc>; themeSubs: Map<string, Acc>
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
  flat: any[]
  labelFor: (o: Outlet) => string
  themeLabels: string[]       // ordered theme labels (matchers) for the predictor
  reviewMatrix: PredReview[]  // per rated text-review: theme-negative flag vector
}

// One pass over a dataset's flat rows + taxonomy assertions, building the
// per-outlet and chain-level net-positive accumulators that BOTH the per-outlet
// report and the cross-outlet leaderboard read from (one scan, two views).
async function scanDataset(datasetId: string): Promise<Scan> {
  const sb = createServiceRoleClient()
  const { data: ds } = await sb.from('datasets').select('name').eq('id', datasetId).maybeSingle()
  const brand: string = ds?.name || 'Brand'
  const brandTokens = new Set<string>(brand.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2))
  const { data: stateRow } = await sb.from('dataset_state').select('theme_model').eq('dataset_id', datasetId).maybeSingle()
  // Theme labels live in `name` ("Food Quality & Taste"); older payloads used
  // `label`. Reading the wrong field collapses every theme to "Theme".
  const themeModel: { id?: string; name?: string; label?: string; keywords: string[] }[] = (stateRow?.theme_model?.themes as any[]) || []
  const themeMatchers = themeModel
    .map((t) => ({ label: t.name || t.label || 'Theme', re: themeMatcher(t.keywords || []) }))
    .filter((t): t is { label: string; re: RegExp } => !!t.re)

  const flat = await pageAll('dataset_rows_flat', 'id, data', datasetId)
  const byId = new Map<number, any>()
  for (const r of flat) byId.set(Number(r.id), r.data)

  const tax = await pageAll('dataset_row_field_taxonomy', 'row_id, assertions', datasetId)

  const outlets = new Map<string, Outlet>()
  const getOutlet = (d: any): Outlet | null => {
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
      }
      outlets.set(placeId, o)
    }
    return o
  }

  const dimChain = new Map<string, Acc>()
  const themeChain = new Map<string, Acc>()
  const themeLabels = themeMatchers.map((tm) => tm.label)
  const reviewMatrix: PredReview[] = []

  // Pass over flat rows: rating + review counts, AND theme matching/sentiment.
  for (const r of flat) {
    const d = r.data
    const o = getOutlet(d)
    if (!o) continue
    o.reviews++
    const rt = Number(d?.rating)
    if (rt) { o.ratingSum += rt; o.ratingN++ }

    if (themeMatchers.length) {
      const text = String(d?.review_text || '')
      if (text.trim()) {
        const { pos, neg } = lexiconScore(text)
        const polarity = pos > neg ? 'pos' : neg > pos ? 'neg' : 'neutral'
        let matchedAny = false
        // Per-review theme-negative flag vector for the predictor (whole-review
        // polarity, same convention as the leaderboard). Only the negative
        // signal drives the model — never score on bare theme presence.
        const negFlags = new Array(themeMatchers.length).fill(false)
        for (let ti = 0; ti < themeMatchers.length; ti++) {
          const tm = themeMatchers[ti]
          if (!tm.re.test(text)) continue
          matchedAny = true
          if (polarity === 'neg') negFlags[ti] = true
          const key = tm.label
          const cu = themeChain.get(key) || (themeChain.set(key, newAcc()), themeChain.get(key)!)
          const ou = o.themeSubs.get(key) || (o.themeSubs.set(key, newAcc()), o.themeSubs.get(key)!)
          cu.total++; ou.total++
          if (polarity === 'pos') { cu.pos++; ou.pos++; if (!ou.exPos) ou.exPos = { full: text, ev: text } }
          else if (polarity === 'neg') { cu.neg++; ou.neg++; if (!ou.exNeg) ou.exNeg = { full: text, ev: text } }
        }
        if (matchedAny) o.themeMatched++
        if (rt) reviewMatrix.push({ placeId: o.placeId, rating: rt, neg: negFlags })
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
      if (!AXES.includes(a.axis)) continue
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
    themeLabels, reviewMatrix,
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

// Theme-driven "biggest levers" predictor (per-outlet actions + brand levers).
function buildPredictorFromScan(scan: Scan): OutletPredictor {
  // Negative example quote per (outlet, theme), recovered from the scan's
  // accumulators — "what to fix" in a guest's own words.
  const examples: PredExample[] = []
  for (const o of scan.outlets) {
    for (const [theme, acc] of o.themeSubs) {
      const quote = extractSentence(acc.exNeg)
      if (quote) examples.push({ placeId: o.placeId, theme, quote })
    }
  }
  return buildPredictor({
    themeLabels: scan.themeLabels,
    reviews: scan.reviewMatrix,
    outlets: scan.outlets.map((o) => ({
      placeId: o.placeId, label: scan.labelFor(o), reviews: o.reviews,
      rating: o.ratingN ? o.ratingSum / o.ratingN : null,
    })),
    examples,
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
