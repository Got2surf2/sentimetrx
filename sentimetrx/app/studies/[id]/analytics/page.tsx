import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import AnalyticsDashboard from '@/components/analytics/AnalyticsDashboard'

interface Props { params: { id: string } }

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, status, visibility, created_by')
    .eq('id', params.id)
    .single()

  if (!study) notFound()

  return (
    <AnalyticsDashboard
      studyId={study.id}
      studyName={study.name}
      botEmoji={study.bot_emoji}
      botName={study.bot_name}
    />
  )
}
