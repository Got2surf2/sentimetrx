// app/api/datasets/[datasetId]/rows/route.ts
// GET  -- paginated rows or bulk fetch for analysis modules
// POST -- append a new batch (unchanged)
//
// Query params:
//   page       (default 1)     — 1-based page number
//   pageSize   (default 100)   — rows per page, max 5000
//   field      (optional)      — return only this single column
//   fields     (optional)      — comma-separated column names to return
//   all        (optional)      — if 'true', return ALL rows (ignores page/pageSize)
//   sampleMax  (optional)      — when used with all=true, cap result to this many rows
//                                using deterministic seeded random sampling. Seeded
//                                by dataset_id, so the same dataset always yields the
//                                same sample (e.g. Stats numbers don't drift across
//                                refreshes). If totalRows <= sampleMax, all rows are
//                                returned unchanged.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { ROWS_PER_BATCH } from '@/lib/constants'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30   // allow 30s for large datasets in bulk mode

interface Params { params: { datasetId: string } }

// Tiny deterministic PRNG (mulberry32). Same seed → same sequence.
function mulberry32(seed: number): () => number {
  let s = seed | 0
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// djb2 hash — convert a UUID string to a 32-bit seed.
function seedFromString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) | 0
  return h
}
// Fisher-Yates shuffle in place using a provided RNG, then truncate to `n`.
function sampleInPlace<T>(arr: T[], n: number, rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
  }
  arr.length = n
}

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const user = await getAuthUser(supabase)
  if (!user) return { user: null, orgId: null }
  const userData = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  return { user, orgId: (userData.data?.org_id as string | null) }
}

// Project a row down to only the requested fields
function projectRow(row: Record<string, unknown>, fieldSet: Set<string> | null): Record<string, unknown> {
  if (!fieldSet) return row
  const out: Record<string, unknown> = {}
  fieldSet.forEach(function(f) { if (f in row) out[f] = row[f] })
  return out
}

export async function GET(req: Request, { params }: Params) {
  const supabase = createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dataset.org_id !== auth.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ── COLLECTION: union rows from all member datasets ─────────────────────
  if ((dataset as any).source === 'collection') {
    return handleCollectionRows(req, params.datasetId, auth.orgId)
  }

  const url      = new URL(req.url)
  const allMode    = url.searchParams.get('all') === 'true'
  const page       = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const pageSize   = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('pageSize') || '100')))
  const field      = url.searchParams.get('field') || null
  const fieldsP    = url.searchParams.get('fields') || null
  const sampleMaxP = url.searchParams.get('sampleMax')
  const sampleMax  = sampleMaxP ? Math.max(1, parseInt(sampleMaxP)) : null

  // Build field projection set
  let fieldSet: Set<string> | null = null
  if (field) {
    fieldSet = new Set([field])
  } else if (fieldsP) {
    fieldSet = new Set(fieldsP.split(',').map(function(f) { return f.trim() }).filter(Boolean))
  }

  const service = createServiceRoleClient()

  // Get total row count
  const metaResult = await service
    .from('datasets')
    .select('row_count')
    .eq('id', params.datasetId)
    .single()

  const totalRows  = metaResult.data?.row_count || 0

  // ── BULK MODE: return all rows (or a sample) in one response ─
  if (allMode) {
    const doSample = sampleMax !== null && totalRows > sampleMax
    const FLAT_PAGE = 1000
    const allRows: Record<string, unknown>[] = []
    let offset = 0
    let fetchMore = true
    while (fetchMore) {
      const { data: flatRows, error: flatErr } = await service
        .from('dataset_rows_flat').select('data')
        .eq('dataset_id', params.datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + FLAT_PAGE - 1)
      if (flatErr) return NextResponse.json({ error: flatErr.message }, { status: 500 })
      if (!flatRows || flatRows.length === 0) break
      for (let i = 0; i < flatRows.length; i++) {
        allRows.push(projectRow(flatRows[i].data, fieldSet))
      }
      if (flatRows.length < FLAT_PAGE) fetchMore = false
      offset += FLAT_PAGE
    }
    // Seeded random sampling — same dataset always yields the same sample
    if (doSample && allRows.length > sampleMax!) {
      sampleInPlace(allRows, sampleMax!, mulberry32(seedFromString(params.datasetId)))
    }
    return NextResponse.json({
      rows: allRows, page: 1, pageSize: allRows.length, totalRows, totalPages: 1,
      field: field || undefined, sampled: doSample,
      sampleSize: doSample ? allRows.length : totalRows,
      sampleRate: doSample ? parseFloat((allRows.length / Math.max(totalRows, 1)).toFixed(4)) : 1,
    })
  }

  // ── PAGINATED MODE ─────────────────────────────────────────────────────
  const totalPages = Math.ceil(totalRows / pageSize)
  const skip       = (page - 1) * pageSize

  const { data: flatRows, error: flatErr } = await service
    .from('dataset_rows_flat').select('data')
    .eq('dataset_id', params.datasetId)
    .order('row_index', { ascending: true })
    .range(skip, skip + pageSize - 1)
  if (flatErr) return NextResponse.json({ error: flatErr.message }, { status: 500 })
  const collected = (flatRows || []).map(function(r) { return projectRow(r.data, fieldSet) })
  return NextResponse.json({ rows: collected, page, pageSize, totalRows, totalPages, field: field || undefined })
}

