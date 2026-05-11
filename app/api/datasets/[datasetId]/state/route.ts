// app/api/datasets/[datasetId]/state/route.ts
// GET  -- full dataset_state record
// PUT  -- replace entire state
// PATCH -- partial update: update only the fields provided

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function authCheck(supabase: ReturnType<typeof createClient>) {
  const ctx = await getCallerOrgContext(supabase)
  return { user: ctx.userId ? { id: ctx.userId } as any : null, orgId: ctx.orgId, isAdmin: ctx.isAdmin }
}

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId, isAdmin } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  const { data, error } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PUT(req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId, isAdmin } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dsCheck.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  const body = await req.json()
  const { schema_config, theme_model, saved_charts, saved_stats, filter_state, session_state } = body

  const service = createServiceRoleClient()
  const { error } = await service
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
  const supabase = createClient()
  const { user, orgId, isAdmin } = await authCheck(supabase)
  if (!user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dsCheck2 } = await supabase.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dsCheck2) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dsCheck2.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const ALLOWED_FIELDS = ['schema_config', 'theme_model', 'saved_charts', 'saved_stats', 'filter_state', 'session_state']
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }

  for (let i = 0; i < ALLOWED_FIELDS.length; i++) {
    const key = ALLOWED_FIELDS[i]
    if (body[key] !== undefined) {
      patch[key] = body[key]
    }
  }

  if (Object.keys(patch).length === 2) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { error } = await service
    .from('dataset_state')
    .update(patch)
    .eq('dataset_id', params.datasetId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
