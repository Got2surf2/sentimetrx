import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/admin/clients - list all organizations with user and study counts
export async function GET() {
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

  const service = createServiceRoleClient()

  const { data: orgs } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, created_at')
    .order('created_at', { ascending: false })

  if (!orgs) return NextResponse.json([])

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
      user_count:     userResult.count || 0,
      study_count:    studyIds.length,
      response_count: responseCount,
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
