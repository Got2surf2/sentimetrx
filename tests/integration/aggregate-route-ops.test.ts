// tests/integration/aggregate-route-ops.test.ts
//
// Behavior tests for POST /api/datasets/[datasetId]/aggregate — the chart
// aggregation dispatcher. The org gate is covered in
// dataset-query-routes-gate.test.ts; this suite pins the op semantics:
//   - grid/series/stats reshaping per op (incl. null → '(blank)' buckets)
//   - the sampled path gating on row_count > AGG_SAMPLE_CAP, and its
//     throw → exact-RPC fallback
//   - scalarRpc filter-awareness: p_row_ids appended when filters are active,
//     dropped and retried on PGRST202 (deploy-order safety, sql/169)
//   - taxRpc fieldKey passthrough with the same PGRST202 retry (sql/164)
//   - collection fan-out for tax_crosstab: per-member RPCs, counts summed,
//     synthetic _collection_label stamped from the member label

import { describe, it, expect, beforeEach, vi } from 'vitest'

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

const ctx = {
  callerCtx: { userId: 'u1' as string | null, orgId: 'orgA' as string | null, isAdmin: false },
  dataset: { org_id: 'orgA', row_count: 100, source: 'upload' } as Record<string, unknown> | null,
  rpc: ((_name: string, _args: Record<string, unknown>) => ({ data: [], error: null })) as (name: string, args: Record<string, unknown>) => RpcResult,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  members: [] as { datasetId: string; label: string | null }[],
}
function reset() {
  ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
  ctx.dataset = { org_id: 'orgA', row_count: 100, source: 'upload' }
  ctx.rpc = () => ({ data: [], error: null })
  ctx.rpcCalls = []
  ctx.members = []
}

function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'range']) b[m] = () => b
  b.single = async () => ({ data: ctx.dataset, error: null })
  b.maybeSingle = async () => ({ data: ctx.dataset, error: null })
  return b
}
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => builder() }),
  createServiceRoleClient: () => ({
    from: () => builder(),
    rpc: async (name: string, args: Record<string, unknown>) => { ctx.rpcCalls.push({ name, args }); return ctx.rpc(name, args) },
  }),
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/collectionScope', () => ({ resolveScopeMembers: async () => ctx.members }))

const sampledCrosstabCounts = vi.fn()
const sampledNumericFieldStats = vi.fn()
vi.mock('@/lib/sampledAggregate', () => ({
  AGG_SAMPLE_CAP: 50000,
  sampledCrosstabCounts: (...a: unknown[]) => sampledCrosstabCounts(...a),
  sampledGroupNumericStats: vi.fn(),
  sampledDateSeriesStats: vi.fn(),
  sampledCountFieldValues: vi.fn(),
  sampledNumericFieldStats: (...a: unknown[]) => sampledNumericFieldStats(...a),
}))
vi.mock('@/lib/sampledTaxonomy', () => ({
  sampledTaxonomySubCounts: vi.fn(),
  sampledTaxonomyGroupStats: vi.fn(),
  sampledTaxonomyCrosstab: vi.fn(),
  sampledTaxonomyDateSeries: vi.fn(),
  sampledTaxonomyAxisCrosstab: vi.fn(),
}))

import { POST } from '@/app/api/datasets/[datasetId]/aggregate/route'

const props = { params: Promise.resolve({ datasetId: 'd_1' }) }
const post = (body: unknown) => POST(new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }), props)

beforeEach(() => { reset(); vi.clearAllMocks() })

