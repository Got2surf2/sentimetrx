// app/api/datasets/[datasetId]/state/route.ts
// GET  -- full dataset_state record
// PUT  -- replace entire state
// PATCH -- partial update: update only the fields provided

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null }
  return { user }
}

export async function GET(_req: Request, { params }: Params) {
  var supabase = createClient()
  var { user } = await authCheck(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data, error } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(req: Request, { params }: Params) {
  var supabase = createClient()
  var { user } = await authCheck(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body = await req.json()
  var { schema_config, theme_model, saved_charts, saved_stats, filter_state, session_state } = body

  var service = createServiceRoleClient()
  var { error } = await service
    .from('dataset_state')
    .update({
      schema_config: schema_config,
      theme_model:   theme_model,
      saved_charts:  saved_charts || [],
      saved_stats:   saved_stats  || [],
      filter_state:  filter_state || {},
      session_state: session_state || null,
      updated_at:    new Date().toISOString(),
      updated_by:    user.id,
    })
    .eq('dataset_id', params.datasetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request, { params }: Params) {
  var supabase = createClient()
  var { user } = await authCheck(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  var ALLOWED_FIELDS = ['schema_config', 'theme_model', 'saved_charts', 'saved_stats', 'filter_state', 'session_state']
  var patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }

  for (var i = 0; i < ALLOWED_FIELDS.length; i++) {
    var key = ALLOWED_FIELDS[i]
    if (body[key] !== undefined) {
      patch[key] = body[key]
    }
  }

  if (Object.keys(patch).length === 2) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  var service = createServiceRoleClient()
  var { error } = await service
    .from('dataset_state')
    .update(patch)
    .eq('dataset_id', params.datasetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
