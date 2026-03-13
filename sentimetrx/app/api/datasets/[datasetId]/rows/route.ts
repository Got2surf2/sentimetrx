// app/api/datasets/[datasetId]/rows/route.ts
// GET  -- paginated rows for TextMine (never returns all rows at once)
// POST -- append a new batch (unchanged)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, orgId: null }
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  return { user, orgId: userData?.org_id as string | null }
}

// GET /api/datasets/[datasetId]/rows
// Query params:
//   page     (default 1)       — 1-based page number
//   pageSize (default 100)     — rows per page, max 500
//   field    (optional)        — return only this column (for TextMine)
//
// The route streams through batch records until it has collected enough rows
// for the requested page, then stops. For large datasets this means only
// O(pageSize / batchSize) batch records are loaded per request.
export async function GET(req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url      = new URL(req.url)
  const page     = Math.max(1, parseInt(url.searchParams.get('page')     || '1'))
  const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get('pageSize') || '100')))
  const field    = url.searchParams.get('field') || null

  const service = createServiceRoleClient()

  // Get total row count from datasets table (denormalised — avoids a COUNT(*))
  const { data: datasetMeta } = await service
    .from('datasets')
    .select('row_count')
    .eq('id', params.datasetId)
    .single()

  const totalRows  = datasetMeta?.row_count || 0
  const totalPages = Math.ceil(totalRows / pageSize)
  const skip       = (page - 1) * pageSize  // how many rows to skip before collecting

  // Stream through batch records in order, skip rows until offset, then collect
  const collected: Record<string, unknown>[] = []
  let   rowsSeen  = 0
  let   batchPage = 0
  const BATCH_FETCH = 50  // batch records per DB round-trip

  outer: while (collected.length < pageSize) {
    const from = batchPage * BATCH_FETCH
    const to   = from + BATCH_FETCH - 1

    const { data: batches, error } = await service
      .from('dataset_rows')
      .select('rows, row_count')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .range(from, to)

    if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
    if (!batches || batches.length === 0) break

    for (const batch of batches) {
      const batchRows: Record<string, unknown>[] = batch.rows || []

      for (const row of batchRows) {
        if (rowsSeen < skip) { rowsSeen++; continue }
        if (collected.length >= pageSize) break outer

        if (field) {
          collected.push({ [field]: row[field] })
        } else {
          collected.push(row)
        }
        rowsSeen++
      }
    }

    if (batches.length < BATCH_FETCH) break
    batchPage++
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
  const { user, orgId } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { rows, source_ref } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data: existing } = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)

  const nextIndex = existing && existing.length > 0 ? existing[0].batch_index + 1 : 0

  const { error: insertErr } = await service
    .from('dataset_rows')
    .insert({
      dataset_id:  params.datasetId,
      rows,
      row_count:   rows.length,
      batch_index: nextIndex,
      source_ref:  source_ref || null,
    })

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  const { data: allBatches } = await service
    .from('dataset_rows')
    .select('row_count')
    .eq('dataset_id', params.datasetId)

  const totalRows = (allBatches || []).reduce(function(sum: number, b: { row_count: number }) {
    return sum + (b.row_count || 0)
  }, 0)

  await service
    .from('datasets')
    .update({ row_count: totalRows, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({ ok: true, batch_index: nextIndex, row_count: rows.length, total_rows: totalRows }, { status: 201 })
}
