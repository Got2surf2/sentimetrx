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
import { mergeDatasetAnalytics, deleteDatasetAnalyticsKey } from '@/lib/datasetAnalytics'
import { logError } from '@/lib/log'
import { countNonEmptyRows } from '@/lib/nonEmptyCount'
import { sampledSignalCounts, SIGNAL_SAMPLE_CAP } from '@/lib/sampledSignalCounts'
import { kwPatternFragment, themeFieldEntries, themeModelKey, type ThemeModel as UtilThemeModel } from '@/lib/themeUtils'

export interface SignalStats {
  /** Tier 1 of the coverage trio (owner 2026-09-03): total rows in the dataset
   *  (or summed across collection members), whether or not they carry text.
   *  The trio is total rows -> `records` (carry a comment) -> `substantiveRecords`
   *  (that comment says something). */
  totalRows: number
  records: number
  /** SIGNALS (owner 2026-09-03): "the number of themes in a specific comment",
   *  summed over comments — so a comment matching 3 themes contributes 3 and
   *  `signals` >= `inThemes` whenever any comment is multi-theme. It is the sum
   *  of the per-theme counts the theme cards print, which means it is gated to
   *  the SUBSTANTIVE base (sql/181) exactly like they are: a signals total that
   *  didn't sum to the visible cards would be a second denominator (see
   *  ENGINEERING: every number reconciles to ONE method).
   *
   *  NOT keyword occurrences. `themeUtils.snippetCount` counts those ("slow"
   *  3x in one comment = 3) and is a different, card-local metric labelled
   *  "snippets". */
  signals: number
  inThemes: number
  themeFitPct: number
  themeFitBand: 'Tight' | 'Mixed' | 'Diffuse'
  themeCount: number
  /** Substantive-scoped theme fit (sql/178/179): the LEAD number on the strip.
   *  `substantiveRecords` = comments carrying usable feedback (drops "N/A" /
   *  "Nothing"); `inThemesSubstantive` = those matching a theme. Both numerator
   *  AND denominator are gated so the fit isn't inflated by matches on junk. The
   *  all-based trio (records/inThemes/themeFitPct) stays for the hover. */
  substantiveRecords: number
  inThemesSubstantive: number
  themeFitPctSubstantive: number
  themeFitBandSubstantive: 'Tight' | 'Mixed' | 'Diffuse'
  /** SIGNAL RATIO (owner 2026-09-03): total signals / total comments — the
   *  average number of themes a comment carries. Same substantive base as
   *  `signals`, so the division is within one population. Null when there is
   *  no substantive base to divide by (never rendered as 0.0, which would read
   *  as "no signal" rather than "not measured"). */
  signalRatio: number | null
  /** True when counts were computed over the deterministic 50K sample and
   *  scaled to the dataset's total rows (datasets above the sampling cap —
   *  exact per-theme scans exceed the DB statement timeout there). */
  sampled?: boolean
}

interface Theme { id?: string; keywords?: string[] }
interface ThemeModel {
  themes?: Theme[]
  fieldName?: string
  fieldNames?: string[]
}

// Bump when the COMPUTATION semantics of the cached numbers change (not the
// theme model) — old cache entries then recompute on next read. v2 = Model A
// (2026-07-14): sampled counts are the EXACT counts of the 50K sample, no longer
// scaled to the full dataset, so v1 entries hold stale scaled numbers.
// v3 = sql/191 (2026-08-16): the 50K sample itself changed, from hash order to
// stratified contiguous blocks. The cache key is (theme-model hash, row count),
// and NEITHER moves when the sampling scheme changes — so without this bump
// every existing entry would survive the conversion and keep serving numbers
// computed over rows that are no longer the sample.
// v4 = 2026-09-03: `signals` is now substantive-gated (it was counted over all
// non-empty rows, so it could not sum to the theme cards) and the payload gained
// totalRows + signalRatio. v3 entries hold the old ungated total and lack both
// new fields, so they must recompute rather than render a mismatched ratio.
const STATS_MODEL_VERSION = 4

