import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'

interface Props { params: { id: string } }
export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ params }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: study }, { data: userData }] = await Promise.all([
    supabase.from('studies').select('id, name, bot_name, bot_emoji, status, visibility, created_by, config').eq('id', params.id).single(),
    supabase.from('users').select('full_name, organizations(is_admin_org, logo_url, name, features)').eq('id', user.id).single(),
  ])

  if (!study) notFound()

  const orgData = resolveOrg(userData?.organizations) as any
  if (orgData?.features?.surveys === false) redirect('/dashboard')

  return (
    <AnalyticsDashboard
      studyId={study.id}
      studyName={study.name}
      botEmoji={study.bot_emoji}
      botName={study.bot_name}
      studyConfig={(study as any).config || {}}
      logoUrl={orgData?.logo_url   || ''}
      orgName={orgData?.name       || ''}
      isAdmin={!!orgData?.is_admin_org}
      analyzeEnabled={!!orgData?.features?.analyze}
      userEmail={user.email        || ''}
      fullName={userData?.full_name || ''}
    />
  )
}
