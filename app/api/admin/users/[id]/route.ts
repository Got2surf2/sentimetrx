// app/api/admin/users/[id]/route.ts
// Admin-only single-user operations. Currently supports:
//   PATCH { org_id } — transfer user to a different org

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const { org_id } = body
  if (!org_id || typeof org_id !== 'string') {
    return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Verify target org exists and isn't the user's current org
  const { data: targetOrg } = await service.from('organizations').select('id, name').eq('id', org_id).single()
  if (!targetOrg) return NextResponse.json({ error: 'Target org not found' }, { status: 404 })

  const { data: target } = await service.from('users').select('id, org_id, email').eq('id', params.id).single()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (target.org_id === org_id) return NextResponse.json({ error: 'User is already in that org' }, { status: 400 })

  // Clear user-level feature overrides on transfer — they may not match the
  // new org's available features. Owner of new org can re-grant.
  const { error } = await service
    .from('users')
    .update({ org_id, features: {} })
    .eq('id', params.id)
  if (error) return serverError(error, 'admin.users.transfer', { orgId: org_id })

  return NextResponse.json({ success: true, user_id: params.id, new_org_id: org_id, new_org_name: targetOrg.name })
}