interface CachedSignalStats extends SignalStats {
  theme_model_hash: string
  row_count: number
  computed_at: string
  stats_v?: number
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

/**
 * Did this fail because the database killed the statement? Postgres reports
 * 57014; PostgREST surfaces it as a message rather than a code, so match both.
 */
function isStatementTimeout(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '57014') return true
  return typeof e.message === 'string' && /statement timeout|57014/i.test(e.message)
}

function emptyStats(themeCount: number, totalRows: number): SignalStats {
  return {
    totalRows,
    records: 0, signals: 0, inThemes: 0,
    themeFitPct: 0, themeFitBand: 'Diffuse',
    substantiveRecords: 0, inThemesSubstantive: 0,
    themeFitPctSubstantive: 0, themeFitBandSubstantive: 'Diffuse',
    signalRatio: null,
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
  const { data: ds, error: dsErr } = await service
    .from('datasets')
    .select('id, source')
    .eq('id', datasetId)
    .single()
  if (dsErr) void logError('signalStats.resolveDatasetIds', dsErr, { datasetId })
  if (!ds) return []
  if ((ds as { source?: string }).source !== 'collection') return [datasetId]
  const { data: coll, error: collErr } = await service
    .from('collections')
    .select('id')
    .eq('dataset_id', datasetId)
    .single()
  if (collErr) void logError('signalStats.resolveDatasetIds', collErr, { datasetId })
  if (!coll) return []
  const { data: members, error: membersErr } = await service
    .from('collection_members')
    .select('dataset_id')
    .eq('collection_id', (coll as { id: string }).id)
  if (membersErr) void logError('signalStats.resolveDatasetIds', membersErr, { datasetId })
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
 *
 * Reads the STORED datasets.row_count column — O(1) — instead of an exact
 * head-count over dataset_rows_flat, which cost an O(N) index scan on every
 * signal-stats call (including cache HITS) just to validate a ~50ms cache
 * read. The stored column is what the bulk rows route already trusts for its
 * sampling gate, and every product write path (upload, sync, trim) maintains
 * it. Members with a null row_count (legacy) fall back to one exact count.
 * Caches written under the old exact-count key mismatch once → recompute →
 * re-key, the desired self-heal.
 */
export async function memberRowCounts(
  service: SupabaseClient,
  datasetIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!datasetIds.length) return counts
  const { data, error } = await service
    .from('datasets')
    .select('id, row_count')
    .in('id', datasetIds)
  if (error) void logError('signalStats.memberRowCounts', error, { datasetIds })
  const byId = new Map(((data || []) as { id: string; row_count: number | null }[]).map(r => [r.id, r.row_count]))
  await Promise.all(datasetIds.map(async did => {
    const stored = byId.get(did)
    if (typeof stored === 'number') { counts.set(did, stored); return }
    const { count, error: countErr } = await service
      .from('dataset_rows_flat')
      .select('id', { count: 'exact', head: true })
      .eq('dataset_id', did)
    if (countErr) void logError('signalStats.memberRowCounts', countErr, { datasetIds: [did] })
    counts.set(did, count || 0)
  }))
  return counts
}

function sumCounts(counts: Map<string, number>): number {
  let total = 0
  for (const v of counts.values()) total += v
  return total
}

/**
 * Compute signal stats for a dataset (or collection). Pure DB work, no
 * caching. Use computeSignalStats for the cache-aware version.
 */
export async function computeSignalStatsRaw(
  service: SupabaseClient,
  datasetId: string,
  modelOverride?: ThemeModel | null,
): Promise<SignalStats> {
  // Load theme model (or take the caller's — the per-field path passes one
  // stored set so switching the Text pill gets that question's own stats)
  let themeModel = modelOverride || null
  if (!themeModel) {
    const { data: stateRow, error: stateRowErr } = await service
      .from('dataset_state')
      .select('theme_model')
      .eq('dataset_id', datasetId)
      .single()
    if (stateRowErr) void logError('signalStats.computeSignalStatsRaw', stateRowErr, { datasetId })
    themeModel = (stateRow as { theme_model: ThemeModel | null } | null)?.theme_model || null
  }

  const themes = (themeModel?.themes || []).filter(
    (t): t is Required<Pick<Theme, 'keywords'>> & Theme =>
      Array.isArray(t.keywords) && t.keywords.filter(Boolean).length > 0,
  )

  let fields: string[] = []
  if (themeModel?.fieldNames && themeModel.fieldNames.length) fields = themeModel.fieldNames
  else if (themeModel?.fieldName) fields = [themeModel.fieldName]

  // Resolve the dataset (or its collection members) that hold the rows
  const datasetIds = await resolveDatasetIds(service, datasetId)

  // Fetched before the empty guard (it reads the stored datasets.row_count
  // column, so it costs one indexed select): a dataset with no themes yet still
  // has a defensible tier-1 count for the coverage trio, and returning 0 there
  // would render as "0 reviews" on a dataset that plainly has rows.
  const rowCounts = await memberRowCounts(service, datasetIds)
  const totalRows = sumCounts(rowCounts)

  if (!themes.length || !fields.length || !datasetIds.length) {
    return emptyStats(themes.length, totalRows)
  }

  // Per member, three groups of counts:
  //   - records  : per-field non-empty counts
  //   - signals  : per-theme match counts
  //   - inThemes : rows matching ANY theme (union)
  //
  // Members at or under the sampling cap count EXACTLY — every independent
  // RPC fired in parallel (for a 14-theme dataset the old serial loop was
  // ~30 RPCs × ~100ms = ~3s; parallel it's bounded by the slowest RPC).
  //
  // Members ABOVE the cap use the sampled single-pass RPC (sql/162) over the
  // deterministic sql/191 block order — the same 50K sample the bulk rows
  // route serves — scaled to the member's total rows and flagged `sampled`.
  // The exact path there is 1 + themes + 1 FULL SCANS, each of which blows
  // the 8s DB statement timeout (~1.4GB of jsonb per scan at 785K rows,
  // prod 2026-07-11). If the sampled RPC isn't in the target database yet
  // (PGRST202 et al.) we fall back to the exact path — pre-sql/162 behavior.
  const perMember = await Promise.all(datasetIds.map(async did => {
    const memberTotal = rowCounts.get(did) || 0
    if (memberTotal > SIGNAL_SAMPLE_CAP) {
      try {
        const s = await sampledSignalCounts(service, did, fields, themes)
        // Model A (owner 2026-07-14): "we're looking at the sample as our view,
        // so everything is based on the 50K." Report the EXACT counts OF the
        // deterministic sample — no scaling to the full dataset, no "~". The
        // "◱ Sampled 50,000/M" chip is the single disclosure that it's a sample;
        // theme-fit stays a ratio (unaffected by whether we scale). This keeps
        // the strip's numbers identical to the client's sample-based counts
        // (mined banner / distribution) instead of a scaled estimate that
        // disagreed with them.
        return {
          recordsPerField: s.recordsPerField,
          recordsSubstantivePerField: s.recordsSubstantivePerField,
          // perThemeSubstantive, not perTheme: `signals` must sum to the theme
          // cards, whose numerator has been substantive-gated since sql/181.
          // The sampled RPC returns both in the same pass, so this is free.
          // On a database that predates the substantive twin the RPC omits it
          // and the accumulator is all-zero, so fall back to the ungated count
          // — a slightly high signals total beats reporting zero signals on a
          // dataset that plainly has them.
          perTheme: s.substantiveAvailable ? s.perThemeSubstantive : s.perTheme,
          union: s.union,
          unionSubstantive: s.unionSubstantive,
          sampled: true,
        }
      } catch (err) {
        void logError('signalStats.sampledSignalCounts', err, { datasetId: did })
        // fall through to the exact path
      }
    }

    // Below the cap the EXACT path runs — but "below the cap" is not the same
    // as "safe". Sentry caught this on a 27,234-row dataset in production
    // (`count_nonempty_rows failed … canceling statement due to statement
    // timeout`, GET /signal-stats): the exact count measured 2,431ms on TEST,
    // and prod runs this RPC roughly 2.5x slower (7,981ms vs 3,171ms on the
    // same Carrabba's call), which puts a mid-size dataset at ~6s against an 8s
    // ceiling. Any contention tips it over. countNonEmptyRows correctly THROWS
    // rather than swallowing to 0 — so no cache poisoning — but the throw
    // propagated out of the route and blanked the entire metric strip.
    //
    // A labelled estimate beats a 500. On a statement timeout, fall back to the
    // same sampled path used above the cap; the "Sampled" chip is already the
    // disclosure, so the degradation is visible rather than silent.
    try {
      return await exactCounts()
    } catch (err) {
      if (!isStatementTimeout(err)) throw err
      void logError('signalStats.exactTimedOut', err, { datasetId: did })
      const s = await sampledSignalCounts(service, did, fields, themes)
      return {
        recordsPerField: s.recordsPerField,
        recordsSubstantivePerField: s.recordsSubstantivePerField,
        perTheme: s.substantiveAvailable ? s.perThemeSubstantive : s.perTheme,
        union: s.union,
        unionSubstantive: s.unionSubstantive,
        sampled: true,
      }
    }

    async function exactCounts() {
    // records — one promise per field. countNonEmptyRows is comma-safe
    // (sql/161) — the raw PostgREST filter this used to build silently
    // matched nothing for question-sentence column names. (Its legacy
    // fallback path still swallows transient errors into 0 — the Rubio's/
    // BareBurger cache-poisoning class — but the fallback only runs until
    // sql/161 reaches the database.)
    const allKeywords = Array.from(
      new Set(themes.flatMap(t => (t.keywords || []).filter(Boolean))),
    )
    const [recordsPerField, recordsSubstantivePerField, signalsResults, inThemesResult, inThemesSubstantiveResult] = await Promise.all([
      Promise.all(fields.map(f => countNonEmptyRows(service, did, f))),
      // Substantive denominator per field (sql/178/179) — the strip's lead.
      Promise.all(fields.map(f => countNonEmptyRows(service, did, f, null, true))),
      Promise.all(themes.map(t =>
        service.rpc('count_theme_matches', {
          p_dataset_id: did,
          p_field_keys: fields,
          // Canonical fragments (kwPatternFragment) — the same patterns the
          // client matcher compiles; the RPC splices them unescaped into its
          // \m(…|…) alternation, so SQL counts and client recounts agree.
          p_keywords: (t.keywords || []).filter(Boolean).map(kwPatternFragment),
          // Substantive-gated (sql/181), matching theme-counts' themeMatchCount
          // exactly, so summing these yields the signals total the theme cards
          // add up to. Same RPC, same round-trip — the flag costs nothing.
          p_substantive_only: true,
        }),
      )),
      service.rpc('count_theme_matches', {
        p_dataset_id: did,
        p_field_keys: fields,
        p_keywords: allKeywords.map(kwPatternFragment),
      }),
      // Substantive numerator: rows matching ANY theme AND substantive in scope.
      service.rpc('count_theme_matches', {
        p_dataset_id: did,
        p_field_keys: fields,
        p_keywords: allKeywords.map(kwPatternFragment),
        p_substantive_only: true,
      }),
    ])
    return {
      recordsPerField,
      recordsSubstantivePerField,
      perTheme: signalsResults.map(r => Number(r.data) || 0),
      union: Number(inThemesResult.data) || 0,
      unionSubstantive: Number(inThemesSubstantiveResult.data) || 0,
      sampled: false,
    }
    }
  }))

  // Combine across members: per-field sums → max across fields (records);
  // theme counts and unions sum straight across.
  const recordsPerField = fields.map((_f, i) =>
    perMember.reduce((s, m) => s + (m.recordsPerField[i] || 0), 0),
  )
  const records = recordsPerField.reduce((m, v) => Math.max(m, v), 0)
  const recordsSubstantivePerField = fields.map((_f, i) =>
    perMember.reduce((s, m) => s + (m.recordsSubstantivePerField[i] || 0), 0),
  )
  const substantiveRecords = recordsSubstantivePerField.reduce((m, v) => Math.max(m, v), 0)
  // Sum of every theme's substantive match count = total themes carried across
  // all comments (a 3-theme comment contributes 3). Same number the theme cards
  // add up to.
  const signals = perMember.reduce((s, m) => s + m.perTheme.reduce((a, b) => a + b, 0), 0)
  const inThemes = perMember.reduce((s, m) => s + m.union, 0)
  const inThemesSubstantive = perMember.reduce((s, m) => s + m.unionSubstantive, 0)
  const sampled = perMember.some(m => m.sampled)

  const themeFitPct = records > 0 ? Math.round((inThemes / records) * 100) : 0
  const themeFitPctSubstantive = substantiveRecords > 0 ? Math.round((inThemesSubstantive / substantiveRecords) * 100) : 0
  // Signals per comment, over the base the signals themselves were counted on.
  const signalRatio = substantiveRecords > 0
    ? Math.round((signals / substantiveRecords) * 100) / 100
    : null
  return {
    totalRows,
    records, signals, inThemes,
    themeFitPct, themeFitBand: band(themeFitPct),
    substantiveRecords, inThemesSubstantive,
    themeFitPctSubstantive, themeFitBandSubstantive: band(themeFitPctSubstantive),
    signalRatio,
    themeCount: themes.length,
    ...(sampled ? { sampled: true } : {}),
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
  const { data: stateRow, error: stateRowErr } = await service
    .from('dataset_state')
    .select('theme_model, analytics')
    .eq('dataset_id', datasetId)
    .single()
  if (stateRowErr) void logError('signalStats.computeSignalStats', stateRowErr, { datasetId })
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
  // self-heal for already-stale entries — including entries keyed under the
  // old exact-head-count semantics, which recompute once and re-key.)
  const datasetIds = await resolveDatasetIds(service, datasetId)
  const currentRowCount = sumCounts(await memberRowCounts(service, datasetIds))

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
    // Entries cached before the substantive twin (sql/179) lack this field —
    // treat as stale so they recompute once and re-key with the new numbers.
    cached.themeFitPctSubstantive !== undefined &&
    // Model A (v2): v1 entries hold scaled sampled counts → recompute.
    cached.stats_v === STATS_MODEL_VERSION &&
    cached.theme_model_hash === currentHash &&
    currentHash !== '' &&
    cached.row_count === currentRowCount
  ) {
    const { theme_model_hash: _h, row_count: _r, computed_at: _c, stats_v: _v, ...stats } = cached
    return stats
  }

  // Compute fresh, persist. Merge only the signal_stats key so a concurrent
  // writer of another analytics key (e.g. the compute route's totalRows/
  // fieldSummaries) isn't clobbered by a full-blob rewrite.
  const stats = await computeSignalStatsRaw(service, datasetId)
  await mergeDatasetAnalytics(service, datasetId, {
    signal_stats: {
      ...stats,
      theme_model_hash: currentHash,
      row_count: currentRowCount,
      computed_at: new Date().toISOString(),
      stats_v: STATS_MODEL_VERSION,
    } satisfies CachedSignalStats,
  })

  return stats
}

/**
 * Signal stats for ONE stored per-field theme set, selected by its
 * themeFieldKey (2026-07-11 — the metric strip follows the active Text
 * pill). The ACTIVE set delegates to the cached path above; any other set
 * gets its own cache slot in dataset_state.analytics.signal_stats_by_field,
 * keyed (like the active slot) by that set's model hash + row count — so
 * switching Text pills costs one 1-4s compute the FIRST time per set, then
 * ~50ms until that set's themes change or rows sync in. Unknown key =
 * active path.
 */
export async function computeSignalStatsForSet(
  service: SupabaseClient,
  datasetId: string,
  fieldKey: string,
): Promise<SignalStats> {
  const { data: stateRow, error: stateRowErr } = await service
    .from('dataset_state')
    .select('theme_model, analytics')
    .eq('dataset_id', datasetId)
    .single()
  if (stateRowErr) void logError('signalStats.computeSignalStatsForSet', stateRowErr, { datasetId })
  const row = stateRow as { theme_model: UtilThemeModel | null; analytics: Record<string, unknown> | null } | null
  const tm = row?.theme_model || null
  const entries = themeFieldEntries(tm)
  if (!entries[fieldKey] || themeModelKey(tm) === fieldKey) {
    return computeSignalStats(service, datasetId)
  }
  const entryModel = entries[fieldKey] as unknown as ThemeModel

  const currentHash = themeModelHash(entryModel)
  const datasetIds = await resolveDatasetIds(service, datasetId)
  const currentRowCount = sumCounts(await memberRowCounts(service, datasetIds))
  const cachedMap = (row?.analytics as { signal_stats_by_field?: Record<string, CachedSignalStats> } | null)
    ?.signal_stats_by_field || {}
  const cached = cachedMap[fieldKey]
  const poisoned = !!cached && cached.records === 0 && (cached.signals > 0 || cached.inThemes > 0)
  if (
    cached &&
    !poisoned &&
    // Entries cached before the substantive twin (sql/179) lack this field —
    // treat as stale so they recompute once and re-key with the new numbers.
    cached.themeFitPctSubstantive !== undefined &&
    // Model A (v2): v1 entries hold scaled sampled counts → recompute.
    cached.stats_v === STATS_MODEL_VERSION &&
    cached.theme_model_hash === currentHash &&
    currentHash !== '' &&
    cached.row_count === currentRowCount
  ) {
    const { theme_model_hash: _h, row_count: _r, computed_at: _c, stats_v: _v, ...stats } = cached
    return stats
  }

  const stats = await computeSignalStatsRaw(service, datasetId, entryModel)
  // Rewrite the whole by-field map under its one analytics key, dropping
  // slots for fields no longer in the theme model (renamed/removed sets).
  // Concurrent writers of OTHER analytics keys are safe (mergeDatasetAnalytics
  // is per-key); two simultaneous by-field writers can lose one slot, which
  // just recomputes on the next read.
  const nextMap: Record<string, CachedSignalStats> = {}
  for (const k of Object.keys(cachedMap)) {
    if (k !== fieldKey && entries[k]) nextMap[k] = cachedMap[k]
  }
  nextMap[fieldKey] = {
    ...stats,
    theme_model_hash: currentHash,
    row_count: currentRowCount,
    computed_at: new Date().toISOString(),
    stats_v: STATS_MODEL_VERSION,
  }
  await mergeDatasetAnalytics(service, datasetId, { signal_stats_by_field: nextMap })

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
  // Atomic single-key deletes — removing only the signal-stats keys can't
  // clobber a concurrent writer of another analytics key. No-op if absent.
  await deleteDatasetAnalyticsKey(service, datasetId, 'signal_stats')
  await deleteDatasetAnalyticsKey(service, datasetId, 'signal_stats_by_field')
  // theme_counts (lib/themeCountsCache) counts the same rows with the same
  // theme model, so anything that staled the strip staled the theme cards too.
  // Its own key covers theme-model and row-count changes, but NOT a change that
  // moves the numbers without moving either — a substantive backfill, or a
  // re-classify that shifts the per-theme Dimensions breakdown.
  await deleteDatasetAnalyticsKey(service, datasetId, 'theme_counts')
}
