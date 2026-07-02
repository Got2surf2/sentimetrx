import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

// GET /api/admin/clients - list all organizations with user and study counts
// Supports ?activeOnly=true to restrict to status='active' orgs (used by
// TransferOrg to gate which orgs can receive resource transfers — no point
// surfacing suspended/archived orgs in that dropdown).
export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const activeOnly = url.searchParams.get('activeOnly') === 'true'

  const service = createServiceRoleClient()

  let orgsQuery = service
    .from('organizations')
    .select('id, name, slug, plan, status, is_admin_org, created_at')
    .order('created_at', { ascending: false })
  // activeOnly filters by BOTH columns: legacy rows have plan='suspended'
  // with status='active'; new rows update both. Either signal disqualifies
  // an org from being a transfer target.
  if (activeOnly) orgsQuery = orgsQuery.eq('status', 'active').neq('plan', 'suspended')
  const { data: orgs } = await orgsQuery

  if (!orgs) return NextResponse.json([])

  // Pre-compute "users active in last 30 days" per org in a single query
  // so we can show a churn-risk indicator on the listing.
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentLogins } = await service
    .from('user_logins')
    .select('user_id, org_id')
    .gte('created_at', since30)
  const activeUsersByOrg: Record<string, Set<string>> = {}
  for (const r of (recentLogins || [])) {
    if (!r.org_id) continue
    if (!activeUsersByOrg[r.org_id]) activeUsersByOrg[r.org_id] = new Set()
    activeUsersByOrg[r.org_id].add(r.user_id)
  }

  // Single RPC returns user_count / study_count / response_count for every
  // org in one round trip (replaces N×3 per-org count queries).
  const orgIds = orgs.map((o: any) => o.id)
  const countsByOrg: Record<string, { user_count: number; study_count: number; response_count: number }> = {}
  if (orgIds.length > 0) {
    const { data: rows } = await service.rpc('org_stats_for_ids', { p_org_ids: orgIds })
    for (const row of (rows || [])) {
      countsByOrg[row.org_id] = {
        user_count:     Number(row.user_count)     || 0,
        study_count:    Number(row.study_count)    || 0,
        response_count: Number(row.response_count) || 0,
      }
    }
  }

  const result = orgs.map((org: any) => {
    const c = countsByOrg[org.id] || { user_count: 0, study_count: 0, response_count: 0 }
    return {
      ...org,
      user_count:       c.user_count,
      active_users_30d: activeUsersByOrg[org.id]?.size || 0,
      study_count:      c.study_count,
      response_count:   c.response_count,
    }
  })

  return NextResponse.json(result)
}

// POST /api/admin/clients - create a new organization
export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { name, slug, plan, is_admin_org, primaryIndustries } = await req.json()

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const features: any = {}
  if (primaryIndustries && Array.isArray(primaryIndustries)) {
    features.primaryIndustries = primaryIndustries
  }

  const { data, error } = await service
    .from('organizations')
    .insert({
      name,
      slug:         slug.toLowerCase().replace(/\s+/g, '-'),
      plan:         plan || 'trial',
      is_admin_org: is_admin_org || false,
      features:     Object.keys(features).length > 0 ? features : undefined,
    })
    .select('id, name, slug')
    .single()

  if (error) return serverError(error, 'admin.clients.create')
  return NextResponse.json(data, { status: 201 })
}
