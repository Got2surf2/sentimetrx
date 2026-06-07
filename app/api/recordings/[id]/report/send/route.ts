// app/api/recordings/[id]/report/send/route.ts
//
// POST — "Send to principals": email the Town Hall report to a list of
// recipients (docs/RECORDINGS.md §4.15). The sender chooses what to include —
// the live /th share link, an attached PDF, or both. Datanautix-branded email
// (client report deliverable); reply-to is the sending user so principals reach
// a human.
//
// Owner (or admin-org) only — same gate as report sharing, since this publishes
// the report outside the org. Service-role reads pair id with org_id; a bare id
// lookup would be a cross-tenant leak. CSRF/same-origin enforced by proxy.ts.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getEmailProvider } from '@/lib/email/provider'
import { buildReportEmail } from '@/lib/recordings/reportEmail'
import { renderRecordingReportPdf } from '@/lib/recordings/reportPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const REPORT_FROM = 'Datanautix <reports@sentimetrx.ai>'
const MAX_RECIPIENTS = 25
const MAX_NOTE_LEN = 2000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Accepts an array or a comma/newline/semicolon-separated string; trims,
// lowercases, validates, dedupes, caps. Returns valid + rejected for feedback.
function parseRecipients(raw: unknown): { valid: string[]; rejected: string[] } {
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(/[\s,;]+/)
      : []
  const seen = new Set<string>()
  const valid: string[] = []
  const rejected: string[] = []
  for (const item of list) {
    const e = item.trim().toLowerCase()
    if (!e) continue
    if (seen.has(e)) continue
    seen.add(e)
    if (EMAIL_RE.test(e)) valid.push(e)
    else rejected.push(e)
  }
  return { valid: valid.slice(0, MAX_RECIPIENTS), rejected }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // THE gate: pair id with org_id; 404 (not 403) on cross-org.
  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, created_by, name, meeting_date, location, status, share_token, share_enabled, share_expires_at, analysis_summary, entity_map, source_duration_sec, analysis_org, analysts, objectives, confidentiality_class, signoff, analyzed_config_version')
    .eq('id', recording_id)
    .single()
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdmin && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Owner (or admin) only — sending publishes the report outside the org.
  if (!isAdmin && rec.created_by !== userId) {
    return NextResponse.json({ error: 'only the recording owner can send the report' }, { status: 403 })
  }

  if (rec.status !== 'complete') {
    return NextResponse.json({ error: 'Finish analysis before sending — the report is only available once the recording is complete.' }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const includeLink = body?.includeLink === true
  const includePdf = body?.includePdf === true
  const includeTranscript = body?.includeTranscript === true
  const note = typeof body?.note === 'string' ? body.note.slice(0, MAX_NOTE_LEN) : ''

  if (!includeLink && !includePdf) {
    return NextResponse.json({ error: 'Choose at least one of: include the report link, or attach the PDF.' }, { status: 400 })
  }

  const { valid: recipients, rejected } = parseRecipients(body?.recipients)
  if (recipients.length === 0) {
    return NextResponse.json({ error: rejected.length ? `No valid email addresses (couldn't parse: ${rejected.slice(0, 3).join(', ')}).` : 'Add at least one recipient email.' }, { status: 400 })
  }

  // Resolve the live share link if the sender wants it included.
  let shareUrl: string | null = null
  if (includeLink) {
    const expired = rec.share_expires_at != null && new Date(rec.share_expires_at).getTime() < Date.now()
    if (!rec.share_enabled || !rec.share_token || expired) {
      return NextResponse.json({ error: 'Enable the public link first (it must be on and unexpired) to include it.' }, { status: 400 })
    }
    const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai').replace(/\/$/, '')
    shareUrl = `${baseUrl}/th/${rec.share_token}`
  }

  // Render the PDF once and reuse the buffer across recipients.
  let attachments: { filename: string; content: string }[] | undefined
  if (includePdf) {
    try {
      const { buffer, fileName } = await renderRecordingReportPdf(service, rec, { includeTranscript })
      attachments = [{ filename: fileName, content: buffer.toString('base64') }]
    } catch (e: any) {
      console.error({ at: 'recording-report-send', msg: 'pdf render failed', err: e?.message })
      return NextResponse.json({ error: 'Could not generate the PDF attachment.' }, { status: 500 })
    }
  }

  // Sender identity → reply-to + email signature.
  const { data: sender } = await service.from('users').select('full_name, email').eq('id', userId).single()
  const senderEmail = (sender?.email as string | undefined) || undefined
  const senderName = (sender?.full_name as string | undefined) || undefined

  const { subject, html, text } = buildReportEmail({
    meetingName: rec.name,
    meetingDate: rec.meeting_date,
    location: rec.location,
    senderName,
    senderEmail,
    shareUrl,
    hasPdf: includePdf,
    note,
  })

  const provider = getEmailProvider('resend')
  const results: { email: string; status: 'sent' | 'failed'; error?: string }[] = []
  for (const to of recipients) {
    try {
      await provider.send({ to, from: REPORT_FROM, replyTo: senderEmail, subject, html, text, attachments })
      results.push({ email: to, status: 'sent' })
    } catch (e: any) {
      console.error({ at: 'recording-report-send', msg: 'send failed', to, err: e?.message })
      results.push({ email: to, status: 'failed', error: e?.message || 'send failed' })
    }
  }

  const sent = results.filter(r => r.status === 'sent').length
  const failed = results.length - sent
  return NextResponse.json({ ok: sent > 0, sent, failed, rejected, results })
}
