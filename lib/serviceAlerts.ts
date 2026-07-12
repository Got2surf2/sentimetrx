import 'server-only'

// lib/serviceAlerts.ts
// Email alerts to the platform admin when a vendor service is CLOSE TO or has
// HIT a credit/quota limit (owner ask, 2026-07-12). Two delivery paths share
// this module:
//
//   1. The service-balance cron (every 6h) — polls tier-1 balances and mails
//      everything alert-worthy. Backstop cadence.
//   2. recordCreditError (lib/serviceHealth) — the REAL-TIME path: the moment
//      live traffic (or the health-page probe) hits a billing/quota error,
//      the transition into 'error' emails immediately instead of waiting up
//      to 6h for the cron.
//
// Throttling — per service, stamped in service_health.last_alerted_at:
//   low            → re-alert at most every ~3 days ("close to the limit" is
//                     a heads-up, not a pager)
//   critical/error → re-alert at most every ~20h (a broke vendor nags daily)
//
// Recipients: CREDITS_ALERT_TO (comma-separated), falling back to
// SENTRY_ALERT_TO — the same list the Sentry digest already reaches.
// No recipients configured → alerting is a no-op (state still persists).
//
// Imports from lib/serviceHealth are type-only (erased at runtime) so the
// serviceHealth → serviceAlerts static import doesn't create a module cycle.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { getEmailProvider } from '@/lib/email/provider'
import type { ServiceHealthRow } from '@/lib/serviceHealth'

const FROM = 'Sentimetrx Alerts <alerts@sentimetrx.ai>'
export const REALERT_BAD_MS = 20 * 3600 * 1000      // critical/error: ~daily
export const REALERT_LOW_MS = 3 * 24 * 3600 * 1000  // low: ~every 3 days

// Local severity rank (worst first in the email). Kept here rather than
// importing serviceHealth's STATUS_RANK to keep this module runtime-free of
// serviceHealth (see header).
const RANK: Record<string, number> = { critical: 4, error: 3, low: 2, unknown: 1, ok: 0 }

export function alertRecipients(): string[] {
  return (process.env.CREDITS_ALERT_TO || process.env.SENTRY_ALERT_TO || '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

/** Rows that warrant an email right now: low/critical/error, outside their
 *  per-status re-alert window. Pure — unit-tested. */
export function pickAlertWorthy(rows: ServiceHealthRow[], nowMs: number): ServiceHealthRow[] {
  return rows.filter(r => {
    if (r.status !== 'low' && r.status !== 'critical' && r.status !== 'error') return false
    const windowMs = r.status === 'low' ? REALERT_LOW_MS : REALERT_BAD_MS
    return !r.last_alerted_at || (nowMs - new Date(r.last_alerted_at).getTime()) > windowMs
  })
}

function fmtBal(r: ServiceHealthRow): string {
  if (r.balance_usd == null) return r.tier === 1 ? 'not configured' : 'no balance API'
  return `$${r.balance_usd.toFixed(2)}`
}

export function buildAlertEmail(bad: ServiceHealthRow[]) {
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
    <tr><td style="background:#fafafa;padding:18px 32px;border-top:1px solid #e5e7eb;"><p style="margin:0;font-size:11px;line-height:1.5;color:#6b7280;">Sent by Sentimetrx service alerting. Recipients via CREDITS_ALERT_TO (or SENTRY_ALERT_TO).</p></td></tr>
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

/** Send one alert email covering `bad` to every recipient. Caller decides
 *  throttling and stamping. Throws on send failure (callers catch). */
export async function sendServiceAlert(bad: ServiceHealthRow[]): Promise<boolean> {
  const recipients = alertRecipients()
  if (recipients.length === 0 || bad.length === 0) return false
  const ordered = [...bad].sort((a, b) => (RANK[b.status] || 0) - (RANK[a.status] || 0))
  const { subject, html, text } = buildAlertEmail(ordered)
  const provider = getEmailProvider('resend')
  await Promise.all(recipients.map(to => provider.send({ to, from: FROM, subject, html, text })))
  return true
}

/**
 * Real-time path: called by recordCreditError the moment a service hits a
 * credit/quota error. Claim-then-send: atomically stamp last_alerted_at only
 * if the row is outside its re-alert window (a burst of concurrent 402s
 * yields ONE email — losers of the claim see zero updated rows and skip).
 * Best-effort: never throws.
 */
export async function maybeAlertCreditError(serviceKey: string): Promise<boolean> {
  try {
    if (alertRecipients().length === 0) return false
    const svc = createServiceRoleClient()
    const cutoff = new Date(Date.now() - REALERT_BAD_MS).toISOString()
    const { data: claimed } = await svc
      .from('service_health')
      .update({ last_alerted_at: new Date().toISOString() })
      .eq('service', serviceKey)
      .or(`last_alerted_at.is.null,last_alerted_at.lt.${cutoff}`)
      .select('service, display_name, tier, status, balance_usd, last_error_msg, last_error_at, last_error_code, last_alerted_at, checked_at, updated_at')
    const row = (claimed as ServiceHealthRow[] | null)?.[0]
    if (!row) return false // someone else claimed within the window, or row missing
    await sendServiceAlert([row])
    return true
  } catch { /* alerting must never break the caller */ return false }
}
