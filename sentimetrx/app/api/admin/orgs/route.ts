// app/api/admin/orgs/route.ts
// GET -- list all orgs (super-admin only)
// Called by admin panel as GET /api/admin/orgs?active=true

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Super-admin check — uses role column on users table
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userData?.role !== 'platform_admin') {
    return NextResponse.json({ error: 'Super-admin only' }, { status: 403 })
  }

  const service = createServiceRoleClient()

  const { data: orgs, error } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, logo_url, features, created_at')
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ orgs: orgs || [] })
}


