import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import EditStudyClient from './EditStudyClient'

interface Props { params: Promise<{ id: string }> }
export const dynamic = 'force-dynamic'

export default async function EditStudyPage(props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: study }, { data: userData }] = await Promise.all([
    supabase.from('studies').select('*').eq('id', params.id).single(),
    supabase.from('users').select('full_name, org_id, organizations(is_admin_org, logo_url, name, features)').eq('id', user.id).single(),
  ])

  if (!study) notFound()

  const orgData = resolveOrg(userData?.organizations) as any
  if (orgData?.features?.surveys === false) redirect('/dashboard')
  const isAdmin = !!orgData?.is_admin_org

  // Fetch all orgs for admin transfer dropdown. Filter out suspended /
  // archived so you can't hand work to a frozen org.
  let allOrgs: { id: string; name: string }[] = []
  if (isAdmin) {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('organizations')
      .select('id, name')
      .neq('id', study.org_id)
      .neq('plan', 'suspended')
      .neq('status', 'suspended')
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
