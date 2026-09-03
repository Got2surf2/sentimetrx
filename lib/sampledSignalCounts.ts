// lib/sampledSignalCounts.ts
// Signal counts over the deterministic 50K sample (sql/162) for datasets
// above the sampling cap — where the exact per-theme full scans
// (count_theme_matches / count_nonempty_rows) exceed the DB's 8s statement
// timeout (~1.4GB of jsonb per scan on a 785K-row dataset, prod 2026-07-11).
//
// One keyset-paged pass over the SAME sample the bulk rows route serves
// (sql/191 stratified contiguous row_index blocks) returns per-field
// non-empty counts, per-theme match counts, and the any-theme union in a
// single heap visit per row. Callers scale to the dataset's total row count
// and label the result as sampled — the platform sampling doctrine
// (ARCHITECTURE.md D6): exact under the cap, deterministic sample above it.
//
// Pages of 5000 keep each statement in the ~1-3s range (a 10K page measured
// up to ~7s cold on TEST — too close to the 8s ceiling).

import type { SupabaseClient } from '@supabase/supabase-js'
import { kwPatternFragment } from '@/lib/themeUtils'

/** The platform-wide sampling cap — matches the bulk rows route / RowsContext. */
export const SIGNAL_SAMPLE_CAP = 50000

/** Stratified blocks the sample is spread over (sql/188/191). The sample is K
 *  contiguous row_index runs rather than hash order, because hash order is
 *  uncorrelated with physical order and its cost is buffer-cache residency,
 *  not row count. 50 sits in the flat part of the measured curve. */
export const SAMPLE_BLOCKS = 50

const PAGE_SIZE = 5000

export interface SampledSignalCounts {
  /** Non-empty counts aligned to the input fields order (sampled, unscaled). */
  recordsPerField: number[]
  /** Substantive (sql/178) non-empty counts per field (sampled, unscaled). */
  recordsSubstantivePerField: number[]
  /** Match counts aligned to the input themes order (sampled, unscaled). */
  perTheme: number[]
  /** Per-theme match counts gated to substantive rows (sql/181) — the
   *  prevalence-bar numerator for the two-count model (sampled, unscaled). */
  perThemeSubstantive: number[]
  /** Rows matching ANY theme (sampled, unscaled). */
  union: number
  /** Rows matching ANY theme AND substantive in a scanned field (sampled). */
  unionSubstantive: number
  /** Rows actually scanned — the scaling denominator (≤ cap). */
  scanned: number
  /** Did the RPC actually return the substantive twins (sql/181)? A database
   *  that predates them omits the keys entirely, which accumulates to all-zero
   *  — indistinguishable from "genuinely no substantive matches" unless we say
   *  so. Callers gating on the substantive numerator use this to fall back to
   *  the ungated count instead of publishing a zero they can't defend
   *  (deploy-order safety, same idiom as the legacy keyword build above). */
  substantiveAvailable: boolean
}

interface PageResult {
  n: number
  records: number[]
  records_substantive?: number[]
  theme_counts: number[]
  theme_counts_substantive?: number[]
  union_count: number
  union_substantive?: number
  last_row_index: number | null
}

/**
 * Page the sampled_signal_counts RPC (sql/162) up to `cap` rows and
 * accumulate. Throws on any RPC error (including PGRST202 when the function
 * hasn't reached the target database yet) — callers fall back to the exact
 * full-scan path, i.e. pre-sql/162 behavior.
 */
