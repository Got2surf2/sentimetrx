import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const service = createServiceRoleClient()
  const { token, email, password, full_name } = await req.json()

  if (!token || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Validate invite token
  const { data: invite, error: inviteError } = await service
    .from('invites')
    .select('id, org_id, role, used_at, expires_at')
    .eq('token', token)
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 })
  }
  if (invite.used_at) {
    return NextResponse.json({ error: 'Invite already used' }, { status: 410 })
  }
  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invite expired' }, { status: 410 })
  }

  // Create auth user
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message || 'Failed to create user' }, { status: 500 })
  }

  // Create users table record
  const { error: userError } = await service
    .from('users')
    .insert({
      id:        authData.user.id,
      email,
      full_name: full_name || null,
      org_id:    invite.org_id,
      role:      invite.role || 'owner',
    })

  if (userError) {
    // Rollback auth user
    await service.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: userError.message }, { status: 500 })
  }

  // Mark invite as used
  await service
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ success: true })
}
