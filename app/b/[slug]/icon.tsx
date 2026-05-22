// app/b/[slug]/icon.tsx
//
// Per-bot favicon at /b/<slug>. Reads the bot's config.avatarLetter +
// config.avatarGradient and renders them as a 64×64 PNG — so the browser tab
// matches the bot's in-app identity instead of the generic Sentimetrx mark.
// Next.js auto-wires this via its icon convention.

import { ImageResponse } from 'next/og'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

interface Props { params: { slug: string } }

export default async function Icon({ params }: Props) {
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('name, config')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  const cfg = (bot?.config || {}) as Record<string, any>
  const avatarLetter   = cfg.avatarLetter || (bot?.name?.charAt(0) || 'A').toUpperCase()
  // Matches BotClient + opengraph-image defaults
  const avatarGradient = cfg.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: avatarGradient,
          fontSize: 42,
          color: 'white',
          fontWeight: 800,
        }}
      >
        {avatarLetter}
      </div>
    ),
    { ...size },
  )
}
