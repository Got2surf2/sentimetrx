// app/api/settings/profile/route.ts
// GET  — fetch current user's profile
// PATCH — update name
// POST  — trigger password reset email

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

// GET /api/settings/profile
export async function GET(_req: NextRequest) {
  var supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data: profile } = await supabase
    .from('users')
    .select('id, email, full_name, role, org_id, created_at')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  return NextResponse.json({ profile: profile })
}

// PATCH /api/settings/profile — update display name
export async function PATCH(req: NextRequest) {
  var supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  var updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) {
    var name = String(body.full_name || '').trim()
    if (name.length > 100) return NextResponse.json({ error: 'Name too long' }, { status: 400 })
    updates.full_name = name || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  var { error } = await supabase.from('users').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// POST /api/settings/profile — trigger password reset email
export async function POST(req: NextRequest) {
  var supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var service = createServiceRoleClient()
  var { error } = await service.auth.resetPasswordForEmail(user.email!, {
    // Route through /auth/callback so the PKCE ?code= gets exchanged for a
    // session before landing on the form. /auth/reset-password itself only
    // renders inputs and calls updateUser — it can't establish the session.
    redirectTo: (process.env.NEXT_PUBLIC_SITE_URL || 'https://sentimetrx.ai') + '/auth/callback?next=/auth/reset-password',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, message: 'Password reset email sent' })
}
