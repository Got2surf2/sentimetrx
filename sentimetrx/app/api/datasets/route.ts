// app/api/datasets/route.ts
// GET  /api/datasets  -- list all datasets for the user's org
// POST /api/datasets  -- create a new dataset + initial state record

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { emptySchemaConfig, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) {
    return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
  }

  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  // Fetch datasets + linked study name in one join
  const { data: datasets, error } = await supabase
    .from('datasets')
    .select('id, name, description, source, study_id, visibility, status, row_count, last_synced_at, created_at, updated_at, ana_library, studies(name)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = (datasets || []).map(function(d: any) {
    const studyName = d.studies?.name ?? null
    const { studies: _s, ...rest } = d
    return { ...rest, study_name: studyName }
  })

  return NextResponse.json({ datasets: enriched })
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) {
    return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
  }

  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const body = await req.json()
  const { name, description, source, study_id, visibility, ana_library } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!['upload', 'study'].includes(source)) {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Insert dataset record
  const { data: dataset, error: dsErr } = await service
    .from('datasets')
    .insert({
      name:        name.trim(),
      description: description || null,
      source:      source,
      study_id:    study_id || null,
      org_id:      orgId,
      created_by:  user.id,
      visibility:  visibility || 'private',
      status:      'active',
      row_count:   0,
      ana_library: ana_library || null,
    })
    .select('id')
    .single()

  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })

  // Insert initial state record
  const { data: state, error: stErr } = await service
    .from('dataset_state')
    .insert({
      dataset_id:   dataset.id,
      schema_config: emptySchemaConfig(),
      theme_model:  emptyThemeModel(),
      saved_charts: [],
      saved_stats:  [],
      filter_state: {},
      updated_by:   user.id,
    })
    .select('id')
    .single()

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 })

  return NextResponse.json({ id: dataset.id, state_id: state.id }, { status: 201 })
}
