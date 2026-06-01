import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Ctx { params: { id: string } }

async function authorize(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, inviteOrgId: string) {
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, organizations(is_admin_org)')
    .eq('id', userId)
    .single()

  const orgData = userData?.organizations
  const isSuperAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org === true
    : (orgData as any)?.is_admin_org === true
  const isOrgOwner = userData?.role === 'owner' && userData?.org_id === inviteOrgId

  return isSuperAdmin || isOrgOwner
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: invite } = await service
    .from('invites')
    .select('id, org_id, used_at')
    .eq('id', params.id)
    .single()

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  if (invite.used_at) return NextResponse.json({ error: 'Invite already accepted; cannot revoke' }, { status: 410 })

  if (!await authorize(supabase, user.id, invite.org_id)) {
    return NextResponse.json({ error: 'Not authorized to revoke this invite' }, { status: 403 })
  }

  const { error } = await service.from('invites').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
