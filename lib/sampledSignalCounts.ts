// lib/sampledSignalCounts.ts
// Signal counts over the deterministic 50K sample (sql/162) for datasets
// above the sampling cap — where the exact per-theme full scans
// (count_theme_matches / count_nonempty_rows) exceed the DB's 8s statement
// timeout (~1.4GB of jsonb per scan on a 785K-row dataset, prod 2026-07-11).
//
// One keyset-paged pass over the SAME sample the bulk rows route serves
// (smallest hash(id||dataset_id) first, idx_drf_sample) returns per-field
// non-empty counts, per-theme match counts, and the any-theme union in a
// single heap visit per row. Callers scale to the dataset's total row count
// and label the result as sampled — the platform sampling doctrine
// (ARCHITECTURE.md D6): exact under the cap, deterministic sample above it.
//
// Pages of 5000 keep each statement in the ~1-3s range (a 10K page measured
// up to ~7s cold on TEST — too close to the 8s ceiling).

import type { SupabaseClient } from '@supabase/supabase-js'

/** The platform-wide sampling cap — matches the bulk rows route / RowsContext. */
export const SIGNAL_SAMPLE_CAP = 50000

const PAGE_SIZE = 5000

export interface SampledSignalCounts {
  /** Non-empty counts aligned to the input fields order (sampled, unscaled). */
  recordsPerField: number[]
  /** Match counts aligned to the input themes order (sampled, unscaled). */
  perTheme: number[]
  /** Rows matching ANY theme (sampled, unscaled). */
  union: number
  /** Rows actually scanned — the scaling denominator (≤ cap). */
  scanned: number
}

interface PageResult {
  n: number
  records: number[]
  theme_counts: number[]
  union_count: number
  last_hash: number | null
  last_id: number | null
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
    perTheme: themes.map(() => 0),
    union: 0,
    scanned: 0,
  }
  const themesPayload = themes.map(t => ({ keywords: (t.keywords || []).filter(Boolean) }))
  let afterHash = -1
  let afterId = -1
  while (acc.scanned < cap) {
    const { data, error } = await service.rpc('sampled_signal_counts', {
      p_dataset_id: datasetId,
      p_field_keys: fields,
      p_themes: themesPayload,
      p_after_hash: afterHash,
      p_after_id: afterId,
      p_limit: Math.min(PAGE_SIZE, cap - acc.scanned),
    })
    if (error) throw new Error('sampled_signal_counts failed for ' + datasetId + ': ' + error.message)
    const page = data as PageResult | null
    const n = Number(page?.n) || 0
    if (!page || n === 0) break // fewer rows than the cap — scanned them all
    acc.scanned += n
    page.records.forEach((c, i) => { acc.recordsPerField[i] += Number(c) || 0 })
    page.theme_counts.forEach((c, i) => { acc.perTheme[i] += Number(c) || 0 })
    acc.union += Number(page.union_count) || 0
    if (page.last_hash == null || page.last_id == null) break
    afterHash = Number(page.last_hash)
    afterId = Number(page.last_id)
  }
  return acc
}

/** Scale a sampled count to the dataset's total rows. */
export function scaleSampledCount(count: number, totalRows: number, scanned: number): number {
  if (scanned <= 0) return 0
  if (totalRows <= scanned) return count
  return Math.round(count * (totalRows / scanned))
}
