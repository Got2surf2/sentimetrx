import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'

interface Props { params: { id: string } }
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: study }, { data: userData }] = await Promise.all([
    supabase.from('studies').select('id, name, bot_name, bot_emoji, status, visibility, created_by').eq('id', params.id).single(),
    supabase.from('users').select('full_name, organizations(is_admin_org, logo_url, name)').eq('id', user.id).single(),
  ])

  if (!study) notFound()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  return (
    <AnalyticsDashboard
      studyId={study.id}
      studyName={study.name}
      botEmoji={study.bot_emoji}
      botName={study.bot_name}
      logoUrl={orgData?.logo_url   || ''}
      orgName={orgData?.name       || ''}
      isAdmin={!!orgData?.is_admin_org}
      userEmail={user.email        || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
