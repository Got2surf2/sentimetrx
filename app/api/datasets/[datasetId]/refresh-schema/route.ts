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

async function readAllFlatRows(service: Service, datasetId: string, label?: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  let offset = 0
  while (true) {
    const { data, error } = await service
      .from('dataset_rows_flat').select('data')
      .eq('dataset_id', datasetId)
      .order('row_index', { ascending: true })
      .range(offset, offset + FLAT_PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data) {
      if (label) all.push({ ...(r as any).data, _collection_label: label })
      else all.push((r as any).data)
    }
    if (data.length < FLAT_PAGE) break
    offset += FLAT_PAGE
  }
  return all
}

interface FieldDelta { field: string; before: number; after: number }
interface RefreshResult { datasetId: string; name?: string; rowsScanned: number; fieldsGrown: FieldDelta[]; skipped?: string }

function diffValuesCounts(before: SchemaConfig, after: SchemaConfig): FieldDelta[] {
  const beforeMap: Record<string, number> = {}
  for (const f of before.fields) {
    if (Array.isArray((f as any).values)) beforeMap[f.field] = (f as any).values.length
  }
  const grew: FieldDelta[] = []
  for (const f of after.fields) {
    if (Array.isArray((f as any).values)) {
      const a = (f as any).values.length
      const b = beforeMap[f.field] || 0
      if (a > b) grew.push({ field: f.field, before: b, after: a })
    }
  }
  return grew
}

async function refreshOne(service: Service, datasetId: string, userId: string, rows: Record<string, unknown>[]): Promise<RefreshResult | null> {
  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  const schema = stateRow?.schema_config as SchemaConfig | null
  if (!schema?.fields?.length) return { datasetId, rowsScanned: 0, fieldsGrown: [], skipped: 'no schema' }
  if (rows.length === 0) return { datasetId, rowsScanned: 0, fieldsGrown: [], skipped: 'no rows' }

  const merged = mergeSchemaStats(schema, rows) as SchemaConfig
  const grew = diffValuesCounts(schema, merged)
  await service.from('dataset_state')
    .update({ schema_config: merged, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('dataset_id', datasetId)
  return { datasetId, rowsScanned: rows.length, fieldsGrown: grew }
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
  if ((dataset as any).source !== 'collection') {
    const rows = await readAllFlatRows(service, params.datasetId)
    const out = await refreshOne(service, params.datasetId, user.id, rows)
    if (!out) return NextResponse.json({ error: 'No schema to refresh' }, { status: 400 })
    if (out.skipped === 'no schema') return NextResponse.json({ error: 'No schema to refresh' }, { status: 400 })
    if (out.skipped === 'no rows')   return NextResponse.json({ error: 'No rows to scan' },  { status: 400 })
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
  const unionRows: Record<string, unknown>[] = []

  if (members && members.length > 0) {
    // Pull each member's rows once, refresh that member, also accumulate the
    // labeled union for the collection-level refresh.
    const memberMeta = await service
      .from('datasets').select('id, name')
      .in('id', members.map(m => m.dataset_id))
    const nameById: Record<string, string> = {}
    for (const r of memberMeta.data || []) nameById[r.id] = r.name as string

    for (const m of members) {
      const ownRows = await readAllFlatRows(service, m.dataset_id)
      const out = await refreshOne(service, m.dataset_id, user.id, ownRows)
      if (out) memberResults.push({ ...out, name: nameById[m.dataset_id] || m.label || m.dataset_id })
      // Accumulate labeled rows for the collection scan without re-fetching.
      const label = m.label || nameById[m.dataset_id] || ''
      for (const row of ownRows) unionRows.push({ ...row, _collection_label: label })
    }
  }

  const collectionOut = await refreshOne(service, params.datasetId, user.id, unionRows)
  if (!collectionOut) return NextResponse.json({ error: 'No schema to refresh' }, { status: 400 })

  return NextResponse.json({
    ok: true,
    isCollection: true,
    rowsScanned: collectionOut.rowsScanned,
    fieldsGrown: collectionOut.fieldsGrown,
    members: memberResults,
  })
}
