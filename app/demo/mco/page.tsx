// app/demo/mco/page.tsx
//
// AskAna canvas demo — boardroom prototype for the Orlando International
// Airport opportunity. Public route, no auth (matches /b/mco posture).
//
// Mode detection ladder (strongest signal first):
//   1. URL parameter ?ctx=home|invenue|kiosk (from QR scan or deep link)
//   2. URL parameter ?kiosk=1 (legacy / explicit kiosk deploy override)
//   3. User agent — mobile UA defaults to invenue, otherwise home
//
// Geolocation is NOT consulted server-side; commit 3 will add a client-side
// permission ask in `invenue` mode to confirm/refine the QR-derived location.
// See docs/MCO_AGENT.md § 4 + 5.

import type { Metadata } from 'next'
import CanvasShell from './CanvasShell'
import type { DeploymentMode } from '@/lib/uiHints'
import { headers } from 'next/headers'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: { ctx?: string; kiosk?: string; bot?: string }
}

// Bot override (?bot=pilot or ?bot=<uuid>) lets us point the canvas at a
// pilot agent without touching the hardcoded live ID. Whitelist UUID +
// the literal "pilot" alias so a stray query string can't redirect the
// canvas at some unrelated agent.
const PILOT_BOT_ID = 'ae948bce-52ed-49aa-a4b1-c5318bfb7b7e'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveBotOverride(bot: string | undefined): string | null {
  if (!bot) return null
  if (bot === 'pilot') return PILOT_BOT_ID
  if (UUID_RE.test(bot)) return bot
  return null
}

function detectMode(ctx: string | undefined, kioskFlag: string | undefined, ua: string): DeploymentMode {
  if (ctx === 'home' || ctx === 'invenue' || ctx === 'kiosk') return ctx
  if (kioskFlag === '1' || kioskFlag === 'true') return 'kiosk'
  // Crude UA check: mobile → assume in-venue (likely a QR scan from signage),
  // desktop → assume planning. Auto mode can be overridden in the demo strip.
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'invenue'
  return 'home'
}

export default function MCODemoPage({ searchParams }: Props) {
  const ua = headers().get('user-agent') || ''
  const mode = detectMode(searchParams.ctx, searchParams.kiosk, ua)
  const botOverride = resolveBotOverride(searchParams.bot)

  return <CanvasShell initialMode={mode} botOverride={botOverride} />
}

export const metadata: Metadata = {
  title: 'MCO Concierge — Orlando International Airport',
  description: 'A digital concierge for MCO. Ask anything about parking, terminals, security, ground transportation, accessibility, and more.',
  openGraph: {
    title: 'MCO Concierge — Orlando International Airport',
    description: 'A digital concierge for MCO from Sentimetrx.',
  },
  robots: { index: false, follow: false },
}
