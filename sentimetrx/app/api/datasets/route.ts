import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Service role client -- bypasses RLS for state inserts
function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// GET /api/datasets -- list datasets for the current user's org
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check analyze feature flag
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const orgRaw = userData?.organizations as any
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
  if (!org?.features?.analyze) {
    return NextResponse.json({ error: 'Analyze not enabled for this org' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('datasets')
    .select('id, name, description, source, study_id, visibility, status, row_count, last_synced_at, created_at, updated_at, created_by')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ datasets: data || [] })
}

// POST /api/datasets -- create a new dataset + empty state record
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get user's org + client + check feature flag
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, client_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const orgRaw = userData?.organizations as any
  const org = Array.isArray(orgRaw) ? orgRaw[0] : orgRaw
  if (!org?.features?.analyze) {
    return NextResponse.json({ error: 'Analyze not enabled for this org' }, { status: 403 })
  }

  const body = await req.json()
  const { name, description, source, study_id, visibility } = body

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!['upload', 'study'].includes(source)) {
    return NextResponse.json({ error: 'source must be upload or study' }, { status: 400 })
  }

  // Insert dataset metadata
  const { data: dataset, error: dsError } = await supabase
    .from('datasets')
    .insert({
      name,
      description:  description || null,
      source:       source || 'upload',
      study_id:     study_id || null,
      org_id:       userData?.org_id,
      client_id:    userData?.client_id || null,
      created_by:   user.id,
      visibility:   visibility || 'private',
      status:       'active',
      row_count:    0,
    })
    .select('id')
    .single()

  if (dsError) return NextResponse.json({ error: dsError.message }, { status: 500 })

  // Insert empty dataset_state via service role (RLS has no INSERT policy for users)
  const sr = serviceRole()
  const { data: state, error: stateError } = await sr
    .from('dataset_state')
    .insert({
      dataset_id:    dataset.id,
      schema_config: {},
      theme_model:   {},
      saved_charts:  [],
      saved_stats:   [],
      filter_state:  {},
      updated_by:    user.id,
    })
    .select('id')
    .single()

  if (stateError) return NextResponse.json({ error: stateError.message }, { status: 500 })

  return NextResponse.json({ id: dataset.id, state_id: state.id }, { status: 201 })
}
