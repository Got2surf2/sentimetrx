// lib/aggregateOps — the shared dispatcher behind the charts aggregate route
// AND Ana's query_data tool (extracted 2026-09-01). These tests pin the
// contract both consumers rely on: op dispatch + reshaping, the exact-path
// RPCs, the sampled-path gating at AGG_SAMPLE_CAP, the filter row-id
// passthrough with its PGRST202 retry (deploy-order safety), and input
// validation statuses.
import { describe, it, expect, vi } from 'vitest'
import { runAggregateOp } from '@/lib/aggregateOps'

vi.mock('@/lib/sampledAggregate', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    sampledCountFieldValues: vi.fn(async () => ({ rows: [{ value: 'Sampled', count: 5 }] })),
  }
})

type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
type RpcImpl = (name: string, args: Record<string, unknown>) => RpcResult

function mockService(rpcImpl: RpcImpl) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args)),
  } as unknown as Parameters<typeof runAggregateOp>[0]
}

const meta = { rowCount: 1000, source: 'upload' }

describe('runAggregateOp — exact scalar ops', () => {
  it('field_counts maps RPC rows into a counts object', async () => {
    const service = mockService((name) => {
      expect(name).toBe('count_field_values')
      return { data: [{ value: 'FL', count: 3 }, { value: 'GA', count: 2 }], error: null }
    })
    const out = await runAggregateOp(service, 'd-1', meta, { op: 'field_counts', field: 'State' })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ counts: { FL: 3, GA: 2 }, sampled: false })
  })

  it('crosstab reshapes RPC rows into a grid with (blank) columns', async () => {
    const service = mockService(() => ({
      data: [
        { row_val: 'FL', col_val: 'Positive', cnt: 4 },
        { row_val: 'FL', col_val: null, cnt: 1 },
        { row_val: 'GA', col_val: 'Positive', cnt: 2 },
      ],
      error: null,
    }))
    const out = await runAggregateOp(service, 'd-1', meta, { op: 'crosstab', rowField: 'State', colField: 'Sentiment' })
    expect(out.status).toBe(200)
    expect(out.body.grid).toEqual({ FL: { Positive: 4, '(blank)': 1 }, GA: { Positive: 2 } })
    expect(out.body.rows).toEqual(['FL', 'GA'])
  })

  it('passes filter row-ids as p_row_ids and retries WITHOUT them on PGRST202', async () => {
    const calls: Record<string, unknown>[] = []
    const service = mockService((name, args) => {
      calls.push(args)
      if ('p_row_ids' in args) return { data: null, error: { message: 'missing fn', code: 'PGRST202' } }
      return { data: [{ value: 'A', count: 1 }], error: null }
    })
    const out = await runAggregateOp(service, 'd-1', meta, { op: 'field_counts', field: 'F', rowIds: [1, 2, 3] })
    expect(out.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[0].p_row_ids).toEqual([1, 2, 3])
    expect('p_row_ids' in calls[1]).toBe(false)
  })

  it('sanitizes rowIds: non-numbers dropped, empty set = whole dataset (no p_row_ids)', async () => {
    const calls: Record<string, unknown>[] = []
    const service = mockService((_n, args) => { calls.push(args); return { data: [], error: null } })
    await runAggregateOp(service, 'd-1', meta, { op: 'field_counts', field: 'F', rowIds: ['x', null, NaN] as unknown[] })
    expect(calls).toHaveLength(1)
    expect('p_row_ids' in calls[0]).toBe(false)
  })
})

describe('runAggregateOp — sampled gating and validation', () => {
  it('above AGG_SAMPLE_CAP uses the sampled twin and flags sampled:true', async () => {
    const service = mockService(() => { throw new Error('exact RPC must not run on the sampled path') })
    const out = await runAggregateOp(service, 'd-1', { rowCount: 60000, source: 'upload' }, { op: 'field_counts', field: 'F' })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({ counts: { Sampled: 5 }, sampled: true })
  })

  it('unknown op → 400; missing required fields → 400; invalid axis → 400', async () => {
    const service = mockService(() => ({ data: [], error: null }))
    expect((await runAggregateOp(service, 'd-1', meta, { op: 'nope' })).status).toBe(400)
    expect((await runAggregateOp(service, 'd-1', meta, { op: 'crosstab', rowField: 'A' })).status).toBe(400)
    expect((await runAggregateOp(service, 'd-1', meta, { op: 'tax_counts', axis: 'bogus' })).status).toBe(400)
  })

  it('DB error surfaces as errAt for the route to log, with a generic body', async () => {
    const service = mockService(() => ({ data: null, error: { message: 'boom' } }))
    const out = await runAggregateOp(service, 'd-1', meta, { op: 'field_counts', field: 'F' })
    expect(out.status).toBe(500)
    expect(out.errAt).toBe('datasets.aggregate.fieldCounts')
    expect(out.body.error).toBe('Aggregation failed')
  })
})

// ── Collection fan-out (2026-09-04) ─────────────────────────────────────────
// A collection holds no rows of its own; before this, every scalar op keyed
// on the collection's id answered zero (Ana hit it: 8 ops, all empty, on a
// 42K-row collection). These pin the per-member fan-out + exact JS merges.
vi.mock('@/lib/collectionScope', () => ({
  resolveScopeMembers: vi.fn(async () => [
    { datasetId: 'm-1', label: 'Alpha' },
    { datasetId: 'm-2', label: 'Beta' },
  ]),
}))

const collMeta = { rowCount: 42224, source: 'collection' }

