import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { sendInviteEmail } from '@/lib/email/sendInvite'
import { serverError } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { org_id, email, role } = body

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!email || !emailRegex.test(email)) {
    return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
  }
  if (!org_id) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  // Auth: caller must be a super-admin (any is_admin_org member) OR an
  // owner of the target org. The previous check only allowed super-admins
  // — regular org owners got a 403 even though the team-invite UI is
  // shown to them.
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData    = userData?.organizations
  const isSuperAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org === true
    : (orgData as any)?.is_admin_org === true
  const isOrgOwner = userData?.role === 'owner' && userData?.org_id === org_id

  if (!isSuperAdmin && !isOrgOwner) {
    return NextResponse.json({ error: 'You must be an owner of this organization to invite members' }, { status: 403 })
  }

  const ALLOWED_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])
  const requestedRole = role || 'owner'
  if (!ALLOWED_ROLES.has(requestedRole)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const service   = createServiceRoleClient()
  const normalizedEmail = String(email).trim().toLowerCase()

  const { data, error } = await service
    .from('invites')
    .insert({
      token,
      org_id,
      email:      normalizedEmail,
      role:       requestedRole,
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select('id, token, email, role, org_id, expires_at')
    .single()

  if (error) return serverError(error, 'invite.create', { orgId: org_id })

  const sendResult = await sendInviteEmail(service, data, user.id)

  return NextResponse.json({
    ...data,
    email_status: sendResult.status,
    email_error:  sendResult.error,
  }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const url   = new URL(req.url)
  const token = url.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data, error } = await service
    .from('invites')
    .select('id, token, email, role, org_id, used_at, expires_at, organizations(name)')
    .eq('token', token)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  if (data.used_at) return NextResponse.json({ error: 'Invite already used' }, { status: 410 })
  if (new Date(data.expires_at) < new Date()) return NextResponse.json({ error: 'Invite expired' }, { status: 410 })

  const orgRel = (data as any).organizations
  const orgName = Array.isArray(orgRel) ? orgRel[0]?.name : orgRel?.name

  return NextResponse.json({
    id:         data.id,
    token:      data.token,
    email:      data.email,
    role:       data.role,
    org_id:     data.org_id,
    org_name:   orgName || null,
    expires_at: data.expires_at,
    used_at:    data.used_at,
  })
}
