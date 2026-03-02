import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import EditStudyClient from './EditStudyClient'

interface Props { params: { id: string } }

export const dynamic = 'force-dynamic'

export default async function EditStudyPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: study } = await supabase
    .from('studies')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!study) notFound()

  return <EditStudyClient study={study} />
}