// ── Collection rows: union member datasets with _collection_label ──────────
async function handleCollectionRows(req: Request, datasetId: string, orgId: string) {
  const service = createServiceRoleClient()

  // Look up collection → members
  const { data: collection } = await service
    .from('collections')
    .select('id')
    .eq('dataset_id', datasetId)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection metadata not found' }, { status: 404 })

  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id, label')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })

  if (!members || members.length === 0) {
    return NextResponse.json({ rows: [], page: 1, pageSize: 0, totalRows: 0, totalPages: 1 })
  }

  const url = new URL(req.url)
  const sampleMaxP = url.searchParams.get('sampleMax')
  const sampleMax  = sampleMaxP ? Math.max(1, parseInt(sampleMaxP)) : null

  // Fetch rows from each member dataset
  const allRows: Record<string, unknown>[] = []
  const FLAT_PAGE = 1000

  for (var mi = 0; mi < members.length; mi++) {
    var memberId = members[mi].dataset_id
    var label    = members[mi].label
    var offset   = 0
    var fetchMore = true

    while (fetchMore) {
      var { data: flatRows } = await service.from('dataset_rows_flat').select('data').eq('dataset_id', memberId).order('row_index', { ascending: true }).range(offset, offset + FLAT_PAGE - 1)
      if (!flatRows || flatRows.length === 0) { fetchMore = false; break }
      for (var fi = 0; fi < flatRows.length; fi++) {
        allRows.push({ ...flatRows[fi].data, _collection_label: label })
      }
      if (flatRows.length < FLAT_PAGE) fetchMore = false
      offset += FLAT_PAGE
    }
  }

  var totalRows = allRows.length

  // Seeded random sampling — same dataset always yields the same sample
  var doSample = sampleMax !== null && totalRows > sampleMax
  if (doSample) {
    sampleInPlace(allRows, sampleMax!, mulberry32(seedFromString(datasetId)))
  }

  return NextResponse.json({
    rows: allRows, page: 1, pageSize: allRows.length, totalRows: totalRows, totalPages: 1,
    sampled: doSample,
    sampleSize: doSample ? allRows.length : totalRows,
    sampleRate: doSample ? parseFloat((allRows.length / Math.max(totalRows, 1)).toFixed(4)) : 1,
  })
}

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const rows = body.rows
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Compute the next batch_index from flat rows. We still expose batch_index in
  // the response/DELETE contract so clients can roll back their own appends.
  // row_index = batch_index * ROWS_PER_BATCH + offset, so batch_index is
  // floor(max_row_index / ROWS_PER_BATCH) + 1.
  const maxRowResp = await service
    .from('dataset_rows_flat')
    .select('row_index')
    .eq('dataset_id', params.datasetId)
    .order('row_index', { ascending: false })
    .limit(1)

  const maxRowIndex = maxRowResp.data && maxRowResp.data.length > 0 ? maxRowResp.data[0].row_index : -1
  const nextIndex = maxRowIndex < 0 ? 0 : Math.floor(maxRowIndex / ROWS_PER_BATCH) + 1

  const flatRows = rows.map(function(r: Record<string, unknown>, i: number) {
    return { dataset_id: params.datasetId, row_index: nextIndex * ROWS_PER_BATCH + i, data: r }
  })
  const insertResult = await service.from('dataset_rows_flat').insert(flatRows)
  if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 })

  const { count } = await service
    .from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', params.datasetId)
  const total = count || 0

  await service
    .from('datasets')
    .update({ row_count: total, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({ ok: true, batch_index: nextIndex, row_count: rows.length, total_rows: total }, { status: 201 })
}

// DELETE /api/datasets/[datasetId]/rows — rollback batches by index
export async function DELETE(req: Request, { params }: Params) {
  const supabase = createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(function() { return {} })
  const batchIndexes: number[] = body.batch_indexes
  if (!Array.isArray(batchIndexes) || batchIndexes.length === 0) {
    return NextResponse.json({ error: 'batch_indexes must be a non-empty array' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Delete from flat table (each batch used row_index = batchIndex * ROWS_PER_BATCH + i)
  for (var bi = 0; bi < batchIndexes.length; bi++) {
    var startIdx = batchIndexes[bi] * ROWS_PER_BATCH
    await service.from('dataset_rows_flat').delete()
      .eq('dataset_id', params.datasetId)
      .gte('row_index', startIdx)
      .lt('row_index', startIdx + ROWS_PER_BATCH)
  }

  const { count } = await service.from('dataset_rows_flat').select('id', { count: 'exact', head: true }).eq('dataset_id', params.datasetId)
  const total = count || 0
  await service.from('datasets').update({ row_count: total, updated_at: new Date().toISOString() }).eq('id', params.datasetId)

  return NextResponse.json({ ok: true, deleted_batches: batchIndexes.length, total_rows: total })
}
