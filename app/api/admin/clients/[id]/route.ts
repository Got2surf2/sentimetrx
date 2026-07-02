import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

// GET /api/admin/clients/[id] - org detail with users, studies, invites
export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const service = createServiceRoleClient()

  const { data: org } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, limits, created_at')
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

  // Per-study response counts using head queries
  const studiesWithCounts = await Promise.all((studies || []).map(async (s: any) => {
    const { count } = await service.from('responses').select('id', { count: 'exact', head: true }).eq('study_id', s.id)
    return { ...s, response_count: count || 0 }
  }))

  const { data: invites } = await service
    .from('invites')
    .select('id, token, email, role, used_at, expires_at, created_at')
    .eq('org_id', params.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ org, members, studies: studiesWithCounts, invites })
}

// PATCH /api/admin/clients/[id] - update org (plan, name, is_admin_org, limits)
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  const service = createServiceRoleClient()
  const body = await req.json()

  const allowed = ['name', 'slug', 'plan', 'is_admin_org', 'limits']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await service
    .from('organizations')
    .update(updates)
    .eq('id', params.id)
    .select('id, name, plan, is_admin_org, limits')
    .single()

  if (error) return serverError(error, 'admin.clients.update')
  return NextResponse.json(data)
}
