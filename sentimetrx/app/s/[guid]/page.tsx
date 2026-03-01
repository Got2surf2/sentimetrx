import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import type { Study } from '@/lib/types'
import SurveyWidget from '@/components/survey/SurveyWidget'

// This page lives at /s/[guid]
// e.g. sentimetrx.ai/s/test-charity-001
//
// It is a React Server Component — study config is fetched on the
// server and only the minimum needed data is passed to the client
// widget. The full config (all clarifiers, all question banks) is
// never serialised into the browser's page source.

interface Props {
  params: { guid: string }
}

// Fetch study server-side — invisible to the browser
async function getStudy(guid: string): Promise<Study | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('studies')
    .select('*')
    .eq('guid', guid)
    .eq('status', 'active')
    .single()

  if (error || !data) return null
  return data as Study
}

// Tell Next.js not to cache this page — always fetch fresh config
export const dynamic = 'force-dynamic'

export default async function SurveyPage({ params }: Props) {
  const study = await getStudy(params.guid)

  if (!study) notFound()

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: study.config.theme.backgroundColor || '#0a1628' }}
    >
      <SurveyWidget study={study} />
    </main>
  )
}

// Generate metadata for the page (shown in browser tab, SMS previews)
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
