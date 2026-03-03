import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

async function requireAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()

  const orgData = data?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as any)?.is_admin_org

  return !!isAdmin
}

// GET /api/admin/clients/[id] - org detail with users, studies, invites
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await requireAdmin(supabase, user.id)
  if (!ok) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const service = createServiceRoleClient()

  const { data: org } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, created_at')
    .eq('id', params.id)
    .single()

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: members } = await service
    .from('users')
    .select('id, email, full_name, role, created_at, client_id')
    .eq('org_id', params.id)
    .order('created_at')

  const { data: studies } = await service
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_at, created_by')
    .eq('org_id', params.id)
    .order('created_at', { ascending: false })

  // Get response counts per study
  const studyIds = (studies || []).map(s => s.id)
  const { data: responses } = studyIds.length > 0
    ? await service.from('responses').select('study_id').in('study_id', studyIds)
    : { data: [] }

  const studiesWithCounts = (studies || []).map(s => ({
    ...s,
    response_count: (responses || []).filter(r => r.study_id === s.id).length,
  }))

  const { data: invites } = await service
    .from('invites')
    .select('id, token, email, role, used_at, expires_at, created_at')
    .eq('org_id', params.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ org, members, studies: studiesWithCounts, invites })
}

// PATCH /api/admin/clients/[id] - update org (plan, name, is_admin_org)
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await requireAdmin(supabase, user.id)
  if (!ok) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const service = createServiceRoleClient()
  const body = await req.json()

  const allowed = ['name', 'slug', 'plan', 'is_admin_org']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await service
    .from('organizations')
    .update(updates)
    .eq('id', params.id)
    .select('id, name, plan, is_admin_org')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
