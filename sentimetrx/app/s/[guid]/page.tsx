import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Study } from '@/lib/types'
import SurveyWidget from '@/components/survey/SurveyWidget'

interface Props { params: { guid: string } }
export const dynamic = 'force-dynamic'

export default async function SurveyPage({ params }: Props) {
  const supabase = createServiceRoleClient()
  const { data: study } = await supabase
    .from('studies')
    .select('*')
    .eq('guid', params.guid)
    .limit(1)
    .single()

  if (!study) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0a1628' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Survey not found</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>This link doesn&apos;t match any survey.</p>
        </div>
      </main>
    )
  }

  const bg = study.config?.theme?.backgroundColor || '#0a1628'

  if (study.status !== 'active') {
    return (
      <main style={{ height: '100dvh', background: bg, overflow: 'hidden' }}>
        <SurveyWidget study={study as Study} />
      </main>
    )
  }

  return (
    <main style={{ height: '100dvh', background: bg, overflow: 'hidden' }}>
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
    title: `${data.bot_emoji} ${data.bot_name} — ${data.name}`,
    description: `Share your feedback with ${data.bot_name}`,
  }
}
