// app/api/datasets/[datasetId]/aggregate/route.ts
// Server-side aggregation for charts — eliminates fetching all rows to browser.
// Uses SQL functions on dataset_rows_flat for O(1) chart rendering at any scale.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

type Params = { params: Promise<{ datasetId: string }> }

async function authCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ctx = await getCallerOrgContext(supabase)
  return { user: ctx.userId ? { id: ctx.userId } as any : null, orgId: ctx.orgId, isAdmin: ctx.isAdmin }
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  var supabase = await createClient()
  var auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data: dsCheck } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  var body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  var op = body.op
  var service = createServiceRoleClient()

  // ── crosstab: row_field × col_field counts ──
  if (op === 'crosstab') {
    var { rowField, colField, limit } = body
    if (!rowField || !colField) return NextResponse.json({ error: 'rowField and colField required' }, { status: 400 })
    var { data, error } = await service.rpc('crosstab_counts', {
      p_dataset_id: params.datasetId, p_row_field: rowField, p_col_field: colField, p_limit: limit || 50,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Reshape into grid
    var grid: Record<string, Record<string, number>> = {}
    var colSet = new Set<string>()
    ;(data || []).forEach(function(r: any) {
      if (!grid[r.row_val]) grid[r.row_val] = {}
      grid[r.row_val][r.col_val || '(blank)'] = Number(r.cnt)
      colSet.add(r.col_val || '(blank)')
    })
    return NextResponse.json({ grid: grid, rows: Object.keys(grid), cols: Array.from(colSet) })
  }

  // ── group_stats: numeric stats grouped by a categorical field ──
  if (op === 'group_stats') {
    var { groupField, valueField } = body
    if (!groupField || !valueField) return NextResponse.json({ error: 'groupField and valueField required' }, { status: 400 })
    var { data, error } = await service.rpc('group_numeric_stats', {
      p_dataset_id: params.datasetId, p_group_field: groupField, p_value_field: valueField,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var groups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number }> = {}
    ;(data || []).forEach(function(r: any) {
      groups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val) }
    })
    return NextResponse.json({ groups: groups })
  }

  // ── date_series: time-bucketed counts/averages ──
  if (op === 'date_series') {
    var { dateField, metricField, bucket } = body
    if (!dateField) return NextResponse.json({ error: 'dateField required' }, { status: 400 })
    var { data, error } = await service.rpc('date_series_stats', {
      p_dataset_id: params.datasetId, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day',
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      series: (data || []).map(function(r: any) { return { date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
    })
  }

  // ── field_counts: value counts for a single field (alias for existing SQL fn) ──
  if (op === 'field_counts') {
    var { field, limit } = body
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var { data, error } = await service.rpc('count_field_values', {
      p_dataset_id: params.datasetId, p_field_key: field, p_limit: limit || 200,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var counts: Record<string, number> = {}
    ;(data || []).forEach(function(r: any) { counts[r.value] = Number(r.count) })
    return NextResponse.json({ counts: counts })
  }

  // ── numeric_stats: stats for a single field (alias for existing SQL fn) ──
  if (op === 'numeric_stats') {
    var { field } = body
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var { data, error } = await service.rpc('numeric_field_stats', {
      p_dataset_id: params.datasetId, p_field_key: field,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var r = (data || [])[0]
    if (!r) return NextResponse.json({ error: 'No data' }, { status: 404 })
    return NextResponse.json({ n: Number(r.n), min: Number(r.min_val), max: Number(r.max_val), avg: Number(r.avg_val), median: Number(r.median_val), stddev: Number(r.stddev_val) })
  }

  // ── Taxonomy ("Dimensions") aggregations — group by a multi-value axis ──
  // axis subs come from dataset_row_taxonomy.axis_<a> (unnested); a row tagged
  // with several subs counts in each. Responses mirror the scalar ops above so
  // chart components consume them unchanged.
  var TAX_AXES = ['touchpoint', 'attribute', 'product', 'beverage', 'ambiance', 'context', 'outcome']

  if (op === 'tax_counts') {
    var { axis } = body
    if (!TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    var { data, error } = await service.rpc('taxonomy_sub_counts', { p_dataset_id: params.datasetId, p_axis: axis })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var counts: Record<string, number> = {}
    ;(data || []).forEach(function(r: any) { counts[r.value] = Number(r.count) })
    return NextResponse.json({ counts: counts })
  }

  if (op === 'tax_group_stats') {
    var { axis, valueField } = body
    if (!TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!valueField) return NextResponse.json({ error: 'valueField required' }, { status: 400 })
    var { data, error } = await service.rpc('taxonomy_group_stats', { p_dataset_id: params.datasetId, p_axis: axis, p_value_field: valueField })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var taxGroups: Record<string, { n: number; mean: number; median: number; min: number; max: number; stddev: number; q1: number | null; q3: number | null }> = {}
    ;(data || []).forEach(function(r: any) {
      taxGroups[r.group_val] = { n: Number(r.n), mean: Number(r.avg_val), median: Number(r.median_val), min: Number(r.min_val), max: Number(r.max_val), stddev: Number(r.stddev_val), q1: r.q1_val != null ? Number(r.q1_val) : null, q3: r.q3_val != null ? Number(r.q3_val) : null }
    })
    return NextResponse.json({ groups: taxGroups })
  }

  if (op === 'tax_date_series') {
    var { axis, dateField, metricField, bucket } = body
    if (!TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!dateField) return NextResponse.json({ error: 'dateField required' }, { status: 400 })
    var { data, error } = await service.rpc('taxonomy_date_series', { p_dataset_id: params.datasetId, p_axis: axis, p_date_field: dateField, p_metric_field: metricField || null, p_bucket: bucket || 'day' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({
      series: (data || []).map(function(r: any) { return { sub: r.sub_val, date: r.bucket_date, count: Number(r.n), avg: r.avg_val != null ? Number(r.avg_val) : null } }),
    })
  }

  if (op === 'tax_crosstab') {
    // axis sub on one side, a scalar field on the other. axisIsRow controls
    // which side the dimension lands on in the returned grid.
    var { axis, field, axisIsRow, limit } = body
    if (!TAX_AXES.includes(axis)) return NextResponse.json({ error: 'invalid axis' }, { status: 400 })
    if (!field) return NextResponse.json({ error: 'field required' }, { status: 400 })
    var { data, error } = await service.rpc('taxonomy_crosstab', { p_dataset_id: params.datasetId, p_axis: axis, p_field: field, p_limit: limit || 50 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    var grid: Record<string, Record<string, number>> = {}
    var colSet = new Set<string>()
    ;(data || []).forEach(function(r: any) {
      var rowKey = axisIsRow ? r.sub_val : (r.field_val || '(blank)')
      var colKey = axisIsRow ? (r.field_val || '(blank)') : r.sub_val
      if (!grid[rowKey]) grid[rowKey] = {}
      grid[rowKey][colKey] = Number(r.cnt)
      colSet.add(colKey)
    })
    return NextResponse.json({ grid: grid, rows: Object.keys(grid), cols: Array.from(colSet) })
  }

  return NextResponse.json({ error: 'Unknown op: ' + op }, { status: 400 })
}
