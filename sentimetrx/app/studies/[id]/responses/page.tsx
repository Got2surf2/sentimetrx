import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import ResponsesDashboard from '@/components/dashboard/ResponsesDashboard'

interface Props { params: { id: string } }

export const dynamic = 'force-dynamic'

export default async function ResponsesPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, bot_emoji, status')
    .eq('id', params.id)
    .single()

  if (!study) notFound()

  return (
    <ResponsesDashboard
      studyId={study.id}
      studyName={study.name}
      botEmoji={study.bot_emoji}
    />
  )
}
