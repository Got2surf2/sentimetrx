// lib/aggregateOps.ts
// Shared server-side aggregation dispatcher — the single implementation behind
// BOTH the charts aggregate route (app/api/datasets/[datasetId]/aggregate) and
// Ana's query_data tool (lib/anaQueryTools). Extracted verbatim from the route
// (2026-09-01) so Ana's numbers are the app's numbers by construction: same
// RPCs, same sampled-vs-exact gating, same collection fan-out, same filter
// row-id semantics. Callers do auth; this module only computes.

import type { createServiceRoleClient } from '@/lib/supabase/server'
import {
  AGG_SAMPLE_CAP,
  sampledCrosstabCounts,
  sampledGroupNumericStats,
  sampledDateSeriesStats,
  sampledCountFieldValues,
  sampledNumericFieldStats,
} from '@/lib/sampledAggregate'
import {
  sampledTaxonomySubCounts,
  sampledTaxonomyGroupStats,
  sampledTaxonomyCrosstab,
  sampledTaxonomyDateSeries,
  sampledTaxonomyAxisCrosstab,
} from '@/lib/sampledTaxonomy'
import { resolveScopeMembers } from '@/lib/collectionScope'

type Service = ReturnType<typeof createServiceRoleClient>

export interface AggregateOpBody {
  op?: string
  rowField?: string
  colField?: string
  groupField?: string
  valueField?: string
  dateField?: string
  metricField?: string
  bucket?: string
  field?: string
  axis?: string
  axisIsRow?: boolean
  limit?: number
  rowIds?: unknown
  /** per-question dimension aggregates (sql/164) — the Charts/Stats source-field picker */
  fieldKey?: string
}

// Shapes of the rows returned by the aggregation SQL functions.
interface CrosstabRow { row_val: string; col_val: string | null; cnt: number }
interface GroupStatsRow { group_val: string; n: number; avg_val: number; median_val: number; min_val: number; max_val: number; stddev_val: number }
interface DateSeriesRow { bucket_date: string; n: number; avg_val: number | null }
interface FieldCountRow { value: string; count: number }
interface TaxGroupStatsRow extends GroupStatsRow { q1_val: number | null; q3_val: number | null }
interface TaxDateSeriesRow { sub_val: string; bucket_date: string; n: number; avg_val: number | null }
interface TaxCrosstabRow { sub_val: string; field_val: string | null; cnt: number }
interface AxisCrosstabRow { axis_val: string; field_val: string | null; cnt: number }

export interface AggregateOpResult {
  status: number
  body: Record<string, unknown>
  /** Set when a DB error occurred — the route logs it via serverError; Ana's
   *  tool executor turns body.error into a tool_result the model can react to. */
  errAt?: string
  errRaw?: unknown
}

function dbError(errRaw: unknown, at: string): AggregateOpResult {
  return { status: 500, body: { error: 'Aggregation failed' }, errAt: at, errRaw }
}

export const TAX_AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome', 'emotion']

