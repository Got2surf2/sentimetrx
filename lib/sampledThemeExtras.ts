// lib/sampledThemeExtras.ts
// Sampled twins of the three /theme-counts "extras" (Brief E item 2,
// PERFORMANCE_REVIEW.md §7): the co-occurrence matrix, per-theme topical words,
// and per-theme Dimensions breakdown. The exact RPCs (compute_theme_cooccurrence_matrix
// sql/055, extract_theme_topical_words sql/054, theme_dimension_counts sql/151)
// full-scan `dataset_rows_flat` per member and 57014 at ~1M. Each here
// keyset-pages the deterministic 50K stratified block sample (sql/191 twins, same
// sample every sampled surface serves), merges the per-page partials in Node,
// and scales counts by total/scanned. All three are MULTI-THEME per page call
// (one page RPC covers every theme) so a member needs ~10 calls, not ~10×N.
//
// Reuses the shared pager + cap from lib/sampledAggregate / sampledSignalCounts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { scaleSampledCount } from '@/lib/sampledSignalCounts'
import { AGG_SAMPLE_CAP, pageSample } from '@/lib/sampledAggregate'

export interface ThemePayload { id: string; keywords: string[] }

// 1. cooccurrence — per-page pair counts → merged, scaled N×N matrix ----------
export async function sampledThemeCooccurrence(
  service: SupabaseClient, datasetId: string, fields: string[], themes: ThemePayload[],
  total: number, cap = AGG_SAMPLE_CAP,
): Promise<Record<string, Record<string, number>>> {
  const pairs = new Map<string, number>() // key = a   b
  const scanned = await pageSample(service, datasetId, 'sampled_theme_cooccurrence_page_blocks',
    { p_field_keys: fields, p_themes: themes }, null,
    page => {
      for (const p of (page.pairs as [string, string, number][] | undefined) || []) {
        const k = p[0] + '\u0000' + p[1]
        pairs.set(k, (pairs.get(k) || 0) + Number(p[2]))
      }
    }, cap)
  const matrix: Record<string, Record<string, number>> = {}
  for (const [k, n] of pairs) {
    const [a, b] = k.split('\u0000')
    if (!matrix[a]) matrix[a] = {}
    matrix[a][b] = scaleSampledCount(n, total, scanned)
  }
  return matrix
}

// 2. topical — per-page (theme, word) counts → merged per theme, scaled -------
//    Returns { themeId: { word: scaledCount } }; the caller merges across
//    members and takes the top-5.
export async function sampledThemeTopical(
  service: SupabaseClient, datasetId: string, fields: string[], themes: ThemePayload[],
  extraExcludes: string[], total: number, cap = AGG_SAMPLE_CAP,
): Promise<Record<string, Record<string, number>>> {
  const byTheme = new Map<string, Map<string, number>>()
  const scanned = await pageSample(service, datasetId, 'sampled_theme_topical_page_blocks',
    { p_field_keys: fields, p_themes: themes, p_extra_excludes: extraExcludes }, null,
    page => {
      for (const w of (page.words as [string, string, number][] | undefined) || []) {
        const m = byTheme.get(w[0]) || byTheme.set(w[0], new Map()).get(w[0])!
        m.set(w[1], (m.get(w[1]) || 0) + Number(w[2]))
      }
    }, cap)
  const out: Record<string, Record<string, number>> = {}
  for (const [tid, words] of byTheme) {
    out[tid] = {}
    for (const [word, n] of words) out[tid][word] = scaleSampledCount(n, total, scanned)
  }
  return out
}

/**
 * Both extras from ONE walk of the sample (sql/187).
 *
 * The two helpers below each page the same 50,000 scattered rows independently.
 * That walk — not the per-row work — is the cost: the sample is hash-ordered and
 * therefore physically scattered, so it is dominated by buffer-cache residency
 * (measured 2,967 disk reads / 1,895ms for one 5,000-row page on the 128K
 * dataset vs 11 reads / 28ms on the 56K one). Halving the number of walks
 * roughly halves the extras phase.
 *
 * Returns exactly what the two separate helpers return, so callers can swap
 * without touching their merge/scale logic. Throws on RPC error (including
 * PGRST202 pre-migration) — callers fall back to the two-walk path.
 */
