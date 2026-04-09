import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  const isAdmin = !!orgData?.is_admin_org
  if (!isAdmin) redirect('/dashboard')

  const service = createServiceRoleClient()

  const { data: orgs } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, created_at')
    .order('created_at', { ascending: false })

  // Per-org counts using targeted queries (not fetching all rows)
  const enriched = await Promise.all((orgs || []).map(async (org: any) => {
    const [userResult, studyResult] = await Promise.all([
      service.from('users').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      service.from('studies').select('id').eq('org_id', org.id),
    ])

    const orgStudies = studyResult.data || []
    const studyIds = orgStudies.map((s: any) => s.id)
    let responseCount = 0
    if (studyIds.length > 0) {
      const { count } = await service.from('responses').select('id', { count: 'exact', head: true }).in('study_id', studyIds)
      responseCount = count || 0
    }

    return {
      ...org,
      user_count:     userResult.count || 0,
      study_count:    orgStudies.length,
      response_count: responseCount,
    }
  }))

  return (
    <AdminClient
      orgs={enriched}
      adminEmail={user.email!}
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