export async function runAggregateOp(
  service: Service,
  datasetId: string,
  meta: { rowCount: number; source: string },
  body: AggregateOpBody,
): Promise<AggregateOpResult> {
  var op = body.op

  // Stored row_count (O(1)) gates the sampled path. Above the 50K cap every
  // exact scalar/taxonomy RPC is an O(N) jsonb scan that 57014s at ~1M rows;
  // below it, exact is fast and stays exact. Collections never take the
  // sampled path — the twins walk a single dataset id — they fan out exact
  // over the members (see scalarRowsOverMembers / taxRowsOverScope below).
  var rowCount = Number(meta.rowCount) || 0
  var useSampled = rowCount > AGG_SAMPLE_CAP
  var isCollection = meta.source === 'collection'

  // Optional filtered row-id set (the filtered view). null = whole dataset;
  // else restrict the aggregate to those flat row ids. Sanitized to finite
  // numbers. The client (ChartsModule) sends this whenever filters are active,
  // capped at its 50K row sample — so on an above-cap dataset the filtered ids
  // are themselves a subset of the deterministic sample the twins walk.
  var filterRowIds: number[] | null = Array.isArray(body.rowIds)
    ? (body.rowIds.filter(function(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) }).slice(0, 200000))
    : null
  if (filterRowIds && filterRowIds.length === 0) filterRowIds = null

  // Exact scalar RPC with filter-awareness (Brief F escalation): append
  // p_row_ids when filters are active, and drop it on PGRST202 so an
  // un-migrated database (pre-sql/169) still answers (filters ignored, the
  // pre-fix behavior) instead of erroring. Deploy-order safe.
  async function scalarRpc(fn: string, args: Record<string, unknown>) {
    if (filterRowIds) {
      var r = await service.rpc(fn, { ...args, p_row_ids: filterRowIds })
      if (!r.error || r.error.code !== 'PGRST202') return r
    }
    return service.rpc(fn, args)
  }

  // A collection holds no rows of its own, so every scalar RPC keyed on the
  // collection's id answers zero — Ana's server-side query tools hit exactly
  // that (owner-hit 2026-09-04: 8 ops, all empty, on a 42K-row collection;
  // the Charts tab never noticed because it computes client-side over rows
  // the rows route already fans out). Run the RPC per member and merge in JS
  // (per-member calls keep idx_drf_id_keyset; an IN() list loses it).
  async function scalarRowsOverMembers<T>(fn: string, args: Record<string, unknown>): Promise<{ rows: T[] | null; label?: (string | null)[]; error: unknown }> {
    var members = await resolveScopeMembers(service, datasetId)
    var out: T[] = []
    var labels: (string | null)[] = []
    for (var mm of members) {
      var r = await scalarRpc(fn, { ...args, p_dataset_id: mm.datasetId })
      if (r.error) return { rows: null, error: r.error }
      var rws = (r.data || []) as T[]
      out = out.concat(rws)
      rws.forEach(function() { labels.push(mm.label) })
    }
    return { rows: out, label: labels, error: null }
  }

  // Merge per-member numeric stat rows exactly: n sums, min/max extremes,
  // mean is count-weighted, stddev pools via combined sum-of-squares
  // (SS_i = (n_i-1)s_i^2, cross term n_i(m_i-M)^2 — exact, not approximate).
  // The MEDIAN of a union is NOT derivable from per-member medians: keep it
  // only when a single member holds all the values, else null — never guess.
  function mergeNumericStats(parts: { n: number; min_val: number | null; max_val: number | null; avg_val: number | null; median_val: number | null; stddev_val: number | null }[]) {
    var live = parts.filter(function(s) { return Number(s.n) > 0 })
    if (live.length === 0) return null
    if (live.length === 1) {
      var o = live[0]
      return { n: Number(o.n), min: o.min_val != null ? Number(o.min_val) : null, max: o.max_val != null ? Number(o.max_val) : null, avg: o.avg_val != null ? Number(o.avg_val) : null, median: o.median_val != null ? Number(o.median_val) : null, stddev: o.stddev_val != null ? Number(o.stddev_val) : null }
    }
    var N = 0, wsum = 0
    var mn: number | null = null, mx: number | null = null
    live.forEach(function(s) {
      var n = Number(s.n); N += n
      if (s.avg_val != null) wsum += n * Number(s.avg_val)
      if (s.min_val != null) mn = mn == null ? Number(s.min_val) : Math.min(mn, Number(s.min_val))
      if (s.max_val != null) mx = mx == null ? Number(s.max_val) : Math.max(mx, Number(s.max_val))
    })
    var M = N > 0 ? wsum / N : null
    var ss = 0, ssOk = M != null
    live.forEach(function(s) {
      var n = Number(s.n)
      if (s.stddev_val == null || s.avg_val == null || M == null) { ssOk = false; return }
      var sd = Number(s.stddev_val), m = Number(s.avg_val)
      ss += (n - 1) * sd * sd + n * (m - M) * (m - M)
    })
    return { n: N, min: mn, max: mx, avg: M, median: null, stddev: ssOk && N > 1 ? Math.sqrt(ss / (N - 1)) : null }
  }

  // ── crosstab: row_field × col_field counts ──
  if (op === 'crosstab') {
    var { rowField, colField, limit } = body
    if (!rowField || !colField) return { status: 400, body: { error: 'rowField and colField required' } }
    var xtRows: CrosstabRow[] | null = null
    var xtSampled = false
    if (useSampled && !isCollection) {
      try { var xs = await sampledCrosstabCounts(service, datasetId, rowField, colField, limit || 50, rowCount, filterRowIds); xtRows = xs.rows as CrosstabRow[]; xtSampled = true } catch { /* fall through to exact */ }
    }
    if (!xtRows && isCollection) {
      var xtm = await scalarRowsOverMembers<CrosstabRow>('crosstab_counts', { p_row_field: rowField, p_col_field: colField, p_limit: limit || 50 })
      if (xtm.error) return dbError(xtm.error, 'datasets.aggregate.crosstab')
      xtRows = xtm.rows
    }
    if (!xtRows) {
      var xt = await scalarRpc('crosstab_counts', { p_dataset_id: datasetId, p_row_field: rowField, p_col_field: colField, p_limit: limit || 50 })
      if (xt.error) return dbError(xt.error, 'datasets.aggregate.crosstab')
      xtRows = (xt.data || []) as CrosstabRow[]
    }
    // Reshape into grid
    var grid: Record<string, Record<string, number>> = {}
    var colSet = new Set<string>()
    ;(xtRows || []).forEach(function(r: CrosstabRow) {
      if (!grid[r.row_val]) grid[r.row_val] = {}
      grid[r.row_val][r.col_val || '(blank)'] = (grid[r.row_val][r.col_val || '(blank)'] || 0) + Number(r.cnt)
      colSet.add(r.col_val || '(blank)')
    })
    return { status: 200, body: { grid: grid, rows: Object.keys(grid), cols: Array.from(colSet), sampled: xtSampled } }
  }

  // ── group_stats: numeric stats grouped by a categorical field ──
  if (op === 'group_stats') {
    var { groupField, valueField } = body
    if (!groupField || !valueField) return { status: 400, body: { error: 'groupField and valueField required' } }
    var gsRows: GroupStatsRow[] | null = null
    var gsSampled = false
    if (useSampled && !isCollection) {
      try { var gss = await sampledGroupNumericStats(service, datasetId, groupField, valueField, rowCount, filterRowIds); gsRows = gss.rows as unknown as GroupStatsRow[]; gsSampled = true } catch { /* fall through */ }
    }
    if (!gsRows && isCollection) {
      // '_collection_label' ("Source Dataset") is synthetic — never stored on
      // member rows — so grouping by it in SQL yields nothing. Each member IS
      // one group: run the single-field stats per member instead.
      if (groupField === '_collection_label') {
        var glMembers = await resolveScopeMembers(service, datasetId)
        var glGroups: Record<string, { n: number; mean: number | null; median: number | null; min: number | null; max: number | null; stddev: number | null }> = {}
        for (var glm of glMembers) {
          var gl = await scalarRpc('numeric_field_stats', { p_dataset_id: glm.datasetId, p_field_key: valueField })
          if (gl.error) return dbError(gl.error, 'datasets.aggregate.groupStats')
          var glRow = ((gl.data || [])[0] as { n: number; min_val: number | null; max_val: number | null; avg_val: number | null; median_val: number | null; stddev_val: number | null } | undefined)
          if (glRow && Number(glRow.n) > 0) {
            glGroups[glm.label || glm.datasetId] = { n: Number(glRow.n), mean: glRow.avg_val != null ? Number(glRow.avg_val) : null, median: glRow.median_val != null ? Number(glRow.median_val) : null, min: glRow.min_val != null ? Number(glRow.min_val) : null, max: glRow.max_val != null ? Number(glRow.max_val) : null, stddev: glRow.stddev_val != null ? Number(glRow.stddev_val) : null }
          }
        }
        return { status: 200, body: { groups: glGroups, sampled: false } }
      }
      var gsm = await scalarRowsOverMembers<GroupStatsRow>('group_numeric_stats', { p_group_field: groupField, p_value_field: valueField })
      if (gsm.error) return dbError(gsm.error, 'datasets.aggregate.groupStats')
      // Same group value can arrive from several members — merge exactly
      // (weighted mean, pooled stddev; a cross-member median would be a guess,
      // so it is null unless one member holds all the group's values).
      var byGroup: Record<string, GroupStatsRow[]> = {}
      ;(gsm.rows || []).forEach(function(r) { (byGroup[r.group_val] = byGroup[r.group_val] || []).push(r) })
      var mgGroups: Record<string, { n: number; mean: number | null; median: number | null; min: number | null; max: number | null; stddev: number | null }> = {}
      Object.keys(byGroup).forEach(function(gv) {
        var merged = mergeNumericStats(byGroup[gv])
        if (merged) mgGroups[gv] = { n: merged.n, mean: merged.avg, median: merged.median, min: merged.min, max: merged.max, stddev: merged.stddev }
      })
      return { status: 200, body: { groups: mgGroups, sampled: false, medianNote: Object.keys(byGroup).length ? 'medians spanning multiple member datasets are omitted (not derivable from per-member aggregates)' : undefined } }
    }
    if (!gsRows) {
      var gs = await scalarRpc('group_numeric_stats', { p_dataset_id: datasetId, p_group_field: groupField, p_value_field: valueField })
      if (gs.error) return dbError(gs.error, 'datasets.aggregate.groupStats')
      gsRows = (gs.data || []) as GroupStatsRow[]
    }
    var groups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number }> = {}
    ;(gsRows || []).forEach(function(r: GroupStatsRow) {
      groups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val) }
    })
    return { status: 200, body: { groups: groups, sampled: gsSampled } }
  }

  // ── date_series: time-bucketed counts/averages ──
  if (op === 'date_series') {
    var { dateField, metricField, bucket } = body
    if (!dateField) return { status: 400, body: { error: 'dateField required' } }
    var dsRows: DateSeriesRow[] | null = null
    var dsSampled = false
    if (useSampled && !isCollection) {
      try { var dss = await sampledDateSeriesStats(service, datasetId, dateField, metricField || null, bucket || 'day', rowCount, filterRowIds); dsRows = dss.rows as DateSeriesRow[]; dsSampled = true } catch { /* fall through */ }
    }
    if (!dsRows && isCollection) {
      var dsm = await scalarRowsOverMembers<DateSeriesRow>('date_series_stats', { p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day' })
      if (dsm.error) return dbError(dsm.error, 'datasets.aggregate.dateSeries')
      // Same bucket arrives once per member — sum counts, weight averages.
      var byBucket: Record<string, { n: number; wsum: number; hasAvg: boolean }> = {}
      ;(dsm.rows || []).forEach(function(r) {
        var b = byBucket[r.bucket_date] = byBucket[r.bucket_date] || { n: 0, wsum: 0, hasAvg: false }
        b.n += Number(r.n)
        if (r.avg_val != null) { b.wsum += Number(r.n) * Number(r.avg_val); b.hasAvg = true }
      })
      dsRows = Object.keys(byBucket).sort().map(function(d) {
        var b = byBucket[d]
        return { bucket_date: d, n: b.n, avg_val: b.hasAvg && b.n > 0 ? b.wsum / b.n : null }
      })
    }
    if (!dsRows) {
      var ds = await scalarRpc('date_series_stats', { p_dataset_id: datasetId, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day' })
      if (ds.error) return dbError(ds.error, 'datasets.aggregate.dateSeries')
      dsRows = (ds.data || []) as DateSeriesRow[]
    }
    return {
      status: 200,
      body: {
        series: (dsRows || []).map(function(r: DateSeriesRow) { return { date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
        sampled: dsSampled,
      },
    }
  }

  // ── field_counts: value counts for a single field (alias for existing SQL fn) ──
  if (op === 'field_counts') {
    var { field, limit } = body
    if (!field) return { status: 400, body: { error: 'field required' } }
    var fcRows: FieldCountRow[] | null = null
    var fcSampled = false
    if (useSampled && !isCollection) {
      try { var fcs = await sampledCountFieldValues(service, datasetId, field, limit || 200, rowCount, filterRowIds); fcRows = fcs.rows as FieldCountRow[]; fcSampled = true } catch { /* fall through */ }
    }
    if (!fcRows && isCollection) {
      var fcm = await scalarRowsOverMembers<FieldCountRow>('count_field_values', { p_field_key: field, p_limit: limit || 200 })
      if (fcm.error) return dbError(fcm.error, 'datasets.aggregate.fieldCounts')
      fcRows = fcm.rows
    }
    if (!fcRows) {
      var fc = await scalarRpc('count_field_values', { p_dataset_id: datasetId, p_field_key: field, p_limit: limit || 200 })
      if (fc.error) return dbError(fc.error, 'datasets.aggregate.fieldCounts')
      fcRows = (fc.data || []) as FieldCountRow[]
    }
    var counts: Record<string, number> = {}
    ;(fcRows || []).forEach(function(r: FieldCountRow) { counts[r.value] = (counts[r.value] || 0) + Number(r.count) })
    return { status: 200, body: { counts: counts, sampled: fcSampled } }
  }

  // ── numeric_stats: stats for a single field (alias for existing SQL fn) ──
  if (op === 'numeric_stats') {
    var { field } = body
    if (!field) return { status: 400, body: { error: 'field required' } }
    var nsRow: { n: number; min_val: number | null; max_val: number | null; avg_val: number | null; median_val: number | null; stddev_val: number | null } | null = null
    var nsSampled = false
    if (useSampled && !isCollection) {
      try { var nss = await sampledNumericFieldStats(service, datasetId, field, rowCount, filterRowIds); nsRow = nss.rows; nsSampled = true } catch { /* fall through */ }
    }
    if (!nsSampled && isCollection) {
      var nsm = await scalarRowsOverMembers<NonNullable<typeof nsRow>>('numeric_field_stats', { p_field_key: field })
      if (nsm.error) return dbError(nsm.error, 'datasets.aggregate.numericStats')
      var nsMerged = mergeNumericStats(nsm.rows || [])
      if (!nsMerged) return { status: 200, body: { n: 0, min: null, max: null, avg: null, median: null, stddev: null, sampled: false } }
      return { status: 200, body: { ...nsMerged, sampled: false, medianNote: nsMerged.median == null ? 'median omitted — the values span multiple member datasets and a union median is not derivable from per-member aggregates' : undefined } }
    }
    if (!nsSampled) {
      var ns = await scalarRpc('numeric_field_stats', { p_dataset_id: datasetId, p_field_key: field })
      if (ns.error) return dbError(ns.error, 'datasets.aggregate.numericStats')
      nsRow = ((ns.data || [])[0] as typeof nsRow) || null
    }
    // Sampled path scanned the sample and found no numeric values → an honest
    // n:0 (not a 404); the exact path's 404 is kept for a truly empty dataset.
    if (!nsRow) {
      if (nsSampled) return { status: 200, body: { n: 0, min: null, max: null, avg: null, median: null, stddev: null, sampled: true } }
      return { status: 404, body: { error: 'No data' } }
    }
    return { status: 200, body: { n: Number(nsRow.n), min: Number(nsRow.min_val), max: Number(nsRow.max_val), avg: Number(nsRow.avg_val), median: Number(nsRow.median_val), stddev: Number(nsRow.stddev_val), sampled: nsSampled } }
  }

  // ── Taxonomy ("Dimensions") aggregations — group by a multi-value axis ──
  // axis subs come from the verdicts embedded in data._tx (sql/151); a row tagged
  // with several subs counts in each. Responses mirror the scalar ops above so
  // chart components consume them unchanged.

  // Filtered row-id set shared with the scalar ops above (parsed once at the
  // top as filterRowIds). null = whole dataset; else restrict to those ids.
  var taxRowIds: number[] | null = filterRowIds

  // Per-question dimension aggregates (sql/164): the client's fieldKey (the
  // Charts/Stats source-field picker) rides into every tax_* RPC; the SQL
  // falls back to the primary classified field when that question has no
  // classification. Retry WITHOUT the param on PGRST202 — the pre-164
  // signatures don't know it yet (deploy-order safety, same pattern as the
  // sampled signal counts).
  var taxFieldKey: string | null = typeof body.fieldKey === 'string' && body.fieldKey.trim() ? body.fieldKey.trim() : null
  async function taxRpc(fn: string, args: Record<string, unknown>) {
    if (taxFieldKey) {
      var r = await service.rpc(fn, { ...args, p_field_key: taxFieldKey })
      if (!r.error || r.error.code !== 'PGRST202') return r
    }
    return service.rpc(fn, args)
  }

  // A collection holds no rows of its own — run the RPC over its members and
  // concatenate. Safe only for the pure-COUNT crosstab ops (the grids below sum
  // the per-member cnt); tax_group_stats' median/stddev can't be merged from
  // per-member aggregates, and nothing asks it for a collection. Always exact:
  // the sampled twins take a single dataset id, so a collection can't use them.
  //
  // `_collection_label` ("Source Dataset", the headline breakdown for a
  // collection) is synthetic — the rows route stamps it on at read time and it
  // is never stored on a member's rows, so grouping by it in SQL yields one
  // (blank) bucket. Each fan-out call already IS one member, so the label is
  // stamped onto its rows here instead.
  async function taxRowsOverScope<T extends object>(fn: string, args: Record<string, unknown>) {
    var members = isCollection
      ? await resolveScopeMembers(service, datasetId)
      : [{ datasetId: datasetId, label: null }]
    var labelByMember = isCollection && args.p_field === '_collection_label'
    var out: T[] = []
    for (var m of members) {
      var r = await taxRpc(fn, { ...args, p_dataset_id: m.datasetId })
      if (r.error) return { rows: null, error: r.error }
      var rows = (r.data || []) as T[]
      var lbl = m.label
      if (labelByMember) rows = rows.map(row => ({ ...row, field_val: lbl } as T))
      out = out.concat(rows)
    }
    return { rows: out, error: null }
  }

  if (op === 'tax_counts') {
    var { axis } = body
    if (!axis || !TAX_AXES.includes(axis)) return { status: 400, body: { error: 'invalid axis' } }
    var tcRows: FieldCountRow[] | null = null
    var tcSampled = false
    if (useSampled && !isCollection) {
      try { var tcs = await sampledTaxonomySubCounts(service, datasetId, axis, taxFieldKey, rowCount, taxRowIds); tcRows = tcs.rows as FieldCountRow[]; tcSampled = true } catch { /* fall through to exact */ }
    }
    if (!tcRows) {
      var tcResp = await taxRowsOverScope<FieldCountRow>('taxonomy_sub_counts', { p_axis: axis, p_row_ids: taxRowIds })
      if (tcResp.error) return dbError(tcResp.error, 'datasets.aggregate.taxCounts')
      tcRows = tcResp.rows
    }
    var counts2: Record<string, number> = {}
    ;(tcRows || []).forEach(function(r: FieldCountRow) { counts2[r.value] = (counts2[r.value] || 0) + Number(r.count) })
    return { status: 200, body: { counts: counts2, sampled: tcSampled } }
  }

  if (op === 'tax_group_stats') {
    var { axis, valueField } = body
    if (!axis || !TAX_AXES.includes(axis)) return { status: 400, body: { error: 'invalid axis' } }
    if (!valueField) return { status: 400, body: { error: 'valueField required' } }
    var tgRows: TaxGroupStatsRow[] | null = null
    var tgSampled = false
    if (useSampled && !isCollection) {
      try { var tgs = await sampledTaxonomyGroupStats(service, datasetId, axis, valueField, taxFieldKey, rowCount, taxRowIds); tgRows = tgs.rows as unknown as TaxGroupStatsRow[]; tgSampled = true } catch { /* fall through */ }
    }
    if (!tgRows && isCollection) {
      var tgResp = await taxRowsOverScope<TaxGroupStatsRow>('taxonomy_group_stats', { p_axis: axis, p_value_field: valueField, p_row_ids: taxRowIds })
      if (tgResp.error) return dbError(tgResp.error, 'datasets.aggregate.taxGroupStats')
      // Same sub can arrive from several members — merge exactly (weighted
      // mean, pooled stddev); union medians/quartiles are not derivable from
      // per-member aggregates, so they are null unless one member holds all.
      var tgByGroup: Record<string, TaxGroupStatsRow[]> = {}
      ;(tgResp.rows || []).forEach(function(r) { (tgByGroup[r.group_val] = tgByGroup[r.group_val] || []).push(r) })
      var tgMerged: Record<string, { n: number; mean: number | null; median: number | null; min: number | null; max: number | null; stddev: number | null; q1: number | null; q3: number | null }> = {}
      Object.keys(tgByGroup).forEach(function(gv) {
        var parts = tgByGroup[gv]
        var mg = mergeNumericStats(parts)
        if (!mg) return
        var solo = parts.filter(function(s) { return Number(s.n) > 0 })
        var soloRow = solo.length === 1 ? solo[0] : null
        tgMerged[gv] = { n: mg.n, mean: mg.avg, median: mg.median, min: mg.min, max: mg.max, stddev: mg.stddev, q1: soloRow && soloRow.q1_val != null ? Number(soloRow.q1_val) : null, q3: soloRow && soloRow.q3_val != null ? Number(soloRow.q3_val) : null }
      })
      return { status: 200, body: { groups: tgMerged, sampled: false } }
    }
    if (!tgRows) {
      var { data, error } = await taxRpc('taxonomy_group_stats', { p_dataset_id: datasetId, p_axis: axis, p_value_field: valueField, p_row_ids: taxRowIds })
      if (error) return dbError(error, 'datasets.aggregate.taxGroupStats')
      tgRows = (data || []) as TaxGroupStatsRow[]
    }
    var taxGroups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number; q1: number | null; q3: number | null }> = {}
    ;(tgRows || []).forEach(function(r: TaxGroupStatsRow) {
      taxGroups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val), q1: r.q1_val != null ? Number(r.q1_val) : null, q3: r.q3_val != null ? Number(r.q3_val) : null }
    })
    return { status: 200, body: { groups: taxGroups, sampled: tgSampled } }
  }

  if (op === 'tax_date_series') {
    var { axis, dateField, metricField, bucket } = body
    if (!axis || !TAX_AXES.includes(axis)) return { status: 400, body: { error: 'invalid axis' } }
    if (!dateField) return { status: 400, body: { error: 'dateField required' } }
    var tdRows: TaxDateSeriesRow[] | null = null
    var tdSampled = false
    if (useSampled && !isCollection) {
      try { var tds = await sampledTaxonomyDateSeries(service, datasetId, axis, dateField, metricField || null, bucket || 'day', taxFieldKey, rowCount, taxRowIds); tdRows = tds.rows as TaxDateSeriesRow[]; tdSampled = true } catch { /* fall through */ }
    }
    if (!tdRows && isCollection) {
      var tdResp = await taxRowsOverScope<TaxDateSeriesRow>('taxonomy_date_series', { p_axis: axis, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day', p_row_ids: taxRowIds })
      if (tdResp.error) return dbError(tdResp.error, 'datasets.aggregate.taxDateSeries')
      // Same (sub, bucket) arrives once per member — sum counts, weight avgs.
      var tdByKey: Record<string, { sub: string; date: string; n: number; wsum: number; hasAvg: boolean }> = {}
      ;(tdResp.rows || []).forEach(function(r) {
        var k = r.sub_val + '\u0001' + r.bucket_date
        var b = tdByKey[k] = tdByKey[k] || { sub: r.sub_val, date: r.bucket_date, n: 0, wsum: 0, hasAvg: false }
        b.n += Number(r.n)
        if (r.avg_val != null) { b.wsum += Number(r.n) * Number(r.avg_val); b.hasAvg = true }
      })
      tdRows = Object.keys(tdByKey).sort().map(function(k) {
        var b = tdByKey[k]
        return { sub_val: b.sub, bucket_date: b.date, n: b.n, avg_val: b.hasAvg && b.n > 0 ? b.wsum / b.n : null }
      })
    }
    if (!tdRows) {
      var { data, error } = await taxRpc('taxonomy_date_series', { p_dataset_id: datasetId, p_axis: axis, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day', p_row_ids: taxRowIds })
      if (error) return dbError(error, 'datasets.aggregate.taxDateSeries')
      tdRows = (data || []) as TaxDateSeriesRow[]
    }
    return {
      status: 200,
      body: {
        series: (tdRows || []).map(function(r: TaxDateSeriesRow) { return { sub: r.sub_val, date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
        sampled: tdSampled,
      },
    }
  }

  if (op === 'tax_crosstab') {
    // axis sub on one side, a scalar field on the other. axisIsRow controls
    // which side the dimension lands on in the returned grid.
    var { axis, field, axisIsRow, limit } = body
    if (!axis || !TAX_AXES.includes(axis)) return { status: 400, body: { error: 'invalid axis' } }
    if (!field) return { status: 400, body: { error: 'field required' } }
    var tcxRows: TaxCrosstabRow[] | null = null
    var tcxSampled = false
    if (useSampled && !isCollection) {
      try { var tcxs = await sampledTaxonomyCrosstab(service, datasetId, axis, field, taxFieldKey, limit || 50, rowCount, taxRowIds); tcxRows = tcxs.rows as TaxCrosstabRow[]; tcxSampled = true } catch { /* fall through */ }
    }
    if (!tcxRows) {
      // p_limit is the SQL's per-call top-N of sub-buckets, so on a collection
      // the merged grid is the union of each member's top-N — the tail beyond a
      // member's cut-off is that member's only.
      var tcx = await taxRowsOverScope<TaxCrosstabRow>('taxonomy_crosstab', { p_axis: axis, p_field: field, p_limit: limit || 50, p_row_ids: taxRowIds })
      if (tcx.error) return dbError(tcx.error, 'datasets.aggregate.taxCrosstab')
      tcxRows = tcx.rows
    }
    var txGrid: Record<string, Record<string, number>> = {}
    var txColSet = new Set<string>()
    ;(tcxRows || []).forEach(function(r: TaxCrosstabRow) {
      var rowKey = axisIsRow ? r.sub_val : (r.field_val || '(blank)')
      var colKey = axisIsRow ? (r.field_val || '(blank)') : r.sub_val
      if (!txGrid[rowKey]) txGrid[rowKey] = {}
      // += so the per-member rows of a collection's fan-out add up.
      txGrid[rowKey][colKey] = (txGrid[rowKey][colKey] || 0) + Number(r.cnt)
      txColSet.add(colKey)
    })
    return { status: 200, body: { grid: txGrid, rows: Object.keys(txGrid), cols: Array.from(txColSet), sampled: tcxSampled } }
  }

  if (op === 'tax_axis_crosstab') {
    // Top-level crosstab: all seven axes (the dimension "categories") on one
    // side, a scalar field on the other. Same returned shape as tax_crosstab
    // (rowKey = axis name when axisIsRow) so the Compare view can swap between
    // the axis-level overview and a single axis's sub-level drill seamlessly.
    var { field: axField, axisIsRow: axIsRow } = body
    if (!axField) return { status: 400, body: { error: 'field required' } }
    var axRows: AxisCrosstabRow[] | null = null
    var axSampled = false
    if (useSampled && !isCollection) {
      try { var axs = await sampledTaxonomyAxisCrosstab(service, datasetId, axField, taxFieldKey, rowCount, taxRowIds); axRows = axs.rows as AxisCrosstabRow[]; axSampled = true } catch { /* fall through */ }
    }
    if (!axRows) {
      var axResp = await taxRowsOverScope<AxisCrosstabRow>('taxonomy_axis_crosstab', { p_field: axField, p_row_ids: taxRowIds })
      if (axResp.error) return dbError(axResp.error, 'datasets.aggregate.taxAxisCrosstab')
      axRows = axResp.rows
    }
    var axGrid: Record<string, Record<string, number>> = {}
    var axColSet = new Set<string>()
    ;(axRows || []).forEach(function(r: AxisCrosstabRow) {
      var rowKey = axIsRow ? r.axis_val : (r.field_val || '(blank)')
      var colKey = axIsRow ? (r.field_val || '(blank)') : r.axis_val
      if (!axGrid[rowKey]) axGrid[rowKey] = {}
      // += so the per-member rows of a collection's fan-out add up.
      axGrid[rowKey][colKey] = (axGrid[rowKey][colKey] || 0) + Number(r.cnt)
      axColSet.add(colKey)
    })
    return { status: 200, body: { grid: axGrid, rows: Object.keys(axGrid), cols: Array.from(axColSet), sampled: axSampled } }
  }

  return { status: 400, body: { error: 'Unknown op: ' + op } }
}