describe('aggregate — crosstab', () => {
  it('reshapes RPC rows into a grid with (blank) buckets, exact path below the cap', async () => {
    ctx.rpc = () => ({ data: [
      { row_val: 'Promoter', col_val: 'East', cnt: 4 },
      { row_val: 'Promoter', col_val: null, cnt: 2 },
      { row_val: 'Detractor', col_val: 'East', cnt: 1 },
    ], error: null })
    const res = await post({ op: 'crosstab', rowField: 'nps', colField: 'region' })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.grid).toEqual({ Promoter: { East: 4, '(blank)': 2 }, Detractor: { East: 1 } })
    expect(j.cols).toEqual(['East', '(blank)'])
    expect(j.sampled).toBe(false)
    expect(ctx.rpcCalls[0].name).toBe('crosstab_counts')
  })

  it('400 when rowField or colField is missing', async () => {
    expect((await post({ op: 'crosstab', rowField: 'nps' })).status).toBe(400)
  })

  it('takes the sampled path above AGG_SAMPLE_CAP without touching the exact RPC', async () => {
    ctx.dataset = { org_id: 'orgA', row_count: 60000, source: 'upload' }
    sampledCrosstabCounts.mockResolvedValue({ rows: [{ row_val: 'A', col_val: 'X', cnt: 7 }] })
    const j = await (await post({ op: 'crosstab', rowField: 'a', colField: 'b' })).json()
    expect(j.sampled).toBe(true)
    expect(j.grid).toEqual({ A: { X: 7 } })
    expect(ctx.rpcCalls).toHaveLength(0)
  })

  it('falls back to the exact RPC when the sampled twin throws', async () => {
    ctx.dataset = { org_id: 'orgA', row_count: 60000, source: 'upload' }
    sampledCrosstabCounts.mockRejectedValue(new Error('57014'))
    ctx.rpc = () => ({ data: [{ row_val: 'A', col_val: 'X', cnt: 1 }], error: null })
    const j = await (await post({ op: 'crosstab', rowField: 'a', colField: 'b' })).json()
    expect(j.sampled).toBe(false)
    expect(j.grid).toEqual({ A: { X: 1 } })
    expect(ctx.rpcCalls.map((c) => c.name)).toEqual(['crosstab_counts'])
  })
})

describe('aggregate — filtered row ids (scalarRpc, sql/169 deploy-order safety)', () => {
  it('sanitizes rowIds to finite numbers and appends p_row_ids', async () => {
    ctx.rpc = () => ({ data: [], error: null })
    await post({ op: 'field_counts', field: 'city', rowIds: [1, 2, 'x', null, 3.5] })
    expect(ctx.rpcCalls[0].args.p_row_ids).toEqual([1, 2, 3.5])
  })

  it('retries WITHOUT p_row_ids when the DB predates sql/169 (PGRST202)', async () => {
    ctx.rpc = (_n, args) =>
      'p_row_ids' in args
        ? { data: null, error: { code: 'PGRST202', message: 'unknown param' } }
        : { data: [{ value: 'Austin', count: 9 }], error: null }
    const j = await (await post({ op: 'field_counts', field: 'city', rowIds: [1, 2] })).json()
    expect(ctx.rpcCalls).toHaveLength(2)
    expect(ctx.rpcCalls[1].args.p_row_ids).toBeUndefined()
    expect(j.counts).toEqual({ Austin: 9 })
  })

  it('treats an empty rowIds array as no filter', async () => {
    await post({ op: 'field_counts', field: 'city', rowIds: [] })
    expect(ctx.rpcCalls[0].args.p_row_ids).toBeUndefined()
  })
})

describe('aggregate — group_stats / date_series / numeric_stats', () => {
  it('maps group stats rows into the keyed groups object', async () => {
    ctx.rpc = () => ({ data: [{ group_val: 'East', n: 10, avg_val: '4.2', median_val: 4, min_val: 1, max_val: 5, stddev_val: 0.8 }], error: null })
    const j = await (await post({ op: 'group_stats', groupField: 'region', valueField: 'rating' })).json()
    expect(j.groups).toEqual({ East: { n: 10, mean: 4.2, median: 4, min: 1, max: 5, stddev: 0.8 } })
  })

  it('maps date series rows, preserving a null avg', async () => {
    ctx.rpc = () => ({ data: [
      { bucket_date: '2026-08-01', n: 3, avg_val: 4.5 },
      { bucket_date: '2026-08-02', n: 2, avg_val: null },
    ], error: null })
    const j = await (await post({ op: 'date_series', dateField: 'review_date' })).json()
    expect(j.series).toEqual([
      { date: '2026-08-01', count: 3, avg: 4.5 },
      { date: '2026-08-02', count: 2, avg: null },
    ])
  })

  it('numeric_stats: maps the exact row; 404 on a truly empty dataset', async () => {
    ctx.rpc = () => ({ data: [{ n: 5, min_val: 1, max_val: 5, avg_val: 3.2, median_val: 3, stddev_val: 1.1 }], error: null })
    const ok = await (await post({ op: 'numeric_stats', field: 'rating' })).json()
    expect(ok).toMatchObject({ n: 5, min: 1, max: 5, avg: 3.2, median: 3, stddev: 1.1, sampled: false })

    ctx.rpc = () => ({ data: [], error: null })
    expect((await post({ op: 'numeric_stats', field: 'rating' })).status).toBe(404)
  })

  it('numeric_stats: a sampled scan with no numeric values answers an honest n:0, not a 404', async () => {
    ctx.dataset = { org_id: 'orgA', row_count: 60000, source: 'upload' }
    sampledNumericFieldStats.mockResolvedValue({ rows: null })
    const res = await post({ op: 'numeric_stats', field: 'rating' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ n: 0, min: null, max: null, avg: null, median: null, stddev: null, sampled: true })
  })
})

