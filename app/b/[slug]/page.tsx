// app/b/[slug]/page.tsx
// Public bot page — serves a custom branded chatbot by slug
// No auth required — this is the public-facing bot URL

import type { Metadata } from 'next'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import BotClient from './BotClient'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Props { params: { slug: string } }

export default async function BotPage({ params }: Props) {
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('bots')
    .select('id, name, slug, status, config')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  if (!bot) notFound()

  return (
    <main style={{ height: '100dvh', background: '#f8fafc', overflow: 'hidden' }}>
      <BotClient bot={bot} />
    </main>
  )
}

// Open Graph metadata — drives iMessage/Slack/WhatsApp/Twitter unfurls.
// Without these, iMessage falls back to "Chat / sentimetrx.ai / Safari icon".
// The dynamically generated card image lives at opengraph-image.tsx in this
// same route segment — Next.js auto-wires it as og:image.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('bots')
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
