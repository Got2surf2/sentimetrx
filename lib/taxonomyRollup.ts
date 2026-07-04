// lib/taxonomyRollup.ts
// The tag-analytics model: read the per-row verdicts embedded in
// dataset_rows_flat.data._tx (sql/151) and roll them up into axis/sub mention
// rates, sentiment, and alert counts — the shape the in-app Taxonomy tab and
// any deck consume. `aggregateTaxonomy` is pure (over an in-memory row array)
// so it's unit-testable; `computeTaxonomyRollup` adds the paged read (org
// access is gated by callers per the route contract; dataset_rows_flat scopes
// through dataset_id per ARCHITECTURE.md D2).
//
// The completed rollup is STORED in dataset_state.analytics.taxonomy at
// classify time (updateStoredTaxonomyRollup) so dashboards read aggregates
// instead of scanning blobs; readStoredTaxonomyRollup is the fast path.

import type { SupabaseClient } from '@supabase/supabase-js'
import { DIM_AXIS_LABEL_LONG } from './dimensionFields'
import { blockAxisSubs, TAXONOMY_VERSION, type TaxonomyFieldBlock } from './taxonomyEmbed'
import { mergeDatasetAnalytics } from './datasetAnalytics'
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

// Streaming accumulator behind aggregateTaxonomy, so the paged rollup read can
// fold each page in without buffering every classified row.
interface TaxonomyAcc {
  n: number
  axisCount: Record<string, number>
  subCount: Record<string, number>
  subPos: Record<string, number>
  subNeg: Record<string, number>
  alertCount: Record<string, number>
  // avg-rating accumulators: [sum, count] of the rating field over matching rows
  axisRatS: Record<string, number>; axisRatN: Record<string, number>
  subRatS: Record<string, number>;  subRatN: Record<string, number>
  overallRatS: number; overallRatN: number
  withSignal: number; alertRows: number
}

function newTaxonomyAcc(): TaxonomyAcc {
  return {
    n: 0, axisCount: {}, subCount: {}, subPos: {}, subNeg: {}, alertCount: {},
    axisRatS: {}, axisRatN: {}, subRatS: {}, subRatN: {},
    overallRatS: 0, overallRatN: 0, withSignal: 0, alertRows: 0,
  }
}

function accumulateTaxonomyRow(acc: TaxonomyAcc, r: TaxonomyRow): void {
  acc.n++
  const rv = r.rating != null ? Number(r.rating) : NaN
  const rating = Number.isFinite(rv) ? rv : null
  if (rating != null) { acc.overallRatS += rating; acc.overallRatN++ }
  let any = false
  for (const ax of AXES) {
    const arr = (r as unknown as Record<string, string[]>)['axis_' + ax]
    if (arr && arr.length) {
      any = true
      acc.axisCount[ax] = (acc.axisCount[ax] || 0) + 1
      if (rating != null) { acc.axisRatS[ax] = (acc.axisRatS[ax] || 0) + rating; acc.axisRatN[ax] = (acc.axisRatN[ax] || 0) + 1 }
      for (const sub of arr) {
        const k = ax + ':' + sub
        acc.subCount[k] = (acc.subCount[k] || 0) + 1
        if (rating != null) { acc.subRatS[k] = (acc.subRatS[k] || 0) + rating; acc.subRatN[k] = (acc.subRatN[k] || 0) + 1 }
      }
    }
  }
  if (any) acc.withSignal++
  if (r.alert_tags && r.alert_tags.length) {
    acc.alertRows++
    for (const t of r.alert_tags) acc.alertCount[t] = (acc.alertCount[t] || 0) + 1
  }
  for (const a of r.assertions || []) {
    const k = a.axis + ':' + a.sub
    if (a.polarity === 'pos') acc.subPos[k] = (acc.subPos[k] || 0) + 1
    else if (a.polarity === 'neg') acc.subNeg[k] = (acc.subNeg[k] || 0) + 1
  }
}

