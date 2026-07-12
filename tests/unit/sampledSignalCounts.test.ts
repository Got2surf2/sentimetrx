import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sampledSignalCounts, scaleSampledCount } from '@/lib/sampledSignalCounts'

// Fake service exposing only the sampled_signal_counts RPC — serves queued
// pages and records the cursors it was called with.
function makeService(pages: Record<string, unknown>[], calls: Record<string, unknown>[] = []) {
  let i = 0
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'sampled_signal_counts') throw new Error('unexpected rpc ' + fn)
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
      { n: 5000, records: [4000], theme_counts: [1000, 200], union_count: 1100, last_hash: 10, last_id: 20 },
      { n: 5000, records: [3800], theme_counts: [900, 300], union_count: 1150, last_hash: 30, last_id: 40 },
    ], calls)

    const r = await sampledSignalCounts(svc, 'd1', ['f'], THEMES, 10000)

    expect(r.scanned).toBe(10000)
    expect(r.recordsPerField).toEqual([7800])
    expect(r.perTheme).toEqual([1900, 500])
    expect(r.union).toBe(2250)
    // page 2 must resume from page 1's cursor
    expect(calls[1].p_after_hash).toBe(10)
    expect(calls[1].p_after_id).toBe(20)
  })

  it('stops early when the dataset runs out of rows (short page)', async () => {
    const svc = makeService([
      { n: 5000, records: [4000], theme_counts: [1000, 0], union_count: 1000, last_hash: 10, last_id: 20 },
      { n: 1200, records: [900], theme_counts: [150, 0], union_count: 150, last_hash: 99, last_id: 99 },
      { n: 0, records: [0], theme_counts: [0, 0], union_count: 0, last_hash: null, last_id: null },
    ])

    const r = await sampledSignalCounts(svc, 'd1', ['f'], THEMES, 50000)

    expect(r.scanned).toBe(6200)
    expect(r.recordsPerField).toEqual([4900])
  })

  it('throws on RPC error so callers can fall back to the exact path', async () => {
    const svc = makeService([]) // immediate error
    await expect(sampledSignalCounts(svc, 'd1', ['f'], THEMES)).rejects.toThrow('sampled_signal_counts failed')
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
