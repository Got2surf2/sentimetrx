// lib/collectionSchema.ts
//
// Merge the schemas of a set of member datasets into one collection schema.
// Shared by manual collections (POST /api/collections) and brand-collections
// (lib/brandRules.rebuildBrandSchema) so the two can't drift. Pure aside from
// the passed-in client — no server-only guard so the one-shot backfill script
// can reuse it.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SchemaConfig, SchemaFieldConfig } from './analyzeTypes'

/** Union all member fields by name (first occurrence wins), prepend the
 *  synthetic `_collection_label` field, and inherit the first member's
 *  primaryTextField. Members with no schema_config are skipped; an empty
 *  memberIds list yields a schema with just `_collection_label`. */
export async function buildMergedCollectionSchema(
  service: SupabaseClient,
  memberIds: string[],
): Promise<SchemaConfig> {
  const schemaResults = await Promise.all(memberIds.map((id) =>
    service.from('dataset_state').select('schema_config').eq('dataset_id', id).single()
  ))

  const fieldMap: Record<string, SchemaFieldConfig> = {
    _collection_label: {
      field:   '_collection_label',
      type:    'categorical',
      label:   'Source Dataset',
      section: 'core',
    },
  }

  let primaryTextField: string | undefined
  for (const res of schemaResults) {
    const sc = res.data?.schema_config as SchemaConfig | null
    if (!sc?.fields) continue
    for (const f of sc.fields) {
      if (!fieldMap[f.field]) fieldMap[f.field] = { ...f }
    }
    if (!primaryTextField && sc.primaryTextField) primaryTextField = sc.primaryTextField
  }

  return {
    fields:           Object.values(fieldMap),
    primaryTextField,
    autoDetected:     false,
    version:          1,
  }
}
