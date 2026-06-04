// lib/taxonomyRollup.ts
// The tag-analytics model: read persisted dataset_row_taxonomy rows and roll
// them up into axis/sub mention rates, sentiment, and alert counts — the shape
// the in-app Taxonomy tab and any deck consume. `aggregateTaxonomy` is pure
// (over an in-memory row array) so it's unit-testable; `computeTaxonomyRollup`
// adds the org-scoped paged read.

import type { SupabaseClient } from '@supabase/supabase-js'

export const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const
export type Axis = typeof AXES[number]

export const AXIS_LABEL: Record<Axis, string> = {
  touchpoint: 'Service — who served you',
  attribute:  'Staff & food attributes',
  product:    'Food — what they ate',
  beverage:   'Drinks — bar & wine',
  ambiance:   'Room — ambiance & décor',
  context:    'Occasion — when & why',
  outcome:    'Outcome — will they return',
}

export interface TaxonomyRow {
  axis_touchpoint: string[]; axis_attribute: string[]; axis_product: string[]
  axis_beverage: string[];   axis_ambiance: string[];  axis_context: string[]
  axis_outcome: string[];    alert_tags: string[]
  assertions: { axis: string; sub: string; polarity?: string }[]
  rating?: number | null     // attached by computeTaxonomyRollup from dataset_rows_flat
}

export interface SubStat { axis: string; sub: string; count: number; rate: number; pos: number; neg: number; posPct: number | null; avgRating: number | null }
export interface TaxonomyRollup {
  classifiedRows: number
  withSignal:     number
  overallAvgRating: number | null
  axes:   { axis: Axis; label: string; count: number; rate: number; avgRating: number | null }[]
  subs:   SubStat[]
  alerts: { tag: string; count: number }[]
  alertRows: number
}

/** mean of a [sum, n] accumulator, rounded to 1dp; null when no values. */
function mean(sum: number, n: number): number | null {
  return n > 0 ? +(sum / n).toFixed(1) : null
}

/** Pure aggregation over already-fetched taxonomy rows. */
export function aggregateTaxonomy(rows: TaxonomyRow[], topSubs = 40): TaxonomyRollup {
  const n = rows.length
  const axisCount: Record<string, number> = {}
  const subCount: Record<string, number> = {}
  const subPos: Record<string, number> = {}
  const subNeg: Record<string, number> = {}
  const alertCount: Record<string, number> = {}
  // avg-rating accumulators: [sum, count] of the rating field over matching rows
  const axisRatS: Record<string, number> = {}, axisRatN: Record<string, number> = {}
  const subRatS: Record<string, number> = {},  subRatN: Record<string, number> = {}
  let overallRatS = 0, overallRatN = 0
  let withSignal = 0, alertRows = 0

  for (const r of rows) {
    const rv = r.rating != null ? Number(r.rating) : NaN
    const rating = Number.isFinite(rv) ? rv : null
    if (rating != null) { overallRatS += rating; overallRatN++ }
    let any = false
    for (const ax of AXES) {
      const arr = (r as unknown as Record<string, string[]>)['axis_' + ax]
      if (arr && arr.length) {
        any = true
        axisCount[ax] = (axisCount[ax] || 0) + 1
        if (rating != null) { axisRatS[ax] = (axisRatS[ax] || 0) + rating; axisRatN[ax] = (axisRatN[ax] || 0) + 1 }
        for (const sub of arr) {
          const k = ax + ':' + sub
          subCount[k] = (subCount[k] || 0) + 1
          if (rating != null) { subRatS[k] = (subRatS[k] || 0) + rating; subRatN[k] = (subRatN[k] || 0) + 1 }
        }
      }
    }
    if (any) withSignal++
    if (r.alert_tags && r.alert_tags.length) {
      alertRows++
      for (const t of r.alert_tags) alertCount[t] = (alertCount[t] || 0) + 1
    }
    for (const a of r.assertions || []) {
      const k = a.axis + ':' + a.sub
      if (a.polarity === 'pos') subPos[k] = (subPos[k] || 0) + 1
      else if (a.polarity === 'neg') subNeg[k] = (subNeg[k] || 0) + 1
    }
  }

  const denom = Math.max(1, n)
  const axes = AXES.map(ax => ({
    axis: ax, label: AXIS_LABEL[ax],
    count: axisCount[ax] || 0,
    rate: +(100 * (axisCount[ax] || 0) / denom).toFixed(1),
    avgRating: mean(axisRatS[ax] || 0, axisRatN[ax] || 0),
  })).sort((a, b) => b.rate - a.rate)

  const subs: SubStat[] = Object.keys(subCount).map(k => {
    const [axis, sub] = k.split(':')
    const pos = subPos[k] || 0, neg = subNeg[k] || 0
    return {
      axis, sub, count: subCount[k],
      rate: +(100 * subCount[k] / denom).toFixed(1),
      pos, neg, posPct: pos + neg === 0 ? null : Math.round(100 * pos / (pos + neg)),
      avgRating: mean(subRatS[k] || 0, subRatN[k] || 0),
    }
  }).sort((a, b) => b.count - a.count).slice(0, topSubs)

  const alerts = Object.keys(alertCount).map(t => ({ tag: t, count: alertCount[t] }))
    .sort((a, b) => b.count - a.count)

  return { classifiedRows: n, withSignal, overallAvgRating: mean(overallRatS, overallRatN), axes, subs, alerts, alertRows }
}

const PAGE = 1000

/** Org-scoped paged read + aggregate. Pairs (dataset_id, org_id) per invariant. */
export async function computeTaxonomyRollup(opts: {
  service: SupabaseClient; datasetId: string; orgId: string; topSubs?: number
}): Promise<TaxonomyRollup> {
  const { service, datasetId, orgId, topSubs } = opts
  const all: TaxonomyRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await service
      .from('dataset_row_taxonomy')
      .select('row_id,axis_touchpoint,axis_attribute,axis_product,axis_beverage,axis_ambiance,axis_context,axis_outcome,alert_tags,assertions')
      .eq('dataset_id', datasetId)
      .eq('org_id', orgId)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    const page = data as unknown as (TaxonomyRow & { row_id: number })[]

    // Attach each row's star rating (for avg-rating-per-dimension) from the flat
    // table — fetch only the rating value, keyed by row_id, for this page.
    const ids = page.map(r => r.row_id).filter((x): x is number => x != null)
    if (ids.length) {
      const { data: rd } = await service
        .from('dataset_rows_flat').select('id, rating:data->>rating').in('id', ids)
      const ratingById = new Map<number, number>()
      for (const r of (rd || []) as { id: number; rating: string | null }[]) {
        const v = r.rating != null ? parseFloat(r.rating) : NaN
        if (!isNaN(v)) ratingById.set(r.id, v)
      }
      for (const r of page) r.rating = ratingById.get(r.row_id) ?? null
    }

    all.push(...page)
    from += data.length
    if (data.length < PAGE) break
  }
  return aggregateTaxonomy(all, topSubs)
}
