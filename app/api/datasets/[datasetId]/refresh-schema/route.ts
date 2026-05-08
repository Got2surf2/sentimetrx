// app/api/datasets/[datasetId]/refresh-schema/route.ts
// POST — re-scan all rows for this dataset and widen the schema's per-field
// `values` lists (and numeric min/max) to match. Idempotent. Use to backfill
// datasets whose schemas were frozen on first sync (Google Reviews, Reddit,
// collections) before the on-every-sync merge was wired up.
//
// For collections, scans all member datasets' rows and attaches
// `_collection_label` to mirror the rows API behavior so the collection's
// own _collection_label values list grows to match its members.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { mergeSchemaStats } from '@/lib/datasetUtils'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { datasetId: string } }

const FLAT_PAGE = 1000

async function readAllFlatRows(service: ReturnType<typeof createServiceRoleClient>, datasetId: string, label?: string): Promise<Record<string, unknown>[]> {
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

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dataset.org_id !== userData?.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const service = createServiceRoleClient()

  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).single()

  const schema = stateRow?.schema_config
  if (!schema?.fields?.length) {
    return NextResponse.json({ error: 'No schema to refresh' }, { status: 400 })
  }

  // Gather all rows. Collections union member rows with _collection_label so
  // the collection's _collection_label values list backfills correctly.
  let rows: Record<string, unknown>[] = []
  if ((dataset as any).source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (!col) return NextResponse.json({ error: 'Collection metadata not found' }, { status: 404 })
    const { data: members } = await service
      .from('collection_members').select('dataset_id, label')
      .eq('collection_id', col.id).order('sort_order', { ascending: true })
    if (members && members.length > 0) {
      for (const m of members) {
        const memberRows = await readAllFlatRows(service, m.dataset_id, m.label || undefined)
        rows.push(...memberRows)
      }
    }
  } else {
    rows = await readAllFlatRows(service, params.datasetId)
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows to scan' }, { status: 400 })
  }

  // Snapshot value-count diff for the response so the caller can confirm
  // something actually changed.
  const before: Record<string, number> = {}
  for (const f of schema.fields) {
    if (Array.isArray((f as any).values)) before[f.field] = (f as any).values.length
  }

  const merged = mergeSchemaStats(schema, rows)

  const after: Record<string, number> = {}
  for (const f of merged.fields) {
    if (Array.isArray((f as any).values)) after[f.field] = (f as any).values.length
  }

  const grew: { field: string; before: number; after: number }[] = []
  for (const k of Object.keys(after)) {
    const a = after[k] || 0
    const b = before[k] || 0
    if (a > b) grew.push({ field: k, before: b, after: a })
  }

  await service.from('dataset_state')
    .update({ schema_config: merged, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('dataset_id', params.datasetId)

  return NextResponse.json({
    ok: true,
    rowsScanned: rows.length,
    fieldsGrown: grew,
  })
}
