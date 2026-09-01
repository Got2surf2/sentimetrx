// lib/analyticsCompute — the per-field analytics engine behind dataset sync,
// compute, trim, and collection recompute. The pure accumulator path runs
// as-is; the SQL path runs against a fake service client + rpc handler.
import { describe, it, expect, vi } from 'vitest'
import type { SchemaConfig } from '@/lib/analyzeTypes'

const countNonEmptyRowsMock = vi.fn(async (..._a: unknown[]) => 0)
vi.mock('@/lib/nonEmptyCount', () => ({ countNonEmptyRows: (...a: unknown[]) => countNonEmptyRowsMock(...a) }))

import { computeAnalyticsFromRows, createAnalyticsAccumulator, computeAnalyticsSQL } from '@/lib/analyticsCompute'
import type {
  CategoricalSummary, NumericSummary, OpenEndedSummary, DateSummary, IgnoredSummary,
} from '@/lib/analyzeTypes'

const schema = (fields: { field: string; type: string }[]): SchemaConfig =>
  ({ fields: fields.map((f) => ({ field: f.field, label: f.field, type: f.type })) } as unknown as SchemaConfig)

describe('computeAnalyticsFromRows — categorical', () => {
  it('counts values sorted desc, skipping null/blank, with topN and uniqueRatio', () => {
    const rows = [
      { color: 'red' }, { color: 'blue' }, { color: 'red' }, { color: 'red' },
      { color: '' }, { color: null }, { color: '  ' }, {},
    ]
    const a = computeAnalyticsFromRows(rows, schema([{ field: 'color', type: 'categorical' }]))
    expect(a.totalRows).toBe(8)
    const s = a.fieldSummaries.color as CategoricalSummary
    expect(s.nonNull).toBe(4)
    expect(Object.keys(s.counts)).toEqual(['red', 'blue']) // sorted by count desc
    expect(s.counts).toEqual({ red: 3, blue: 1 })
    expect(s.topN).toEqual(['red', 'blue'])
    expect(s.uniqueCount).toBe(2)
    expect(s.uniqueRatio).toBe(0.5)
  })
})

describe('computeAnalyticsFromRows — numeric', () => {
  it('computes exact stats and a per-value discrete profile for rating-like fields', () => {
    const rows = [1, 2, 2, 3, 3, 3, 4, 4, 5, 'nope'].map((rating) => ({ rating }))
    const s = computeAnalyticsFromRows(rows, schema([{ field: 'rating', type: 'numeric' }]))
      .fieldSummaries.rating as NumericSummary
    expect(s.nonNull).toBe(9) // 'nope' ignored
    expect(s.min).toBe(1)
    expect(s.max).toBe(5)
    expect(s.avg).toBeCloseTo(27 / 9)
    expect(s.median).toBe(3)
    expect(s.p25).toBe(2)
    expect(s.p75).toBe(4)
    expect(s.isDiscrete).toBe(true)
    expect(s.valueCounts).toEqual({ '1': 1, '2': 2, '3': 3, '4': 2, '5': 1 })
    expect(s.histogram.reduce((n, b) => n + b.count, 0)).toBe(9) // every value bucketed
  })

  it('drops the per-value profile past 20 distinct values (continuous field)', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ x: i * 1.5 }))
    const s = computeAnalyticsFromRows(rows, schema([{ field: 'x', type: 'numeric' }]))
      .fieldSummaries.x as NumericSummary
    expect(s.isDiscrete).toBe(false)
    expect(s.valueCounts).toBeUndefined()
    expect(s.histogram).toHaveLength(10)
    expect(s.histogram.reduce((n, b) => n + b.count, 0)).toBe(30)
  })

  it('collapses to a single histogram bucket when min equals max, and zeroes an empty field', () => {
    const one = computeAnalyticsFromRows([{ x: 7 }, { x: 7 }], schema([{ field: 'x', type: 'numeric' }]))
      .fieldSummaries.x as NumericSummary
    expect(one.histogram).toEqual([{ min: 7, max: 7, count: 2 }])
    const none = computeAnalyticsFromRows([{}], schema([{ field: 'x', type: 'numeric' }]))
      .fieldSummaries.x as NumericSummary
    expect(none).toMatchObject({ nonNull: 0, min: 0, max: 0, avg: 0, stddev: 0 })
  })
})

describe('computeAnalyticsFromRows — open-ended / date / id', () => {
  it('summarizes text length and words with a capped sample', () => {
    const rows = [
      { comment: 'Great service today' },
      { comment: 'Meh' },
      { comment: '' },
    ]
    const s = computeAnalyticsFromRows(rows, schema([{ field: 'comment', type: 'open-ended' }]))
      .fieldSummaries.comment as OpenEndedSummary
    expect(s.nonNull).toBe(2)
    expect(s.avgWordCount).toBe(2) // (3 + 1) / 2
    expect(s.maxCharLen).toBe('Great service today'.length)
    expect(s.sample).toEqual(['Great service today', 'Meh'])
  })

  it('normalizes date values to YYYY-MM-DD for min/max/buckets', () => {
    const rows = [
      { day: '2026-03-05T10:00:00Z' },
      { day: '2026-01-02' },
      { day: '2026-01-02' },
    ]
    const s = computeAnalyticsFromRows(rows, schema([{ field: 'day', type: 'date' }]))
      .fieldSummaries.day as DateSummary
    expect(s.min).toBe('2026-01-02')
    expect(s.max).toBe('2026-03-05')
    expect(s.counts).toEqual({ '2026-01-02': 2, '2026-03-05': 1 })
  })

  it('tracks id fields by unique count and a 5-value sample', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ uid: `u${i}` }))
    const s = computeAnalyticsFromRows(rows, schema([{ field: 'uid', type: 'id' }]))
      .fieldSummaries.uid as IgnoredSummary
    expect(s.uniqueCount).toBe(8)
    expect(s.sample).toHaveLength(5)
  })
})

