import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Per-outlet "vs peers" summary report.
//
// For a multi-location brand (one dataset, many outlets), compare a single
// outlet to the rest of its outlets ("peers") on two axes:
//   1. Headline star rating  — per-outlet avg vs chain avg + percentile rank.
//   2. Sub-theme sentiment    — for each taxonomy sub (e.g. attribute:speed),
//      the outlet's net-positive rate vs the chain's, surfacing where the
//      outlet EXCELS (beats peers) and NEEDS WORK (trails peers).
//
// Outlets are keyed by Google place_id (several share the same name + city, so
// the human name alone is ambiguous). Sentiment comes from the per-field
// taxonomy assertions ({ axis, sub, polarity, evidence }) joined to flat rows
// by dataset_rows_flat.id === dataset_row_field_taxonomy.row_id.

const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const

// Stability floors: ignore thin samples that would produce noisy deltas.
const MIN_SUB_N_OUTLET = 6   // assertions for this sub at this outlet
const MIN_SUB_N_CHAIN = 20   // assertions for this sub across all outlets
const MIN_POLAR_SHARE = 0.3  // sub must carry real opinion, not pure mentions
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
  n: number           // assertions for this sub at this outlet
  quote: string | null
}

export type OutletReport = {
  brand: string
  outlets: OutletOption[]
  selected: {
    placeId: string
    name: string
    location: string
    reviews: number
    rating: number
    chainRating: number
    ratingDelta: number
    percentile: number   // 0-100, share of outlets this one beats on rating
    rank: number         // 1 = best
    outletCount: number
    classifiedReviews: number
    strengths: ThemeDelta[]
    weaknesses: ThemeDelta[]
  } | null
}

type Example = { full: string; ev: string }
type Acc = { pos: number; neg: number; total: number; exPos: Example | null; exNeg: Example | null }
const newAcc = (): Acc => ({ pos: 0, neg: 0, total: 0, exPos: null, exNeg: null })
const net = (a: Acc) => (a.total ? (a.pos - a.neg) / a.total : 0)

// The classifier is purely keyword-based, so the cleanliness keyword "dirty"
// false-fires on menu items ("dirty soda", "dirty cherry cola", "dirty orange
// soda") and the idiom "dirty look(s)". Drop those from the Clean axis so a
// menu name doesn't read as a hygiene complaint. (Proper fix is vocabulary-level.)
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

