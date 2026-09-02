// lib/anaQueryTools — Ana's server-executed query tools. Pins: query_data's
// input mapping into the shared dispatcher (ctx rowIds/fieldKey ride along,
// limits clamped), error translation into a model-readable hint, the
// filters-scope note, result compaction for oversized counts, and find_quotes'
// exact whole-dataset total + filtered-view preference + internal-field
// stripping in quotes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeAnaQueryTool, anaToolStatusLabel, chartConfigForQuery, ANA_QUERY_TOOL_NAMES, type AnaQueryContext } from '@/lib/anaQueryTools'
import { runAggregateOp } from '@/lib/aggregateOps'

vi.mock('@/lib/aggregateOps', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, runAggregateOp: vi.fn(async () => ({ status: 200, body: { counts: { A: 1 }, sampled: false } })) }
})

const mockedAgg = vi.mocked(runAggregateOp)

type ServiceArg = Parameters<typeof executeAnaQueryTool>[0]

function searchService(opts: { rpcRows?: { id: number; data: Record<string, unknown> }[]; count?: number }) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'order', 'range', 'textSearch']) chain[m] = self
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, count: opts.count ?? 0 }).then(resolve)
  return {
    rpc: vi.fn(async () => ({ data: opts.rpcRows ?? [], error: null })),
    from: vi.fn(() => chain),
  } as unknown as ServiceArg
}

const baseCtx: AnaQueryContext = { datasetId: 'd-1', rowCount: 1000, source: 'upload', rowIds: null, fieldKey: null }

beforeEach(() => { mockedAgg.mockClear() })

describe('query_data', () => {
  it('maps input into the shared dispatcher with ctx rowIds + fieldKey and clamps limit', async () => {
    const ctx: AnaQueryContext = { ...baseCtx, rowIds: [7, 8], fieldKey: 'q1' }
    const out = await executeAnaQueryTool(searchService({}), ctx, 'query_data', { op: 'field_counts', field: 'State', limit: 999 })
    expect(mockedAgg).toHaveBeenCalledTimes(1)
    const [, datasetId, meta, body] = mockedAgg.mock.calls[0]
    expect(datasetId).toBe('d-1')
    expect(meta).toEqual({ rowCount: 1000, source: 'upload' })
    expect(body.rowIds).toEqual([7, 8])
    expect(body.fieldKey).toBe('q1')
    expect(body.limit).toBe(100)
    expect(out.counts).toEqual({ A: 1 })
    expect(String(out.scope)).toContain('active filters')
  })

  it('no filters → no scope note', async () => {
    const out = await executeAnaQueryTool(searchService({}), baseCtx, 'query_data', { op: 'field_counts', field: 'F' })
    expect(out.scope).toBeUndefined()
  })

  it('non-200 dispatcher result becomes a model-readable error + hint', async () => {
    mockedAgg.mockResolvedValueOnce({ status: 400, body: { error: 'field required' } })
    const out = await executeAnaQueryTool(searchService({}), baseCtx, 'query_data', { op: 'field_counts' })
    expect(out.error).toBe('field required')
    expect(String(out.hint)).toContain('field keys')
  })

  it('oversized counts results are compacted to the top 50 with a truncation note', async () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < 800; i++) counts['value-with-a-reasonably-long-name-' + i] = 800 - i
    mockedAgg.mockResolvedValueOnce({ status: 200, body: { counts, sampled: false } })
    const out = await executeAnaQueryTool(searchService({}), baseCtx, 'query_data', { op: 'field_counts', field: 'F' })
    expect(Object.keys(out.counts as Record<string, number>)).toHaveLength(50)
    expect((out.counts as Record<string, number>)['value-with-a-reasonably-long-name-0']).toBe(800)
    expect(String(out.truncated)).toContain('750 more')
  })
})

describe('find_quotes', () => {
  it('returns the exact whole-dataset total, strips internal _fields from quotes, labels the scope', async () => {
    const service = searchService({
      rpcRows: [
        { id: 1, data: { review_text: 'The wait was too long', _tx: { hidden: true }, rating: 2 } },
        { id: 2, data: { review_text: 'Great service' } },
      ],
      count: 42,
    })
    const out = await executeAnaQueryTool(service, baseCtx, 'find_quotes', { query: 'wait' })
    expect(out.total).toBe(42)
    expect(String(out.totalScope)).toContain('NOT applied')
    const quotes = out.quotes as { text: string }[]
    expect(quotes).toHaveLength(2)
    expect(quotes[0].text).toContain('The wait was too long')
    expect(quotes[0].text).not.toContain('hidden')
  })

  it('prefers quotes from the filtered view when rowIds are present', async () => {
    const service = searchService({
      rpcRows: [
        { id: 10, data: { review_text: 'outside the filter' } },
        { id: 20, data: { review_text: 'inside the filter' } },
      ],
      count: 2,
    })
    const ctx: AnaQueryContext = { ...baseCtx, rowIds: [20] }
    const out = await executeAnaQueryTool(service, ctx, 'find_quotes', { query: 'filter', limit: 1 })
    const quotes = out.quotes as { text: string; inFilteredView: boolean }[]
    expect(quotes).toHaveLength(1)
    expect(quotes[0].text).toContain('inside the filter')
    expect(quotes[0].inFilteredView).toBe(true)
  })

  it('empty query → error', async () => {
    const out = await executeAnaQueryTool(searchService({}), baseCtx, 'find_quotes', { query: '  ' })
    expect(out.error).toBe('query required')
  })
})

