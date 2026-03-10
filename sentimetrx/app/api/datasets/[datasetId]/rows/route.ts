import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { mergeRowBatches } from '@/lib/datasetUtils'

function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: { datasetId: string } }

// GET /api/datasets/[datasetId]/rows
// Returns merged flat row array by default.
// ?raw=true returns raw batch records.
export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('raw') === 'true'

  const { data: batches, error } = await supabase
    .from('dataset_rows')
    .select('id, dataset_id, rows, row_count, batch_index, source_ref, created_at')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (raw) {
    return NextResponse.json({ batches: batches || [], batch_count: (batches || []).length })
  }

  const rows = mergeRowBatches(batches || [])
  return NextResponse.json({
    rows,
    row_count:   rows.length,
    batch_count: (batches || []).length,
  })
}

// POST /api/datasets/[datasetId]/rows
// Appends a new batch. Used by upload flow and study sync.
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user can access this dataset
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, row_count')
    .eq('id', params.datasetId)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const { rows, source_ref } = body

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })
  }

  // Get current max batch_index
  const { data: lastBatch } = await supabase
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)
    .single()

  const nextBatchIndex = lastBatch ? lastBatch.batch_index + 1 : 0

  // Insert batch via service role (no user INSERT policy on dataset_rows)
  const sr = serviceRole()
  const { error: insertError } = await sr
    .from('dataset_rows')
    .insert({
      dataset_id:  params.datasetId,
      rows,
      row_count:   rows.length,
      batch_index: nextBatchIndex,
      source_ref:  source_ref || null,
    })

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Update dataset row_count
  const newTotal = (dataset.row_count || 0) + rows.length
  await sr
    .from('datasets')
    .update({ row_count: newTotal, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({
    batch_index: nextBatchIndex,
    added:       rows.length,
    total:       newTotal,
  }, { status: 201 })
}
