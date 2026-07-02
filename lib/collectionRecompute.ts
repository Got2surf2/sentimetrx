// lib/collectionRecompute.ts
// Recompute a collection's cached aggregates from its member datasets.
//
// A collection dataset (source='collection') holds no rows of its own — its
// rows live in member datasets. Its cached aggregates (row_count,
// analytics.totalRows, analytics.signal_stats) are point-in-time snapshots
// computed only when the collection is explicitly recomputed. Nothing
// auto-recomputes them when a member gains rows via sync, so the collection's
// toolbar counts drift stale while its live field/theme views stay correct —
// the root cause of the 62-vs-108 (and 67-vs-80) count mismatches.
//
// These helpers let a member sync cascade a recompute to every parent
// collection so the aggregates self-heal immediately.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeAnalyticsFromRows } from '@/lib/analyticsCompute'
import { invalidateSignalStats } from '@/lib/signalStats'
import { logError } from '@/lib/log'
import { buildMergedCollectionSchema } from '@/lib/collectionSchema'

const FLAT_PAGE = 1000

/**
 * Re-read every member dataset's flat rows and recompute the collection's
 * cached analytics + row_count, then drop its stale signal-stats cache so the
 * next read recomputes against the new rows.
 *
 * Returns the recomputed analytics + row count, or null when the collection
 * has no schema or no members (nothing to compute).
 */
export async function recomputeCollectionAnalytics(
  service: SupabaseClient,
  collectionDatasetId: string,
  updatedBy?: string,
): Promise<{ analytics: any; rowCount: number } | null> {
  const { data: stateRow, error: stateErr } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', collectionDatasetId).single()
  if (stateErr) void logError('collectionRecompute.recomputeCollectionAnalytics', stateErr)
  // schema_config is the untyped JSON blob persisted in dataset_state; pass it
  // straight through to computeAnalyticsFromRows as the compute route does.
  const schema = (stateRow as { schema_config?: any } | null)?.schema_config
  if (!schema?.fields?.length) return null

  const { data: col, error: colErr } = await service
    .from('collections').select('id').eq('dataset_id', collectionDatasetId).single()
  if (colErr) void logError('collectionRecompute.recomputeCollectionAnalytics', colErr)
  if (!col) return null
  const { data: members, error: membersErr } = await service
    .from('collection_members').select('dataset_id, label')
    .eq('collection_id', (col as { id: string }).id).order('sort_order')
  if (membersErr) void logError('collectionRecompute.recomputeCollectionAnalytics', membersErr)
  if (!members?.length) return null

  const allRows: Record<string, unknown>[] = []
  for (const m of members as { dataset_id: string; label: string }[]) {
    let off = 0, more = true
    while (more) {
      const { data: fRows, error: fRowsErr } = await service
        .from('dataset_rows_flat').select('data')
        .eq('dataset_id', m.dataset_id)
        .order('row_index', { ascending: true })
        .range(off, off + FLAT_PAGE - 1)
      if (fRowsErr) void logError('collectionRecompute.recomputeCollectionAnalytics', fRowsErr)
      if (!fRows || fRows.length === 0) break
      for (const fr of fRows) allRows.push({ ...(fr as { data: Record<string, unknown> }).data, _collection_label: m.label })
      if (fRows.length < FLAT_PAGE) more = false
      off += FLAT_PAGE
    }
  }

  const analytics = computeAnalyticsFromRows(allRows, schema)
  const now = new Date().toISOString()
  const stateUpdate: Record<string, unknown> = { analytics, updated_at: now }
  if (updatedBy) stateUpdate.updated_by = updatedBy
  await service.from('dataset_state').update(stateUpdate).eq('dataset_id', collectionDatasetId)
  await service.from('datasets').update({ row_count: allRows.length, updated_at: now }).eq('id', collectionDatasetId)
  // Drop the stale signal-stats cache — it's keyed on theme-model hash + row
  // count, but invalidating here guarantees an immediate refresh.
  await invalidateSignalStats(service, collectionDatasetId)
  return { analytics, rowCount: allRows.length }
}

/**
 * Full refresh for a collection whose member datasets have changed since it was
 * built: rebuild the merged SCHEMA over the current members (so new/changed
 * member fields — e.g. a member that gained Dimensions — flow in), then
 * recompute analytics + row_count + drop the signal-stats cache. The recompute
 * bumps the collection's `updated_at`, which clears the "members updated" badge.
 *
 * Used by POST /api/collections/[id]/refresh. Returns the recomputed analytics
 * + row count, or null when the collection is missing.
 */
export async function refreshCollection(
  service: SupabaseClient,
  collectionDatasetId: string,
  updatedBy?: string,
): Promise<{ analytics: any; rowCount: number } | null> {
  const { data: col, error: colErr } = await service
    .from('collections').select('id').eq('dataset_id', collectionDatasetId).single()
  if (colErr) void logError('collectionRecompute.refreshCollection', colErr)
  if (!col) return null
  const { data: members, error: membersErr } = await service
    .from('collection_members').select('dataset_id').eq('collection_id', (col as { id: string }).id)
  if (membersErr) void logError('collectionRecompute.refreshCollection', membersErr)
  const memberIds = (members || []).map((m: { dataset_id: string }) => m.dataset_id)

  // Rebuild + persist the merged schema first so the analytics recompute reads it.
  const mergedSchema = await buildMergedCollectionSchema(service, memberIds)
  await service.from('dataset_state').update({ schema_config: mergedSchema }).eq('dataset_id', collectionDatasetId)

  return recomputeCollectionAnalytics(service, collectionDatasetId, updatedBy)
}

/**
 * Find every collection that includes `memberDatasetId` and recompute each.
 * Best-effort: logs and continues on per-collection failure so a member sync
 * is never blocked by one bad parent. Returns the count recomputed.
 */
export async function recomputeParentCollections(
  service: SupabaseClient,
  memberDatasetId: string,
): Promise<number> {
  const { data: memberships, error: membershipsErr } = await service
    .from('collection_members').select('collection_id').eq('dataset_id', memberDatasetId)
  if (membershipsErr) void logError('collectionRecompute.recomputeParentCollections', membershipsErr)
  if (!memberships?.length) return 0

  const collectionIds = Array.from(new Set(
    (memberships as { collection_id: string }[]).map(m => m.collection_id)))
  const { data: cols, error: colsErr } = await service
    .from('collections').select('dataset_id').in('id', collectionIds)
  if (colsErr) void logError('collectionRecompute.recomputeParentCollections', colsErr)
  if (!cols?.length) return 0

  let recomputed = 0
  for (const c of cols as { dataset_id: string }[]) {
    try {
      const res = await recomputeCollectionAnalytics(service, c.dataset_id)
      if (res) recomputed++
    } catch (err) {
      console.error({ at: 'recomputeParentCollections', collection: c.dataset_id, err })
    }
  }
  return recomputed
}
