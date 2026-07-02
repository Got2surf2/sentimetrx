// app/api/townhall/sessions/[id]/duplicate/route.ts
// POST — duplicate a Town Hall session (copies config + discussion guide into new setup session)

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Resolve the caller's org + admin status so the duplicate is gated to the
  // owning org (or a platform admin) — a bare-id fetch with the service-role
  // client would otherwise let any logged-in user duplicate any org's session.
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const callerOrg = (userData as any)?.org_id as string | null

  const db = createServiceRoleClient()

  // Fetch the source session
  const { data: source } = await db
    .from('townhall_sessions')
    .select('name, config, discussion_guide, org_id')
    .eq('id', params.id)
    .single()

  if (!source) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!isAdmin && (source as any).org_id !== callerOrg) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // Strip archived flag if present
  const config = { ...source.config }
  delete config.archived

  // Create duplicate
  const { data, error } = await db
    .from('townhall_sessions')
    .insert({
      org_id: source.org_id,
      created_by: user.id,
      name: source.name + ' (Copy)',
      config,
      discussion_guide: source.discussion_guide,
      status: 'setup',
    })
    .select('id')
    .single()

  if (error) return serverError(error, 'townhall.sessions.duplicate', { orgId: source.org_id })
  return NextResponse.json(data, { status: 201 })
}
