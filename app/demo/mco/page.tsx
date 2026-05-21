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
  searchParams: { ctx?: string; kiosk?: string }
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

  return <CanvasShell initialMode={mode} />
}

export const metadata: Metadata = {
  title: 'AskAna — Orlando International Airport',
  description: 'A digital concierge for MCO. Ask anything about parking, terminals, security, ground transportation, accessibility, and more.',
  openGraph: {
    title: 'AskAna — Orlando International Airport',
    description: 'A digital concierge for MCO from Sentimetrx.',
  },
  robots: { index: false, follow: false },
}
