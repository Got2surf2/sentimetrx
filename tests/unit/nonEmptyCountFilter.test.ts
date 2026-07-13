import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { countNonEmptyRows } from '@/lib/nonEmptyCount'

// count_nonempty_rows filter-awareness (sql/170) — the RPC gets p_row_ids only
// when a filter set is passed; the PGRST202 legacy fallback applies it via .in().

function rpcService(behavior: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown }, calls: Record<string, unknown>[]) {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => { calls.push(args); return Promise.resolve(behavior(fn, args)) },
  } as unknown as SupabaseClient
}

describe('countNonEmptyRows — p_row_ids forwarding', () => {
  it('appends p_row_ids only when a non-empty filter set is passed', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = rpcService(() => ({ data: 42, error: null }), calls)
    await countNonEmptyRows(svc, 'd1', 'f', [10, 20, 30])
    expect(calls[0]).toEqual({ p_dataset_id: 'd1', p_field: 'f', p_row_ids: [10, 20, 30] })

    await countNonEmptyRows(svc, 'd1', 'f', null)
    expect(calls[1]).toEqual({ p_dataset_id: 'd1', p_field: 'f' }) // no p_row_ids

    await countNonEmptyRows(svc, 'd1', 'f', []) // empty = whole dataset
    expect(calls[2]).toEqual({ p_dataset_id: 'd1', p_field: 'f' })
  })

  it('returns the RPC count', async () => {
    const svc = rpcService(() => ({ data: 7, error: null }), [])
    expect(await countNonEmptyRows(svc, 'd1', 'f', [1, 2])).toBe(7)
  })

  it('applies the filter via .in() on the PGRST202 legacy fallback', async () => {
    const chain: string[] = []
    const legacy = {
      rpc: () => Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not in schema cache' } }),
      from: () => {
        const b = {
          select: () => b, eq: () => b, not: () => b, neq: () => b,
          in: (col: string, ids: number[]) => { chain.push('in:' + col + ':' + ids.join(',')); return b },
          then: (res: (v: { count: number; error: null }) => unknown) => res({ count: 5, error: null }),
        }
        return b
      },
    } as unknown as SupabaseClient
    const n = await countNonEmptyRows(legacy, 'd1', 'f', [1, 2, 3])
    expect(n).toBe(5)
    expect(chain).toContain('in:id:1,2,3')
  })
})
