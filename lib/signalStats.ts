// lib/signalStats.ts
//
// Shared computation for dataset signal stats (records / signals /
// in-themes / theme-fit). Used by the single-dataset signal-stats
// endpoint and the batch endpoint that powers the listing page.
//
// Caching: results are written to `dataset_state.analytics.signal_stats`
// keyed by a hash of the theme model. When the saved theme model
// changes the hash flips and the next read recomputes; otherwise the
// strip + listing card return in ~50ms instead of 1–4s.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SignalStats {
  records: number
  signals: number
  inThemes: number
  themeFitPct: number
  themeFitBand: 'Tight' | 'Mixed' | 'Diffuse'
  themeCount: number
}

interface Theme { id?: string; keywords?: string[] }
interface ThemeModel {
  themes?: Theme[]
  fieldName?: string
  fieldNames?: string[]
}

interface CachedSignalStats extends SignalStats {
  theme_model_hash: string
  row_count: number
  computed_at: string
}

function band(pct: number): SignalStats['themeFitBand'] {
  if (pct >= 85) return 'Tight'
  if (pct >= 60) return 'Mixed'
  return 'Diffuse'
}

export function themeModelHash(tm: ThemeModel | null | undefined): string {
  if (!tm || !Array.isArray(tm.themes) || tm.themes.length === 0) return ''
  const sig = {
    themes: tm.themes
      .map(t => ({
        id: String(t.id || ''),
        keywords: (t.keywords || []).filter(Boolean).map(k => String(k).toLowerCase()).sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    fields: tm.fieldNames && tm.fieldNames.length
      ? [...tm.fieldNames].sort()
      : (tm.fieldName ? [tm.fieldName] : []),
  }
  return createHash('md5').update(JSON.stringify(sig)).digest('hex').slice(0, 12)
}

function emptyStats(themeCount: number): SignalStats {
  return {
    records: 0, signals: 0, inThemes: 0,
    themeFitPct: 0, themeFitBand: 'Diffuse',
    themeCount,
  }
}

/**
 * Resolve the underlying dataset IDs whose rows feed the stats: the
 * dataset itself, or — for a collection — its member datasets. Shared
 * by the compute path and the cache freshness check so both count the
 * exact same rows.
 */
async function resolveDatasetIds(
  service: SupabaseClient,
  datasetId: string,
): Promise<string[]> {
  const { data: ds } = await service
    .from('datasets')
    .select('id, source')
    .eq('id', datasetId)
    .single()
  if (!ds) return []
  if ((ds as { source?: string }).source !== 'collection') return [datasetId]
  const { data: coll } = await service
    .from('collections')
    .select('id')
    .eq('dataset_id', datasetId)
    .single()
  if (!coll) return []
  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id')
    .eq('collection_id', (coll as { id: string }).id)
  return ((members || []) as { dataset_id: string }[]).map(m => m.dataset_id)
}

/**
 * Cheap freshness signal for the cache: total rows feeding the stats.
 * Changes when rows are synced in or deleted — which the theme-model
 * hash alone does NOT capture, so a cache keyed only on that hash goes
 * permanently stale after a sync until the theme model is next edited.
 * (Edits that fill a previously-empty field without changing the row
 * count are not detected — a rare case; re-mining the themes forces a
 * recompute regardless.)
 */
async function totalRowCount(
  service: SupabaseClient,
  datasetIds: string[],
): Promise<number> {
  if (!datasetIds.length) return 0
  const { count } = await service
    .from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true })
    .in('dataset_id', datasetIds)
  return count || 0
}

/**
 * Compute signal stats for a dataset (or collection). Pure DB work, no
 * caching. Use computeSignalStats for the cache-aware version.
 */
export async function computeSignalStatsRaw(
  service: SupabaseClient,
  datasetId: string,
): Promise<SignalStats> {
  // Load theme model
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('theme_model')
    .eq('dataset_id', datasetId)
    .single()
  const themeModel = (stateRow as { theme_model: ThemeModel | null } | null)?.theme_model || null

  const themes = (themeModel?.themes || []).filter(
    (t): t is Required<Pick<Theme, 'keywords'>> & Theme =>
      Array.isArray(t.keywords) && t.keywords.filter(Boolean).length > 0,
  )

  let fields: string[] = []
  if (themeModel?.fieldNames && themeModel.fieldNames.length) fields = themeModel.fieldNames
  else if (themeModel?.fieldName) fields = [themeModel.fieldName]

  // Resolve the dataset (or its collection members) that hold the rows
  const datasetIds = await resolveDatasetIds(service, datasetId)

  if (!themes.length || !fields.length || !datasetIds.length) {
    return emptyStats(themes.length)
  }

  // Run every independent DB call in parallel. For a 14-theme dataset
  // on a 2-member collection the old serial loop was ~30 RPCs ×
  // ~100ms each = ~3s per dataset; parallel it's bounded by the
  // slowest single RPC (~300-500ms). Three groups of work fire at once:
  //   - records  : per-field non-empty counts × member
  //   - signals  : per-theme count_theme_matches × member
  //   - inThemes : union-keyword count_theme_matches × member

  const allKeywords = Array.from(
    new Set(themes.flatMap(t => (t.keywords || []).filter(Boolean))),
  )

  // records — promise per (field, member); reduce per field, max across fields
  const recordsPerField = await Promise.all(
    fields.map(async f => {
      const counts = await Promise.all(
        datasetIds.map(async did => {
          const { count, error } = await service
            .from('dataset_rows_flat')
            .select('id', { count: 'exact', head: true })
            .eq('dataset_id', did)
            .not('data->' + f, 'is', null)
            .neq('data->>' + f, '')
          // A transient error here (e.g. statement timeout on the exact-count
          // scan of a large dataset under parallel load) used to be swallowed:
          // `count` came back null → 0, and computeSignalStats then cached
          // `records: 0` permanently (the freshness check keys on theme-model
          // hash + row_count, neither of which flips on a recompute). That
          // poisoned the cache for Rubio's/BareBurger — non-zero signals but
          // records:0 → themeFitPct:0 → the listing card hid its signal-stats
          // line. Throw instead so the bad partial is never persisted; the
          // batch endpoint catches it and the next load recomputes.
          if (error) throw new Error('records count failed for ' + did + ': ' + error.message)
          return count || 0
        }),
      )
      return counts.reduce((s, c) => s + c, 0)
    }),
  )
  const records = recordsPerField.reduce((m, v) => Math.max(m, v), 0)

  // signals — one promise per (theme, member), summed
  const signalsCalls = themes.flatMap(t =>
    datasetIds.map(did =>
      service.rpc('count_theme_matches', {
        p_dataset_id: did,
        p_field_keys: fields,
        p_keywords: (t.keywords || []).filter(Boolean),
      }),
    ),
  )
  // inThemes — one promise per member
  const inThemesCalls = datasetIds.map(did =>
    service.rpc('count_theme_matches', {
      p_dataset_id: did,
      p_field_keys: fields,
      p_keywords: allKeywords,
    }),
  )
  const [signalsResults, inThemesResults] = await Promise.all([
    Promise.all(signalsCalls),
    Promise.all(inThemesCalls),
  ])
  const signals = signalsResults.reduce((s, r) => s + (Number(r.data) || 0), 0)
  const inThemes = inThemesResults.reduce((s, r) => s + (Number(r.data) || 0), 0)

  const themeFitPct = records > 0 ? Math.round((inThemes / records) * 100) : 0
  return {
    records, signals, inThemes,
    themeFitPct, themeFitBand: band(themeFitPct),
    themeCount: themes.length,
  }
}

/**
 * Cache-aware variant. Returns the cached SignalStats from
 * dataset_state.analytics.signal_stats when BOTH the theme model hash
 * and the row count match the current state, otherwise computes + writes.
 *
 * Two invalidation triggers: editing/re-mining themes flips the hash, and
 * syncing rows in/out changes the row count. Either one forces a recompute
 * on the next read. (invalidateSignalStats() below can drop the cache
 * eagerly, but the row-count check makes that optional for sync paths.)
 */
export async function computeSignalStats(
  service: SupabaseClient,
  datasetId: string,
): Promise<SignalStats> {
  // Read current theme model + cached stats together
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('theme_model, analytics')
    .eq('dataset_id', datasetId)
    .single()
  if (!stateRow) {
    // No state row at all — fall back to raw compute (will return empties).
    return computeSignalStatsRaw(service, datasetId)
  }
  const row = stateRow as { theme_model: ThemeModel | null; analytics: Record<string, unknown> | null }
  const currentHash = themeModelHash(row.theme_model)
  const cached = (row.analytics as { signal_stats?: CachedSignalStats } | null)?.signal_stats

  // Freshness: the hash only flips on theme-model edits, so it can't see
  // rows added/removed by a sync. Pair it with the current row count so a
  // sync invalidates the cache. (Caches written before row_count existed
  // have it undefined → never matches → recompute, which is the desired
  // self-heal for already-stale entries.)
  const datasetIds = await resolveDatasetIds(service, datasetId)
  const currentRowCount = await totalRowCount(service, datasetIds)

  // A cache with signals/inThemes > 0 but records == 0 is internally
  // inconsistent — a row can't match a theme without its text field being
  // non-empty, so records >= inThemes always. This shape was produced by the
  // old swallowed-error path (records count-query timed out → 0 → cached),
  // and the freshness check above can't see it (hash + row_count still match).
  // Treat it as poisoned and recompute, self-healing the bad entries.
  const poisoned = !!cached && cached.records === 0 && (cached.signals > 0 || cached.inThemes > 0)

  if (
    cached &&
    !poisoned &&
    cached.theme_model_hash === currentHash &&
    currentHash !== '' &&
    cached.row_count === currentRowCount
  ) {
    const { theme_model_hash: _h, row_count: _r, computed_at: _c, ...stats } = cached
    return stats
  }

  // Compute fresh, persist
  const stats = await computeSignalStatsRaw(service, datasetId)
  const nextAnalytics = {
    ...(row.analytics || {}),
    signal_stats: {
      ...stats,
      theme_model_hash: currentHash,
      row_count: currentRowCount,
      computed_at: new Date().toISOString(),
    } satisfies CachedSignalStats,
  }
  await service
    .from('dataset_state')
    .update({ analytics: nextAnalytics })
    .eq('dataset_id', datasetId)

  return stats
}

/**
 * Drop the cached signal stats so the next read recomputes. Call from
 * sync completion + theme model save paths if you want immediate
 * staleness rather than waiting for the hash mismatch (which only
 * catches theme model changes, not new row inserts).
 */
export async function invalidateSignalStats(
  service: SupabaseClient,
  datasetId: string,
): Promise<void> {
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('analytics')
    .eq('dataset_id', datasetId)
    .single()
  if (!stateRow) return
  const analytics = (stateRow as { analytics: Record<string, unknown> | null }).analytics || {}
  if (!('signal_stats' in analytics)) return
  const next = { ...analytics }
  delete (next as Record<string, unknown>).signal_stats
  await service.from('dataset_state').update({ analytics: next }).eq('dataset_id', datasetId)
}
