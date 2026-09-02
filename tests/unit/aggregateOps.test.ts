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