export async function sampledSignalCounts(
  service: SupabaseClient,
  datasetId: string,
  fields: string[],
  themes: { keywords: string[] }[],
  cap: number = SIGNAL_SAMPLE_CAP,
): Promise<SampledSignalCounts> {
  const acc: SampledSignalCounts = {
    recordsPerField: fields.map(() => 0),
    recordsSubstantivePerField: fields.map(() => 0),
    perTheme: themes.map(() => 0),
    perThemeSubstantive: themes.map(() => 0),
    union: 0,
    unionSubstantive: 0,
    scanned: 0,
    substantiveAvailable: false,
  }
  // `patterns` = canonical prebuilt fragments (kwPatternFragment), used by
  // sql/166+; `keywords` kept alongside so a pre-166 database still counts
  // via its legacy escaped-keyword build (deploy-order safety, sql/164 style).
  const themesPayload = themes.map(t => {
    const kws = (t.keywords || []).filter(Boolean)
    return { keywords: kws, patterns: kws.map(kwPatternFragment) }
  })
  let afterRowIndex = -1
  while (acc.scanned < cap) {
    const { data, error } = await service.rpc('sampled_signal_counts_blocks', {
      p_dataset_id: datasetId,
      p_field_keys: fields,
      p_themes: themesPayload,
      p_after_row_index: afterRowIndex,
      p_limit: Math.min(PAGE_SIZE, cap - acc.scanned),
    })
    if (error) throw new Error('sampled_signal_counts_blocks failed for ' + datasetId + ': ' + error.message)
    const page = data as PageResult | null
    const n = Number(page?.n) || 0
    if (!page || n === 0) break // fewer rows than the cap — scanned them all
    acc.scanned += n
    page.records.forEach((c, i) => { acc.recordsPerField[i] += Number(c) || 0 })
    ;(page.records_substantive || []).forEach((c, i) => { acc.recordsSubstantivePerField[i] += Number(c) || 0 })
    page.theme_counts.forEach((c, i) => { acc.perTheme[i] += Number(c) || 0 })
    if (Array.isArray(page.theme_counts_substantive)) {
      acc.substantiveAvailable = true
      page.theme_counts_substantive.forEach((c, i) => { acc.perThemeSubstantive[i] += Number(c) || 0 })
    }
    acc.union += Number(page.union_count) || 0
    acc.unionSubstantive += Number(page.union_substantive) || 0
    if (page.last_row_index == null) break
    const nextRowIndex = Number(page.last_row_index)
    if (nextRowIndex <= afterRowIndex) break   // no forward progress
    afterRowIndex = nextRowIndex
  }
  return acc
}

/** Scale a sampled count to the dataset's total rows. */
export function scaleSampledCount(count: number, totalRows: number, scanned: number): number {
  if (scanned <= 0) return 0
  if (totalRows <= scanned) return count
  return Math.round(count * (totalRows / scanned))
}

export interface SampledNumericStats {
  /** numeric-valued rows in the sample (unscaled) */
  n: number
  /** mean over the sample — an unbiased estimate of the all-rows mean */
  avg: number | null
  min: number | null
  max: number | null
  /** rows actually scanned (≤ cap) */
  scanned: number
}

interface NumericPageResult {
  n_scanned: number
  n: number
  sum: number | null
  min: number | null
  max: number | null
  last_row_index: number | null
}

/**
 * Page sampled_numeric_field_stats (sql/163) up to `cap` rows: numeric field
 * stats over the same deterministic sample, for datasets where the exact
 * full-scan aggregates (numeric_field_stats / field_aliased_avg) blow the
 * statement timeout. `aliases` mirrors field_aliased_avg (remapped rating
 * fields); null = raw numeric cast. Throws on RPC error — callers fall back
 * to the exact path.
 */
export async function sampledNumericFieldStats(
  service: SupabaseClient,
  datasetId: string,
  field: string,
  aliases: Record<string, string> | null,
  cap: number = SIGNAL_SAMPLE_CAP,
): Promise<SampledNumericStats> {
  let scanned = 0
  let n = 0
  let sum = 0
  let min: number | null = null
  let max: number | null = null
  let afterRowIndex = -1
  while (scanned < cap) {
    const { data, error } = await service.rpc('sampled_numeric_field_stats_blocks', {
      p_dataset_id: datasetId,
      p_field: field,
      p_aliases: aliases,
      p_after_row_index: afterRowIndex,
      p_limit: Math.min(PAGE_SIZE, cap - scanned),
    })
    if (error) throw new Error('sampled_numeric_field_stats_blocks failed for ' + datasetId + ': ' + error.message)
    const page = data as NumericPageResult | null
    const pageScanned = Number(page?.n_scanned) || 0
    if (!page || pageScanned === 0) break // fewer rows than the cap — scanned them all
    scanned += pageScanned
    n += Number(page.n) || 0
    sum += Number(page.sum) || 0
    if (page.min != null) min = min == null ? Number(page.min) : Math.min(min, Number(page.min))
    if (page.max != null) max = max == null ? Number(page.max) : Math.max(max, Number(page.max))
    if (page.last_row_index == null) break
    const nextRowIndex = Number(page.last_row_index)
    if (nextRowIndex <= afterRowIndex) break   // no forward progress
    afterRowIndex = nextRowIndex
  }
  return { n, avg: n > 0 ? sum / n : null, min, max, scanned }
}
