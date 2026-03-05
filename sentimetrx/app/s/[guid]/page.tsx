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

  // Unknown GUID
  if (!study) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-[#0a1628]">
        <div className="text-center text-white">
          <div className="text-5xl mb-4">🔍</div>
          <h1 className="text-xl font-bold mb-2">Survey not found</h1>
          <p className="text-white/50 text-sm">This link doesn&apos;t match any survey.</p>
        </div>
      </main>
    )
  }

  const bg = study.config?.theme?.backgroundColor || '#0a1628'
  const gradient = study.config?.theme?.headerGradient || 'linear-gradient(135deg,#1a7a4a,#0d4a2a)'

  // Closed or draft — render locked UI server-side, no widget
  if (study.status !== 'active') {
    const isClosed = study.status === 'closed'
    return (
      <main className="min-h-screen sm:flex sm:items-center sm:justify-center sm:p-4" style={{ background: bg }}>
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mx-auto mb-6 shadow-lg"
            style={{ background: gradient }}>
            {study.bot_emoji}
          </div>
          <h1 className="text-2xl font-bold text-white mb-1">{study.bot_name}</h1>
          <p className="text-white/50 text-sm mb-8">{study.name}</p>
          <div className="bg-white/10 border border-white/20 rounded-2xl p-8">
            <div className="text-4xl mb-4">{isClosed ? '🔒' : '🚧'}</div>
            <h2 className="text-white font-bold text-lg mb-2">
              {isClosed ? 'This survey is now closed' : 'Not yet available'}
            </h2>
            <p className="text-white/60 text-sm leading-relaxed">
              {isClosed
                ? 'Thank you for your interest. This survey is no longer accepting responses.'
                : "This survey isn't published yet. Check back soon."}
            </p>
          </div>
          <p className="text-white/20 text-xs mt-8">
            Powered by <span className="text-white/40 font-medium">sentimetrx.ai</span>
          </p>
        </div>
      </main>
    )
  }

  // Active — render the widget
  return (
    <main className="min-h-screen sm:flex sm:items-center sm:justify-center sm:p-4" style={{ background: bg }}>
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
