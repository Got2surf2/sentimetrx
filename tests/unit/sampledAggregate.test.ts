import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  sampledCrosstabCounts,
  sampledCountFieldValues,
  sampledDateSeriesStats,
  sampledGroupNumericStats,
  sampledNumericFieldStats,
} from '@/lib/sampledAggregate'

// Fake service serving queued pages for one twin RPC + recording call args.
function makeService(rpcName: string, pages: Record<string, unknown>[], calls: Record<string, unknown>[] = []) {
  let i = 0
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== rpcName) throw new Error('unexpected rpc ' + fn)
      calls.push(args)
      const page = pages[i++]
      if (!page) return Promise.resolve({ data: null, error: { message: 'no page queued' } })
      return Promise.resolve({ data: page, error: null })
    },
  } as unknown as SupabaseClient
}

describe('sampledCountFieldValues', () => {
  it('merges per-value counts across pages, scales, sorts desc, limits', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService('sampled_count_field_values', [
      { n_scanned: 5000, groups: [['A', 3000], ['B', 2000]], last_hash: 10, last_id: 20 },
      { n_scanned: 5000, groups: [['B', 1000], ['C', 500]], last_hash: 30, last_id: 40 },
    ], calls)
    // total 40000, scanned 10000 → ×4 (cap 10000 = two pages)
    const r = await sampledCountFieldValues(svc, 'd1', 'f', 2, 40000, null, 10000)
    expect(r.scanned).toBe(10000)
    // A = 3000*4 = 12000, B = (2000+1000)*4 = 12000; C = 500*4 dropped by limit=2
    expect(r.rows).toHaveLength(2)
    expect(r.rows.map(x => x.value).sort()).toEqual(['A', 'B'])
    expect(r.rows.find(x => x.value === 'B')!.count).toBe(12000)
    expect(r.rows.find(x => x.value === 'A')!.count).toBe(12000)
    expect(calls[1].p_after_hash).toBe(10) // cursor advanced
    expect(calls[0].p_row_ids).toBeNull()
  })

  it('forwards p_row_ids and stops on a short page', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService('sampled_count_field_values', [
      { n_scanned: 0, groups: [], last_hash: null, last_id: null },
    ], calls)
    const r = await sampledCountFieldValues(svc, 'd1', 'f', 200, 100000, [1, 2, 3])
    expect(r.scanned).toBe(0)
    expect(calls[0].p_row_ids).toEqual([1, 2, 3])
  })
})

describe('sampledCrosstabCounts', () => {
  it('accumulates (row,col) cells, scales, builds ranked grid', async () => {
    const svc = makeService('sampled_crosstab_counts', [
      { n_scanned: 5000, groups: [['Dine-In', 'FL', 3000], ['Carry Out', 'FL', 1000]], last_hash: 1, last_id: 1 },
      { n_scanned: 0, groups: [], last_hash: null, last_id: null },
    ])
    const r = await sampledCrosstabCounts(svc, 'd1', 'visit', 'state', 50, 10000, null)
    // ×2 scaling
    const dineFl = r.rows.find(x => x.row_val === 'Dine-In' && x.col_val === 'FL')!
    expect(dineFl.cnt).toBe(6000)
    expect(r.rows[0].cnt).toBeGreaterThanOrEqual(r.rows[1].cnt) // sorted desc
  })
})

describe('sampledGroupNumericStats', () => {
  it('derives per-group n(scaled)/mean/median/min/max/stddev(unscaled) from raw values', async () => {
    const svc = makeService('sampled_group_numeric_stats', [
      { n_scanned: 4, vals: [['X', 2], ['X', 4], ['X', 6], ['Y', 10]], last_hash: null, last_id: null },
    ])
    const r = await sampledGroupNumericStats(svc, 'd1', 'g', 'v', 8, null) // ×2
    const x = r.rows.find(g => g.group_val === 'X')!
    expect(x.n).toBe(6)            // 3 scaled ×2
    expect(x.avg_val).toBe(4)      // mean UNSCALED
    expect(x.median_val).toBe(4)   // median UNSCALED
    expect(x.min_val).toBe(2)
    expect(x.max_val).toBe(6)
    expect(x.stddev_val).toBeCloseTo(2) // sample stddev of [2,4,6]
    // largest raw group first
    expect(r.rows[0].group_val).toBe('X')
    const y = r.rows.find(g => g.group_val === 'Y')!
    expect(y.stddev_val).toBeNull() // n<2
  })
})

describe('sampledNumericFieldStats (aggregate op — raw values)', () => {
  it('computes n(scaled)/mean/median/stddev over the sample; even-n median interpolates', async () => {
    const svc = makeService('sampled_numeric_field_values', [
      { n_scanned: 4, vals: [1, 2, 3, 4], last_hash: null, last_id: null },
    ])
    const r = await sampledNumericFieldStats(svc, 'd1', 'v', 8, null) // ×2
    expect(r.rows!.n).toBe(8)          // 4 scaled ×2
    expect(r.rows!.avg_val).toBe(2.5)  // unscaled
    expect(r.rows!.median_val).toBe(2.5) // (2+3)/2
    expect(r.rows!.min_val).toBe(1)
    expect(r.rows!.max_val).toBe(4)
  })

  it('returns null rows when no numeric values in the sample', async () => {
    const svc = makeService('sampled_numeric_field_values', [
      { n_scanned: 3, vals: [], last_hash: null, last_id: null },
    ])
    const r = await sampledNumericFieldStats(svc, 'd1', 'v', 100, null)
    expect(r.rows).toBeNull()
  })
})

describe('sampledDateSeriesStats', () => {
  it('merges bucket counts (scaled) + metric sum/count → avg (unscaled), sorts by bucket', async () => {
    const svc = makeService('sampled_date_series_stats', [
      { n_scanned: 5000, buckets: [['2026-02', 100, 400, 100], ['2026-01', 50, 250, 50]], last_hash: 1, last_id: 1 },
      { n_scanned: 0, buckets: [], last_hash: null, last_id: null },
    ])
    const r = await sampledDateSeriesStats(svc, 'd1', 'date', 'rating', 'month', 10000, null)
    expect(r.rows.map(b => b.bucket_date)).toEqual(['2026-01', '2026-02'])
    expect(r.rows[1].n).toBe(200)       // 100 ×2
    expect(r.rows[1].avg_val).toBe(4)   // 400/100 unscaled
    expect(r.rows[0].avg_val).toBe(5)   // 250/50
  })
})

describe('error handling', () => {
  it('throws on RPC error so the route falls back to the exact path', async () => {
    const svc = makeService('sampled_count_field_values', []) // immediate error
    await expect(sampledCountFieldValues(svc, 'd1', 'f', 200, 100, null)).rejects.toThrow('sampled_count_field_values failed')
  })
})
