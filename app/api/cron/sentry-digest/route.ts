// app/api/cron/sentry-digest/route.ts
// Daily Sentry snapshot. Fetches the current unresolved-issues list,
// writes one row to sentry_snapshots, and emails an alert when there
// are NEW issues compared to the previous snapshot. Trend over time
// visible on /admin/sentry.
//
// Scheduled by vercel.json: 0 13 * * *  (13:00 UTC ≈ 9:00 ET).
// Set SENTRY_ALERT_TO=email1@x.com,email2@x.com to receive alerts.
// No SENTRY_ALERT_TO → cron still writes snapshots, just doesn't email.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { serverError } from '@/lib/apiError'
import { fetchUnresolvedIssues, type SentryIssue } from '@/lib/sentry'
import { getEmailProvider } from '@/lib/email/provider'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const FROM = 'Sentimetrx Alerts <alerts@sentimetrx.ai>'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function buildAlertEmail(newIssues: SentryIssue[], stillUnresolved: SentryIssue[], totalCount: number) {
  const subject = `Sentry digest — ${newIssues.length} new, ${totalCount} total unresolved`

  const renderRow = (it: SentryIssue, isNew: boolean) => `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:10px 12px;vertical-align:top;">
        ${isNew ? '<span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;background:#fef3c7;color:#92400e;margin-right:4px;">NEW</span>' : ''}
        <span style="display:inline-block;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;background:#fee2e2;color:#b91c1c;text-transform:uppercase;">${escapeHtml(it.level)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#9ca3af;margin-left:4px;">${escapeHtml(it.shortId)}</span>
        <div style="font-weight:600;color:#1f2937;font-size:13px;margin-top:4px;">${escapeHtml(it.title)}</div>
        ${it.culprit ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${escapeHtml(it.culprit)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;text-align:right;vertical-align:top;white-space:nowrap;">
        <div style="font-weight:700;color:#1f2937;font-size:13px;">${it.count.toLocaleString()}</div>
        <div style="font-size:10px;color:#9ca3af;">events</div>
        ${it.userCount > 0 ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;">${it.userCount.toLocaleString()} users</div>` : ''}
        <div style="margin-top:6px;"><a href="${escapeHtml(it.permalink)}" style="font-size:11px;color:#0F7173;text-decoration:underline;">View in Sentry →</a></div>
      </td>
    </tr>`

  const tableRows =
    newIssues.slice(0, 10).map(it => renderRow(it, true)).join('') +
    stillUnresolved.slice(0, 10).map(it => renderRow(it, false)).join('')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background-color:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f4;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background-color:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;">
      <tr><td style="background-color:#E8632A;height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 32px 8px;">
        <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#1f2937;">Sentry digest</h1>
        <p style="margin:0;font-size:13px;color:#6b7280;">
          ${newIssues.length} new · ${totalCount} unresolved · captured ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
        </p>
      </td></tr>
      <tr><td style="padding:16px 32px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          ${tableRows || '<tr><td style="padding:16px;color:#6b7280;font-size:13px;text-align:center;">No issues to display.</td></tr>'}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 28px;">
        <a href="${baseUrl}/admin/sentry"
           style="display:inline-block;padding:12px 22px;background-color:#E8632A;color:#fff;text-decoration:none;font-size:13px;font-weight:600;border-radius:8px;">
          View full digest →
        </a>
      </td></tr>
      <tr><td style="background-color:#fafafa;padding:18px 32px;border-top:1px solid #e5e7eb;">
        <p style="margin:0;font-size:11px;line-height:1.5;color:#6b7280;">
          Sent daily by the Sentimetrx ops cron. Recipients configured via the SENTRY_ALERT_TO env var.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`

  const text = [
    `Sentry digest — ${newIssues.length} new, ${totalCount} unresolved`,
    '',
    ...newIssues.slice(0, 10).map(it => `[NEW] ${it.shortId} — ${it.title}\n  ${it.count} events, ${it.userCount} users\n  ${it.permalink}`),
    ...stillUnresolved.slice(0, 10).map(it => `${it.shortId} — ${it.title}\n  ${it.count} events, ${it.userCount} users\n  ${it.permalink}`),
    '',
    `Full digest: ${baseUrl}/admin/sentry`,
  ].join('\n')

  return { subject, html, text }
}

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const digest = await fetchUnresolvedIssues(50)
  const service = createServiceRoleClient()

  // Pull previous snapshot BEFORE inserting today's row — used to compute
  // the new-issue diff. First run after the table is created has no prev,
  // so every current issue is "new" (triggers a bootstrap alert).
  const { data: prev } = await service
    .from('sentry_snapshots')
    .select('captured_at, issues')
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await service.from('sentry_snapshots').insert({
    unresolved_count: digest.total,
    issues:           digest.issues,
    error:            digest.ok ? null : (digest.reason || 'unknown'),
  })
  if (error) {
    return serverError(error, 'cron.sentryDigest.insert')
  }

  // Diff new vs still-unresolved by issue id.
  const newIssues: SentryIssue[] = []
  const stillUnresolved: SentryIssue[] = []
  if (digest.ok && digest.issues.length > 0) {
    const prevIds = new Set<string>()
    const prevArr: Array<{ id?: unknown }> = Array.isArray(prev?.issues) ? (prev!.issues as Array<{ id?: unknown }>) : []
    for (const it of prevArr) if (it?.id) prevIds.add(String(it.id))
    for (const it of digest.issues) {
      if (prevIds.size === 0 || !prevIds.has(it.id)) newIssues.push(it)
      else stillUnresolved.push(it)
    }
  }

  // Email when there are NEW issues. Quiet days (count stable, nothing
  // new) don't produce email — operators want signal, not a daily noop.
  let emailed = false
  const recipients = (process.env.SENTRY_ALERT_TO || '').split(',').map(s => s.trim()).filter(Boolean)
  if (recipients.length > 0 && digest.ok && newIssues.length > 0) {
    try {
      const { subject, html, text } = buildAlertEmail(newIssues, stillUnresolved, digest.total)
      const provider = getEmailProvider('resend')
      await Promise.all(recipients.map(to => provider.send({ to, from: FROM, subject, html, text })))
      emailed = true
    } catch (e: unknown) {
      console.error({ at: 'cron/sentry-digest', msg: "email send failed", err: e instanceof Error ? e.message : e })
    }
  }

  return NextResponse.json({
    ok:               digest.ok,
    configured:       digest.configured,
    unresolved_count: digest.total,
    new_issues:       newIssues.length,
    still_unresolved: stillUnresolved.length,
    emailed,
    recipients:       recipients.length,
  })
}
