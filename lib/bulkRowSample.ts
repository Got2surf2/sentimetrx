// lib/bulkRowSample.ts
// Shared O(sample) bulk-row sampling for the rows route (sql/160).
//
// Two consumers, one pager: the single-dataset all=true path above the 50K
// cap, and — since the first-open efficiency audit (2026-07-12) — the
// COLLECTION path, which used to JS-page every member fully (O(total across
// members), the exact disease sql/160 cured for single datasets: a 184K-row
// brand collection was ~184 serial 1000-row requests). Above the cap each
// member now contributes a proportional share of the deterministic sample
// (sql/191: 50 stratified contiguous row_index blocks, not hash order — hash
// order is uncorrelated with physical order, so its cost was buffer-cache
// residency rather than row count), so a collection load costs the same
// regardless of member sizes.
//
// Deliberately dependency-free (no lib/log / server-only chain) so verify
// harnesses can exercise it directly against a real database.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SAMPLE_BLOCKS } from '@/lib/sampledSignalCounts'

const SAMPLE_PAGE = 5000

export interface SampledRow {
  id: number
  row_index: number
  data: Record<string, unknown>
}

/**
 * Page the sample_dataset_rows_blocks RPC (sql/188, fixed in sql/191) up to
 * `cap` rows, invoking `cb` per row in deterministic row_index order. Returns
 * the number of rows fetched. Throws on RPC error — callers decide how to
 * surface it.
 *
 * sql/191: the stratified BLOCK sample replaces the hash sample, so one
 * row_index cursor is a complete cursor. This is the same sample every
 * sampled_*_blocks count RPC walks — the two must never be mixed on one
 * screen, because they select different rows.
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
  let afterRowIndex = -1 // row_index is >= 0, so -1 starts at the first sampled row
  // Drop the argument entirely once a database answers PGRST202 for it, so a
  // deploy that reaches the app before sql/186 reaches the DB degrades to the
  // previous behaviour instead of failing the whole bulk load.
  let sendDropKeys = !!(dropKeys && dropKeys.length)
  while (fetched < cap) {
    const pageLimit = Math.min(SAMPLE_PAGE, cap - fetched)
    const args: Record<string, unknown> = {
      p_dataset_id: datasetId,
      p_after_row_index: afterRowIndex,
      p_limit: pageLimit,
      p_cap: cap,
      p_blocks: SAMPLE_BLOCKS,
    }
    if (sendDropKeys) args.p_drop_keys = dropKeys
    let { data, error } = await service.rpc('sample_dataset_rows_blocks', args)
    if (error && sendDropKeys && error.code === 'PGRST202') {
      sendDropKeys = false
      delete args.p_drop_keys
      ;({ data, error } = await service.rpc('sample_dataset_rows_blocks', args))
    }
    if (error) throw new Error('sample_dataset_rows_blocks failed for ' + datasetId + ': ' + error.message)
    const parsed = data as { rows?: SampledRow[]; last_row_index?: number | null } | null
    const pageRows = parsed?.rows || []
    if (pageRows.length === 0) break
    for (const r of pageRows) cb(r)
    fetched += pageRows.length
    if (parsed?.last_row_index == null || pageRows.length < pageLimit) break
    const nextRowIndex = Number(parsed.last_row_index)
    if (nextRowIndex <= afterRowIndex) break   // no forward progress
    afterRowIndex = nextRowIndex
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
