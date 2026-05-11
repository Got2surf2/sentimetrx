import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { sendInviteEmail } from '@/lib/email/sendInvite'

interface Ctx { params: { id: string } }

export async function POST(_req: NextRequest, { params }: Ctx) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: invite } = await service
    .from('invites')
    .select('id, token, email, role, org_id, expires_at, used_at')
    .eq('id', params.id)
    .single()

  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  if (invite.used_at) return NextResponse.json({ error: 'Invite already accepted' }, { status: 410 })
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invite expired; revoke and create a new one' }, { status: 410 })
  }

  // Auth: super-admin or owner of the invite's org
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isSuperAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org === true
    : (orgData as any)?.is_admin_org === true
  const isOrgOwner = userData?.role === 'owner' && userData?.org_id === invite.org_id

  if (!isSuperAdmin && !isOrgOwner) {
    return NextResponse.json({ error: 'Not authorized to resend this invite' }, { status: 403 })
  }

  const result = await sendInviteEmail(service, invite, user.id)
  return NextResponse.json({ email_status: result.status, email_error: result.error })
}
