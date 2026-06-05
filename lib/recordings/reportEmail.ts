import 'server-only'

// lib/recordings/reportEmail.ts
//
// Builds the "Send to principals" email for a Town Hall recording report
// (docs/RECORDINGS.md §4.15). This is a client-facing report deliverable, so it
// carries the DATANAUTIX brand (wordmark "datanautix" — data teal + nautix
// orange — and a datanautix.com footer), NOT Sentimetrx. See CLAUDE.md's
// deck/report branding exception.
//
// The body adapts to what the sender chose to include: a live report link
// (button + CTA), an attached PDF (a "see the attachment" line — the PDF itself
// is attached by the route), or both. All user-supplied strings are escaped.

const TEAL   = '#0F7173'  // "data"
const ORANGE = '#E8632A'  // "nautix"
const TEXT   = '#1f2937'
const MUTED  = '#6b7280'
const BG     = '#f5f5f4'
const CARD   = '#ffffff'
const BORDER = '#e5e7eb'

export interface ReportEmailParams {
  meetingName:  string
  meetingDate?: string | null
  location?:    string | null
  senderName?:  string
  senderEmail?: string
  shareUrl?:    string | null  // present when the sender included the live link
  hasPdf:       boolean        // true when a PDF is attached (copy adapts)
  note?:        string         // optional plain-text message from the sender
}

export interface ReportEmailContent {
  subject: string
  html:    string
  text:    string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(iso: string): string {
  // meeting_date is a date-only column ("YYYY-MM-DD"); `new Date("YYYY-MM-DD")`
  // parses as UTC midnight, which renders a day early in negative-offset zones.
  // Build from local components so the printed date matches what was entered.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function buildReportEmail(p: ReportEmailParams): ReportEmailContent {
  const meeting    = p.meetingName?.trim() || 'the meeting'
  const senderLbl  = p.senderName?.trim() || p.senderEmail || 'Your meeting host'
  const subject    = `${meeting} — Q&A report`

  const metaParts = [
    p.meetingDate ? formatDate(p.meetingDate) : '',
    (p.location || '').trim(),
  ].filter(Boolean)
  const meta = metaParts.join(' · ')

  const eMeeting = escapeHtml(meeting)
  const eSender  = escapeHtml(senderLbl)
  const eMeta    = escapeHtml(meta)
  const eUrl     = p.shareUrl ? escapeHtml(p.shareUrl) : ''

  // Optional note from the sender — escaped, line breaks preserved.
  const trimmedMsg = (p.note || '').trim()
  const eMsgHtml = trimmedMsg
    ? `<tr>
          <td style="padding:0 40px 8px 40px;">
            <div style="border-left:3px solid ${ORANGE};padding:10px 14px;background-color:#fff7f1;border-radius:0 6px 6px 0;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:.06em;">Note from ${eSender}</p>
              <p style="margin:0;font-size:14px;line-height:1.55;color:${TEXT};">${escapeHtml(trimmedMsg).replace(/\n/g, '<br>')}</p>
            </div>
          </td>
        </tr>`
    : ''

  // Lead line adapts to what's included.
  const lead = p.shareUrl
    ? `The Q&amp;A summary from <strong>${eMeeting}</strong> is ready to read online${p.hasPdf ? ' — and a PDF copy is attached to this email' : ''}.`
    : `The Q&amp;A summary from <strong>${eMeeting}</strong> is attached to this email as a PDF.`

  const ctaHtml = p.shareUrl
    ? `<tr>
          <td style="padding:24px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background-color:${TEAL};border-radius:8px;">
                  <a href="${eUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">View the report &rarr;</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 40px 24px 40px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">
              Or paste this link into your browser:<br>
              <a href="${eUrl}" style="color:${TEAL};word-break:break-all;text-decoration:underline;">${eUrl}</a>
            </p>
          </td>
        </tr>`
    : `<tr>
          <td style="padding:16px 40px 24px 40px;">
            <p style="margin:0;font-size:14px;line-height:1.6;color:${TEXT};">
              📎 See the attached PDF for the full meeting overview and Q&amp;A by topic.
            </p>
          </td>
        </tr>`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Q&amp;A summary from ${eMeeting}${eMeta ? ' (' + eMeta + ')' : ''}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${CARD};border-radius:12px;border:1px solid ${BORDER};overflow:hidden;">
        <tr>
          <td style="background-color:${ORANGE};height:6px;line-height:6px;font-size:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:28px 40px 4px 40px;">
            <span style="font-size:20px;font-weight:700;letter-spacing:-0.02em;"><span style="color:${TEAL};">data</span><span style="color:${ORANGE};">nautix</span></span>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px 4px 40px;">
            <h1 style="margin:0 0 6px 0;font-size:22px;font-weight:600;line-height:1.3;color:${TEXT};letter-spacing:-0.01em;">Q&amp;A summary — ${eMeeting}</h1>
            ${eMeta ? `<p style="margin:0 0 8px 0;font-size:13px;color:${MUTED};">${eMeta}</p>` : ''}
            <p style="margin:8px 0 0 0;font-size:15px;line-height:1.6;color:${TEXT};">${lead}</p>
          </td>
        </tr>
        ${eMsgHtml}
        ${ctaHtml}
        <tr>
          <td style="background-color:#fafafa;padding:18px 40px;border-top:1px solid ${BORDER};">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
              Shared by ${eSender}. If you weren't expecting this, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:16px 8px;text-align:center;">
            <p style="margin:0;font-size:11px;color:${MUTED};">
              Delivered by Datanautix &middot; <a href="https://www.datanautix.com" style="color:${MUTED};text-decoration:underline;">datanautix.com</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`

  const text = [
    `Q&A summary — ${meeting}`,
    meta,
    '',
    p.shareUrl
      ? `The Q&A summary is ready to read online${p.hasPdf ? ' (a PDF copy is also attached)' : ''}:`
      : `The Q&A summary is attached to this email as a PDF.`,
    p.shareUrl ? p.shareUrl : '',
    trimmedMsg ? `\nNote from ${senderLbl}:\n${trimmedMsg}` : '',
    '',
    `Shared by ${senderLbl}.`,
    `Delivered by Datanautix · datanautix.com`,
  ].filter(s => s !== '').join('\n')

  return { subject, html, text }
}
