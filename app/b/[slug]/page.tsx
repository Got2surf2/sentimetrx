// app/b/[slug]/page.tsx
// Public bot page — serves a custom branded chatbot by slug
// No auth required — this is the public-facing bot URL

import type { Metadata } from 'next'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { enabledProbes } from '@/lib/researchProbes'
import BotClient from './BotClient'

// Public bot pages are read by share-link unfurls (iMessage / Slack / Twitter)
// and SEO crawlers far more than by the bot owner. Revalidate every hour so
// every fetch hits the CDN edge instead of regenerating server-side. The
// chat itself is a client component that fetches fresh state on mount, so
// stale page HTML doesn't affect runtime correctness.
export const revalidate = 3600
export const fetchCache = 'force-no-store'

interface Props { params: Promise<{ slug: string }> }

export default async function BotPage(props: Props) {
  const params = await props.params;
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('id, name, slug, status, config, research_probes')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  if (!bot) notFound()

  // §14.3: any enabled research probe forces the disclosure line in the
  // widget chrome. Computed server-side; the probe definitions themselves
  // never reach the client.
  const { research_probes: _probes, ...botForClient } = bot
  const researchDisclosure = enabledProbes(bot).length > 0

  return (
    <main style={{ height: '100dvh', background: '#f8fafc', overflow: 'hidden' }}>
      <BotClient bot={{ ...botForClient, researchDisclosure }} />
    </main>
  )
}

// Open Graph metadata — drives iMessage/Slack/WhatsApp/Twitter unfurls.
// Without these, iMessage falls back to "Chat / sentimetrx.ai / Safari icon".
// The dynamically generated card image lives at opengraph-image.tsx in this
// same route segment — Next.js auto-wires it as og:image.
export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('name, config')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  if (!bot) return { title: 'Chat' }

  const cfg = (bot.config || {}) as Record<string, any>
  const subtitle = cfg.subtitle || ''
  const websiteLabel = cfg.websiteLabel || ''
  const title = `Chat with ${bot.name}`
  const desc  = subtitle || (websiteLabel ? `An AI assistant from ${websiteLabel}` : 'An AI assistant trained to help you.')

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: 'website',
      siteName: websiteLabel || 'Datanautix',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
    },
  }
}
