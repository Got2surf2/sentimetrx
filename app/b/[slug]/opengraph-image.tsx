// app/b/[slug]/opengraph-image.tsx
// Dynamically generated 1200x630 OG card for /b/<slug>.
// Next.js auto-wires this as og:image / twitter:image for the route.
// Uses the bot's brand gradient + avatar letter so the unfurl mirrors the
// in-app card design.

import { ImageResponse } from 'next/og'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const contentType = 'image/png'
export const size = { width: 1200, height: 630 }
export const alt = 'Chat with this AI assistant'

interface Props { params: { slug: string } }

interface BotOgConfig {
  subtitle?: string
  websiteLabel?: string
  headerGradient?: string
  avatarGradient?: string
  accentColor?: string
  avatarLetter?: string
}

export default async function OG({ params }: Props) {
  const service = createServiceRoleClient()
  const { data: bot } = await service
    .from('agents')
    .select('name, config')
    .eq('slug', params.slug)
    .eq('status', 'active')
    .single()

  const name = bot?.name || 'Chat'
  const cfg = (bot?.config || {}) as BotOgConfig
  const subtitle = cfg.subtitle || cfg.websiteLabel || 'AI assistant'
  // CSS gradients are stored as full strings in config; default matches BotClient.
  const headerGradient = cfg.headerGradient || 'linear-gradient(135deg, #0a1628, #1a2d4a)'
  const avatarGradient = cfg.avatarGradient || 'linear-gradient(135deg, #00b4d8, #0077a8)'
  const accent         = cfg.accentColor    || '#00b4d8'
  const avatarLetter   = (cfg.avatarLetter || name.charAt(0) || 'A').toUpperCase()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: headerGradient,
          color: 'white',
          padding: '72px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Top row: avatar + brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div style={{
            width: 132, height: 132, borderRadius: 132,
            background: avatarGradient,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 64, fontWeight: 800,
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          }}>
            {avatarLetter}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>powered by</div>
            <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: 1 }}>DATANAUTIX</div>
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 32, color: accent, fontWeight: 700, letterSpacing: 0.5 }}>Chat with</div>
          <div style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: -1 }}>{name}</div>
          <div style={{ fontSize: 30, color: 'rgba(255,255,255,0.78)', marginTop: 12 }}>{subtitle}</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
