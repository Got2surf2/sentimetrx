import { cache } from 'react'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Study } from '@/lib/types'
import SurveyWidget from '@/components/survey/SurveyWidget'

interface Props { params: Promise<{ guid: string }> }
export const dynamic = 'force-dynamic'

// Look up study by slug first, then by guid. React.cache dedupes the lookup
// within one request (perf review §7 Brief D) — the page render and
// generateMetadata both call it, and without this a QR-burst page view paid
// the ~3–5 point lookups TWICE. Keyed by identifier only (the client is
// created inside so the memo key stays stable across both call sites).
const findStudy = cache(async (identifier: string) => {
  const supabase = createServiceRoleClient()
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

  // Last resort: try slug even if it looked like a UUID, then try id
  if (isUUID) {
    const { data: slugData } = await supabase
      .from('studies')
      .select('*')
      .eq('slug', identifier.toLowerCase())
      .limit(1)
      .single()
    if (slugData) return slugData

    // Final fallback: try by primary id (for legacy studies with no guid)
    const { data: idData } = await supabase
      .from('studies')
      .select('*')
      .eq('id', identifier)
      .limit(1)
      .single()
    if (idData) return idData
  }

  return null
})

export default async function SurveyPage(props: Props) {
  const params = await props.params;
  const study = await findStudy(params.guid)

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

  // Fetch org name for AI prompts
  let orgName = ''
  if (study.org_id) {
    const supabase = createServiceRoleClient()
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', study.org_id)
      .single()
    if (org) orgName = org.name
  }

  const bg = study.config?.theme?.backgroundColor || '#0a1628'

  return (
    <main style={{ height: '100dvh', background: bg, overflow: 'hidden' }}>
      <SurveyWidget study={study as Study} orgName={orgName} />
    </main>
  )
}

export async function generateMetadata(props: Props) {
  const params = await props.params;
  const study = await findStudy(params.guid)
  if (!study) return { title: 'Survey' }
  return {
    title: `${study.bot_emoji} ${study.bot_name} — ${study.name}`,
    description: `Share your feedback with ${study.bot_name}`,
  }
}
