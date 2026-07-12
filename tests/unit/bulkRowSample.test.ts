import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { allocateSampleShares, pageSampledRows } from '@/lib/bulkRowSample'

function makeService(pages: Record<string, unknown>[], calls: Record<string, unknown>[] = []) {
  let i = 0
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'sample_dataset_rows') throw new Error('unexpected rpc ' + fn)
      calls.push(args)
      const page = pages[i++]
      if (!page) return Promise.resolve({ data: null, error: { message: 'no page queued' } })
      return Promise.resolve({ data: page, error: null })
    },
  } as unknown as SupabaseClient
}

const row = (id: number) => ({ id, row_index: id, data: { text: 'r' + id } })

describe('pageSampledRows — shared sql/160 pager', () => {
  it('pages to the cap, advances the cursor, invokes cb per row in order', async () => {
    // A FULL page (length == pageLimit) continues; multi-page kicks in when
    // the cap exceeds the 5000-row page size.
    const calls: Record<string, unknown>[] = []
    const page1 = Array.from({ length: 5000 }, (_v, i) => row(i + 1))
    const svc = makeService([
      { rows: page1, last_hash: 10, last_id: 5000 },
      { rows: [row(5001), row(5002)], last_hash: 20, last_id: 5002 },
    ], calls)

    const seen: number[] = []
    const fetched = await pageSampledRows(svc, 'd1', 7000, r => seen.push(r.id))

    expect(fetched).toBe(5002) // page 2 came back short → dataset exhausted
    expect(seen[0]).toBe(1)
    expect(seen[seen.length - 1]).toBe(5002)
    expect(calls[0].p_limit).toBe(5000)
    expect(calls[1].p_after_hash).toBe(10)
    expect(calls[1].p_after_id).toBe(5000)
    expect(calls[1].p_limit).toBe(2000)
    expect(calls).toHaveLength(2) // short page 2 stops the loop
  })

  it('stops on a short page (dataset smaller than the cap)', async () => {
    const svc = makeService([{ rows: [row(1)], last_hash: 5, last_id: 1 }])
    const fetched = await pageSampledRows(svc, 'd1', 5000, () => {})
    expect(fetched).toBe(1) // short page → no second RPC (which would error)
  })

  it('throws on RPC error', async () => {
    const svc = makeService([])
    await expect(pageSampledRows(svc, 'd1', 10, () => {})).rejects.toThrow('sample_dataset_rows failed')
  })
})

describe('allocateSampleShares', () => {
  it('splits the cap proportionally to member row counts (floored)', () => {
    const shares = allocateSampleShares(new Map([['a', 150000], ['b', 50000]]), 50000)
    expect(shares.get('a')).toBe(37500)
    expect(shares.get('b')).toBe(12500)
  })

  it('never exceeds the cap and keeps at least 1 row per non-empty member', () => {
    const shares = allocateSampleShares(new Map([['big', 999999], ['tiny', 3]]), 50000)
    expect(shares.get('tiny')).toBe(1) // not silently dropped
    let sum = 0
    for (const v of shares.values()) sum += v
    expect(sum).toBeLessThanOrEqual(50000 + 1) // min-1 bump is the only overshoot source
    expect(shares.get('big')).toBeLessThanOrEqual(50000)
  })

  it('skips empty members and handles all-zero input', () => {
    expect(allocateSampleShares(new Map([['a', 0]]), 50000).size).toBe(0)
    const shares = allocateSampleShares(new Map([['a', 100], ['b', 0]]), 50)
    expect(shares.has('b')).toBe(false)
    expect(shares.get('a')).toBe(50)
  })
})