describe('tool metadata', () => {
  it('query tool names are registered for the streaming loop', () => {
    expect(ANA_QUERY_TOOL_NAMES.has('query_data')).toBe(true)
    expect(ANA_QUERY_TOOL_NAMES.has('find_quotes')).toBe(true)
    expect(ANA_QUERY_TOOL_NAMES.has('create_theme')).toBe(false)
  })

  it('status labels are human-readable', () => {
    expect(anaToolStatusLabel('query_data', { op: 'field_counts' })).toBe('Counting values…')
    expect(anaToolStatusLabel('find_quotes', { query: 'wait times' })).toContain('wait times')
  })
})

describe('chartConfigForQuery — canvas handoff mapping', () => {
  it('maps ops onto CHART_SLOTS-shaped configs', () => {
    expect(chartConfigForQuery({ op: 'field_counts', field: 'State' }))
      .toEqual({ chartType: 'bar', config: { category: 'State' }, label: 'State counts' })
    expect(chartConfigForQuery({ op: 'crosstab', rowField: 'State', colField: 'City' })?.config)
      .toEqual({ rows: 'State', cols: 'City' })
    expect(chartConfigForQuery({ op: 'group_stats', groupField: 'State', valueField: 'rating' })?.config)
      .toEqual({ category: 'State', value: 'rating' })
    expect(chartConfigForQuery({ op: 'date_series', dateField: 'review_date', metricField: 'rating' })?.config)
      .toEqual({ date: 'review_date', metric: 'rating' })
    expect(chartConfigForQuery({ op: 'tax_counts', axis: 'touchpoint' })?.config)
      .toEqual({ category: '__dim_touchpoint__' })
  })

  it('field_counts on a NUMERIC field maps to distribution — the bar category slot rejects numerics ("No data for this field", seen live 9/02)', () => {
    expect(chartConfigForQuery({ op: 'field_counts', field: 'rating' }, { rating: 'numeric' }))
      .toEqual({ chartType: 'distribution', config: { field: 'rating' }, label: 'rating distribution' })
    expect(chartConfigForQuery({ op: 'field_counts', field: 'State' }, { State: 'categorical' })?.chartType).toBe('bar')
  })

  it('unmappable ops return null (no chip)', () => {
    expect(chartConfigForQuery({ op: 'tax_axis_crosstab', field: 'State' })).toBeNull()
    expect(chartConfigForQuery({ op: 'field_counts' })).toBeNull()
  })
})

describe('read_comments — on-demand reading sample', () => {
  function readService(opts: { rpcRows?: { id: number; data: Record<string, unknown> }[]; count?: number; sampleRows?: Record<string, unknown>[]; byIdRows?: { id: number; data: Record<string, unknown> }[] }) {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    let inIds: number[] | null = null
    for (const m of ['select', 'eq', 'order', 'range', 'textSearch']) chain[m] = self
    chain.in = (_col: string, ids: number[]) => { inIds = ids; return chain }
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (inIds) {
        const wanted = new Set(inIds)
        return Promise.resolve({ data: (opts.byIdRows || []).filter(r => wanted.has(r.id)), error: null, count: null }).then(resolve)
      }
      return Promise.resolve({ data: null, error: null, count: opts.count ?? 0 }).then(resolve)
    }
    return {
      rpc: vi.fn(async (name: string) => {
        if (name === 'search_dataset_rows') return { data: opts.rpcRows ?? [], error: null }
        if (name === 'sample_row_pairs') return { data: (opts.sampleRows || []).map(d => ({ data: d })), error: null }
        return { data: null, error: { message: 'unexpected rpc ' + name } }
      }),
      from: vi.fn(() => chain),
    } as unknown as ServiceArg
  }

  it('targeted: reads matches, reports the exact total, prefers the filtered view', async () => {
    const service = readService({
      rpcRows: [
        { id: 1, data: { review_text: 'salsa bar was dirty' } },
        { id: 2, data: { review_text: 'love the salsa bar', _tx: { x: 1 } } },
      ],
      count: 283,
    })
    const ctx: AnaQueryContext = { ...baseCtx, rowIds: [2] }
    const out = await executeAnaQueryTool(service, ctx, 'read_comments', { query: 'salsa bar' })
    expect(out.totalMatching).toBe(283)
    expect(out.readCount).toBe(2)
    const comments = out.comments as string[]
    expect(comments[0]).toContain('love the salsa bar')   // in-view first
    expect(comments[0]).not.toContain('_tx')
    expect(String(out.scope)).toContain('283')
  })

  it('untargeted with filters: reads an evenly-spread slice of the filtered view by id', async () => {
    const byIdRows = Array.from({ length: 300 }, (_, i) => ({ id: i, data: { review_text: 'comment ' + i } }))
    const service = readService({ byIdRows })
    const ctx: AnaQueryContext = { ...baseCtx, rowIds: byIdRows.map(r => r.id) }
    const out = await executeAnaQueryTool(service, ctx, 'read_comments', { limit: 50 })
    expect(out.readCount).toBe(50)
    expect(String(out.scope)).toContain('filtered view')
  })

  it('untargeted without filters: representative sample via sample_row_pairs', async () => {
    const service = readService({ sampleRows: Array.from({ length: 40 }, (_, i) => ({ review_text: 'sampled ' + i })) })
    const out = await executeAnaQueryTool(service, baseCtx, 'read_comments', { limit: 40 })
    expect(out.readCount).toBe(40)
    expect(String(out.scope)).toContain('representative sample')
  })
})
