// app/api/datasets/[datasetId]/route.ts
// GET    -- dataset metadata + state
// PATCH  -- update name / description / visibility / status
// DELETE -- delete dataset (cascades rows + state)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

async function getOrgAndCheck(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, orgId: null, isAdmin: false, error: 'Unauthorized' }

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) return { user: null, orgId: null, isAdmin: false, error: 'Analyze module not enabled' }

  return { user, orgId: userData?.org_id as string, isAdmin: !!orgData?.is_admin_org, error: null }
}

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId, isAdmin: _isAdmin, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  const { data, error: dbErr } = await supabase
    .from('datasets')
    .select('*, studies(name), dataset_state(*)')
    .eq('id', params.datasetId)
    .eq('org_id', orgId)
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 404 })

  const studyName = (data as any).studies?.name ?? null
  const state     = (data as any).dataset_state ?? null
  const { studies: _s, dataset_state: _ds, ...rest } = data as any

  return NextResponse.json({ dataset: { ...rest, study_name: studyName, state } })
}

export async function PATCH(req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId, isAdmin, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'visibility', 'status']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Admin-only: allow changing org_id (transfer dataset to another org)
  if ('org_id' in body) {
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can transfer datasets' }, { status: 403 })
    }
    updates.org_id = body.org_id
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  const service = createServiceRoleClient()
  const { error: updErr } = await service
    .from('datasets')
    .update(updates)
    .eq('id', params.datasetId)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { user, orgId, isAdmin: _isAdminDel, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  // Verify user owns the dataset before deleting
  const { data: ds } = await supabase
    .from('datasets')
    .select('created_by')
    .eq('id', params.datasetId)
    .eq('org_id', orgId)
    .single()

  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ds.created_by !== user.id) {
    return NextResponse.json({ error: 'Only the creator can delete a dataset' }, { status: 403 })
  }

  const service = createServiceRoleClient()

  // Explicitly delete child records first (belt-and-suspenders with CASCADE)
  try { await service.from('dataset_rows_flat').delete().eq('dataset_id', params.datasetId) } catch {}
  await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)
  await service.from('dataset_state').delete().eq('dataset_id', params.datasetId)

  const { error: delErr } = await service
    .from('datasets')
    .delete()
    .eq('id', params.datasetId)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}