describe('aggregate — taxonomy ops', () => {
  it('rejects an axis outside the taxonomy', async () => {
    expect((await post({ op: 'tax_counts', axis: 'vibes' })).status).toBe(400)
  })

  it('passes fieldKey as p_field_key and retries without it on PGRST202 (sql/164)', async () => {
    ctx.rpc = (_n, args) =>
      'p_field_key' in args
        ? { data: null, error: { code: 'PGRST202', message: 'unknown param' } }
        : { data: [{ value: 'speed', count: 6 }], error: null }
    const j = await (await post({ op: 'tax_counts', axis: 'touchpoint', fieldKey: 'q_service' })).json()
    expect(ctx.rpcCalls).toHaveLength(2)
    expect(ctx.rpcCalls[0].args.p_field_key).toBe('q_service')
    expect(ctx.rpcCalls[1].args.p_field_key).toBeUndefined()
    expect(j.counts).toEqual({ speed: 6 })
  })

  it('tax_crosstab reshapes with the axis on the chosen side', async () => {
    ctx.rpc = () => ({ data: [{ sub_val: 'speed', field_val: 'East', cnt: 3 }], error: null })
    const asRow = await (await post({ op: 'tax_crosstab', axis: 'touchpoint', field: 'region', axisIsRow: true })).json()
    expect(asRow.grid).toEqual({ speed: { East: 3 } })
    const asCol = await (await post({ op: 'tax_crosstab', axis: 'touchpoint', field: 'region', axisIsRow: false })).json()
    expect(asCol.grid).toEqual({ East: { speed: 3 } })
  })

  it('fans a collection out over its members, summing counts', async () => {
    ctx.dataset = { org_id: 'orgA', row_count: 100, source: 'collection' }
    ctx.members = [{ datasetId: 'm1', label: 'Store A' }, { datasetId: 'm2', label: 'Store B' }]
    ctx.rpc = (_n, args) => ({ data: [{ sub_val: 'speed', field_val: 'East', cnt: args.p_dataset_id === 'm1' ? 2 : 5 }], error: null })
    const j = await (await post({ op: 'tax_crosstab', axis: 'touchpoint', field: 'region', axisIsRow: true })).json()
    expect(ctx.rpcCalls.map((c) => c.args.p_dataset_id)).toEqual(['m1', 'm2'])
    expect(j.grid).toEqual({ speed: { East: 7 } }) // per-member counts add up
    expect(j.sampled).toBe(false)
  })

  it('stamps the synthetic _collection_label from each member label', async () => {
    ctx.dataset = { org_id: 'orgA', row_count: 100, source: 'collection' }
    ctx.members = [{ datasetId: 'm1', label: 'Store A' }, { datasetId: 'm2', label: 'Store B' }]
    // The RPC returns a blank field_val (the label is never stored on rows)
    ctx.rpc = () => ({ data: [{ sub_val: 'speed', field_val: null, cnt: 1 }], error: null })
    const j = await (await post({ op: 'tax_crosstab', axis: 'touchpoint', field: '_collection_label', axisIsRow: true })).json()
    expect(j.grid).toEqual({ speed: { 'Store A': 1, 'Store B': 1 } })
  })

  it('tax_axis_crosstab reshapes axis names against the field', async () => {
    ctx.rpc = () => ({ data: [
      { axis_val: 'touchpoint', field_val: 'East', cnt: 4 },
      { axis_val: 'product', field_val: null, cnt: 2 },
    ], error: null })
    const j = await (await post({ op: 'tax_axis_crosstab', field: 'region', axisIsRow: true })).json()
    expect(j.grid).toEqual({ touchpoint: { East: 4 }, product: { '(blank)': 2 } })
  })
})

describe('aggregate — dispatch', () => {
  it('400 on an unknown op and on invalid JSON', async () => {
    expect((await post({ op: 'summon' })).status).toBe(400)
    const bad = await POST(new Request('http://t/x', { method: 'POST', body: '{nope' }), props)
    expect(bad.status).toBe(400)
  })
})
