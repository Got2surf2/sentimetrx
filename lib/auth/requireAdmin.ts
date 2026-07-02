// lib/auth/requireAdmin.ts
// Guard for API routes that should only be accessible to admin-org users.
// Returns null if authorized; returns a 404 NextResponse otherwise so the
// route does not leak its existence to unauthenticated callers.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'
import { logError } from '@/lib/log'

export async function requireAdmin(): Promise<NextResponse | null> {
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

  const org = resolveOrg(userData?.organizations) as any
  if (!org?.is_admin_org) return notFound

  return null
}