describe('runAggregateOp — collection fan-out', () => {
  it('field_counts fans out per member and SUMS shared values', async () => {
    const seen: string[] = []
    const service = mockService((name, args) => {
      expect(name).toBe('count_field_values')
      seen.push(String(args.p_dataset_id))
      return args.p_dataset_id === 'm-1'
        ? { data: [{ value: 'FL', count: 3 }, { value: 'GA', count: 2 }], error: null }
        : { data: [{ value: 'FL', count: 4 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'field_counts', field: 'State' })
    expect(out.status).toBe(200)
    expect(seen).toEqual(['m-1', 'm-2'])
    expect(out.body.counts).toEqual({ FL: 7, GA: 2 })
  })

  it('numeric_stats merges exactly: n sums, mean weighted, stddev pooled, median NULL across members', async () => {
    // A: values [0,2] → n2 mean1 sd√2 · B: values [2,4] → n2 mean3 sd√2
    // Union [0,2,2,4]: n4 mean2 sd √(8/3) — the pooled formula must land there.
    const service = mockService((name, args) => {
      expect(name).toBe('numeric_field_stats')
      return args.p_dataset_id === 'm-1'
        ? { data: [{ n: 2, min_val: 0, max_val: 2, avg_val: 1, median_val: 1, stddev_val: Math.SQRT2 }], error: null }
        : { data: [{ n: 2, min_val: 2, max_val: 4, avg_val: 3, median_val: 3, stddev_val: Math.SQRT2 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'numeric_stats', field: 'rating' })
    expect(out.status).toBe(200)
    expect(out.body.n).toBe(4)
    expect(out.body.min).toBe(0)
    expect(out.body.max).toBe(4)
    expect(out.body.avg).toBe(2)
    expect(out.body.stddev).toBeCloseTo(Math.sqrt(8 / 3), 10)
    expect(out.body.median).toBeNull()
    expect(String(out.body.medianNote)).toMatch(/median omitted/)
  })

  it('numeric_stats keeps the median when only ONE member holds values', async () => {
    const service = mockService((name, args) =>
      args.p_dataset_id === 'm-1'
        ? { data: [{ n: 5, min_val: 1, max_val: 5, avg_val: 3, median_val: 3, stddev_val: 1.2 }], error: null }
        : { data: [{ n: 0, min_val: null, max_val: null, avg_val: null, median_val: null, stddev_val: null }], error: null },
    )
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'numeric_stats', field: 'rating' })
    expect(out.body.median).toBe(3)
    expect(out.body.n).toBe(5)
  })

  it('date_series merges buckets across members: counts sum, averages count-weighted', async () => {
    const service = mockService((name, args) => {
      expect(name).toBe('date_series_stats')
      return args.p_dataset_id === 'm-1'
        ? { data: [{ bucket_date: '2026-08-01', n: 10, avg_val: 4 }, { bucket_date: '2026-09-01', n: 5, avg_val: 2 }], error: null }
        : { data: [{ bucket_date: '2026-09-01', n: 15, avg_val: 4 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'date_series', dateField: 'review_date', metricField: 'rating', bucket: 'month' })
    expect(out.status).toBe(200)
    const series = out.body.series as { date: string; count: number; avg: number | null }[]
    expect(series).toEqual([
      { date: '2026-08-01', count: 10, avg: 4 },
      { date: '2026-09-01', count: 20, avg: 3.5 },  // (5·2 + 15·4)/20
    ])
  })

  it('group_stats by _collection_label answers one group per member from per-member stats', async () => {
    const service = mockService((name, args) => {
      expect(name).toBe('numeric_field_stats')
      return args.p_dataset_id === 'm-1'
        ? { data: [{ n: 3, min_val: 1, max_val: 5, avg_val: 4, median_val: 4, stddev_val: 0.5 }], error: null }
        : { data: [{ n: 2, min_val: 2, max_val: 3, avg_val: 2.5, median_val: 2.5, stddev_val: 0.7 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'group_stats', groupField: '_collection_label', valueField: 'rating' })
    expect(out.status).toBe(200)
    const groups = out.body.groups as Record<string, { n: number; mean: number | null }>
    expect(Object.keys(groups).sort()).toEqual(['Alpha', 'Beta'])
    expect(groups.Alpha.n).toBe(3)
    expect(groups.Beta.mean).toBe(2.5)
  })

  it('tax_counts fans out over members and sums sub counts', async () => {
    const service = mockService((name, args) => {
      expect(name).toBe('taxonomy_sub_counts')
      return args.p_dataset_id === 'm-1'
        ? { data: [{ value: 'wait time', count: 8 }], error: null }
        : { data: [{ value: 'wait time', count: 2 }, { value: 'staff', count: 6 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', collMeta, { op: 'tax_counts', axis: 'touchpoint' })
    expect(out.status).toBe(200)
    expect(out.body.counts).toEqual({ 'wait time': 10, staff: 6 })
  })

  it('a collection above AGG_SAMPLE_CAP still fans out exact — never the single-id sampled twin', async () => {
    const service = mockService((name) => {
      expect(name).toBe('count_field_values')  // sampled twin would not RPC this
      return { data: [{ value: 'X', count: 1 }], error: null }
    })
    const out = await runAggregateOp(service, 'coll-1', { rowCount: 90000, source: 'collection' }, { op: 'field_counts', field: 'F' })
    expect(out.status).toBe(200)
    expect(out.body.sampled).toBe(false)
    expect(out.body.counts).toEqual({ X: 2 })
  })
})
