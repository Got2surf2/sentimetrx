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

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30   // allow 30s for large datasets in bulk mode

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  var result = await supabase.auth.getUser()
  var user = result.data.user
  if (!user) return { user: null, orgId: null }
  var userData = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  return { user, orgId: (userData.data?.org_id as string | null) }
}

// Project a row down to only the requested fields
function projectRow(row: Record<string, unknown>, fieldSet: Set<string> | null): Record<string, unknown> {
  if (!fieldSet) return row
  var out: Record<string, unknown> = {}
  fieldSet.forEach(function(f) { if (f in row) out[f] = row[f] })
  return out
}

export async function GET(req: Request, { params }: Params) {
  var supabase = createClient()
  var auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var url      = new URL(req.url)
  var allMode  = url.searchParams.get('all') === 'true'
  var page     = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  var pageSize = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('pageSize') || '100')))
  var field    = url.searchParams.get('field') || null
  var fieldsP  = url.searchParams.get('fields') || null

  // Build field projection set
  var fieldSet: Set<string> | null = null
  if (field) {
    fieldSet = new Set([field])
  } else if (fieldsP) {
    fieldSet = new Set(fieldsP.split(',').map(function(f) { return f.trim() }).filter(Boolean))
  }

  var service = createServiceRoleClient()

  // Get total row count
  var metaResult = await service
    .from('datasets')
    .select('row_count')
    .eq('id', params.datasetId)
    .single()

  var totalRows  = metaResult.data?.row_count || 0

  // ── BULK MODE: return all rows in one response ──────────────────────────
  if (allMode) {
    var allRows: Record<string, unknown>[] = []
    var bulkPage = 0
    var BULK_FETCH = 200  // fetch 200 batch records per DB call (~10K rows)
    var hasMore = true

    while (hasMore) {
      var bFrom = bulkPage * BULK_FETCH
      var bTo   = bFrom + BULK_FETCH - 1

      var batchResult = await service
        .from('dataset_rows')
        .select('rows')
        .eq('dataset_id', params.datasetId)
        .order('batch_index', { ascending: true })
        .range(bFrom, bTo)

      if (batchResult.error) return NextResponse.json({ error: batchResult.error.message }, { status: 500 })
      var batches = batchResult.data
      if (!batches || batches.length === 0) { hasMore = false; break }

      for (var bi = 0; bi < batches.length; bi++) {
        var batchRows = batches[bi].rows || []
        for (var ri = 0; ri < batchRows.length; ri++) {
          allRows.push(projectRow(batchRows[ri], fieldSet))
        }
      }

      if (batches.length < BULK_FETCH) hasMore = false
      bulkPage++
    }

    return NextResponse.json({
      rows:       allRows,
      page:       1,
      pageSize:   allRows.length,
      totalRows:  totalRows,
      totalPages: 1,
      field:      field || undefined,
    })
  }

  // ── PAGINATED MODE (original behaviour) ─────────────────────────────────
  var totalPages = Math.ceil(totalRows / pageSize)
  var skip       = (page - 1) * pageSize

  var collected: Record<string, unknown>[] = []
  var rowsSeen  = 0
  var pageBatch = 0
  var PAGE_FETCH = 50

  outer: while (collected.length < pageSize) {
    var pFrom = pageBatch * PAGE_FETCH
    var pTo   = pFrom + PAGE_FETCH - 1

    var pageResult = await service
      .from('dataset_rows')
      .select('rows, row_count')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .range(pFrom, pTo)

    if (pageResult.error) return NextResponse.json({ error: pageResult.error.message }, { status: 500 })
    var pageBatches = pageResult.data
    if (!pageBatches || pageBatches.length === 0) break

    for (var pbi = 0; pbi < pageBatches.length; pbi++) {
      var pRows: Record<string, unknown>[] = pageBatches[pbi].rows || []
      for (var pri = 0; pri < pRows.length; pri++) {
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
  var supabase = createClient()
  var auth = await authCheck(supabase)
  if (!auth.user || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body = await req.json()
  var rows = body.rows
  var source_ref = body.source_ref
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  var service = createServiceRoleClient()

  var existResult = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)

  var nextIndex = existResult.data && existResult.data.length > 0 ? existResult.data[0].batch_index + 1 : 0

  var insertResult = await service
    .from('dataset_rows')
    .insert({
      dataset_id:  params.datasetId,
      rows,
      row_count:   rows.length,
      batch_index: nextIndex,
      source_ref:  source_ref || null,
    })

  if (insertResult.error) return NextResponse.json({ error: insertResult.error.message }, { status: 500 })

  var countResult = await service
    .from('dataset_rows')
    .select('row_count')
    .eq('dataset_id', params.datasetId)

  var total = (countResult.data || []).reduce(function(sum: number, b: { row_count: number }) {
    return sum + (b.row_count || 0)
  }, 0)

  await service
    .from('datasets')
    .update({ row_count: total, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({ ok: true, batch_index: nextIndex, row_count: rows.length, total_rows: total }, { status: 201 })
}