export async function sampledThemeExtras(
  service: SupabaseClient, datasetId: string, fields: string[], themes: ThemePayload[],
  total: number, want: { cooccurrence: boolean; dimensions: boolean }, cap = AGG_SAMPLE_CAP,
): Promise<{
  cooccurrence: Record<string, Record<string, number>>
  dimensions: Record<string, Record<string, { axis: string; sub: string; count: number }>>
}> {
  const pairs = new Map<string, number>()
  const byTheme = new Map<string, Map<string, { axis: string; sub: string; count: number }>>()
  const scanned = await pageSample(service, datasetId, 'sampled_theme_extras_page_blocks',
    { p_field_keys: fields, p_themes: themes, p_want_pairs: want.cooccurrence, p_want_dims: want.dimensions }, null,
    page => {
      for (const p of (page.pairs as [string, string, number][] | undefined) || []) {
        const k = p[0] + ' ' + p[1]
        pairs.set(k, (pairs.get(k) || 0) + Number(p[2]))
      }
      for (const d of (page.dims as [string, string, string, number][] | undefined) || []) {
        const m = byTheme.get(d[0]) || byTheme.set(d[0], new Map()).get(d[0])!
        const key = d[1] + ':' + d[2]
        const acc = m.get(key) || { axis: d[1], sub: d[2], count: 0 }
        acc.count += Number(d[3])
        m.set(key, acc)
      }
    }, cap)

  const cooccurrence: Record<string, Record<string, number>> = {}
  for (const [k, n] of pairs) {
    const [a, b] = k.split(' ')
    if (!cooccurrence[a]) cooccurrence[a] = {}
    cooccurrence[a][b] = scaleSampledCount(n, total, scanned)
  }
  const dimensions: Record<string, Record<string, { axis: string; sub: string; count: number }>> = {}
  for (const [tid, dims] of byTheme) {
    dimensions[tid] = {}
    for (const [key, v] of dims) dimensions[tid][key] = { axis: v.axis, sub: v.sub, count: scaleSampledCount(v.count, total, scanned) }
  }
  return { cooccurrence, dimensions }
}

// 3. dimensions — per-page (theme, axis, sub) counts → merged, scaled ---------
//    Returns { themeId: { "axis:sub": { axis, sub, count } } }.
export async function sampledThemeDimensions(
  service: SupabaseClient, datasetId: string, fields: string[], themes: ThemePayload[],
  total: number, cap = AGG_SAMPLE_CAP,
): Promise<Record<string, Record<string, { axis: string; sub: string; count: number }>>> {
  const byTheme = new Map<string, Map<string, { axis: string; sub: string; count: number }>>()
  const scanned = await pageSample(service, datasetId, 'sampled_theme_dimension_page_blocks',
    { p_field_keys: fields, p_themes: themes }, null,
    page => {
      for (const d of (page.dims as [string, string, string, number][] | undefined) || []) {
        const m = byTheme.get(d[0]) || byTheme.set(d[0], new Map()).get(d[0])!
        const key = d[1] + ':' + d[2]
        const acc = m.get(key) || { axis: d[1], sub: d[2], count: 0 }
        acc.count += Number(d[3])
        m.set(key, acc)
      }
    }, cap)
  const out: Record<string, Record<string, { axis: string; sub: string; count: number }>> = {}
  for (const [tid, dims] of byTheme) {
    out[tid] = {}
    for (const [key, v] of dims) out[tid][key] = { axis: v.axis, sub: v.sub, count: scaleSampledCount(v.count, total, scanned) }
  }
  return out
}
