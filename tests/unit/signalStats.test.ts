import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { computeSignalStats, computeSignalStatsForSet, themeModelHash } from '@/lib/signalStats'

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
  // stored datasets.row_count (defaults to flatCount; null = legacy dataset,
  // forces the exact head-count fallback)
  rowCount?: number | null
  // theme model served by dataset_state (defaults to THEME_MODEL)
  themeModel?: Record<string, unknown>
  // per-field cache map stored at analytics.signal_stats_by_field
  cachedByField?: Record<string, unknown> | null
  // page queue for the sampled_signal_counts RPC (sql/162)
  sampledPages?: Record<string, unknown>[]
  // observes every rpc(fn, args) call — used to pin the substantive gate
  rpcSpy?: (fn: string, args: unknown) => void
}

// Minimal Supabase fake covering exactly the chains signalStats walks:
//   dataset_state .select().eq().single()        -> { theme_model, analytics }
//   datasets      .select().eq().single()        -> { id, source:'study' }
//   dataset_rows_flat .select(count,head).…       -> { count }
//   .rpc('merge_dataset_analytics')               -> { error:null } (persist path)
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
        const analytics: Record<string, unknown> = {}
        if (o.cached) analytics.signal_stats = o.cached
        if (o.cachedByField) analytics.signal_stats_by_field = o.cachedByField
        return Promise.resolve({ data: { theme_model: o.themeModel ?? THEME_MODEL, analytics } })
      }
      if (table === 'datasets') return Promise.resolve({ data: { id: 'd1', source: 'study' } })
      return Promise.resolve({ data: null })
    }
    // thenables awaited directly: the dataset_rows_flat exact head-count and
    // the datasets stored-row_count list read (memberRowCounts)
    ch.then = (res: (v: unknown) => unknown) => {
      if (table === 'dataset_rows_flat') return Promise.resolve({ count: o.flatCount }).then(res)
      if (table === 'datasets') {
        const rowCount = o.rowCount === undefined ? o.flatCount : o.rowCount
        return Promise.resolve({ data: [{ id: 'd1', row_count: rowCount }] }).then(res)
      }
      return Promise.resolve({ data: null }).then(res)
    }
    return ch
  }
  let sampledIdx = 0
  return {
    from(table: string) {
      return {
        select: () => chain(table),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
    // Persistence now goes through the atomic merge RPC (lib/datasetAnalytics),
    // so the persist-spy tracks that call; count_nonempty_rows (sql/161, the
    // comma-safe records counter) mirrors the fake DB's non-empty count; the
    // theme-match count RPCs return rpcVal.
    rpc: (fn: string, args: unknown) => {
      o.rpcSpy?.(fn, args)
      if (fn === 'merge_dataset_analytics') {
        o.updateSpy(args)
        return Promise.resolve({ error: null })
      }
      if (fn === 'count_nonempty_rows') return Promise.resolve({ data: o.flatCount })
      if (fn === 'sampled_signal_counts_blocks') {
        const page = (o.sampledPages || [])[sampledIdx++]
        if (!page) return Promise.resolve({ data: null, error: { message: 'no page queued' } })
        return Promise.resolve({ data: page, error: null })
      }
      return Promise.resolve({ data: o.rpcVal })
    },
  } as unknown as SupabaseClient
}

describe('computeSignalStats — cache freshness', () => {
  it('returns the cache untouched when hash AND row_count both match', async () => {
    const updateSpy = vi.fn()
    const cached = {
      records: 67, signals: 115, inThemes: 59, themeFitPct: 88,
      themeFitBand: 'Tight', themeCount: 8,
      substantiveRecords: 50, inThemesSubstantive: 47, themeFitPctSubstantive: 94, themeFitBandSubstantive: 'Tight',
      theme_model_hash: HASH, row_count: 67, computed_at: '2026-05-13T12:59:36Z', stats_v: 4,
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
      substantiveRecords: 50, inThemesSubstantive: 47, themeFitPctSubstantive: 94, themeFitBandSubstantive: 'Tight',
      theme_model_hash: HASH, row_count: 67, computed_at: '2026-05-13T12:59:36Z', stats_v: 4,
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
      substantiveRecords: 50, inThemesSubstantive: 47, themeFitPctSubstantive: 94, themeFitBandSubstantive: 'Tight',
      theme_model_hash: HASH, computed_at: '2026-05-13T12:59:36Z', // no row_count
    }
    const svc = makeService({ cached, flatCount: 67, rpcVal: 0, updateSpy })

    await computeSignalStats(svc, 'd1')

    expect(updateSpy).toHaveBeenCalledTimes(1) // undefined row_count never matches → self-heal
  })
})

describe('computeSignalStats — sampled path above the cap (sql/162)', () => {
  it('computes EXACT counts over the deterministic sample (Model A — no scaling), flags sampled', async () => {
    const updateSpy = vi.fn()
    // 150K rows (> 50K cap): the pager draws two 25K pages, then stops at the
    // cap. Model A (owner 2026-07-14): the sample IS the view — report the exact
    // counts of the 50K sample, NOT scaled to the full dataset.
    const page = {
      n: 25000, records: [20000], records_substantive: [10000],
      theme_counts: [5000], union_count: 5000, union_substantive: 4000,
      last_row_index: 456,
    }
    const svc = makeService({
      cached: null, flatCount: 150000, rpcVal: 99999, updateSpy,
      rowCount: 150000, sampledPages: [page, page],
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.sampled).toBe(true)
    expect(stats.records).toBe(40000)  // 20000+20000, exact sample (no scaling)
    expect(stats.signals).toBe(10000)  // 5000+5000
    expect(stats.inThemes).toBe(10000)
    expect(stats.themeFitPct).toBe(25)  // ratio unchanged (10000/40000)
    // substantive twin: denom 10000+10000 = 20000, num 4000+4000 = 8000
    expect(stats.substantiveRecords).toBe(20000)
    expect(stats.inThemesSubstantive).toBe(8000)
    expect(stats.themeFitPctSubstantive).toBe(40)  // 8000/20000 — higher, junk dropped
    expect(updateSpy).toHaveBeenCalledTimes(1) // persisted with the sampled flag
  })

  it('falls back to the exact path when the sampled RPC is unavailable', async () => {
    const updateSpy = vi.fn()
    // No pages queued → sampled RPC errors (e.g. PGRST202 pre-migration).
    // The exact path must still produce pre-sql/162 numbers.
    const svc = makeService({
      cached: null, flatCount: 150000, rpcVal: 40000, updateSpy,
      rowCount: 150000, sampledPages: [],
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.sampled).toBeUndefined()
    expect(stats.records).toBe(150000) // exact count_nonempty_rows
    expect(stats.signals).toBe(40000)  // exact count_theme_matches
  })

  it('stays exact at or under the cap', async () => {
    const updateSpy = vi.fn()
    const svc = makeService({ cached: null, flatCount: 50000, rpcVal: 12000, updateSpy, rowCount: 50000 })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.sampled).toBeUndefined()
    expect(stats.records).toBe(50000)
  })
})

describe('computeSignalStatsForSet — per-field cache slots', () => {
  // Top-level (active) set bound to field A; a stored per-field entry for B.
  const MODEL_B = { fieldNames: ['field_b'], themes: [{ id: 'tb', keywords: ['slow'] }] }
  const TM_WITH_FIELDS = {
    ...THEME_MODEL,
    fields: { field_b: MODEL_B },
  }
  const HASH_B = themeModelHash(MODEL_B)

  it('returns the cached slot for a non-active set without recomputing', async () => {
    const updateSpy = vi.fn()
    const cachedB = {
      records: 40, signals: 12, inThemes: 10, themeFitPct: 25,
      themeFitBand: 'Diffuse', themeCount: 1,
      substantiveRecords: 30, inThemesSubstantive: 9, themeFitPctSubstantive: 30, themeFitBandSubstantive: 'Diffuse',
      theme_model_hash: HASH_B, row_count: 67, computed_at: '2026-07-11T00:00:00Z', stats_v: 4,
    }
    const svc = makeService({
      cached: null, flatCount: 67, rpcVal: 0, updateSpy,
      themeModel: TM_WITH_FIELDS, cachedByField: { field_b: cachedB },
    })

    const stats = await computeSignalStatsForSet(svc, 'd1', 'field_b')

    expect(stats.records).toBe(40) // served from the per-field slot
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('computes + persists a per-field slot on miss, pruning removed fields', async () => {
    const updateSpy = vi.fn()
    const staleOther = { records: 1, signals: 1, inThemes: 1, themeFitPct: 100, themeFitBand: 'Tight', themeCount: 1, theme_model_hash: 'x', row_count: 1, computed_at: '' }
    const svc = makeService({
      cached: null, flatCount: 67, rpcVal: 20, updateSpy,
      themeModel: TM_WITH_FIELDS,
      // stale hash for field_b forces a recompute; removed_field has no
      // matching set anymore and must be pruned from the rewritten map
      cachedByField: { field_b: { ...staleOther, theme_model_hash: 'stale' }, removed_field: staleOther },
    })

    const stats = await computeSignalStatsForSet(svc, 'd1', 'field_b')

    expect(stats.records).toBe(67) // fresh compute
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const patch = (updateSpy.mock.calls[0][0] as { p_patch: { signal_stats_by_field: Record<string, { theme_model_hash: string }> } }).p_patch
    expect(patch.signal_stats_by_field.field_b.theme_model_hash).toBe(HASH_B)
    expect(patch.signal_stats_by_field.removed_field).toBeUndefined()
  })

  it('delegates the ACTIVE field key to the main cached path', async () => {
    const updateSpy = vi.fn()
    const cached = {
      records: 67, signals: 115, inThemes: 59, themeFitPct: 88,
      themeFitBand: 'Tight', themeCount: 8,
      substantiveRecords: 50, inThemesSubstantive: 47, themeFitPctSubstantive: 94, themeFitBandSubstantive: 'Tight',
      theme_model_hash: HASH, row_count: 67, computed_at: '2026-05-13T12:59:36Z', stats_v: 4,
    }
    const svc = makeService({
      cached, flatCount: 67, rpcVal: 0, updateSpy, themeModel: TM_WITH_FIELDS,
    })

    const stats = await computeSignalStatsForSet(svc, 'd1', 'experience_followup')

    expect(stats.records).toBe(67) // the active slot's cache, untouched
    expect(updateSpy).not.toHaveBeenCalled()
  })
})

// ── Signals: themes carried per comment (owner 2026-09-03) ────────────────
// "Signals should be the number of themes in a specific comment, and the signal
// ratio should be total signals / total comments." The total is therefore the
// sum of the per-theme comment counts — which the theme cards also display, so
// it MUST be counted on the same substantive base they are (sql/181). A signals
// total that didn't sum to the visible cards would be a second denominator.
describe('signals + signal ratio', () => {
  it('counts the per-theme numerator on the SUBSTANTIVE base (exact path)', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    // Two single-keyword themes, so a PER-THEME call is identifiable by its
    // one-keyword payload — the any-theme union calls pass both keywords.
    const svc = makeService({
      cached: null, flatCount: 100, rpcVal: 40, updateSpy: vi.fn(), rowCount: 100,
      themeModel: {
        fieldNames: ['experience_followup'],
        themes: [{ id: 't1', keywords: ['great'] }, { id: 't2', keywords: ['slow'] }],
      },
      rpcSpy: (fn, args) => { calls.push({ fn, args: args as Record<string, unknown> }) },
    })

    await computeSignalStats(svc, 'd1')

    // Every per-theme call carries the substantive gate — the same flag
    // theme-counts' themeMatchCount sets, so the two agree row for row.
    const perTheme = calls.filter(c =>
      c.fn === 'count_theme_matches' && (c.args.p_keywords as unknown[]).length === 1)
    expect(perTheme).toHaveLength(2)
    for (const c of perTheme) expect(c.args.p_substantive_only).toBe(true)
    // The all-based theme-fit numerator stays UNGATED — it divides by the
    // all-based records, so gating it would mix two populations.
    const ungatedUnion = calls.filter(c =>
      c.fn === 'count_theme_matches' && (c.args.p_keywords as unknown[]).length === 2
      && c.args.p_substantive_only === undefined)
    expect(ungatedUnion).toHaveLength(1)
  })

  it('ratio = signals / substantive comments, and totalRows carries the trio tier 1', async () => {
    // One theme, every RPC returns 40 matches against a 100-row / 100-comment
    // dataset: 40 signals over 100 substantive comments = 0.4 themes per comment.
    const svc = makeService({
      cached: null, flatCount: 100, rpcVal: 40, updateSpy: vi.fn(), rowCount: 250,
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.signals).toBe(40)
    expect(stats.substantiveRecords).toBe(100)
    expect(stats.signalRatio).toBe(0.4)
    expect(stats.totalRows).toBe(250)  // tier 1 — rows, not comments
  })

  it('multi-theme comments push the ratio above 1 (a comment can carry several)', async () => {
    const svc = makeService({
      cached: null, flatCount: 100, rpcVal: 60, updateSpy: vi.fn(), rowCount: 100,
      themeModel: {
        fieldNames: ['experience_followup'],
        themes: [{ id: 't1', keywords: ['great'] }, { id: 't2', keywords: ['slow'] }],
      },
    })

    const stats = await computeSignalStats(svc, 'd1')

    // 2 themes x 60 matching comments = 120 signals over 100 comments. The
    // total EXCEEDS the comment count precisely because signals count themes,
    // not comments — the property that distinguishes it from inThemes.
    expect(stats.signals).toBe(120)
    expect(stats.signalRatio).toBe(1.2)
  })

  it('uses the substantive twin on the sampled path when the RPC returns it', async () => {
    const page = {
      n: 25000, records: [20000], records_substantive: [10000],
      theme_counts: [5000], theme_counts_substantive: [3000],
      union_count: 5000, union_substantive: 4000, last_row_index: 456,
    }
    const svc = makeService({
      cached: null, flatCount: 150000, rpcVal: 99999, updateSpy: vi.fn(),
      rowCount: 150000, sampledPages: [page, page],
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.signals).toBe(6000)          // 3000+3000, the gated twin
    expect(stats.substantiveRecords).toBe(20000)
    expect(stats.signalRatio).toBe(0.3)       // 6000/20000
  })

  it('falls back to the ungated count when the DB predates the substantive twin', async () => {
    // Deploy-order safety: a database without theme_counts_substantive omits
    // the key entirely. Accumulating that as 0 would publish "0 signals" on a
    // dataset that plainly has them — an unmeasured zero rendered as a verdict,
    // the 2026-08-13 metric-strip bug class. Fall back to the ungated count.
    const page = {
      n: 25000, records: [20000], records_substantive: [10000],
      theme_counts: [5000], union_count: 5000, union_substantive: 4000,
      last_row_index: 456,
    }
    const svc = makeService({
      cached: null, flatCount: 150000, rpcVal: 99999, updateSpy: vi.fn(),
      rowCount: 150000, sampledPages: [page, page],
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.signals).toBe(10000)  // ungated 5000+5000, NOT 0
  })

  it('reports a null ratio rather than 0.0 when there is no substantive base', async () => {
    const svc = makeService({
      cached: null, flatCount: 0, rpcVal: 0, updateSpy: vi.fn(), rowCount: 500,
    })

    const stats = await computeSignalStats(svc, 'd1')

    expect(stats.signalRatio).toBeNull()  // "not measured", never "no signal"
    expect(stats.totalRows).toBe(500)
  })
})
