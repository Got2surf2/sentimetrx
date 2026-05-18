import 'server-only'

// lib/brandRules.ts
//
// The "brand rules" seam: actions applied to a brand-collection's datasets.
// Two rules today:
//   1. rebuildBrandSchema — keep the brand-collection's merged schema in sync
//      with its members so Charts/Stats work across the brand.
//   2. discoverBrandEntitiesIfNeeded — incremental entity discovery the first
//      time a branded dataset's rows land (Phase 6).
// Both are invoked from the compute route (the only point at which a member
// dataset's rows are guaranteed to exist — create routes run before rows
// load). Future brand rules (structured tagging, score maps — read from
// collections.rules) slot in here too.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMergedCollectionSchema } from './collectionSchema'
import { discoverEntities } from './entityDiscovery'

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
 *  collection_members. Today: rebuild the merged schema. No-op when the
 *  dataset has no brand. */
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

/** Brand rule #1 (Phase 6): incremental entity discovery. Called from the
 *  compute route after a branded dataset's analytics compute succeeds — the
 *  first point at which the dataset's rows are guaranteed to exist (the 5
 *  dataset-create routes all run before rows load, so discovery wired there
 *  would sample nothing).
 *
 *  Runs discovery exactly once per dataset: discovery does paid Haiku NER
 *  calls, so it must not re-run on every subsequent sync/compute. The
 *  once-per-dataset gate reads entity_catalog_refresh.datasets_sampled — if
 *  this dataset already appears in a run for its brand scope, it's covered
 *  (the weekly cron handles ongoing refresh). No-op when the dataset has no
 *  brand. Caller should not await this on the request path — it's slow. */
export async function discoverBrandEntitiesIfNeeded(
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

  const { data: priorRuns } = await service
    .from('entity_catalog_refresh')
    .select('id')
    .eq('scope_type', 'collection')
    .eq('scope_id', brandCollectionId)
    .contains('datasets_sampled', [datasetId])
    .limit(1)
  if (priorRuns && priorRuns.length > 0) return

  await discoverEntities({
    service,
    datasetId,
    mode: 'incremental',
    sampleDatasetIds: [datasetId],
    // Same auto-skip logic the weekly cron uses: don't burn AI tokens on a
    // category the brand has already curated by hand.
    autoExcludeFromCurated: true,
  })
}
