import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import CampaignDetailClient from './CampaignDetailClient'

export const dynamic = 'force-dynamic'

export default async function CampaignDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  // Use service role for campaign data reads — RLS on campaign tables
  // uses current_org_id() which may not resolve for all user roles
  const service = createServiceRoleClient()

  const { data: campaign } = await service
    .from('campaigns')
    .select('*, studies(name, status, guid, slug)')
    .eq('id', params.id)
    .single()

  if (!campaign) redirect('/campaigns')

  const { data: emails } = await service
    .from('campaign_emails')
    .select('*')
    .eq('campaign_id', params.id)
    .order('sequence', { ascending: true })

  const { data: respondents } = await service
    .from('campaign_respondents')
    .select('*')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true })
    .limit(500)

  const { count: totalRespondents } = await service
    .from('campaign_respondents')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', params.id)

  return (
    <CampaignDetailClient
      logoUrl={orgData?.logo_url || ''}
      analyzeEnabled={!!orgData?.features?.analyze}
      campaignsEnabled={!!orgData?.features?.campaigns}
      features={orgData?.features || {}}
      user={{
        email: user.email!,
        fullName: userData?.full_name ?? '',
        clientName: orgData?.name ?? '',
        isAdmin: !!orgData?.is_admin_org,
        userId: user.id,
      }}
      campaign={{
        ...campaign,
        study_name: campaign.studies?.name,
        study_status: campaign.studies?.status,
        study_guid: campaign.studies?.guid,
        study_slug: campaign.studies?.slug,
      }}
      emails={emails || []}
      respondents={respondents || []}
      totalRespondents={totalRespondents || 0}
    />
  )
}
