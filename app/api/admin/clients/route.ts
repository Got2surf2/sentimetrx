import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/clients - list all organizations with user and study counts
// Supports ?activeOnly=true to restrict to status='active' orgs (used by
// TransferOrg to gate which orgs can receive resource transfers — no point
// surfacing suspended/archived orgs in that dropdown).
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as any)?.is_admin_org

  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const url = new URL(req.url)
  const activeOnly = url.searchParams.get('activeOnly') === 'true'

  const service = createServiceRoleClient()

  let orgsQuery = service
    .from('organizations')
    .select('id, name, slug, plan, status, is_admin_org, created_at')
    .order('created_at', { ascending: false })
  if (activeOnly) orgsQuery = orgsQuery.eq('status', 'active')
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

  // Per-org counts using count queries (not fetching all rows)
  const result = await Promise.all(orgs.map(async (org: any) => {
    const [userResult, studyResult] = await Promise.all([
      service.from('users').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      service.from('studies').select('id').eq('org_id', org.id),
    ])
    const studyIds = (studyResult.data || []).map((s: any) => s.id)
    let responseCount = 0
    if (studyIds.length > 0) {
      const { count } = await service.from('responses').select('id', { count: 'exact', head: true }).in('study_id', studyIds)
      responseCount = count || 0
    }
    return {
      ...org,
      user_count:        userResult.count || 0,
      active_users_30d:  activeUsersByOrg[org.id]?.size || 0,
      study_count:       studyIds.length,
      response_count:    responseCount,
    }
  }))

  return NextResponse.json(result)
}

// POST /api/admin/clients - create a new organization
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as any)?.is_admin_org

  if (!isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
