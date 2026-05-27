// app/b/[slug]/icon.tsx
//
// Per-bot favicon at /b/<slug>. Two paths:
//
//   1. slug === 'mco': serve the official MCO sunburst+plane logo directly
//      (public/mco/favicon-64.png). The custom airline-themed letter-on-
//      gradient we used before could be read as us inventing branding
//      for someone else's airport. Using the official mark sidesteps it.
//
//   2. Every other bot: ImageResponse renders the bot's avatarLetter
//      (config.avatarLetter, e.g. "S") on the bot's avatarGradient.

import { ImageResponse } from 'next/og'
import { readFileSync } from 'fs'
import path from 'path'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

interface Props { params: { slug: string } }

export default async function Icon({ params }: Props) {
  // MCO override — serve the official logo PNG so we're not minting our own
  // airport brand identity. Falls back to the dynamic letter render if the
  // file is missing for any reason.
  if (params.slug === 'mco') {
    try {
      const buf = readFileSync(path.join(process.cwd(), 'public', 'mco', 'favicon-64.png'))
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
      })
    } catch { /* fall through to the dynamic render */ }
  }

  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('name, config')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  const cfg = (bot?.config || {}) as Record<string, any>
  const avatarLetter   = cfg.avatarLetter || (bot?.name?.charAt(0) || 'A').toUpperCase()
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
