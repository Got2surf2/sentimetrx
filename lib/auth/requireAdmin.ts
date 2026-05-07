// lib/auth/requireAdmin.ts
// Guard for API routes that should only be accessible to admin-org users.
// Returns null if authorized; returns a 404 NextResponse otherwise so the
// route does not leak its existence to unauthenticated callers.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'

export async function requireAdmin(): Promise<NextResponse | null> {
  const notFound = new NextResponse('Not Found', { status: 404 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return notFound

  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const org = resolveOrg(userData?.organizations) as any
  if (!org?.is_admin_org) return notFound

  return null
}