function finalizeTaxonomy(acc: TaxonomyAcc, topSubs = 40): TaxonomyRollup {
  const { n, axisCount, subCount, subPos, subNeg, alertCount,
          axisRatS, axisRatN, subRatS, subRatN,
          overallRatS, overallRatN, withSignal, alertRows } = acc
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

/** Pure aggregation over already-fetched taxonomy rows. */
export function aggregateTaxonomy(rows: TaxonomyRow[], topSubs = 40): TaxonomyRollup {
  const acc = newTaxonomyAcc()
  for (const r of rows) accumulateTaxonomyRow(acc, r)
  return finalizeTaxonomy(acc, topSubs)
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

/** Map an embedded field block to the axis-array row shape aggregateTaxonomy
 *  consumes (kept stable so the pure aggregate + its unit tests don't move).
 *  Assertions are cut down to the axis/sub/polarity the aggregate reads — the
 *  block's evidence strings dominate its size and must not be retained when
 *  rows are buffered for trend windows. */
function blockToTaxonomyRow(block: TaxonomyFieldBlock | null): TaxonomyRow {
  return {
    axis_touchpoint: blockAxisSubs(block, 'touchpoint'),
    axis_attribute:  blockAxisSubs(block, 'attribute'),
    axis_product:    blockAxisSubs(block, 'product'),
    axis_beverage:   blockAxisSubs(block, 'beverage'),
    axis_ambiance:   blockAxisSubs(block, 'ambiance'),
    axis_context:    blockAxisSubs(block, 'context'),
    axis_outcome:    blockAxisSubs(block, 'outcome'),
    alert_tags:      block?.al ?? [],
    assertions:      (block?.as ?? []).map(a => ({ axis: a.axis, sub: a.sub, polarity: a.polarity })),
  }
}

/** Paged read + aggregate over the embedded verdicts, for ONE field key. The
 *  taxonomy_rows_for_field RPC returns the block PLUS the row's rating/date
 *  values (same row now — the sidecar version needed two extra lookups per
 *  page); field names are bind params so survey-question keys with spaces or
 *  commas work. Callers gate org access before calling (route contract). */
export async function computeTaxonomyRollup(opts: {
  service: SupabaseClient; datasetId: string; orgId: string; field: string; topSubs?: number
  /** When set, also compute recent/prior-window rollups bucketed by this date
   *  field (the JSONB key, e.g. 'review_date') so dimensions can trend. */
  dateField?: string | null
}): Promise<TaxonomyTrendRollup> {
  const { service, datasetId, orgId, field, topSubs, dateField } = opts

  // Resolve the rating field once (dynamic — supports survey/aliased fields,
  // not just a literal `rating` column). Aliased fields store a text label →
  // resolve via the alias map after the fetch.
  const { field: ratingField, aliases } = await detectRatingField(service, datasetId)

  // Each page folds straight into the accumulator; rows are buffered (lean —
  // no evidence strings) only when a trend date field needs the recent/prior
  // window re-aggregation below.
  const acc = newTaxonomyAcc()
  const dated: TaxonomyRow[] = []
  // Keyset on row_id (sql/155), not OFFSET — an OFFSET page re-walks (and
  // re-detoasts the blob of) every earlier page's rows, O(n²) per rollup.
  let afterId: number | null = null
  for (;;) {
    const { data, error } = await service.rpc('taxonomy_rows_for_field', {
      p_dataset_id: datasetId, p_field_key: field,
      p_rating_field: ratingField, p_date_field: dateField ?? null,
      p_after_id: afterId, p_limit: PAGE,
    })
    if (error) throw new Error(error.message)
    const page = (data ?? []) as { row_id: number; tx: TaxonomyFieldBlock | null; rating_val: string | null; date_val: string | null }[]
    if (page.length === 0) break

    for (const r of page) {
      const row = blockToTaxonomyRow(r.tx)
      const mapped = aliases && r.rating_val != null ? aliases[r.rating_val] : r.rating_val
      const v = mapped != null ? parseFloat(mapped) : NaN
      row.rating = isNaN(v) ? null : v
      if (dateField) {
        const t = r.date_val != null ? Date.parse(String(r.date_val)) : NaN
        row.dateMs = isFinite(t) ? t : null
        dated.push(row)
      }
      accumulateTaxonomyRow(acc, row)
    }

    afterId = page[page.length - 1].row_id
    if (page.length < PAGE) break
  }
  const rollup = finalizeTaxonomy(acc, topSubs)

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
    const ms = dated.map(r => r.dateMs).filter((x): x is number => x != null)
    if (ms.length >= 8) {
      let min = Infinity, max = -Infinity
      for (const t of ms) { if (t < min) min = t; if (t > max) max = t }
      if (max > min) {
        const win = deriveTrendWindows(min, max)
        if (win.recent && win.prior) {
          const inWin = (r: TaxonomyRow, w: { startMs: number; endMs: number }) =>
            r.dateMs != null && r.dateMs >= w.startMs && r.dateMs < w.endMs
          recent = aggregateTaxonomy(dated.filter(r => inWin(r, win.recent!)), topSubs)
          prior  = aggregateTaxonomy(dated.filter(r => inWin(r, win.prior!)), topSubs)
          windowLabel = win.windowLabel
        }
      }
    }
  }

  return { ...rollup, recent, prior, windowLabel }
}

// ── Stored rollups (dataset_state.analytics.taxonomy) ────────────────────────
// Written at classify completion; read by the Dimensions tab route as the fast
// path (no blob scan) and by taxonomy_primary_field (sql/151) to resolve the
// Charts dimension field. Shape:
//   analytics.taxonomy = { fields: { [fieldKey]: StoredTaxonomyField } }

export interface StoredTaxonomyField {
  /** the real field names behind the combined key — reviewSync's auto-classify
   *  safety net re-runs pending classification per entry without parsing the key */
  selFields: string[]
  rollup: TaxonomyRollup
  updatedAt: string
  version: string
}

export interface StoredTaxonomy { fields: Record<string, StoredTaxonomyField> }

/** The stored taxonomy block, or null when the dataset has none. */
export async function readStoredTaxonomy(
  service: SupabaseClient,
  datasetId: string,
): Promise<StoredTaxonomy | null> {
  const { data, error } = await service
    .from('dataset_state').select('analytics').eq('dataset_id', datasetId).maybeSingle()
  if (error) { void logError('taxonomyRollup.readStoredTaxonomy', error); return null }
  const tax = (data?.analytics as { taxonomy?: StoredTaxonomy } | null)?.taxonomy
  return tax && tax.fields && typeof tax.fields === 'object' ? tax : null
}

/** Recompute one field's rollup from the embedded verdicts and store it,
 *  preserving other fields' entries. RMW on the `taxonomy` key only (the
 *  merge RPC is atomic per top-level analytics key; concurrent classifies of
 *  DIFFERENT fields are rare enough that last-writer-wins is acceptable). */
export async function updateStoredTaxonomyRollup(opts: {
  service: SupabaseClient; datasetId: string; orgId: string
  field: string; selFields: string[]
}): Promise<TaxonomyRollup> {
  const { service, datasetId, orgId, field, selFields } = opts
  const { recent: _r, prior: _p, windowLabel: _w, ...rollup } =
    await computeTaxonomyRollup({ service, datasetId, orgId, field })
  const cur = await readStoredTaxonomy(service, datasetId)
  const next: StoredTaxonomy = { fields: { ...(cur?.fields ?? {}) } }
  next.fields[field] = {
    selFields,
    rollup,
    updatedAt: new Date().toISOString(),
    version: TAXONOMY_VERSION,
  }
  await mergeDatasetAnalytics(service, datasetId, { taxonomy: next })
  return rollup
}
