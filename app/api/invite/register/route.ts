import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createBareClient } from '@supabase/supabase-js'
import { serverError } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  const service = createServiceRoleClient()
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { token, email, password, full_name } = body

  if (!token || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const { data: invite, error: inviteError } = await service
    .from('invites')
    .select('id, org_id, role, email, used_at, expires_at')
    .eq('token', token)
    .single()

  if (inviteError || !invite) {
    return NextResponse.json({ error: 'Invalid invite token' }, { status: 404 })
  }
  if (invite.used_at)                          return NextResponse.json({ error: 'Invite already used' },     { status: 410 })
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'Invite expired' },          { status: 410 })
  if (!invite.email) {
    return NextResponse.json({ error: 'Invite is missing a bound email; ask the inviter to issue a new one' }, { status: 400 })
  }
  if (String(email).trim().toLowerCase() !== String(invite.email).trim().toLowerCase()) {
    return NextResponse.json({ error: 'This invite was issued to a different email address' }, { status: 403 })
  }

  // Check whether an auth.users row already exists for this email.
  // If yes we must not call admin.createUser (it will 422 "already
  // registered") — instead we verify the typed password against the
  // existing account, then attach a public.users row to that auth id.
  // This handles users who were partially created earlier (auth row
  // without public.users row) or who have a Sentimetrx auth account
  // from a different path and are now being formally invited to an org.
  const { data: existingAuthId } = await service.rpc('get_auth_user_id_by_email', { p_email: email })

  let authUserId: string

  if (existingAuthId) {
    // Verify ownership by attempting a sign-in with the typed password.
    // We can't reset their password here — that would let anyone with
    // the invite link take over the existing account.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const bare = createBareClient(url, anonKey, { auth: { persistSession: false } })
    const { error: signInError } = await bare.auth.signInWithPassword({ email, password })
    if (signInError) {
      return NextResponse.json({
        error: 'You already have a Sentimetrx account for this email. Enter your existing password to accept the invitation.',
      }, { status: 401 })
    }

    // Refuse if they already have a public.users row — they're already
    // a member of an org, and our schema currently models org membership
    // as a single org_id per user. Joining a second org would silently
    // move them. Return a clear error instead.
    const { data: existingPublic } = await service
      .from('users')
      .select('id, org_id')
      .eq('id', existingAuthId)
      .maybeSingle()
    if (existingPublic) {
      return NextResponse.json({
        error: 'You are already a member of an organization on Sentimetrx. Ask an admin to move you instead of inviting you.',
      }, { status: 409 })
    }

    authUserId = existingAuthId as string
  } else {
    // New auth user — original flow.
    const { data: authData, error: authError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError || !authData.user) {
      return serverError(authError, 'invite.register.createUser', { orgId: invite.org_id })
    }
    authUserId = authData.user.id
  }

  const { error: userError } = await service
    .from('users')
    .insert({
      id:        authUserId,
      email,
      full_name: full_name || null,
      org_id:    invite.org_id,
      role:      invite.role || 'owner',
    })

  if (userError) {
    // Roll back the auth user only if WE created it this run. Existing
    // accounts must never be deleted as a side-effect of a failed insert.
    if (!existingAuthId) {
      try { await service.auth.admin.deleteUser(authUserId) } catch {}
    }
    return serverError(userError, 'invite.register.insertUser', { orgId: invite.org_id })
  }

  await service
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ success: true })
}
