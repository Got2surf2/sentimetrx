// lib/collectionScope.ts
// A collection dataset holds ZERO rows of its own — every row lives in its
// member datasets. Anything that reads or writes dataset_rows_flat for a
// dataset that might be a collection has to fan out across the members, the
// way /theme-counts has since collections shipped. Taxonomy ("Dimensions")
// never did, which is why the tab showed "No taggable text found" on every
// collection: it queried the collection's own dataset_id and found nothing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logError } from './log'

/** One dataset in a scope. `label` is the member's `_collection_label` — the
 *  synthetic "Source Dataset" value, which lives on collection_members and is
 *  never stored on the rows themselves — and is null for a plain dataset. */
export interface ScopeMember { datasetId: string; label: string | null }

/**
 * The datasets whose rows make up this dataset's scope: a collection's member
 * datasets, or the dataset itself. A collection with no members falls back to
 * itself so callers page an honestly-empty scope rather than skipping their
 * query entirely.
 */
export async function resolveScopeMembers(
  service: SupabaseClient,
  datasetId: string,
): Promise<ScopeMember[]> {
  const self = [{ datasetId, label: null }]
  const { data: ds, error: dsErr } = await service
    .from('datasets').select('source').eq('id', datasetId).single()
  if (dsErr) void logError('collectionScope.resolveScopeMembers', dsErr)
  if ((ds as { source?: string } | null)?.source !== 'collection') return self
  const { data: col, error: colErr } = await service
    .from('collections').select('id').eq('dataset_id', datasetId).single()
  if (colErr) void logError('collectionScope.resolveScopeMembers', colErr)
  if (!col) return self
  const { data: members, error: membersErr } = await service
    .from('collection_members').select('dataset_id, label, sort_order')
    .eq('collection_id', (col as { id: string }).id)
    .order('sort_order', { ascending: true })
  if (membersErr) void logError('collectionScope.resolveScopeMembers', membersErr)
  const rows = (members || []) as { dataset_id: string; label: string | null }[]
  if (rows.length === 0) return self
  // Unlabelled members fall back to the member dataset's own name, matching
  // what the rows route stamps onto `_collection_label`.
  const missing = rows.filter(m => !m.label).map(m => m.dataset_id)
  const names = new Map<string, string>()
  if (missing.length) {
    const { data: dsRows } = await service.from('datasets').select('id, name').in('id', missing)
    for (const d of (dsRows || []) as { id: string; name: string }[]) names.set(d.id, d.name)
  }
  return rows.map(m => ({ datasetId: m.dataset_id, label: m.label || names.get(m.dataset_id) || null }))
}

/** Just the ids — the common case for a read or write that only needs scope. */
export async function resolveMemberDatasetIds(
  service: SupabaseClient,
  datasetId: string,
): Promise<string[]> {
  return (await resolveScopeMembers(service, datasetId)).map(m => m.datasetId)
}

/** Sum a per-dataset scalar RPC (a count) over the scope. */
export async function sumOverDatasets(
  service: SupabaseClient,
  datasetIds: string[],
  fn: string,
  args: (datasetId: string) => Record<string, unknown>,
): Promise<number | null> {
  let total = 0
  for (const id of datasetIds) {
    const { data, error } = await service.rpc(fn, args(id))
    if (error || data == null || !Number.isFinite(Number(data))) return null
    total += Number(data)
  }
  return total
}
