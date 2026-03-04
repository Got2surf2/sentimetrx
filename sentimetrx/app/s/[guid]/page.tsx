import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Study } from '@/lib/types'
import SurveyWidget from '@/components/survey/SurveyWidget'
import ClosedStudyPage from '@/components/survey/ClosedStudyPage'

interface Props { params: { guid: string } }
export const dynamic = 'force-dynamic'

async function getStudyAny(guid: string) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('studies')
    .select('*')
    .eq('guid', guid)
    .single()
  return data
}

async function notifyCreator(study: any) {
  try {
    if (!study.created_by) return
    const supabase = createServiceRoleClient()
    const { data: creator } = await supabase
      .from('users')
      .select('email, full_name')
      .eq('id', study.created_by)
      .single()
    if (!creator?.email) return

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    await fetch(`${baseUrl}/api/notify/closed-study`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creatorEmail: creator.email,
        creatorName:  creator.full_name || creator.email,
        studyName:    study.name,
        studyId:      study.id,
        accessedAt:   new Date().toISOString(),
      }),
    })
  } catch (e) {
    console.error('[notify] failed:', e)
  }
}

export default async function SurveyPage({ params }: Props) {
  const study = await getStudyAny(params.guid)

  // Unknown GUID
  if (!study) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
        <div className="text-center text-white">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold mb-2">Survey not found</h1>
          <p className="text-gray-400 text-sm">This link doesn&apos;t match any survey.</p>
        </div>
      </main>
    )
  }

  // Not active — show closed/draft page
  if (study.status !== 'active') {
    if (study.status === 'closed') notifyCreator(study)
    return <ClosedStudyPage study={study} />
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: study.config?.theme?.backgroundColor || '#0a1628' }}
    >
      <SurveyWidget study={study as Study} />
    </main>
  )
}

export async function generateMetadata({ params }: Props) {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('studies')
    .select('name, bot_name, bot_emoji')
    .eq('guid', params.guid)
    .single()

  if (!data) return { title: 'Survey' }
  return {
    title:       `${data.bot_emoji} ${data.bot_name} — ${data.name}`,
    description: `Share your feedback with ${data.bot_name}`,
  }
}
