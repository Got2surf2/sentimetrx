import 'server-only'

// lib/brandRules.ts
//
// The "brand rules" seam: actions applied to a brand-collection when its
// membership changes. Today it does one thing — rebuild the brand-collection's
// merged schema so Charts/Stats work across the brand's datasets. Phase 6
// extends applyBrandRulesOnJoin with incremental entity discovery and adds a
// weekly cron caller; future brand rules (structured tagging, score maps —
// read from collections.rules) slot in here too.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMergedCollectionSchema } from './collectionSchema'

/** Rebuild the merged schema for one brand-collection's virtual dataset from
 *  its current members. Idempotent. A brand with no members gets a schema
 *  with just the `_collection_label` field. No-op if the id isn't a
 *  brand-collection. */
export async function rebuildBrandSchema(
  service: SupabaseClient,
  brandCollectionId: string,
): Promise<void> {
  const { data: col } = await service
    .from('collections')
    .select('dataset_id, kind')
    .eq('id', brandCollectionId)
    .single()
  if (!col || (col as any).kind !== 'brand') return

  const virtualDatasetId = (col as any).dataset_id as string

  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id')
    .eq('collection_id', brandCollectionId)
  const memberIds = (members || []).map((m: any) => m.dataset_id as string)

  const mergedSchema = await buildMergedCollectionSchema(service, memberIds)

  await service
    .from('dataset_state')
    .upsert({ dataset_id: virtualDatasetId, schema_config: mergedSchema }, { onConflict: 'dataset_id' })
}

/** Apply a brand's on-join rules after a dataset joins it. Called from the
 *  dataset-create routes once a brand_tag has been set — by then the 062
 *  trigger has already stamped brand_collection_id and synced
 *  collection_members. Today: rebuild the merged schema. Phase 6 adds
 *  incremental entity discovery here. No-op when the dataset has no brand. */
export async function applyBrandRulesOnJoin(
  service: SupabaseClient,
  datasetId: string,
): Promise<void> {
  const { data: ds } = await service
    .from('datasets')
    .select('brand_collection_id')
    .eq('id', datasetId)
    .single()
  const brandCollectionId = (ds as any)?.brand_collection_id as string | null
  if (!brandCollectionId) return

  await rebuildBrandSchema(service, brandCollectionId)
}
