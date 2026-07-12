// app/api/cron/service-balance/route.ts
// Polls tier-1 vendor balances (DataForSEO, Deepgram, Twilio), persists every
// service's health to service_health, and emails an alert when any service is
// out of / low on credit — so an out-of-balance vendor (the Rubio's DataForSEO
// 402, 2026-06-16) surfaces BEFORE it silently stalls a load.
//
// Scheduled by vercel.json: 0 */6 * * * (every 6h).
// Set CREDITS_ALERT_TO=a@x.com,b@x.com (falls back to SENTRY_ALERT_TO) to get
// emails. No recipients → cron still refreshes balances, just doesn't email.
//
// Alert throttle (shared with the real-time path in lib/serviceAlerts):
// critical/error re-alert ~daily; LOW ("close to the limit") re-alerts ~every
// 3 days — the header always promised low alerts, but the filter only sent
// critical/error until 2026-07-12. Real-time "hit the limit" emails come from
// recordCreditError the moment a 402 lands; this cron is the backstop.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { alertRecipients, pickAlertWorthy, sendServiceAlert } from '@/lib/serviceAlerts'
import { probeBalances, getServiceHealthRows } from '@/lib/serviceHealth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  // 1. Refresh tier-1 balances (persists each row + flags 402s as credit errors).
  const probed = await probeBalances()

  // 2. Read the full roster (tier-1 balances + tier-2 last-error rows).
  const rows = await getServiceHealthRows()
  const service = createServiceRoleClient()
  const now = Date.now()

  // 3. low ("close to the limit") + critical/error are alert-worthy, each with
  //    its own re-alert window (lib/serviceAlerts.pickAlertWorthy).
  const toAlert = pickAlertWorthy(rows, now)
  const recipients = alertRecipients()

  let emailed = false
  if (recipients.length > 0 && toAlert.length > 0) {
    try {
      emailed = await sendServiceAlert(toAlert)
      // Stamp last_alerted_at so a still-bad service waits out its window.
      const stamp = new Date(now).toISOString()
      await Promise.all(toAlert.map(r =>
        service.from('service_health').update({ last_alerted_at: stamp }).eq('service', r.service)
      ))
    } catch (e: unknown) {
      console.error({ at: 'cron/service-balance', msg: 'email send failed', err: e instanceof Error ? e.message : e })
    }
  }

  return NextResponse.json({
    ok: true,
    probed,
    services: rows.map(r => ({ service: r.service, status: r.status, balance_usd: r.balance_usd })),
    alert_worthy: toAlert.length,
    emailed,
    recipients: recipients.length,
  })
}
