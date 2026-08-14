// lib/bulkRowSample.ts
// Shared O(sample) bulk-row sampling for the rows route (sql/160).
//
// Two consumers, one pager: the single-dataset all=true path above the 50K
// cap, and — since the first-open efficiency audit (2026-07-12) — the
// COLLECTION path, which used to JS-page every member fully (O(total across
// members), the exact disease sql/160 cured for single datasets: a 184K-row
// brand collection was ~184 serial 1000-row requests). Above the cap each
// member now contributes a proportional share of the deterministic sample
// (smallest hash(id‖dataset_id) first, idx_drf_sample index range scan), so
// a collection load costs the same regardless of member sizes.
//
// Deliberately dependency-free (no lib/log / server-only chain) so verify
// harnesses can exercise it directly against a real database.

import type { SupabaseClient } from '@supabase/supabase-js'

const SAMPLE_PAGE = 5000

export interface SampledRow {
  id: number
  row_index: number
  data: Record<string, unknown>
}

/**
 * Page the sample_dataset_rows RPC (sql/160) up to `cap` rows, invoking `cb`
 * per row in deterministic (hash, id) order. Returns the number of rows
 * fetched. Throws on RPC error — callers decide how to surface it.
 */
export async function pageSampledRows(
  service: SupabaseClient,
  datasetId: string,
  cap: number,
  cb: (row: SampledRow) => void,
  /** Field names to omit from every row's `data` (sql/186) — the schema's
   *  ignore/hidden columns, which every analyze surface filters out anyway.
   *  Dropped in SQL so the DB→server leg never carries them: measured -39%
   *  payload on a 32-field survey, and it keeps ignored PII-ish columns
   *  (name/email/IP/card) out of the client payload entirely. */
  dropKeys?: string[],
): Promise<number> {
  let fetched = 0
  let afterHash = -1 // hashes are >= 0, so (-1, -1) starts at the smallest-hash row
  let afterId = -1
  // Drop the argument entirely once a database answers PGRST202 for it, so a
  // deploy that reaches the app before sql/186 reaches the DB degrades to the
  // previous behaviour instead of failing the whole bulk load.
  let sendDropKeys = !!(dropKeys && dropKeys.length)
  while (fetched < cap) {
    const pageLimit = Math.min(SAMPLE_PAGE, cap - fetched)
    const args: Record<string, unknown> = {
      p_dataset_id: datasetId,
      p_after_hash: afterHash,
      p_after_id: afterId,
      p_limit: pageLimit,
    }
    if (sendDropKeys) args.p_drop_keys = dropKeys
    let { data, error } = await service.rpc('sample_dataset_rows', args)
    if (error && sendDropKeys && error.code === 'PGRST202') {
      sendDropKeys = false
      delete args.p_drop_keys
      ;({ data, error } = await service.rpc('sample_dataset_rows', args))
    }
    if (error) throw new Error('sample_dataset_rows failed for ' + datasetId + ': ' + error.message)
    const parsed = data as { rows?: SampledRow[]; last_hash?: number | null; last_id?: number | null } | null
    const pageRows = parsed?.rows || []
    if (pageRows.length === 0) break
    for (const r of pageRows) cb(r)
    fetched += pageRows.length
    if (parsed?.last_hash == null || pageRows.length < pageLimit) break
    afterHash = parsed.last_hash
    afterId = parsed.last_id ?? -1
  }
  return fetched
}

/**
 * Allocate a sample cap across collection members proportionally to their row
 * counts (floored — the total never exceeds `cap`; every non-empty member
 * gets at least 1 row so small members aren't silently dropped from the
 * sample). Deterministic for given counts.
 */
export function allocateSampleShares(
  counts: Map<string, number>,
  cap: number,
): Map<string, number> {
  const shares = new Map<string, number>()
  let total = 0
  for (const c of counts.values()) total += c
  if (total <= 0 || cap <= 0) return shares
  for (const [id, c] of counts) {
    if (c <= 0) continue
    shares.set(id, Math.max(1, Math.floor((cap * c) / total)))
  }
  return shares
}
