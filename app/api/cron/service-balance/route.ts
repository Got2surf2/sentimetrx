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
// Alert throttle: a persistent outage re-alerts at most ~once/day (a service
// is re-emailed only if it hasn't been alerted in the last 20h), so a broke
// vendor nags daily instead of every 6h.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { getEmailProvider } from '@/lib/email/provider'
import { probeBalances, getServiceHealthRows, STATUS_RANK, type ServiceHealthRow } from '@/lib/serviceHealth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FROM = 'Sentimetrx Alerts <alerts@sentimetrx.ai>'
const REALERT_MS = 20 * 3600 * 1000 // re-email a still-broken service at most ~once/day

function fmtBal(r: ServiceHealthRow): string {
  if (r.balance_usd == null) return r.tier === 1 ? 'not configured' : 'no balance API'
  return `$${r.balance_usd.toFixed(2)}`
}

function buildAlertEmail(bad: ServiceHealthRow[]) {
  const subject = `⚠ Service credits — ${bad.map(r => r.display_name).join(', ')} need attention`
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const color = (s: string) => (s === 'critical' || s === 'error') ? '#b91c1c' : s === 'low' ? '#92400e' : '#6b7280'
  const rows = bad.map(r => `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:10px 12px;font-size:13px;color:#1f2937;font-weight:600;">${r.display_name}</td>
      <td style="padding:10px 12px;font-size:13px;color:#1f2937;">${fmtBal(r)}</td>
      <td style="padding:10px 12px;"><span style="font-size:10px;font-weight:700;text-transform:uppercase;color:${color(r.status)};">${r.status}</span></td>
      <td style="padding:10px 12px;font-size:11px;color:#6b7280;">${r.last_error_msg ? String(r.last_error_msg).slice(0, 80) : ''}</td>
    </tr>`).join('')
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:32px 16px;"><tr><td align="center">
  <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
    <tr><td style="background:#E8632A;height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
    <tr><td style="padding:28px 32px 8px;">
      <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;">Service credits need attention</h1>
      <p style="margin:0;font-size:13px;color:#6b7280;">${bad.length} service(s) low/out of credit — top up before they stall jobs.</p>
    </td></tr>
    <tr><td style="padding:16px 32px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">${rows}</table></td></tr>
    <tr><td style="padding:16px 32px 28px;"><a href="${baseUrl}/admin/health" style="display:inline-block;padding:12px 22px;background:#E8632A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px;">View on /admin/health →</a></td></tr>
    <tr><td style="background:#fafafa;padding:18px 32px;border-top:1px solid #e5e7eb;"><p style="margin:0;font-size:11px;line-height:1.5;color:#6b7280;">Sent by the service-balance cron. Recipients via CREDITS_ALERT_TO (or SENTRY_ALERT_TO).</p></td></tr>
  </table>
</td></tr></table></body></html>`
  const text = [
    `Service credits need attention — ${bad.length} service(s):`,
    '',
    ...bad.map(r => `${r.display_name}: ${fmtBal(r)} [${r.status}]${r.last_error_msg ? ' — ' + String(r.last_error_msg).slice(0, 80) : ''}`),
    '',
    `Details: ${baseUrl}/admin/health`,
  ].join('\n')
  return { subject, html, text }
}

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  // 1. Refresh tier-1 balances (persists each row + flags 402s as credit errors).
  const probed = await probeBalances()

  // 2. Read the full roster (tier-1 balances + tier-2 last-error rows).
  const rows = await getServiceHealthRows()
  const service = createServiceRoleClient()
  const now = Date.now()

  // 3. Anything critical/error is alert-worthy; throttle per service to ~daily.
  const alertWorthy = rows.filter(r => r.status === 'critical' || r.status === 'error')
  const toAlert = alertWorthy.filter(r =>
    !r.last_alerted_at || (now - new Date(r.last_alerted_at).getTime()) > REALERT_MS
  )

  let emailed = false
  const recipients = (process.env.CREDITS_ALERT_TO || process.env.SENTRY_ALERT_TO || '')
    .split(',').map(s => s.trim()).filter(Boolean)

  if (recipients.length > 0 && toAlert.length > 0) {
    try {
      const ordered = [...toAlert].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])
      const { subject, html, text } = buildAlertEmail(ordered)
      const provider = getEmailProvider('resend')
      await Promise.all(recipients.map(to => provider.send({ to, from: FROM, subject, html, text })))
      emailed = true
      // Stamp last_alerted_at so a still-broken service doesn't re-email for ~20h.
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
    alert_worthy: alertWorthy.length,
    emailed,
    recipients: recipients.length,
  })
}
