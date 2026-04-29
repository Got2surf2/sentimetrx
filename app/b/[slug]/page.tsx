// app/b/[slug]/page.tsx
// Public bot page — serves a custom branded chatbot by slug
// No auth required — this is the public-facing bot URL

import { createServiceRoleClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import BotClient from './BotClient'

export const dynamic = 'force-dynamic'

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
