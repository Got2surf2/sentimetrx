// app/api/admin/orgs/route.ts
// GET -- compact org list for admin filter dropdowns (id + name only).
// Returns an array directly (not wrapped) so SubHeader/FilterBar can map it.
// Gated on is_admin_org (the canonical admin check used elsewhere).
// ?active=true narrows to status='active' — same semantics as
// /api/admin/clients?activeOnly=true uses for the transfer dropdown.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

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
  if (error) return serverError(error, 'admin.orgs.list')
  return NextResponse.json(data || [])
}
