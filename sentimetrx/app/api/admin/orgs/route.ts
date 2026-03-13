// app/api/admin/orgs/route.ts
// GET -- list all orgs (super-admin only)
// Called by admin panel as GET /api/admin/orgs?active=true

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Super-admin check
  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as { is_admin_org?: boolean }
  if (!orgData?.is_admin_org) {
    return NextResponse.json({ error: 'Super-admin only' }, { status: 403 })
  }

  const service = createServiceRoleClient()
  const url     = new URL(req.url)
  const active  = url.searchParams.get('active')

  let query = service
    .from('organizations')
    .select('id, name, client_id, features, created_at, is_admin_org')
    .order('name', { ascending: true })

  // ?active=true filters out archived/inactive orgs if that column exists
  // Safe to ignore if column doesn't exist — Supabase will just return all rows
  if (active === 'true') {
    query = query.eq('active', true)
  }

  const { data: orgs, error } = await query

  if (error) {
    // If the 'active' column doesn't exist, retry without the filter
    if (error.message.includes('column') && error.message.includes('active')) {
      const { data: allOrgs, error: err2 } = await service
        .from('organizations')
        .select('id, name, client_id, features, created_at, is_admin_org')
        .order('name', { ascending: true })
      if (err2) return NextResponse.json({ error: err2.message }, { status: 500 })
      return NextResponse.json({ orgs: allOrgs || [] })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ orgs: orgs || [] })
}
