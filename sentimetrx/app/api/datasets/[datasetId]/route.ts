import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: { datasetId: string } }

// GET /api/datasets/[datasetId] -- metadata + state in one call
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset, error } = await supabase
    .from('datasets')
    .select(`
      id, name, description, source, study_id, org_id, client_id,
      created_by, visibility, status, row_count, last_synced_at,
      created_at, updated_at
    `)
    .eq('id', params.datasetId)
    .single()

  if (error || !dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: state } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  return NextResponse.json({ ...dataset, state: state || null })
}

// PATCH /api/datasets/[datasetId] -- update metadata only
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  // Only allow safe metadata fields -- never rows or state
  const allowed = ['name', 'description', 'visibility', 'status']
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await supabase
    .from('datasets')
    .update(update)
    .eq('id', params.datasetId)
    .eq('created_by', user.id)   // only creator can update
    .select('id, name, visibility, status, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 })
  return NextResponse.json(data)
}

// DELETE /api/datasets/[datasetId] -- auth check via user client, delete via service role
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership with user client
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, created_by')
    .eq('id', params.datasetId)
    .eq('created_by', user.id)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Not found or not authorized' }, { status: 404 })

  // Delete via service role (cascade handles dataset_rows + dataset_state)
  const sr = serviceRole()
  const { error } = await sr
    .from('datasets')
    .delete()
    .eq('id', params.datasetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
