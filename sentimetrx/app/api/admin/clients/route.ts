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

  // Get user counts per org
  const { data: userCounts } = await service
    .from('users')
    .select('org_id')

  // Get study + response counts per org
  const { data: studyCounts } = await service
    .from('studies')
    .select('org_id, id')

  const { data: responseCounts } = await service
    .from('responses')
    .select('org_id')

  const result = orgs.map(org => ({
    ...org,
    user_count:     (userCounts     || []).filter(u => u.org_id    === org.id).length,
    study_count:    (studyCounts    || []).filter(s => s.org_id    === org.id).length,
    response_count: (responseCounts || []).filter(r => r.org_id    === org.id).length,
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

  const { name, slug, plan, is_admin_org } = await req.json()

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  const { data, error } = await service
    .from('organizations')
    .insert({
      name,
      slug:         slug.toLowerCase().replace(/\s+/g, '-'),
      plan:         plan || 'trial',
      is_admin_org: is_admin_org || false,
    })
    .select('id, name, slug')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
