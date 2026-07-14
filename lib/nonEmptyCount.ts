// lib/nonEmptyCount.ts
// Non-empty row count for one field, safe for ANY column name.
//
// Deliberately dependency-free (no lib/log → no 'server-only' chain):
// lib/analyticsCompute is imported by client components (ViewsBar) for its
// pure recompute path, so anything IT imports must stay client-bundleable.
//
// WHY this exists: the legacy `.not('data->' + field, ...)` PostgREST filter
// silently matches NOTHING when the column name contains a comma (filter-
// grammar separator) — survey columns are full question sentences ("What,
// if anything, did you like LEAST ...?"), which blanked the metric strip and
// skewed denominators (2026-07-11). The parameterized count_nonempty_rows
// RPC (sql/161) is immune; the legacy filter remains ONLY as the fallback
// until the migration reaches the target database (PGRST202 = function not
// in the schema cache). Any other failure THROWS — a transient-timeout zero
// once got cached as records:0 and permanently hid a listing card's stats
// (Rubio's/BareBurger); callers that tolerate a degraded count catch locally.

import type { SupabaseClient } from '@supabase/supabase-js'

export async function countNonEmptyRows(
  service: SupabaseClient,
  datasetId: string,
  field: string,
  // Optional flat-row-id filter (sql/170) — restricts to the filtered view.
  // null/undefined = whole dataset. The RPC drops it on PGRST202; the legacy
  // fallback applies it via an `id in (...)` filter (bounded — the caller only
  // passes a ≤50K sample subset when filters are active).
  rowIds?: number[] | null,
  // Substantive-only denominator (sql/178/179): count rows carrying usable
  // feedback in this field (substantive ? field) instead of merely non-empty.
  substantiveOnly?: boolean,
): Promise<number> {
  const params: Record<string, unknown> = { p_dataset_id: datasetId, p_field: field }
  if (rowIds && rowIds.length) params.p_row_ids = rowIds
  if (substantiveOnly) params.p_substantive_only = true
  const { data, error } = await service.rpc('count_nonempty_rows', params)
  if (!error && typeof data === 'number') return data
  if (error && error.code !== 'PGRST202') {
    throw new Error('count_nonempty_rows failed for ' + datasetId + ': ' + error.message)
  }
  let q = service
    .from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', datasetId)
  // substantive fallback (pre-179 db): the stored map has the field key.
  if (substantiveOnly) q = q.not('substantive->' + field, 'is', null)
  else q = q.not('data->' + field, 'is', null).neq('data->>' + field, '')
  if (rowIds && rowIds.length) q = q.in('id', rowIds)
  const { count, error: legacyErr } = await q
  if (legacyErr) throw new Error('non-empty count failed for ' + datasetId + ': ' + legacyErr.message)
  return count || 0
}
