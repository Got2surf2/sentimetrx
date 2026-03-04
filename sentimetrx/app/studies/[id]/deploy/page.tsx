import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DeployClient from './DeployClient'

interface Props { params: { id: string } }
export const dynamic = 'force-dynamic'

export default async function DeployPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: study }, { data: userData }] = await Promise.all([
    supabase.from('studies').select('*').eq('id', params.id).single(),
    supabase.from('users').select('full_name, organizations(is_admin_org, logo_url, name)').eq('id', user.id).single(),
  ])

  if (!study) notFound()

  const rawOrg = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const surveyUrl = `${baseUrl}/s/${study.guid}`

  return (
    <DeployClient
      study={study}
      surveyUrl={surveyUrl}
      logoUrl={orgData?.logo_url || ''}
      orgName={orgData?.name || ''}
      isAdmin={!!orgData?.is_admin_org}
      userEmail={user.email || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