// The classifier's `evidence` is a fixed-width window that starts/ends
// mid-word. Recover a readable full sentence: locate the evidence inside the
// original review and expand out to sentence boundaries.
function extractSentence(ex: Example | null): string | null {
  if (!ex) return null
  const full = (ex.full || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const ev = (ex.ev || '').replace(/\s+/g, ' ').trim()
  if (!full) return ev || null

  // Locate the evidence (trim a few chars off each end since the window may
  // begin/end mid-word, which can break an exact match).
  const core = ev.length > 12 ? ev.slice(3, -3) : ev
  let i = full.toLowerCase().indexOf(core.toLowerCase())
  if (i < 0) i = full.toLowerCase().indexOf(ev.toLowerCase())
  if (i < 0) {
    // Couldn't locate — fall back to the first sentence of the review.
    const first = full.split(/(?<=[.!?])\s/)[0] || full
    return clamp(first)
  }
  const end = i + core.length
  // Expand left to the start of the sentence, right to its terminator.
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

async function pageAll(
  table: string, cols: string, datasetId: string,
): Promise<any[]> {
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

export async function computeOutletReport(datasetId: string, selectedPlaceId?: string): Promise<OutletReport> {
  const sb = createServiceRoleClient()
  const { data: ds } = await sb.from('datasets').select('name').eq('id', datasetId).maybeSingle()

  const flat = await pageAll('dataset_rows_flat', 'id, data', datasetId)
  const byId = new Map<number, any>()
  for (const r of flat) byId.set(Number(r.id), r.data)

  const tax = await pageAll('dataset_row_field_taxonomy', 'row_id, assertions', datasetId)

  // Per-outlet state, keyed by place_id.
  type Outlet = {
    placeId: string; name: string; city: string; state: string; address: string
    reviews: number; ratingSum: number; ratingN: number
    classified: number
    subs: Map<string, Acc>
  }
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
        reviews: 0, ratingSum: 0, ratingN: 0, classified: 0, subs: new Map(),
      }
      outlets.set(placeId, o)
    }
    return o
  }

  // Rating + review counts from flat rows.
  for (const r of flat) {
    const o = getOutlet(r.data)
    if (!o) continue
    o.reviews++
    const rt = Number(r.data?.rating)
    if (rt) { o.ratingSum += rt; o.ratingN++ }
  }

  // Sub-level sentiment from taxonomy assertions.
  const chain = new Map<string, Acc>()
  for (const t of tax) {
    const d = byId.get(Number(t.row_id))
    if (!d) continue
    const o = getOutlet(d)
    if (!o) continue
    o.classified++
    for (const a of (t.assertions || [])) {
      if (!AXES.includes(a.axis)) continue
      if (isNoiseAssertion(a)) continue
      const key = `${a.axis}:${a.sub}`
      const cu = chain.get(key) || (chain.set(key, newAcc()), chain.get(key)!)
      const ou = o.subs.get(key) || (o.subs.set(key, newAcc()), o.subs.get(key)!)
      cu.total++; ou.total++
      if (a.polarity === 'pos') {
        cu.pos++; ou.pos++
        if (!ou.exPos && a.evidence) ou.exPos = { full: d.review_text || '', ev: a.evidence }
      } else if (a.polarity === 'neg') {
        cu.neg++; ou.neg++
        if (!ou.exNeg && a.evidence) ou.exNeg = { full: d.review_text || '', ev: a.evidence }
      }
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

  const all = [...outlets.values()]
  const options: OutletOption[] = all
    .map((o) => ({ placeId: o.placeId, label: labelFor(o), sublabel: `${o.ratingN ? (o.ratingSum / o.ratingN).toFixed(1) : '—'}★`, reviews: o.reviews }))
    .sort((a, b) => b.reviews - a.reviews)

  const targetId = selectedPlaceId && outlets.has(selectedPlaceId) ? selectedPlaceId : options[0]?.placeId
  const target = targetId ? outlets.get(targetId)! : null

  let selected: OutletReport['selected'] = null
  if (target) {
    const rated = all.filter((o) => o.ratingN > 0)
    const chainRatingAll = rated.reduce((s, o) => s + o.ratingSum, 0) / Math.max(1, rated.reduce((s, o) => s + o.ratingN, 0))
    const outletRating = target.ratingN ? target.ratingSum / target.ratingN : 0
    const avgList = rated.map((o) => o.ratingSum / o.ratingN).sort((a, b) => a - b)
    const beats = avgList.filter((r) => r < outletRating).length
    const percentile = avgList.length > 1 ? Math.round((100 * beats) / (avgList.length - 1)) : 100
    const rank = rated.filter((o) => o.ratingSum / o.ratingN > outletRating).length + 1

    const chainNetFor = (key: string) => {
      const c = chain.get(key)!
      return net(c)
    }
    const deltas: ThemeDelta[] = [...target.subs.entries()]
      .filter(([key, o]) => {
        const c = chain.get(key)
        if (!c) return false
        if (o.total < MIN_SUB_N_OUTLET || c.total < MIN_SUB_N_CHAIN) return false
        if ((c.pos + c.neg) / c.total < MIN_POLAR_SHARE) return false  // skip pure-mention subs
        return true
      })
      .map(([key, o]) => {
        const [axis, sub] = key.split(':')
        const oNet = net(o)
        const cNet = chainNetFor(key)
        return {
          sub, axis, label: humanize(sub), category: CATEGORY[axis] || axis,
          outletNet: oNet, chainNet: cNet, delta: oNet - cNet, n: o.total,
          quote: null as string | null,
          _exPos: o.exPos, _exNeg: o.exNeg,
        } as ThemeDelta & { _exPos: Example | null; _exNeg: Example | null }
      })

    const strengths = deltas
      .filter((d) => d.delta >= DELTA_THRESHOLD && d.outletNet > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 4)
      .map((d) => ({ ...d, quote: extractSentence((d as any)._exPos) }))

    const weaknesses = deltas
      .filter((d) => d.delta <= -DELTA_THRESHOLD)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 4)
      .map((d) => ({ ...d, quote: extractSentence((d as any)._exNeg) }))

    selected = {
      placeId: target.placeId,
      name: target.name,
      location: [target.city, target.state].filter(Boolean).join(', '),
      reviews: target.reviews,
      rating: outletRating,
      chainRating: chainRatingAll,
      ratingDelta: outletRating - chainRatingAll,
      percentile, rank, outletCount: rated.length,
      classifiedReviews: target.classified,
      strengths: strengths.map(({ _exPos, _exNeg, ...s }: any) => s),
      weaknesses: weaknesses.map(({ _exPos, _exNeg, ...w }: any) => w),
    }
  }

  return { brand: ds?.name || 'Brand', outlets: options, selected }
}
