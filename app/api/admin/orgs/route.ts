// app/api/admin/orgs/route.ts
// GET -- compact org list for admin filter dropdowns (id + name only).
// Returns an array directly (not wrapped) so SubHeader/FilterBar can map it.
// Gated on is_admin_org (the canonical admin check used elsewhere).
// ?active=true narrows to status='active' — same semantics as
// /api/admin/clients?activeOnly=true uses for the transfer dropdown.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgRel = userData?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

  const service = createServiceRoleClient()
  if (activeOnly) {
    // Pre-migration deploys (no status column) will throw — fall back to all.
    const { data, error } = await service
      .from('organizations')
      .select('id, name')
      .eq('status', 'active')
      .order('name', { ascending: true })
    if (!error) return NextResponse.json(data || [])
  }
  const { data, error } = await service
    .from('organizations')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data || [])
}