describe('createAnalyticsAccumulator — streaming equivalence', () => {
  it('chunked pushRows produces the same analytics as one in-memory pass', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      rating: (i % 5) + 1,
      color: i % 2 ? 'red' : 'blue',
      comment: i % 3 ? 'Nice place to eat' : '',
    }))
    const s = schema([
      { field: 'rating', type: 'numeric' },
      { field: 'color', type: 'categorical' },
      { field: 'comment', type: 'open-ended' },
    ])
    const chunked = createAnalyticsAccumulator(s)
    chunked.pushRows(rows.slice(0, 17))
    chunked.pushRows(rows.slice(17, 40))
    chunked.pushRows(rows.slice(40))
    const a = chunked.finalize()
    const b = computeAnalyticsFromRows(rows, s)
    expect(a.totalRows).toBe(50)
    // computedAt differs; everything measured must not
    expect(a.fieldSummaries).toEqual(b.fieldSummaries)
  })
})

// ── SQL path ────────────────────────────────────────────────────────────
type Rpc = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }
function fakeService(opts: { totalRows: number; sampleRows?: Record<string, unknown>[]; rpc: Rpc }) {
  function chain() {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) b[m] = () => b
    b.limit = async () => ({ data: (opts.sampleRows || []).map((data) => ({ data })), error: null })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ count: opts.totalRows, error: null }).then(res)
    return b
  }
  return {
    from: () => chain(),
    rpc: async (name: string, args: Record<string, unknown>) => opts.rpc(name, args),
  } as unknown as Parameters<typeof computeAnalyticsSQL>[0]
}

describe('computeAnalyticsSQL', () => {
  it('summarizes categorical + discrete numeric + date fields from the RPCs', async () => {
    const service = fakeService({
      totalRows: 1000,
      rpc: (name, args) => {
        if (name === 'count_field_values' && args.p_field_key === 'color')
          return { data: [{ value: 'red', count: '600' }, { value: 'blue', count: 400 }], error: null }
        if (name === 'numeric_field_stats')
          return { data: [{ n: 1000, min_val: 1, max_val: 5, avg_val: '4.2', median_val: 4, stddev_val: 0.9 }], error: null }
        if (name === 'count_field_values' && args.p_field_key === 'rating')
          return { data: [{ value: '5', count: 500 }, { value: '4', count: 300 }, { value: '1', count: 200 }], error: null }
        if (name === 'count_field_values' && args.p_field_key === 'day')
          return { data: [{ value: '2026-02-01', count: 700 }, { value: '2026-01-15', count: 300 }], error: null }
        return { data: [], error: null }
      },
    })
    const a = await computeAnalyticsSQL(service, 'd1', schema([
      { field: 'color', type: 'categorical' },
      { field: 'rating', type: 'numeric' },
      { field: 'day', type: 'date' },
    ]))
    expect(a.totalRows).toBe(1000)
    const color = a.fieldSummaries.color as CategoricalSummary
    expect(color.counts).toEqual({ red: 600, blue: 400 })
    expect(color.nonNull).toBe(1000)
    const rating = a.fieldSummaries.rating as NumericSummary
    expect(rating).toMatchObject({ nonNull: 1000, min: 1, max: 5, avg: 4.2, isDiscrete: true })
    // Discrete histogram: one bucket per value, sorted numerically
    expect(rating.histogram).toEqual([
      { min: 1, max: 1, count: 200 }, { min: 4, max: 4, count: 300 }, { min: 5, max: 5, count: 500 },
    ])
    const day = a.fieldSummaries.day as DateSummary
    expect(day).toMatchObject({ min: '2026-01-15', max: '2026-02-01', nonNull: 1000 })
  })

  it('zeroes a numeric field the stats RPC finds empty', async () => {
    const service = fakeService({ totalRows: 10, rpc: () => ({ data: [], error: null }) })
    const a = await computeAnalyticsSQL(service, 'd1', schema([{ field: 'x', type: 'numeric' }]))
    expect(a.fieldSummaries.x).toMatchObject({ type: 'numeric', nonNull: 0, min: 0, max: 0, histogram: [] })
  })

  it('prefers the comma-safe SQL non-empty count for open-ended fields, sampling only the word stats', async () => {
    countNonEmptyRowsMock.mockResolvedValue(842)
    const service = fakeService({
      totalRows: 1000,
      sampleRows: [{ q: 'Loved the patio seating' }, { q: '' }, { q: 'Fine' }],
      rpc: () => ({ data: [], error: null }),
    })
    const a = await computeAnalyticsSQL(service, 'd1', schema([{ field: 'q', type: 'open-ended' }]))
    const s = a.fieldSummaries.q as OpenEndedSummary
    expect(s.nonNull).toBe(842) // sql/161 count wins over the 20-row sample
    expect(s.sample).toEqual(['Loved the patio seating', 'Fine'])
    expect(s.avgWordCount).toBe(2.5) // (4 + 1) / 2 from the sample
  })

  it('falls back to the sampled non-empty count when the SQL count throws', async () => {
    countNonEmptyRowsMock.mockRejectedValue(new Error('57014'))
    const service = fakeService({
      totalRows: 1000,
      sampleRows: [{ q: 'Only row with text' }],
      rpc: () => ({ data: [], error: null }),
    })
    const a = await computeAnalyticsSQL(service, 'd1', schema([{ field: 'q', type: 'open-ended' }]))
    expect((a.fieldSummaries.q as OpenEndedSummary).nonNull).toBe(1)
  })
})
