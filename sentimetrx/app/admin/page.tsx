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

  const { data: userCounts }    = await service.from('users').select('org_id')
  const { data: studiesData }   = await service.from('studies').select('id, org_id')
  const { data: responseData }  = await service.from('responses').select('study_id')

  // Build a study_id → org_id lookup so response counts flow through studies
  const studyOrgMap: Record<string, string> = {}
  ;(studiesData || []).forEach((s: any) => { studyOrgMap[s.id] = s.org_id })

  const enriched = (orgs || []).map(org => {
    const orgStudyIds = new Set((studiesData || []).filter((s: any) => s.org_id === org.id).map((s: any) => s.id))
    return {
      ...org,
      user_count:     (userCounts   || []).filter((u: any) => u.org_id === org.id).length,
      study_count:    orgStudyIds.size,
      response_count: (responseData || []).filter((r: any) => orgStudyIds.has(r.study_id)).length,
    }
  })

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
