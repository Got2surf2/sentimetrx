// lib/datasetAnalytics.ts
// Atomic accessors for the shared dataset_state.analytics JSONB blob.
//
// `analytics` holds independent top-level keys written by different code paths
// (signal_stats, totalRows, fieldSummaries, computedAt…). Writing it with a
// read-modify-write lets concurrent writers of different keys clobber one
// another. These delegate the mutation to server-side jsonb functions (sql/145)
// so each writer only touches its own keys. If the RPC isn't present yet
// (pre-migration), they fall back to the old best-effort RMW — same behavior as
// before, so nothing breaks until sql/145 is applied.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from '@/lib/log'

type AnalyticsRow = { analytics: Record<string, unknown> | null }

/** Shallow-merge `patch` into dataset_state.analytics, preserving other keys. */
export async function mergeDatasetAnalytics(
  service: SupabaseClient,
  datasetId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await service.rpc('merge_dataset_analytics', { p_dataset_id: datasetId, p_patch: patch })
  if (!error) return
  const { data, error: readErr } = await service.from('dataset_state').select('analytics').eq('dataset_id', datasetId).single()
  if (readErr) void logError('datasetAnalytics.mergeDatasetAnalytics', readErr)
  const cur = (data as AnalyticsRow | null)?.analytics || {}
  await service.from('dataset_state').update({ analytics: { ...cur, ...patch } }).eq('dataset_id', datasetId)
}

/** Remove one top-level key from dataset_state.analytics. */
export async function deleteDatasetAnalyticsKey(
  service: SupabaseClient,
  datasetId: string,
  key: string,
): Promise<void> {
  const { error } = await service.rpc('delete_dataset_analytics_key', { p_dataset_id: datasetId, p_key: key })
  if (!error) return
  const { data, error: readErr } = await service.from('dataset_state').select('analytics').eq('dataset_id', datasetId).single()
  if (readErr) void logError('datasetAnalytics.deleteDatasetAnalyticsKey', readErr)
  const cur = (data as AnalyticsRow | null)?.analytics
  if (!cur || !(key in cur)) return
  const next = { ...cur }
  delete next[key]
  await service.from('dataset_state').update({ analytics: next }).eq('dataset_id', datasetId)
}
