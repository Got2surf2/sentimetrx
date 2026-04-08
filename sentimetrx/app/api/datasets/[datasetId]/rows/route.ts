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
//                                using systematic sampling (every N-th row).
//                                If totalRows <= sampleMax, all rows are returned unchanged.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30   // allow 30s for large datasets in bulk mode

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const result = await supabase.auth.getUser()
  const user = result.data.user
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

  const { data: dataset } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (dataset.org_id !== auth.orgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

  // ── BULK MODE: return all rows (or a systematic sample) in one response ─
  if (allMode) {
    // Systematic sampling: when sampleMax is set and the dataset exceeds it,
    // include every step-th row so the result is evenly distributed over time.
    // step = ceil(totalRows / sampleMax) — e.g. 50k rows, sampleMax 10k → step 5.
    // We compute step from the stored row_count so we never need to materialise
    // the full array; sampling happens during the streaming loop.
    const doSample    = sampleMax !== null && totalRows > sampleMax
    const sampleStep  = doSample ? Math.ceil(totalRows / sampleMax!) : 1
    let globalIdx   = 0

    const allRows: Record<string, unknown>[] = []
    let bulkPage = 0
    const BULK_FETCH = 200  // fetch 200 batch records per DB call (~10K rows)
    let hasMore = true

    while (hasMore) {
      const bFrom = bulkPage * BULK_FETCH
      const bTo   = bFrom + BULK_FETCH - 1

      const batchResult = await service
        .from('dataset_rows')
        .select('rows')
        .eq('dataset_id', params.datasetId)
        .order('batch_index', { ascending: true })
        .range(bFrom, bTo)

      if (batchResult.error) return NextResponse.json({ error: batchResult.error.message }, { status: 500 })
      const batches = batchResult.data
      if (!batches || batches.length === 0) { hasMore = false; break }

      for (let bi = 0; bi < batches.length; bi++) {
        const batchRows = batches[bi].rows || []
        for (let ri = 0; ri < batchRows.length; ri++) {
          if (!doSample || globalIdx % sampleStep === 0) {
            allRows.push(projectRow(batchRows[ri], fieldSet))
          }
          globalIdx++
        }
      }

      if (batches.length < BULK_FETCH) hasMore = false
      bulkPage++
    }

    return NextResponse.json({
      rows:       allRows,
      page:       1,
      pageSize:   allRows.length,
      totalRows,
      totalPages: 1,
      field:      field || undefined,
      // Sampling metadata — consumed by StatsModule to show a banner
      sampled:    doSample,
      sampleSize: doSample ? allRows.length : totalRows,
      sampleRate: doSample ? parseFloat((allRows.length / Math.max(totalRows, 1)).toFixed(4)) : 1,
    })
  }

  // ── PAGINATED MODE (original behavior) ─────────────────────────────────
  const totalPages = Math.ceil(totalRows / pageSize)
  const skip       = (page - 1) * pageSize

  const collected: Record<string, unknown>[] = []
  let rowsSeen  = 0
  let pageBatch = 0
  const PAGE_FETCH = 50

  outer: while (collected.length < pageSize) {
    const pFrom = pageBatch * PAGE_FETCH
    const pTo   = pFrom + PAGE_FETCH - 1

    const pageResult = await service
      .from('dataset_rows')
      .select('rows, row_count')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .range(pFrom, pTo)

    if (pageResult.error) return NextResponse.json({ error: pageResult.error.message }, { status: 500 })
    const pageBatches = pageResult.data
    if (!pageBatches || pageBatches.length === 0) break

    for (let pbi = 0; pbi < pageBatches.length; pbi++) {
      const pRows: Record<string, unknown>[] = pageBatches[pbi].rows || []
      for (let pri = 0; pri < pRows.length; pri++) {
        if (rowsSeen < skip) { rowsSeen++; continue }
        if (collected.length >= pageSize) break outer
        collected.push(projectRow(pRows[pri], fieldSet))
        rowsSeen++
      }
    }

    if (pageBatches.length < PAGE_FETCH) break
    pageBatch++
  }

  return NextResponse.json({
    rows:       collected,
    page,
    pageSize,
    totalRows,
    totalPages,
    field:      field || undefined,
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
  const source_ref = body.source_ref
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const existResult = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)

  const nextIndex = existResult.data && existResult.data.length > 0 ? existResult.data[0].batch_index + 1 : 0

  const insertResult = await service
    .from('dataset_rows')
    .insert({
      dataset_id:  params.datasetId,
      rows,
      row_count:   rows.length,
      batch_index: nextIndex,
      source_ref:  source_ref || null,
    })

  if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 })

  // Also insert into flat table for fast queries
  const flatRows = rows.map(function(r: Record<string, unknown>, i: number) {
    return { dataset_id: params.datasetId, row_index: nextIndex * 200 + i, data: r }
  })
  if (flatRows.length > 0) {
    try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
  }

  const countResult = await service
    .from('dataset_rows')
    .select('row_count')
    .eq('dataset_id', params.datasetId)

  const total = (countResult.data || []).reduce(function(sum: number, b: { row_count: number }) {
    return sum + (b.row_count || 0)
  }, 0)

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

  // Delete from batched table
  await service.from('dataset_rows').delete()
    .eq('dataset_id', params.datasetId)
    .in('batch_index', batchIndexes)

  // Delete from flat table (each batch used row_index = batchIndex * 200 + i)
  for (var bi = 0; bi < batchIndexes.length; bi++) {
    var startIdx = batchIndexes[bi] * 200
    await service.from('dataset_rows_flat').delete()
      .eq('dataset_id', params.datasetId)
      .gte('row_index', startIdx)
      .lt('row_index', startIdx + 200)
  }

  // Recalculate row count
  const countResult = await service.from('dataset_rows').select('row_count').eq('dataset_id', params.datasetId)
  const total = (countResult.data || []).reduce(function(sum: number, b: { row_count: number }) { return sum + (b.row_count || 0) }, 0)
  await service.from('datasets').update({ row_count: total, updated_at: new Date().toISOString() }).eq('id', params.datasetId)

  return NextResponse.json({ ok: true, deleted_batches: batchIndexes.length, total_rows: total })
}
