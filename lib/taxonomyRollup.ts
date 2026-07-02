// lib/taxonomyRollup.ts
// The tag-analytics model: read persisted dataset_row_taxonomy rows and roll
// them up into axis/sub mention rates, sentiment, and alert counts — the shape
// the in-app Taxonomy tab and any deck consume. `aggregateTaxonomy` is pure
// (over an in-memory row array) so it's unit-testable; `computeTaxonomyRollup`
// adds the org-scoped paged read.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DIM_AXIS_LABEL_LONG } from './dimensionFields'
import { deriveTrendWindows } from './trendWindows'
import { logError } from './log'

export const AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome'] as const
export type Axis = typeof AXES[number]

// Verbose axis labels — single source lives in lib/dimensionFields.ts so the tab,
// the rollup, and the chart hover never drift.
export const AXIS_LABEL: Record<Axis, string> = DIM_AXIS_LABEL_LONG

export interface TaxonomyRow {
  axis_touchpoint: string[]; axis_attribute: string[]; axis_product: string[]
  axis_beverage: string[];   axis_ambiance: string[];  axis_context: string[]
  axis_outcome: string[];    alert_tags: string[]
  assertions: { axis: string; sub: string; polarity?: string }[]
  rating?: number | null     // attached by computeTaxonomyRollup from dataset_rows_flat
  dateMs?: number | null     // attached when a trend date field is requested
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

// computeTaxonomyRollup return when a trend date field is supplied: the full
// rollup plus recent/prior-window rollups (for the Heads-Up 📉📈 dimension lens).
export interface TaxonomyTrendRollup extends TaxonomyRollup {
  recent: TaxonomyRollup | null
  prior:  TaxonomyRollup | null
  windowLabel: string | null
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

/**
 * Detect the dataset's rating field for the avg-rating-per-dimension rollup —
 * the same rule the metric strip / signal-stats route uses. Returns the JSONB
 * key plus, when the field stores text labels mapped to numbers (valueAliases
 * like {"Highly Satisfied":"5"}), the alias map so a per-row label resolves to
 * its number. Falls back to the legacy `rating` key when no schema is found, so
 * existing google_reviews datasets behave exactly as before.
 */
async function detectRatingField(service: SupabaseClient, datasetId: string): Promise<{ field: string; aliases: Record<string, string> | null }> {
  try {
    const { data: stateRow, error: stateRowErr } = await service
      .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).maybeSingle()
    if (stateRowErr) void logError('taxonomyRollup.detectRatingField', stateRowErr)
    const fields = (stateRow as { schema_config?: { fields?: Array<{ field: string; type?: string; sqt?: string; scoreField?: boolean; valueAliases?: Record<string, string> }> } } | null)?.schema_config?.fields || []
    const rf = fields.find(f => f.type === 'numeric' && (f.sqt === 'rating' || f.sqt === 'nps' || f.sqt === 'likert' || f.scoreField))
    if (!rf) return { field: 'rating', aliases: null }
    // Only treat the field as remapped when its alias values are numeric.
    const aliases = rf.valueAliases && typeof rf.valueAliases === 'object'
      && Object.values(rf.valueAliases).some(v => /^-?[0-9]+\.?[0-9]*$/.test(String(v)))
      ? rf.valueAliases : null
    return { field: rf.field, aliases }
  } catch {
    return { field: 'rating', aliases: null }
  }
}

/** Org-scoped paged read + aggregate, for ONE open-ended field. Pairs
 *  (dataset_id, org_id) per invariant and filters to the field's tags so the
 *  Dimensions view reflects whichever open-end the user is analyzing. */
export async function computeTaxonomyRollup(opts: {
  service: SupabaseClient; datasetId: string; orgId: string; field: string; topSubs?: number
  /** When set, also compute recent/prior-window rollups bucketed by this date
   *  field (the JSONB key, e.g. 'review_date') so dimensions can trend. */
  dateField?: string | null
}): Promise<TaxonomyTrendRollup> {
  const { service, datasetId, orgId, field, topSubs, dateField } = opts

  // Resolve the rating field once (dynamic — supports survey/aliased fields, not
  // just a literal `rating` column). The key can carry spaces/commas/apostrophes
  // (survey question text), which a PostgREST select string can't express, so
  // values are fetched via the dataset_field_values RPC (field passed as a bind
  // param). A plain `rating`-named field still uses the direct select so existing
  // google_reviews rollups don't depend on the new RPC being applied first.
  const { field: ratingField, aliases } = await detectRatingField(service, datasetId)
  const useDirectSelect = ratingField === 'rating' && !aliases

  const all: TaxonomyRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await service
      .from('dataset_row_field_taxonomy')
      .select('row_id,axis_touchpoint,axis_attribute,axis_product,axis_beverage,axis_ambiance,axis_context,axis_outcome,alert_tags,assertions')
      .eq('dataset_id', datasetId)
      .eq('org_id', orgId)
      .eq('field', field)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    const page = data as unknown as (TaxonomyRow & { row_id: number })[]

    // Attach each row's star rating (for avg-rating-per-dimension) from the flat
    // table — fetch only the rating value, keyed by row_id, for this page.
    const ids = page.map(r => r.row_id).filter((x): x is number => x != null)
    if (ids.length) {
      const ratingById = new Map<number, number>()
      const rows: { id: number; val: string | null }[] = useDirectSelect
        ? ((await service.from('dataset_rows_flat').select('id, val:data->>rating').in('id', ids)).data as unknown as { id: number; val: string | null }[] || [])
        : ((await service.rpc('dataset_field_values', { p_dataset_id: datasetId, p_field: ratingField, p_ids: ids })).data as { id: number; val: string | null }[] || [])
      for (const r of rows) {
        // Remapped fields store a text label → resolve via the alias map; plain
        // numeric fields parse directly.
        const mapped = aliases && r.val != null ? aliases[r.val] : r.val
        const v = mapped != null ? parseFloat(mapped) : NaN
        if (!isNaN(v)) ratingById.set(r.id, v)
      }
      for (const r of page) r.rating = ratingById.get(r.row_id) ?? null

      // Attach each row's timestamp (for recent/prior trend windows). Best-effort:
      // a simple `field` name uses a direct select; anything exotic (survey
      // question text) goes through the bind-param RPC. Failure → no trend.
      if (dateField) {
        try {
          const dateById = new Map<number, number>()
          const simple = /^[a-z0-9_]+$/i.test(dateField)
          const drows: { id: number; val: string | null }[] = simple
            ? ((await service.from('dataset_rows_flat').select(`id, val:data->>${dateField}`).in('id', ids)).data as unknown as { id: number; val: string | null }[] || [])
            : ((await service.rpc('dataset_field_values', { p_dataset_id: datasetId, p_field: dateField, p_ids: ids })).data as { id: number; val: string | null }[] || [])
          for (const r of drows) { const t = r.val != null ? Date.parse(String(r.val)) : NaN; if (isFinite(t)) dateById.set(r.id, t) }
          for (const r of page) r.dateMs = dateById.get(r.row_id) ?? null
        } catch { /* leave dateMs undefined → no trend */ }
      }
    }

    all.push(...page)
    from += data.length
    if (data.length < PAGE) break
  }
  const rollup = aggregateTaxonomy(all, topSubs)

