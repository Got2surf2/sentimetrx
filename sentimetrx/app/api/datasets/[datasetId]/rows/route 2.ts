// app/api/datasets/[datasetId]/rows/route.ts
// GET  -- all batches merged into flat array
// POST -- append a new batch

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { mergeRowBatches } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, orgId: null }
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  return { user, orgId: userData?.org_id as string | null }
}

export async function GET(req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const raw = url.searchParams.get('raw') === 'true'

  const { data: batches, error } = await supabase
    .from('dataset_rows')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (raw) return NextResponse.json({ batches: batches || [] })

  const rows = mergeRowBatches(batches || [])
  return NextResponse.json({
    rows,
    row_count:   rows.length,
    batch_count: (batches || []).length,
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

  // Get next batch_index
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
      rows:        rows,
      row_count:   rows.length,
      batch_index: nextIndex,
      source_ref:  source_ref || null,
    })

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Update row_count on the dataset
  const { data: allBatches } = await service
    .from('dataset_rows')
    .select('row_count')
    .eq('dataset_id', params.datasetId)

  const totalRows = (allBatches || []).reduce(function(sum: number, b: any) { return sum + (b.row_count || 0) }, 0)

  await service
    .from('datasets')
    .update({ row_count: totalRows, updated_at: new Date().toISOString() })
    .eq('id', params.datasetId)

  return NextResponse.json({ ok: true, batch_index: nextIndex, row_count: rows.length, total_rows: totalRows }, { status: 201 })
}
