import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import DeployClient from './DeployClient'

interface Props { params: { id: string } }

export const dynamic = 'force-dynamic'

export default async function DeployPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: study } = await supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, config')
    .eq('id', params.id)
    .single()

  if (!study) notFound()

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://sentimetrx.ai'
  const surveyUrl = base + '/s/' + study.guid

  return <DeployClient study={study} surveyUrl={surveyUrl} />
}
