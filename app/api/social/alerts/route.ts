// app/api/social/alerts/route.ts
// GET  — list alert rules
// POST — create alert rule

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET() {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('social_alert_rules')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })

  if (error) return serverError(error, 'social.alerts.list', { orgId: auth.orgId })
  return NextResponse.json({ rules: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rule_type, config, channels, enabled } = await req.json()
  if (!rule_type) return NextResponse.json({ error: 'rule_type is required' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('social_alert_rules')
    .insert({
      org_id: auth.orgId,
      rule_type,
      config: config || {},
      channels: channels || [],
      enabled: enabled !== false,
    })
    .select()
    .single()

  if (error) return serverError(error, 'social.alerts.create', { orgId: auth.orgId })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const id = body?.id
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Whitelist updatable fields. Spreading `...updates` from the request
  // body let callers set org_id/created_by/etc., trivially escaping the
  // org filter on the query below.
  const ALLOWED = ['rule_type', 'config', 'channels', 'enabled'] as const
  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (key in body) updates[key] = (body as Record<string, unknown>)[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { error } = await service
    .from('social_alert_rules')
    .update(updates)
    .eq('id', id)
    .eq('org_id', auth.orgId)

  if (error) return serverError(error, 'social.alerts.update', { orgId: auth.orgId })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const service = createServiceRoleClient()
  const { error } = await service
    .from('social_alert_rules')
    .delete()
    .eq('id', id)
    .eq('org_id', auth.orgId)

  if (error) return serverError(error, 'social.alerts.delete', { orgId: auth.orgId })
  return NextResponse.json({ ok: true })
}
