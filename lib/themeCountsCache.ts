// lib/themeCountsCache.ts
//
// Server-side cache for the /theme-counts payload, mirroring the signal_stats
// cache in lib/signalStats.ts.
//
// WHY: theme-counts had NO server cache — only the in-memory, per-tab-session
// clientRequestCache, which dies on every page reload. So each fresh TextMine
// load of a dataset above the 50K sampling cap re-ran THREE independent 10-page
// keyset scans over the sample. Measured cold on TEST against the 128,619-row
// Outback GuestLens dataset (6 themes, 2026-08-14):
//
//     sampledSignalCounts        13.4s
//     sampledThemeCooccurrence    9.1s
//     sampledThemeDimensions     10.9s
//     ────────────────────────────────
//     one uncached request       33.4s   ← every load, forever
//
// signal-stats was already cached and returns in ~50ms after its first compute,
// which is why the strip looked fine while the theme cards sat spinning. Same
// cache shape here takes the recurring cost to a single ~50ms state read.
//
// Keyed on everything that can change the numbers: the theme model (ids +
// keywords), the fields scanned, the optional-extras flags, and the dataset's
// row count — so a sync (rows in/out) or a theme edit both invalidate, exactly
// like signal_stats. Filtered requests (p_row_ids) are never cached: they are
// per-view by definition and already bounded/cheap.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mergeDatasetAnalytics, deleteDatasetAnalyticsKey } from '@/lib/datasetAnalytics'
import { logError } from '@/lib/log'

/** Bump when the SHAPE or SEMANTICS of the cached payload changes (not the
 *  theme model — that rides the request hash). Old entries then miss once. */
const THEME_COUNTS_VERSION = 1

/** Most-recent slots kept per dataset. A user switching Text pills or toggling
 *  Dimensions creates a slot each; without a bound the analytics blob grows
 *  without limit. Evicted oldest-first by computed_at. */
const MAX_SLOTS = 6

/** Don't cache a payload larger than this. The co-occurrence matrix is N×N in
 *  themes, so a 100-theme model can produce a very large blob — and
 *  dataset_state.analytics is read on paths that only want signal_stats. */
const MAX_PAYLOAD_BYTES = 512 * 1024

export interface ThemeCountsPayload {
  counts: { id: string; count: number; percentage: number }[]
  totalNonEmpty: number
  sampled?: boolean
  sampleSize?: number
  cooccurrence?: Record<string, Record<string, number>>
  topical?: Record<string, [string, number][]>
  dimensions?: Record<string, { axis: string; sub: string; count: number }[]>
}

interface CachedEntry {
  payload: ThemeCountsPayload
  row_count: number
  computed_at: string
  v: number
}

/**
 * Stable hash of everything that determines the payload. Keyword order is
 * normalised (lowercased + sorted) exactly like themeModelHash, so a cosmetic
 * reorder in the theme editor doesn't force a 33s recompute.
 */
export function themeCountsKey(input: {
  themes: { id: string; keywords?: string[] }[]
  fields: string[]
  cooccurrence?: boolean
  topical?: boolean
  dimensions?: boolean
  /** Two-phase load: an extras-only response has a different SHAPE (no counts),
   *  so it must never be served to a caller asking for counts, or vice versa. */
  extrasOnly?: boolean
}): string {
  const sig = {
    themes: input.themes
      .map(t => ({
        id: String(t.id || ''),
        keywords: (t.keywords || []).filter(Boolean).map(k => String(k).toLowerCase()).sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    fields: [...input.fields].sort(),
    extras: [!!input.cooccurrence, !!input.topical, !!input.dimensions],
    extrasOnly: !!input.extrasOnly,
    v: THEME_COUNTS_VERSION,
  }
  return createHash('md5').update(JSON.stringify(sig)).digest('hex').slice(0, 16)
}

type SlotMap = Record<string, CachedEntry>

function readSlots(analytics: Record<string, unknown> | null | undefined): SlotMap {
  const raw = (analytics as { theme_counts?: SlotMap } | null | undefined)?.theme_counts
  return raw && typeof raw === 'object' ? raw : {}
}

/**
 * Cached payload for this request, or null on a miss. `analytics` is passed in
 * by the caller (which has already read dataset_state for other reasons) so a
 * cache hit costs no extra round-trip.
 */
export function readThemeCountsCache(
  analytics: Record<string, unknown> | null | undefined,
  key: string,
  currentRowCount: number,
): ThemeCountsPayload | null {
  const entry = readSlots(analytics)[key]
  if (!entry || entry.v !== THEME_COUNTS_VERSION) return null
  if (entry.row_count !== currentRowCount) return null
  if (!entry.payload || !Array.isArray(entry.payload.counts)) return null
  return entry.payload
}

/**
 * Persist a freshly computed payload under `key`, evicting the oldest slots
 * beyond MAX_SLOTS. Never throws — a cache write failing must not fail the
 * request that already has its answer.
 */
export async function writeThemeCountsCache(
  service: SupabaseClient,
  datasetId: string,
  analytics: Record<string, unknown> | null | undefined,
  key: string,
  currentRowCount: number,
  payload: ThemeCountsPayload,
): Promise<void> {
  try {
    const bytes = JSON.stringify(payload).length
    if (bytes > MAX_PAYLOAD_BYTES) return // too big to be worth carrying in analytics

    const slots = { ...readSlots(analytics) }
    slots[key] = { payload, row_count: currentRowCount, computed_at: new Date().toISOString(), v: THEME_COUNTS_VERSION }

    const keep = Object.entries(slots)
      .sort((a, b) => String(b[1].computed_at).localeCompare(String(a[1].computed_at)))
      .slice(0, MAX_SLOTS)
    await mergeDatasetAnalytics(service, datasetId, { theme_counts: Object.fromEntries(keep) })
  } catch (err) {
    void logError('themeCountsCache.write', err, { datasetId })
  }
}

/** Drop every cached theme-counts slot (theme re-mine, row backfill). */
export async function invalidateThemeCounts(
  service: SupabaseClient,
  datasetId: string,
): Promise<void> {
  await deleteDatasetAnalyticsKey(service, datasetId, 'theme_counts')
}
