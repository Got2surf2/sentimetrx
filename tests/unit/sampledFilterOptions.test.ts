import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sampledFilterOptions } from '@/lib/sampledFilterOptions'

// Fake service exposing sampled_filter_options — serves queued pages and
// records the args each call received (to assert cursor advance).
function makeService(pages: Record<string, unknown>[], calls: Record<string, unknown>[] = []) {
  let i = 0
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'sampled_filter_options_blocks') throw new Error('unexpected rpc ' + fn)
      calls.push(args)
      const page = pages[i++]
      if (!page) return Promise.resolve({ data: null, error: { message: 'no page queued' } })
      return Promise.resolve({ data: page, error: null })
    },
  } as unknown as SupabaseClient
}

const FIELDS = [
  { field: 'loc', type: 'categorical' },
  { field: 'rating', type: 'numeric' },
  { field: 'd', type: 'date' },
  { field: 'txt', type: 'open-ended' },
]

describe('sampledFilterOptions', () => {
  it('accumulates counts, merges values, and merges min/max across pages', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService([
      {
        n_scanned: 2,
        fields: [
          { ord: 1, nonempty: 2, num_min: null, num_max: null, date_min: null, date_max: null, values: [{ v: 'A', c: 1 }, { v: 'B', c: 1 }], distinct_n: 2 },
          { ord: 2, nonempty: 2, num_min: 2, num_max: 5, date_min: null, date_max: null, values: [], distinct_n: 0 },
          { ord: 3, nonempty: 2, num_min: null, num_max: null, date_min: '2024-01-05', date_max: '2024-03-01', values: [], distinct_n: 0 },
          { ord: 4, nonempty: 1, num_min: null, num_max: null, date_min: null, date_max: null, values: [], distinct_n: 0 },
        ],
        last_row_index: 100,
      },
      {
        n_scanned: 1,
        fields: [
          { ord: 1, nonempty: 1, num_min: null, num_max: null, date_min: null, date_max: null, values: [{ v: 'A', c: 2 }, { v: 'C', c: 1 }], distinct_n: 2 },
          { ord: 2, nonempty: 1, num_min: 1, num_max: 4, date_min: null, date_max: null, values: [], distinct_n: 0 },
          { ord: 3, nonempty: 1, num_min: null, num_max: null, date_min: '2024-01-02', date_max: '2024-02-01', values: [], distinct_n: 0 },
          { ord: 4, nonempty: 0, num_min: null, num_max: null, date_min: null, date_max: null, values: [], distinct_n: 0 },
        ],
        last_row_index: null, // terminal page → stop after processing
      },
    ], calls)

    const { options, scanned } = await sampledFilterOptions(svc, 'ds', FIELDS)
    expect(scanned).toBe(3)

    // categorical: merged value counts A=3,B=1,C=1 → 3 distinct, not capped, a→z
    expect(options.loc.nonempty).toBe(3)
    expect(options.loc.values).toEqual(['A', 'B', 'C'])
    expect(options.loc.valuesCapped).toBe(false)

    // numeric: min of mins, max of maxs; no value list
    expect(options.rating.nonempty).toBe(3)
    expect(options.rating.min).toBe(1)
    expect(options.rating.max).toBe(5)
    expect(options.rating.values).toBeNull()

    // date: lexical min/max over ISO strings
    expect(options.d.dateMin).toBe('2024-01-02')
    expect(options.d.dateMax).toBe('2024-03-01')

    // open-ended: never value-counted (not filterable) → values null
    expect(options.txt.nonempty).toBe(1)
    expect(options.txt.values).toBeNull()

    // cursor advanced from the first page's (last_hash,last_id)
    expect(calls[0].p_after_row_index).toBe(-1)
    expect(calls[1].p_after_row_index).toBe(100) // single row_index cursor now
  })

  it('caps the value list at 500 by count and flags valuesCapped', async () => {
    // 600 distinct values, counts 600..1 (v0 highest, v599 lowest)
    const values = Array.from({ length: 600 }, (_, i) => ({ v: 'v' + i, c: 600 - i }))
    const svc = makeService([
      {
        n_scanned: 5,
        fields: [{ ord: 1, nonempty: 5, num_min: null, num_max: null, date_min: null, date_max: null, values, distinct_n: 600 }],
        last_row_index: null,
      },
    ])
    const { options } = await sampledFilterOptions(svc, 'ds', [{ field: 'loc', type: 'categorical' }])
    expect(options.loc.valuesCapped).toBe(true)
    expect(options.loc.values!.length).toBe(500)
    // highest-count value kept, lowest-count value dropped
    expect(options.loc.values).toContain('v0')
    expect(options.loc.values).not.toContain('v599')
  })

  it('stops when a page returns zero scanned rows (dataset smaller than cap)', async () => {
    const svc = makeService([
      { n_scanned: 2, fields: [{ ord: 1, nonempty: 2, num_min: null, num_max: null, date_min: null, date_max: null, values: [{ v: 'A', c: 2 }], distinct_n: 1 }], last_row_index: 9 },
      { n_scanned: 0, fields: [], last_row_index: null },
    ])
    const { options, scanned } = await sampledFilterOptions(svc, 'ds', [{ field: 'loc', type: 'categorical' }])
    expect(scanned).toBe(2)
    expect(options.loc.values).toEqual(['A'])
  })

  it('throws on RPC error so the route falls back to the legacy path', async () => {
    const svc = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'Could not find the function public.sampled_filter_options' } }),
    } as unknown as SupabaseClient
    await expect(sampledFilterOptions(svc, 'ds', [{ field: 'loc', type: 'categorical' }])).rejects.toThrow(/sampled_filter_options_blocks failed/)
  })
})
