// app/api/datasets/[datasetId]/aggregate/route.ts
// Server-side aggregation for charts — eliminates fetching all rows to browser.
// Uses SQL functions on dataset_rows_flat for O(1) chart rendering at any scale.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
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

type Params = { params: Promise<{ datasetId: string }> }

interface AggregateBody {
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

async function authCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ctx = await getCallerOrgContext(supabase)
  return { user: ctx.userId ? { id: ctx.userId } : null, orgId: ctx.orgId, isAdmin: ctx.isAdmin }
}

// Aggregation RPCs are O(N) scans; on large datasets a burst of chart specs
// can outlive the default function budget even though each statement stays
// under the DB's 8s timeout. Same budget as the peer dataset routes.
export const maxDuration = 60

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  var supabase = await createClient()
  var auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data: dsCheck } = await supabase.from('datasets').select('org_id, row_count, source').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  var body: AggregateBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  var op = body.op
  var service = createServiceRoleClient()

  // Stored row_count (O(1)) gates the sampled path. Above the 50K cap every
  // exact scalar/taxonomy RPC is an O(N) jsonb scan that 57014s at ~1M rows;
  // below it, exact is fast and stays exact. (Collections don't reach the
  // scalar ops — the client falls back to raw-row client compute for them —
  // but Dimensions › Compare DOES send the two tax crosstabs, which fan out
  // over the members below.)
  var rowCount = Number((dsCheck as { row_count?: number }).row_count) || 0
  var useSampled = rowCount > AGG_SAMPLE_CAP
  var isCollection = (dsCheck as { source?: string }).source === 'collection'

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

  // ── crosstab: row_field × col_field counts ──
  if (op === 'crosstab') {
    var { rowField, colField, limit } = body
    if (!rowField || !colField) return NextResponse.json({ error: 'rowField and colField required' }, { status: 400 })
    var xtRows: CrosstabRow[] | null = null
    var xtSampled = false
    if (useSampled) {
      try { var xs = await sampledCrosstabCounts(service, params.datasetId, rowField, colField, limit || 50, rowCount, filterRowIds); xtRows = xs.rows as CrosstabRow[]; xtSampled = true } catch { /* fall through to exact */ }
    }
    if (!xtRows) {
      var xt = await scalarRpc('crosstab_counts', { p_dataset_id: params.datasetId, p_row_field: rowField, p_col_field: colField, p_limit: limit || 50 })
      if (xt.error) return serverError(xt.error, 'datasets.aggregate.crosstab', { orgId: auth.orgId })
      xtRows = (xt.data || []) as CrosstabRow[]
    }
    // Reshape into grid
    var grid: Record<string, Record<string, number>> = {}
    var colSet = new Set<string>()
    ;(xtRows || []).forEach(function(r: CrosstabRow) {
      if (!grid[r.row_val]) grid[r.row_val] = {}
      grid[r.row_val][r.col_val || '(blank)'] = Number(r.cnt)
      colSet.add(r.col_val || '(blank)')
    })
    return NextResponse.json({ grid: grid, rows: Object.keys(grid), cols: Array.from(colSet), sampled: xtSampled })
  }

  // ── group_stats: numeric stats grouped by a categorical field ──
  if (op === 'group_stats') {
    var { groupField, valueField } = body
    if (!groupField || !valueField) return NextResponse.json({ error: 'groupField and valueField required' }, { status: 400 })
    var gsRows: GroupStatsRow[] | null = null
    var gsSampled = false
    if (useSampled) {
      try { var gss = await sampledGroupNumericStats(service, params.datasetId, groupField, valueField, rowCount, filterRowIds); gsRows = gss.rows as unknown as GroupStatsRow[]; gsSampled = true } catch { /* fall through */ }
    }
    if (!gsRows) {
      var gs = await scalarRpc('group_numeric_stats', { p_dataset_id: params.datasetId, p_group_field: groupField, p_value_field: valueField })
      if (gs.error) return serverError(gs.error, 'datasets.aggregate.groupStats', { orgId: auth.orgId })
      gsRows = (gs.data || []) as GroupStatsRow[]
    }
    var groups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number }> = {}
    ;(gsRows || []).forEach(function(r: GroupStatsRow) {
      groups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val) }
    })
    return NextResponse.json({ groups: groups, sampled: gsSampled })
  }

  // ── date_series: time-bucketed counts/averages ──
  if (op === 'date_series') {
    var { dateField, metricField, bucket } = body
    if (!dateField) return NextResponse.json({ error: 'dateField required' }, { status: 400 })
    var dsRows: DateSeriesRow[] | null = null
    var dsSampled = false
    if (useSampled) {
      try { var dss = await sampledDateSeriesStats(service, params.datasetId, dateField, metricField || null, bucket || 'day', rowCount, filterRowIds); dsRows = dss.rows as DateSeriesRow[]; dsSampled = true } catch { /* fall through */ }
    }
    if (!dsRows) {
      var ds = await scalarRpc('date_series_stats', { p_dataset_id: params.datasetId, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day' })
      if (ds.error) return serverError(ds.error, 'datasets.aggregate.dateSeries', { orgId: auth.orgId })
      dsRows = (ds.data || []) as DateSeriesRow[]
    }
    return NextResponse.json({
      series: (dsRows || []).map(function(r: DateSeriesRow) { return { date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
      sampled: dsSampled,
    })
  }

  // ── field_counts: value counts for a single field (alias for existing SQL fn) ──
  if (op === 'field_counts') {
    var { field, limit } = body
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var fcRows: FieldCountRow[] | null = null
    var fcSampled = false
    if (useSampled) {
      try { var fcs = await sampledCountFieldValues(service, params.datasetId, field, limit || 200, rowCount, filterRowIds); fcRows = fcs.rows as FieldCountRow[]; fcSampled = true } catch { /* fall through */ }
    }
    if (!fcRows) {
      var fc = await scalarRpc('count_field_values', { p_dataset_id: params.datasetId, p_field_key: field, p_limit: limit || 200 })
      if (fc.error) return serverError(fc.error, 'datasets.aggregate.fieldCounts', { orgId: auth.orgId })
      fcRows = (fc.data || []) as FieldCountRow[]
    }
    var counts: Record<string, number> = {}
    ;(fcRows || []).forEach(function(r: FieldCountRow) { counts[r.value] = Number(r.count) })
    return NextResponse.json({ counts: counts, sampled: fcSampled })
  }

  // ── numeric_stats: stats for a single field (alias for existing SQL fn) ──
  if (op === 'numeric_stats') {
    var { field } = body
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var nsRow: { n: number; min_val: number | null; max_val: number | null; avg_val: number | null; median_val: number | null; stddev_val: number | null } | null = null
    var nsSampled = false
    if (useSampled) {
      try { var nss = await sampledNumericFieldStats(service, params.datasetId, field, rowCount, filterRowIds); nsRow = nss.rows; nsSampled = true } catch { /* fall through */ }
    }
    if (!nsSampled) {
      var ns = await scalarRpc('numeric_field_stats', { p_dataset_id: params.datasetId, p_field_key: field })
      if (ns.error) return serverError(ns.error, 'datasets.aggregate.numericStats', { orgId: auth.orgId })
      nsRow = ((ns.data || [])[0] as typeof nsRow) || null
    }
    // Sampled path scanned the sample and found no numeric values → an honest
    // n:0 (not a 404); the exact path's 404 is kept for a truly empty dataset.
    if (!nsRow) {
      if (nsSampled) return NextResponse.json({ n: 0, min: null, max: null, avg: null, median: null, stddev: null, sampled: true })
      return NextResponse.json({ error: 'No data' }, { status: 404 })
    }
    return NextResponse.json({ n: Number(nsRow.n), min: Number(nsRow.min_val), max: Number(nsRow.max_val), avg: Number(nsRow.avg_val), median: Number(nsRow.median_val), stddev: Number(nsRow.stddev_val), sampled: nsSampled })
  }

  // ── Taxonomy ("Dimensions") aggregations — group by a multi-value axis ──
  // axis subs come from the verdicts embedded in data._tx (sql/151); a row tagged
  // with several subs counts in each. Responses mirror the scalar ops above so
  // chart components consume them unchanged.
  var TAX_AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome', 'emotion']

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
  async function taxRowsOverScope<T extends { field_val?: string | null }>(fn: string, args: Record<string, unknown>) {
    var members = isCollection
      ? await resolveScopeMembers(service, params.datasetId)
      : [{ datasetId: params.datasetId, label: null }]
    var labelByMember = isCollection && args.p_field === '_collection_label'
    var out: T[] = []
    for (var m of members) {
      var r = await taxRpc(fn, { ...args, p_dataset_id: m.datasetId })
      if (r.error) return { rows: null, error: r.error }
      var rows = (r.data || []) as T[]
      var lbl = m.label
      if (labelByMember) rows = rows.map(row => ({ ...row, field_val: lbl }))
      out = out.concat(rows)
    }
    return { rows: out, error: null }
  }

  if (op === 'tax_counts') {
    var { axis } = body
    if (!axis || !TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    var tcRows: FieldCountRow[] | null = null
    var tcSampled = false
    if (useSampled) {
      try { var tcs = await sampledTaxonomySubCounts(service, params.datasetId, axis, taxFieldKey, rowCount, taxRowIds); tcRows = tcs.rows as FieldCountRow[]; tcSampled = true } catch { /* fall through to exact */ }
    }
    if (!tcRows) {
      var { data, error } = await taxRpc('taxonomy_sub_counts', { p_dataset_id: params.datasetId, p_axis: axis, p_row_ids: taxRowIds })
      if (error) return serverError(error, 'datasets.aggregate.taxCounts', { orgId: auth.orgId })
      tcRows = (data || []) as FieldCountRow[]
    }
    var counts: Record<string, number> = {}
    ;(tcRows || []).forEach(function(r: FieldCountRow) { counts[r.value] = Number(r.count) })
    return NextResponse.json({ counts: counts, sampled: tcSampled })
  }

  if (op === 'tax_group_stats') {
    var { axis, valueField } = body
    if (!axis || !TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!valueField) return NextResponse.json({ error: 'valueField required' }, { status: 400 })
    var tgRows: TaxGroupStatsRow[] | null = null
    var tgSampled = false
    if (useSampled) {
      try { var tgs = await sampledTaxonomyGroupStats(service, params.datasetId, axis, valueField, taxFieldKey, rowCount, taxRowIds); tgRows = tgs.rows as unknown as TaxGroupStatsRow[]; tgSampled = true } catch { /* fall through */ }
    }
    if (!tgRows) {
      var { data, error } = await taxRpc('taxonomy_group_stats', { p_dataset_id: params.datasetId, p_axis: axis, p_value_field: valueField, p_row_ids: taxRowIds })
      if (error) return serverError(error, 'datasets.aggregate.taxGroupStats', { orgId: auth.orgId })
      tgRows = (data || []) as TaxGroupStatsRow[]
    }
    var taxGroups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number; q1: number | null; q3: number | null }> = {}
    ;(tgRows || []).forEach(function(r: TaxGroupStatsRow) {
      taxGroups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val), q1: r.q1_val != null ? Number(r.q1_val) : null, q3: r.q3_val != null ? Number(r.q3_val) : null }
    })
    return NextResponse.json({ groups: taxGroups, sampled: tgSampled })
  }

  if (op === 'tax_date_series') {
    var { axis, dateField, metricField, bucket } = body
    if (!axis || !TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!dateField) return NextResponse.json({ error: 'dateField required' }, { status: 400 })
    var tdRows: TaxDateSeriesRow[] | null = null
    var tdSampled = false
    if (useSampled) {
      try { var tds = await sampledTaxonomyDateSeries(service, params.datasetId, axis, dateField, metricField || null, bucket || 'day', taxFieldKey, rowCount, taxRowIds); tdRows = tds.rows as TaxDateSeriesRow[]; tdSampled = true } catch { /* fall through */ }
    }
    if (!tdRows) {
      var { data, error } = await taxRpc('taxonomy_date_series', { p_dataset_id: params.datasetId, p_axis: axis, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day', p_row_ids: taxRowIds })
      if (error) return serverError(error, 'datasets.aggregate.taxDateSeries', { orgId: auth.orgId })
      tdRows = (data || []) as TaxDateSeriesRow[]
    }
    return NextResponse.json({
      series: (tdRows || []).map(function(r: TaxDateSeriesRow) { return { sub: r.sub_val, date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
      sampled: tdSampled,
    })
  }

  if (op === 'tax_crosstab') {
    // axis sub on one side, a scalar field on the other. axisIsRow controls
    // which side the dimension lands on in the returned grid.
    var { axis, field, axisIsRow, limit } = body
    if (!axis || !TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var tcxRows: TaxCrosstabRow[] | null = null
    var tcxSampled = false
    if (useSampled && !isCollection) {
      try { var tcxs = await sampledTaxonomyCrosstab(service, params.datasetId, axis, field, taxFieldKey, limit || 50, rowCount, taxRowIds); tcxRows = tcxs.rows as TaxCrosstabRow[]; tcxSampled = true } catch { /* fall through */ }
    }
    if (!tcxRows) {
      // p_limit is the SQL's per-call top-N of sub-buckets, so on a collection
      // the merged grid is the union of each member's top-N — the tail beyond a
      // member's cut-off is that member's only.
      var tcx = await taxRowsOverScope<TaxCrosstabRow>('taxonomy_crosstab', { p_axis: axis, p_field: field, p_limit: limit || 50, p_row_ids: taxRowIds })
      if (tcx.error) return serverError(tcx.error, 'datasets.aggregate.taxCrosstab', { orgId: auth.orgId })
      tcxRows = tcx.rows
    }
    var grid: Record<string, Record<string, number>> = {}
    var colSet = new Set<string>()
    ;(tcxRows || []).forEach(function(r: TaxCrosstabRow) {
      var rowKey = axisIsRow ? r.sub_val : (r.field_val || '(blank)')
      var colKey = axisIsRow ? (r.field_val || '(blank)') : r.sub_val
      if (!grid[rowKey]) grid[rowKey] = {}
      // += so the per-member rows of a collection's fan-out add up.
      grid[rowKey][colKey] = (grid[rowKey][colKey] || 0) + Number(r.cnt)
      colSet.add(colKey)
    })
    return NextResponse.json({ grid: grid, rows: Object.keys(grid), cols: Array.from(colSet), sampled: tcxSampled })
  }

  if (op === 'tax_axis_crosstab') {
    // Top-level crosstab: all seven axes (the dimension "categories") on one
    // side, a scalar field on the other. Same returned shape as tax_crosstab
    // (rowKey = axis name when axisIsRow) so the Compare view can swap between
    // the axis-level overview and a single axis's sub-level drill seamlessly.
    var { field: axField, axisIsRow: axIsRow } = body
    if (!axField) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var axRows: AxisCrosstabRow[] | null = null
    var axSampled = false
    if (useSampled && !isCollection) {
      try { var axs = await sampledTaxonomyAxisCrosstab(service, params.datasetId, axField, taxFieldKey, rowCount, taxRowIds); axRows = axs.rows as AxisCrosstabRow[]; axSampled = true } catch { /* fall through */ }
    }
    if (!axRows) {
      var axResp = await taxRowsOverScope<AxisCrosstabRow>('taxonomy_axis_crosstab', { p_field: axField, p_row_ids: taxRowIds })
      if (axResp.error) return serverError(axResp.error, 'datasets.aggregate.taxAxisCrosstab', { orgId: auth.orgId })
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
    return NextResponse.json({ grid: axGrid, rows: Object.keys(axGrid), cols: Array.from(axColSet), sampled: axSampled })
  }

  return NextResponse.json({ error: 'Unknown op: ' + op }, { status: 400 })
}
