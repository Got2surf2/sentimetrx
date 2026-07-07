// app/api/datasets/[datasetId]/refresh-schema/route.ts
// POST — re-scan all rows for this dataset and widen the schema's per-field
// `values` lists (and numeric min/max) to match. Idempotent. Use to backfill
// datasets whose schemas were frozen on first sync (Google Reviews, Reddit,
// collections) before the on-every-sync merge was wired up.
//
// For collections, the refresh cascades: each member dataset's schema is
// refreshed against its own rows first, then the collection's schema is
// refreshed against the union of all member rows (with `_collection_label`
// attached). That way fixing the collection also fixes its members in one
// click — the user doesn't have to walk every member individually.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { mergeSchemaStats } from '@/lib/datasetUtils'
import type { SchemaConfig, SchemaFieldConfig } from '@/lib/analyzeTypes'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ datasetId: string }> }

const FLAT_PAGE = 1000

type Service = ReturnType<typeof createServiceRoleClient>

// Stream the dataset's rows in FLAT_PAGE chunks — only one chunk is ever held
// in memory. Returns the total row count scanned.
async function forEachFlatChunk(service: Service, datasetId: string, onChunk: (rows: Record<string, unknown>[]) => void): Promise<number> {
  let scanned = 0
  let offset = 0
  while (true) {
    const { data, error } = await service
      .from('dataset_rows_flat').select('data')
      .eq('dataset_id', datasetId)
      .order('row_index', { ascending: true })
      .range(offset, offset + FLAT_PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    onChunk((data as Array<{ data: Record<string, unknown> }>).map(function(r) { return r.data }))
    scanned += data.length
    if (data.length < FLAT_PAGE) break
    offset += FLAT_PAGE
  }
  return scanned
}

interface FieldDelta { field: string; before: number; after: number }
interface RefreshResult { datasetId: string; name?: string; rowsScanned: number; fieldsGrown: FieldDelta[]; skipped?: string }

function diffValuesCounts(before: SchemaConfig, after: SchemaConfig): FieldDelta[] {
  const beforeMap: Record<string, number> = {}
  for (const f of before.fields) {
    if (Array.isArray(f.values)) beforeMap[f.field] = f.values.length
  }
  const grew: FieldDelta[] = []
  for (const f of after.fields) {
    if (Array.isArray(f.values)) {
      const a = f.values.length
      const b = beforeMap[f.field] || 0
      if (a > b) grew.push({ field: f.field, before: b, after: a })
    }
  }
  return grew
}

async function loadSchemaConfig(service: Service, datasetId: string): Promise<SchemaConfig | null> {
  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  const schema = stateRow?.schema_config as SchemaConfig | null
  return schema?.fields?.length ? schema : null
}

async function saveMergedSchema(service: Service, datasetId: string, userId: string, before: SchemaConfig, merged: SchemaConfig, rowsScanned: number): Promise<RefreshResult> {
  const grew = diffValuesCounts(before, merged)
  await service.from('dataset_state')
    .update({ schema_config: merged, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('dataset_id', datasetId)
  return { datasetId, rowsScanned, fieldsGrown: grew }
}

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase.from('datasets').select('org_id, source, name').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  const service = createServiceRoleClient()

  // Non-collection — refresh against this dataset's own rows.
  if (dataset.source !== 'collection') {
    const schema = await loadSchemaConfig(service, params.datasetId)
    if (!schema) return NextResponse.json({ error: 'No schema to refresh' }, { status: 400 })
    let merged = schema
    const rowsScanned = await forEachFlatChunk(service, params.datasetId, function(rows) {
      merged = mergeSchemaStats(merged, rows) as SchemaConfig
    })
    if (rowsScanned === 0) return NextResponse.json({ error: 'No rows to scan' }, { status: 400 })
    const out = await saveMergedSchema(service, params.datasetId, user.id, schema, merged, rowsScanned)
    return NextResponse.json({
      ok: true,
      rowsScanned: out.rowsScanned,
      fieldsGrown: out.fieldsGrown,
    })
  }

  // Collection — cascade. Refresh each member against its own rows first,
  // then refresh the collection against the union (with _collection_label).
  const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
  if (!col) return NextResponse.json({ error: 'Collection metadata not found' }, { status: 404 })

  const { data: members } = await service
    .from('collection_members').select('dataset_id, label')
    .eq('collection_id', col.id).order('sort_order', { ascending: true })

  const memberResults: Array<RefreshResult & { name?: string }> = []
  const collectionSchema = await loadSchemaConfig(service, params.datasetId)
  let collectionMerged = collectionSchema
  let unionScanned = 0

  if (members && members.length > 0) {
    // Stream each member's rows once per chunk: refresh that member, then
    // label the same chunk in place and fold it into the collection-level
    // merge — no union buffer, no duplicate copy.
    const memberMeta = await service
      .from('datasets').select('id, name')
      .in('id', members.map(m => m.dataset_id))
    const nameById: Record<string, string> = {}
    for (const r of memberMeta.data || []) nameById[r.id] = r.name as string

    for (const m of members) {
      const memberSchema = await loadSchemaConfig(service, m.dataset_id)
      let memberMerged = memberSchema
      const label = m.label || nameById[m.dataset_id] || ''
      const scanned = await forEachFlatChunk(service, m.dataset_id, function(rows) {
        if (memberMerged) memberMerged = mergeSchemaStats(memberMerged, rows) as SchemaConfig
        for (const row of rows) row['_collection_label'] = label
        if (collectionMerged) collectionMerged = mergeSchemaStats(collectionMerged, rows) as SchemaConfig
      })
      unionScanned += scanned
      const name = nameById[m.dataset_id] || m.label || m.dataset_id
      if (!memberSchema || !memberMerged) {
        memberResults.push({ datasetId: m.dataset_id, rowsScanned: 0, fieldsGrown: [], skipped: 'no schema', name })
      } else if (scanned === 0) {
        memberResults.push({ datasetId: m.dataset_id, rowsScanned: 0, fieldsGrown: [], skipped: 'no rows', name })
      } else {
        const out = await saveMergedSchema(service, m.dataset_id, user.id, memberSchema, memberMerged, scanned)
        memberResults.push({ ...out, name })
      }
    }
  }

  let collectionOut: RefreshResult
  if (!collectionSchema || !collectionMerged) {
    collectionOut = { datasetId: params.datasetId, rowsScanned: 0, fieldsGrown: [], skipped: 'no schema' }
  } else if (unionScanned === 0) {
    collectionOut = { datasetId: params.datasetId, rowsScanned: 0, fieldsGrown: [], skipped: 'no rows' }
  } else {
    collectionOut = await saveMergedSchema(service, params.datasetId, user.id, collectionSchema, collectionMerged, unionScanned)
  }

  return NextResponse.json({
    ok: true,
    isCollection: true,
    rowsScanned: collectionOut.rowsScanned,
    fieldsGrown: collectionOut.fieldsGrown,
    members: memberResults,
  })
}
