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
//                                returned unchanged. Bounded above by BULK_ROWS_HARD_CAP
//                                (below) no matter what — the endpoint never buffers a
//                                whole 500K-row dataset even if sampleMax is omitted.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { ROWS_PER_BATCH } from '@/lib/constants'
import { stripReservedRowKeys } from '@/lib/taxonomyEmbed'
import { serverError } from '@/lib/apiError'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30   // allow 30s for large datasets in bulk mode

// Hard ceiling on how many rows a bulk (all=true) fetch will ever hold in memory
// / return. TextMine loads all rows client-side under 50K by design, so 50K is the
// product cap; above it TextMine already switches to sampling. The client passes
// sampleMax, but the SERVER must enforce its own bound — an all=true call with no
// (or a huge) sampleMax would otherwise page an entire 500K-row dataset into the
// function heap and JSON-serialize it (OOM + hundreds of MB response).
const BULK_ROWS_HARD_CAP = 50000

interface Params { params: Promise<{ datasetId: string }> }

// Streaming reservoir sample (Algorithm R): keep a uniform random `capacity`-size
// sample over an unbounded stream in O(capacity) memory. Seed the rng from a stable
// key (dataset_id) so the selected sample is identical across refreshes. When the
// stream has <= capacity items, every item is kept (no sampling), in arrival order.
function makeReservoir(capacity: number, rng: () => number) {
  const items: Record<string, unknown>[] = []
  let seen = 0
  return {
    push(item: Record<string, unknown>) {
      seen++
      if (items.length < capacity) { items.push(item); return }
      const j = Math.floor(rng() * seen)
      if (j < capacity) items[j] = item
    },
    get seen() { return seen },
    get items() { return items },
  }
}

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
async function authCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const ctx = await getCallerOrgContext(supabase)
  return { user: ctx.userId ? { id: ctx.userId } as any : null, orgId: ctx.orgId, isAdmin: ctx.isAdmin }
}

// Project a row down to only the requested fields. Unprojected rows are
// stripped of reserved metadata keys (data._tx taxonomy block, sql/151) —
// they're app internals, not dataset columns, and TextMine's bulk fetch would
// otherwise ship every classified row's assertions to the client.
function projectRow(row: Record<string, unknown>, fieldSet: Set<string> | null): Record<string, unknown> {
  if (!fieldSet) return stripReservedRowKeys(row)
  const out: Record<string, unknown> = {}
  fieldSet.forEach(function(f) { if (f in row) out[f] = row[f] })
  return out
}

export async function GET(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dataset.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

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
  // Opt-in: attach the flat row id as `_rowId` so the client can build a filtered
  // row-id set for server-side dimension aggregates (view-level charts). Off by
  // default so existing callers' row shape is unchanged.
  const withRowIds = url.searchParams.get('withRowIds') === 'true'

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
    // Effective cap = the smaller of the caller's sampleMax and the hard ceiling;
    // reservoir-sample as we page so heap is bounded to `cap` even if the dataset
    // is 500K rows (fixes the unbounded-buffer path when sampleMax is omitted).
    const cap = Math.min(sampleMax ?? BULK_ROWS_HARD_CAP, BULK_ROWS_HARD_CAP)
    const reservoir = makeReservoir(cap, mulberry32(seedFromString(params.datasetId)))
    const FLAT_PAGE = 1000
    let offset = 0
    let fetchMore = true
    while (fetchMore) {
      const { data: flatRows, error: flatErr } = await service
        .from('dataset_rows_flat').select(withRowIds ? 'id, data' : 'data')
        .eq('dataset_id', params.datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + FLAT_PAGE - 1)
      if (flatErr) return serverError(flatErr, 'datasets.rows.bulk', { orgId: auth.orgId })
      if (!flatRows || flatRows.length === 0) break
      for (let i = 0; i < flatRows.length; i++) {
        const r = projectRow((flatRows[i] as any).data, fieldSet)
        if (withRowIds) r._rowId = (flatRows[i] as any).id
        reservoir.push(r)
      }
      if (flatRows.length < FLAT_PAGE) fetchMore = false
      offset += FLAT_PAGE
    }
    const rows = reservoir.items
    const sampled = reservoir.seen > rows.length
    return NextResponse.json({
      rows, page: 1, pageSize: rows.length, totalRows, totalPages: 1,
      field: field || undefined, sampled,
      sampleSize: rows.length,
      sampleRate: sampled ? parseFloat((rows.length / Math.max(reservoir.seen, 1)).toFixed(4)) : 1,
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
  if (flatErr) return serverError(flatErr, 'datasets.rows.page', { orgId: auth.orgId })
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

  // Reservoir-sample the union so a collection over several large members can't
  // buffer millions of rows at once. Bounded to the smaller of sampleMax and the
  // hard cap; seeded by the collection's dataset_id for a stable sample.
  const cap = Math.min(sampleMax ?? BULK_ROWS_HARD_CAP, BULK_ROWS_HARD_CAP)
  const reservoir = makeReservoir(cap, mulberry32(seedFromString(datasetId)))
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
        reservoir.push({ ...stripReservedRowKeys(flatRows[fi].data), _collection_label: label })
      }
      if (flatRows.length < FLAT_PAGE) fetchMore = false
      offset += FLAT_PAGE
    }
  }

  var rows = reservoir.items
  var totalRows = reservoir.seen
  var doSample = reservoir.seen > rows.length

  return NextResponse.json({
    rows, page: 1, pageSize: rows.length, totalRows: totalRows, totalPages: 1,
    sampled: doSample,
    sampleSize: rows.length,
    sampleRate: doSample ? parseFloat((rows.length / Math.max(totalRows, 1)).toFixed(4)) : 1,
  })
}

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck } = await supabase.from('datasets').select('org_id, row_count').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

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
  if (insertResult.error) return serverError(insertResult.error, 'datasets.rows.insert', { orgId: auth.orgId })

  // Running total — an exact count(*) over the whole dataset per appended batch
  // is quadratic across a large upload. DELETE below still recounts exactly, so
  // any drift self-heals on the next rollback.
  const total = (dsCheck.row_count || 0) + rows.length

  await service
    .from('datasets')
    .update({ row_count: total, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({ ok: true, batch_index: nextIndex, row_count: rows.length, total_rows: total }, { status: 201 })
}

// DELETE /api/datasets/[datasetId]/rows — rollback batches by index
export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!auth.isAdmin && dsCheck.org_id !== auth.orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

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
