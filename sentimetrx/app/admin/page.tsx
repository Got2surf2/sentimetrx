import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminClient from './AdminClient'

export const dynamic = 'force-dynamic'

async function checkAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org, logo_url)')
    .eq('id', userId)
    .single()
  const orgData = data?.organizations
  return Array.isArray(orgData) ? orgData[0]?.is_admin_org : (orgData as any)?.is_admin_org
}

export default async function AdminPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { isAdmin, logoUrl, data } = await checkAdmin(supabase, user.id)
  if (!isAdmin) redirect('/dashboard')

  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/admin/clients`, {
    headers: { Cookie: '' },
    cache: 'no-store',
  })

  // Fetch directly via supabase since we are server-side
  const { createServiceRoleClient } = await import('@/lib/supabase/server')
  const service = createServiceRoleClient()

  const { data: orgs } = await service
    .from('organizations')
    .select('id, name, slug, plan, is_admin_org, created_at')
    .order('created_at', { ascending: false })

  const { data: userCounts }     = await service.from('users').select('org_id')
  const { data: studyCounts }    = await service.from('studies').select('org_id')
  const { data: responseCounts } = await service.from('responses').select('org_id')

  const enriched = (orgs || []).map(org => ({
    ...org,
    user_count:     (userCounts     || []).filter(u => u.org_id === org.id).length,
    study_count:    (studyCounts    || []).filter(s => s.org_id === org.id).length,
    response_count: (responseCounts || []).filter(r => r.org_id === org.id).length,
  }))

    const rawOrg = data?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  return <AdminClient orgs={enriched} adminEmail={user.email!} logoUrl={orgData?.logo_url || ''} />
}
