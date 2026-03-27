import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Study } from '@/lib/types'
import SurveyWidget from '@/components/survey/SurveyWidget'

interface Props { params: { guid: string } }
export const dynamic = 'force-dynamic'

// Look up study by slug first, then by guid
async function findStudy(supabase: any, identifier: string) {
  // If it looks like a UUID, try guid first
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)

  if (!isUUID) {
    // Try slug first (slugs are never UUIDs)
    const { data } = await supabase
      .from('studies')
      .select('*')
      .eq('slug', identifier.toLowerCase())
      .limit(1)
      .single()
    if (data) return data
  }

  // Try guid
  const { data } = await supabase
    .from('studies')
    .select('*')
    .eq('guid', identifier)
    .limit(1)
    .single()
  if (data) return data

  // Last resort: try slug even if it looked like a UUID
  if (isUUID) {
    const { data: slugData } = await supabase
      .from('studies')
      .select('*')
      .eq('slug', identifier.toLowerCase())
      .limit(1)
      .single()
    if (slugData) return slugData
  }

  return null
}

export default async function SurveyPage({ params }: Props) {
  const supabase = createServiceRoleClient()
  const study = await findStudy(supabase, params.guid)

  if (!study) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#0a1628' }}>
        <div style={{ textAlign: 'center', color: 'white' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDD0D'}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Survey not found</h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>This link doesn&apos;t match any survey.</p>
        </div>
      </main>
    )
  }

  const bg = study.config?.theme?.backgroundColor || '#0a1628'

  return (
    <main style={{ height: '100dvh', background: bg, overflow: 'hidden' }}>
      <SurveyWidget study={study as Study} />
    </main>
  )
}

export async function generateMetadata({ params }: Props) {
  const supabase = createServiceRoleClient()
  const study = await findStudy(supabase, params.guid)
  if (!study) return { title: 'Survey' }
  return {
    title: `${study.bot_emoji} ${study.bot_name} — ${study.name}`,
    description: `Share your feedback with ${study.bot_name}`,
  }
}
