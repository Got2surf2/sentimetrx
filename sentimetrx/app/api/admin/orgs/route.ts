import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const org = Array.isArray(userData?.organizations) ? userData.organizations[0] : userData?.organizations as any
  if (!org?.is_admin_org) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // ?active=true → only orgs that have active studies
  const activeOnly = req.nextUrl.searchParams.get('active') === 'true'

  let query = supabase
    .from('organizations')
    .select('id, name, slug, plan')
    .eq('is_admin_org', false)   // never show the admin org itself
    .order('name', { ascending: true })

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (activeOnly) {
    // Filter to orgs that have at least one active study
    const { data: activeOrgs } = await supabase
      .from('studies')
      .select('org_id')
      .eq('status', 'active')
    const activeOrgIds = new Set((activeOrgs || []).map((s: any) => s.org_id).filter(Boolean))
    return NextResponse.json((data || []).filter((o: any) => activeOrgIds.has(o.id)))
  }

  return NextResponse.json(data)
}
