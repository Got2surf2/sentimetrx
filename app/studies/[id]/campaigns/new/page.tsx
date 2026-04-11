import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import NewCampaignClient from './NewCampaignClient'

export const dynamic = 'force-dynamic'

export default async function NewCampaignPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  // Fetch the study
  const { data: study } = await supabase
    .from('studies')
    .select('id, guid, slug, name, status, config')
    .eq('id', params.id)
    .single()

  if (!study) redirect('/dashboard')

  // Extract hidden fields from study config
  const config = study.config || {}
  const hiddenFields: string[] = (config.questions || [])
    .filter((q: any) => q.type === 'hidden' && q.paramKey)
    .map((q: any) => q.paramKey)

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const surveyPath = '/s/' + (study.slug || study.guid)
  const studyUrl = baseUrl + surveyPath

  return (
    <NewCampaignClient
      logoUrl={orgData?.logo_url || ''}
      analyzeEnabled={!!orgData?.features?.analyze}
      campaignsEnabled={!!orgData?.features?.campaigns}
      user={{
        email: user.email!,
        fullName: userData?.full_name ?? '',
        clientName: orgData?.name ?? '',
        isAdmin: !!orgData?.is_admin_org,
      }}
      study={{ id: study.id, name: study.name, status: study.status, guid: study.guid, slug: study.slug }}
      hiddenFields={hiddenFields}
      studyUrl={studyUrl}
    />
  )
}
