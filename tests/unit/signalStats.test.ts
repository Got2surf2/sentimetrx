import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeSignalStats, themeModelHash } from '@/lib/signalStats'

// A single-field, single-theme model so the records denominator is just the
// non-empty count of that field — easy to reason about against the fake DB.
const THEME_MODEL = {
  fieldNames: ['experience_followup'],
  themes: [{ id: 't1', keywords: ['great', 'helpful'] }],
}
const HASH = themeModelHash(THEME_MODEL)

interface FakeOpts {
  // cached signal_stats blob stored on dataset_state.analytics (or null)
  cached: Record<string, unknown> | null
  // current non-empty / total row count the fake DB reports
  flatCount: number
  // value every count_theme_matches RPC returns
  rpcVal: number
  updateSpy: (payload: unknown) => void
}

// Minimal Supabase fake covering exactly the chains signalStats walks:
//   dataset_state .select().eq().single()        -> { theme_model, analytics }
//   datasets      .select().eq().single()        -> { id, source:'study' }
//   dataset_rows_flat .select(count,head).…       -> { count }
//   dataset_state .update().eq()                  -> { error:null }
//   .rpc('count_theme_matches')                   -> { data }
function makeService(o: FakeOpts): SupabaseClient {
  function chain(table: string) {
    const ch: Record<string, unknown> = {}
    const pass = () => ch
    ch.eq = pass
    ch.neq = pass
    ch.not = pass
    ch.in = pass
    ch.single = () => {
      if (table === 'dataset_state') {
        return Promise.resolve({ data: { theme_model: THEME_MODEL, analytics: o.cached ? { signal_stats: o.cached } : {} } })
      }
      if (table === 'datasets') return Promise.resolve({ data: { id: 'd1', source: 'study' } })
      return Promise.resolve({ data: null })
    }
    // thenable: dataset_rows_flat count queries are awaited directly
    ch.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(table === 'dataset_rows_flat' ? { count: o.flatCount } : { data: null }).then(res)
    return ch
  }
  return {
    from(table: string) {
      return {
        select: () => chain(table),
        update: (payload: unknown) => {
          o.updateSpy(payload)
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: () => Promise.resolve({ data: o.rpcVal }),
  } as unknown as SupabaseClient
}

describe('computeSignalStats — cache freshness', () => {
  it('returns the cache untouched when hash AND row_count both match', async () => {
    const updateSpy = vi.fn()
    const cached = {
      records: 67, signals: 115, inThemes: 59, themeFitPct: 88,
      themeFitBand: 'Tight', themeCount: 8,
      theme_model_hash: HASH, row_count: 67, computed_at: '2026-05-13T12:59:36Z',
    }
    const svc = makeService({ cached, flatCount: 67, rpcVal: 0, updateSpy })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.records).toBe(67) // served from cache
    expect(updateSpy).not.toHaveBeenCalled() // no recompute/persist
  })

  it('recomputes when rows were synced in (row_count changed) even though the hash is unchanged', async () => {
    // This is the Coalition bug: themes never edited (hash stable) but 13 rows
    // arrived after the cache was written, so 67 became 80.
    const updateSpy = vi.fn()
    const cached = {
      records: 67, signals: 115, inThemes: 59, themeFitPct: 88,
      themeFitBand: 'Tight', themeCount: 8,
      theme_model_hash: HASH, row_count: 67, computed_at: '2026-05-13T12:59:36Z',
    }
    // live DB now has 80 non-empty rows for the field
    const svc = makeService({ cached, flatCount: 80, rpcVal: 10, updateSpy })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.records).toBe(80) // freshly computed, not the stale 67
    expect(updateSpy).toHaveBeenCalledTimes(1) // recomputed + persisted
  })

  it('recomputes a legacy cache that predates the row_count field', async () => {
    const updateSpy = vi.fn()
    const cached = {
      records: 67, signals: 115, inThemes: 59, themeFitPct: 88,
      themeFitBand: 'Tight', themeCount: 8,
      theme_model_hash: HASH, computed_at: '2026-05-13T12:59:36Z', // no row_count
    }
    const svc = makeService({ cached, flatCount: 67, rpcVal: 0, updateSpy })

    await computeSignalStats(svc, 'd1')

    expect(updateSpy).toHaveBeenCalledTimes(1) // undefined row_count never matches → self-heal
  })
})
