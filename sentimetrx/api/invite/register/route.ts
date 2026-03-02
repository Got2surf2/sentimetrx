import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/invite/register
// Called when someone completes the registration form via an invite link
export async function POST(req: NextRequest) {
  const { token, email, password, full_name } = await req.json()

  if (!token || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // Validate the invite
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .select('id, client_id, role, used_at, expires_at')
    .eq('token', token)
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  }

  if (invite.used_at) {
    return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }

  // Create the Supabase Auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message || 'Failed to create account' }, { status: 500 })
  }

  // Create the user record in our users table
  const { error: userError } = await supabase
    .from('users')
    .insert({
      id:        authData.user.id,
      client_id: invite.client_id,
      email,
      full_name: full_name || null,
      role:      invite.role,
    })

  if (userError) {
    // Clean up the auth user if our insert failed
    await supabase.auth.admin.deleteUser(authData.user.id)
    return NextResponse.json({ error: 'Failed to create user record' }, { status: 500 })
  }

  // Mark the invite as used
  await supabase
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ success: true }, { status: 201 })
}
