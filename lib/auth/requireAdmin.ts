// lib/auth/requireAdmin.ts
// Guard for API routes that should only be accessible to admin-org users.
// Returns null if authorized; returns a 404 NextResponse otherwise so the
// route does not leak its existence to unauthenticated callers.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'
import { logError } from '@/lib/log'
import { cookies } from 'next/headers'
import { evaluateAdminSession, ADMIN_SESSION_COOKIE, ADMIN_SESSION_COOKIE_OPTIONS } from '@/lib/auth/adminSession'

export async function requireAdmin(opts: { touch?: boolean } = {}): Promise<NextResponse | null> {
  const notFound = new NextResponse('Not Found', { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound

  const { data: userData, error: userDataErr } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (userDataErr) void logError('requireAdmin.requireAdmin', userDataErr)

  const org = resolveOrg(userData?.organizations)
  if (!org?.is_admin_org) return notFound

  // SECURITY.md §3 (ratified 2026-09-15): platform-admin sessions end after
  // 30 min idle / 24 h. The stamp is a signed cookie refreshed on every admin
  // request; without one (or with a tampered one) only a sign-in inside the
  // idle window counts, so deleting the cookie cannot extend a session.
  let jar: Awaited<ReturnType<typeof cookies>> | null = null
  try { jar = await cookies() } catch { jar = null }   // outside a request scope (unit tests)
  const state = evaluateAdminSession({ cookie: jar?.get(ADMIN_SESSION_COOKIE)?.value, lastSignInAt: user.last_sign_in_at, touch: opts.touch })
  if (!state.ok) return NextResponse.json({ error: 'Admin session expired — sign in again', reason: state.reason }, { status: 401 })
  try { jar?.set(ADMIN_SESSION_COOKIE, state.cookie, ADMIN_SESSION_COOKIE_OPTIONS) } catch { /* read-only context — proxy.ts re-stamps page loads */ }

  return null
}
