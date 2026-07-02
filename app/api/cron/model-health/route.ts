// app/api/cron/model-health/route.ts
// Cron: verify the Anthropic models this app is configured to call still exist.
//
// Anthropic retires dated model snapshots on a schedule; a retired model 404s
// every call (e.g. claude-sonnet-4-20250514 retiring 2026-06-15 silently broke
// Ask Ana + the `standard` tier). Runs weekly so a deprecation surfaces weeks
// early — in logs + Sentry — instead of on retirement day. See lib/modelHealth.ts.
//
// Also callable ad hoc by an admin with the cron secret to get the current report.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkCronAuth } from '@/lib/cronAuth'
import { checkConfiguredModels } from '@/lib/modelHealth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 })
  }

  const report = await checkConfiguredModels(apiKey)

  if (!report.ok) {
    const bad = report.results
      .filter(r => r.status !== 'ok')
      .map(r => r.model + ' (' + r.tiers.join('/') + ' tier): ' + r.status + (r.detail ? ' — ' + r.detail : ''))
      .join('; ')
    const msg = 'Configured Anthropic model(s) unhealthy — calls will 404: ' + bad
    console.error('[model-health] ' + msg)
    Sentry.captureMessage(msg, 'error')
  }

  // 503 on problems so an external uptime check can alert too.
  return NextResponse.json(report, { status: report.ok ? 200 : 503 })
}
