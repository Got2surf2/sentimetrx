import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import EditStudyClient from './EditStudyClient'

interface Props { params: { id: string } }
export const dynamic = 'force-dynamic'

export default async function EditStudyPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: study }, { data: userData }] = await Promise.all([
    supabase.from('studies').select('*').eq('id', params.id).single(),
    supabase.from('users').select('full_name, org_id, organizations(is_admin_org, logo_url, name)').eq('id', user.id).single(),
  ])

  if (!study) notFound()

  const orgData = resolveOrg(userData?.organizations) as any
  const isAdmin = !!orgData?.is_admin_org

  // Fetch all orgs for admin transfer dropdown
  let allOrgs: { id: string; name: string }[] = []
  if (isAdmin) {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('organizations')
      .select('id, name')
      .neq('id', study.org_id)
      .order('name')
    allOrgs = data || []
  }

  return (
    <EditStudyClient
      study={study}
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      isAdmin={isAdmin}
      allOrgs={allOrgs}
      userEmail={user.email || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
