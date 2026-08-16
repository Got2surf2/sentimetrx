import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sampledNumericFieldStats, sampledSignalCounts, scaleSampledCount } from '@/lib/sampledSignalCounts'

// Fake service exposing one sampled RPC — serves queued pages and records
// the args it was called with.
function makeService(pages: Record<string, unknown>[], calls: Record<string, unknown>[] = [], rpcName = 'sampled_signal_counts_blocks') {
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

const THEMES = [{ keywords: ['great'] }, { keywords: ['slow'] }]

describe('sampledSignalCounts — keyset pager', () => {
  it('accumulates pages up to the cap and advances the cursor', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService([
      { n: 5000, records: [4000], records_substantive: [3000], theme_counts: [1000, 200], theme_counts_substantive: [800, 150], union_count: 1100, union_substantive: 900, last_row_index: 20 },
      { n: 5000, records: [3800], records_substantive: [2900], theme_counts: [900, 300], theme_counts_substantive: [700, 240], union_count: 1150, union_substantive: 950, last_row_index: 40 },
    ], calls)

    const r = await sampledSignalCounts(svc, 'd1', ['f'], THEMES, 10000)

    expect(r.scanned).toBe(10000)
    expect(r.recordsPerField).toEqual([7800])
    expect(r.recordsSubstantivePerField).toEqual([5900])
    expect(r.perTheme).toEqual([1900, 500])
    // sql/181: per-theme substantive numerator accumulates in lockstep
    expect(r.perThemeSubstantive).toEqual([1500, 390])
    expect(r.union).toBe(2250)
    expect(r.unionSubstantive).toBe(1850)
    // page 2 must resume from page 1's cursor
    expect(calls[1].p_after_row_index).toBe(20) // single row_index cursor now
  })

  it('stops early when the dataset runs out of rows (short page)', async () => {
    const svc = makeService([
      { n: 5000, records: [4000], theme_counts: [1000, 0], union_count: 1000, last_row_index: 20 },
      { n: 1200, records: [900], theme_counts: [150, 0], union_count: 150, last_row_index: 99 },
      { n: 0, records: [0], theme_counts: [0, 0], union_count: 0, last_row_index: null },
    ])

    const r = await sampledSignalCounts(svc, 'd1', ['f'], THEMES, 50000)

    expect(r.scanned).toBe(6200)
    expect(r.recordsPerField).toEqual([4900])
  })

  it('throws on RPC error so callers can fall back to the exact path', async () => {
    const svc = makeService([]) // immediate error
    await expect(sampledSignalCounts(svc, 'd1', ['f'], THEMES)).rejects.toThrow('sampled_signal_counts_blocks failed')
  })
})

describe('sampledNumericFieldStats — keyset pager (sql/163)', () => {
  it('accumulates sum/n/min/max across pages and derives the mean', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService([
      { n_scanned: 5000, n: 4000, sum: 16000, min: 1, max: 5, last_row_index: 20 },
      { n_scanned: 5000, n: 3000, sum: 15000, min: 2, max: 4, last_row_index: 40 },
    ], calls, 'sampled_numeric_field_stats_blocks')

    const r = await sampledNumericFieldStats(svc, 'd1', 'rating', null, 10000)

    expect(r.scanned).toBe(10000)
    expect(r.n).toBe(7000)
    expect(r.avg).toBeCloseTo(31000 / 7000)
    expect(r.min).toBe(1)
    expect(r.max).toBe(5)
    expect(calls[0].p_aliases).toBeNull()
    expect(calls[1].p_after_row_index).toBe(20) // cursor advanced (row_index, was the hash)
  })

  it('passes the alias map through and handles a rating-less sample', async () => {
    const calls: Record<string, unknown>[] = []
    const svc = makeService([
      { n_scanned: 3000, n: 0, sum: null, min: null, max: null, last_row_index: null },
    ], calls, 'sampled_numeric_field_stats_blocks')

    const r = await sampledNumericFieldStats(svc, 'd1', 'sat', { 'Highly Satisfied': '5' }, 50000)

    expect(calls[0].p_aliases).toEqual({ 'Highly Satisfied': '5' })
    expect(r.n).toBe(0)
    expect(r.avg).toBeNull()
  })

  it('throws on RPC error so callers fall back to the exact aggregates', async () => {
    const svc = makeService([], [], 'sampled_numeric_field_stats_blocks')
    await expect(sampledNumericFieldStats(svc, 'd1', 'rating', null)).rejects.toThrow('sampled_numeric_field_stats_blocks failed')
  })
})

describe('scaleSampledCount', () => {
  it('scales by total/scanned and rounds', () => {
    expect(scaleSampledCount(20000, 150000, 50000)).toBe(60000)
    expect(scaleSampledCount(1, 785638, 50000)).toBe(16)
  })
  it('returns the raw count when the scan covered everything', () => {
    expect(scaleSampledCount(123, 40000, 40000)).toBe(123)
    expect(scaleSampledCount(123, 30000, 40000)).toBe(123)
  })
  it('guards a zero-row scan', () => {
    expect(scaleSampledCount(5, 100, 0)).toBe(0)
  })
})
