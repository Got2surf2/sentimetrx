import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import CampaignDashboardClient from './CampaignDashboardClient'

export const dynamic = 'force-dynamic'

export default async function CampaignsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, role, client_id, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  const isAdmin = !!orgData?.is_admin_org

  // Check if campaigns feature is enabled
  if (!orgData?.features?.campaigns && !isAdmin) {
    redirect('/dashboard')
  }

  // Use service role for campaign data reads
  const service = createServiceRoleClient()

  const { data: campaigns } = await service
    .from('campaigns')
    .select('*, studies(name, status, config, bot_emoji)')
    .order('created_at', { ascending: false })

  const enrichedCampaigns = (campaigns || []).map((c: any) => ({
    ...c,
    study_name: c.studies?.name,
    study_status: c.studies?.status,
    study_color: c.studies?.config?.theme?.primaryColor || null,
    study_gradient: c.studies?.config?.theme?.headerGradient || null,
    study_emoji: c.studies?.bot_emoji || null,
    studies: undefined,
  }))

  // Fetch respondent stats for each campaign
  const statsMap: Record<string, any> = {}
  const respondentsMap: Record<string, { email: string; status: string }[]> = {}
  for (const c of enrichedCampaigns) {
    const { data: respondents } = await service
      .from('campaign_respondents')
      .select('email, status')
      .eq('campaign_id', c.id)
      .order('created_at', { ascending: true })
      .limit(100)

    const counts = { total: 0, pending: 0, sent: 0, opened: 0, clicked: 0, completed: 0, bounced: 0, unsubscribed: 0 }
    for (const r of (respondents || [])) {
      counts.total++
      const s = r.status as keyof typeof counts
      if (s in counts) counts[s]++
    }
    statsMap[c.id] = counts
    respondentsMap[c.id] = (respondents || []).map((r: any) => ({ email: r.email, status: r.status }))
  }

  return (
    <CampaignDashboardClient
      logoUrl={orgData?.logo_url || ''}
      orgId={orgData?.id || ''}
      analyzeEnabled={!!orgData?.features?.analyze}
      campaignsEnabled={!!orgData?.features?.campaigns}
      user={{
        email: user.email!,
        fullName: userData?.full_name ?? '',
        role: userData?.role ?? '',
        clientName: orgData?.name ?? '',
        isAdmin,
        userId: user.id,
      }}
      campaigns={enrichedCampaigns}
      statsMap={statsMap}
      respondentsMap={respondentsMap}
    />
  )
}