  // Overall avg rating = ALL rated rows, not just the classified subset
  // aggregateTaxonomy sees (the "ratings = all reviews" principle — the
  // Dimensions overall ★ ties back to Google/exports). Per-axis/per-sub
  // avgRating stay dimension-scoped (text-classified). Same all-rows RPCs the
  // metric strip uses; leave the classified-rows fallback if the RPC returns 0.
  try {
    const { data: ns, error: nsErr } = aliases
      ? await service.rpc('field_aliased_avg', { p_dataset_id: datasetId, p_field: ratingField, p_present_field: '', p_aliases: aliases })
      : await service.rpc('numeric_field_stats', { p_dataset_id: datasetId, p_field_key: ratingField })
    if (nsErr) void logError('taxonomyRollup.computeTaxonomyRollup', nsErr, { orgId })
    const row = Array.isArray(ns) ? ns[0] : null
    if (row && Number(row.n) > 0 && row.avg_val != null) {
      rollup.overallAvgRating = Math.round(Number(row.avg_val) * 100) / 100
    }
  } catch { /* keep the classified-rows overall if the all-rows RPC fails */ }

  // Recent/prior-window rollups for the trend lens — derived from the dated rows
  // we just attached. Each window is aggregated exactly like the full set, so a
  // sub's recent-vs-prior count/posPct/avgRating drives 📉📈 in the Heads-Up.
  let recent: TaxonomyRollup | null = null
  let prior:  TaxonomyRollup | null = null
  let windowLabel: string | null = null
  if (dateField) {
    const ms = all.map(r => r.dateMs).filter((x): x is number => x != null)
    if (ms.length >= 8) {
      let min = Infinity, max = -Infinity
      for (const t of ms) { if (t < min) min = t; if (t > max) max = t }
      if (max > min) {
        const win = deriveTrendWindows(min, max)
        if (win.recent && win.prior) {
          const inWin = (r: TaxonomyRow, w: { startMs: number; endMs: number }) =>
            r.dateMs != null && r.dateMs >= w.startMs && r.dateMs < w.endMs
          recent = aggregateTaxonomy(all.filter(r => inWin(r, win.recent!)), topSubs)
          prior  = aggregateTaxonomy(all.filter(r => inWin(r, win.prior!)), topSubs)
          windowLabel = win.windowLabel
        }
      }
    }
  }

  return { ...rollup, recent, prior, windowLabel }
}
