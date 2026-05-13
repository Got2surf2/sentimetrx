import 'server-only'

export interface InviteEmailParams {
  orgName:        string
  inviterName?:   string
  inviterEmail?:  string
  role:           string
  inviteUrl:      string
  expiresAt:      string
  customMessage?: string  // optional plain-text note from the inviter; rendered as a quoted block above the CTA
}

export interface InviteEmailContent {
  subject: string
  html:    string
  text:    string
}

const ORANGE = '#E8632A'
const TEAL   = '#0F7173'
const TEXT   = '#1f2937'
const MUTED  = '#6b7280'
const BG     = '#f5f5f4'
const CARD   = '#ffffff'
const BORDER = '#e5e7eb'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function buildInviteEmail(p: InviteEmailParams): InviteEmailContent {
  const inviterLabel = p.inviterName?.trim() || p.inviterEmail || 'A teammate'
  const orgName      = p.orgName || 'their organization'
  const subject      = `${inviterLabel} invited you to ${orgName} on Sentimetrx`
  const expiry       = formatExpiry(p.expiresAt)

  const eOrg     = escapeHtml(orgName)
  const eInviter = escapeHtml(inviterLabel)
  const eRole    = escapeHtml(p.role)
  const eUrl     = escapeHtml(p.inviteUrl)
  const eExpiry  = escapeHtml(expiry)

  // Custom message block: rendered as a quoted paragraph between the
  // body line and the CTA button. Plain-text input only — line breaks
  // are preserved with <br>, but HTML is escaped so an inviter can't
  // inject markup.
  const trimmedMsg = (p.customMessage || '').trim()
  const eMsgHtml = trimmedMsg
    ? `<tr>
          <td style="padding:0 40px 8px 40px;">
            <div style="border-left:3px solid ${ORANGE};padding:10px 14px;background-color:#fff7f1;border-radius:0 6px 6px 0;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:.06em;">Note from ${eInviter}</p>
              <p style="margin:0;font-size:14px;line-height:1.55;color:${TEXT};">${escapeHtml(trimmedMsg).replace(/\n/g, '<br>')}</p>
            </div>
          </td>
        </tr>`
    : ''
  const eMsgText = trimmedMsg ? `\nNote from ${inviterLabel}:\n${trimmedMsg}\n` : ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${eInviter} invited you to join ${eOrg} on Sentimetrx. Accept by ${eExpiry}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${CARD};border-radius:12px;border:1px solid ${BORDER};overflow:hidden;">
        <tr>
          <td style="background-color:${ORANGE};height:6px;line-height:6px;font-size:0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:12px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="width:36px;height:36px;background-color:${ORANGE};border-radius:50%;text-align:center;vertical-align:middle;color:#ffffff;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">S</td>
                    </tr>
                  </table>
                </td>
                <td style="vertical-align:middle;font-size:18px;font-weight:600;color:${TEXT};letter-spacing:-0.01em;">Sentimetrx</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px 8px 40px;">
            <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;line-height:1.3;color:${TEXT};letter-spacing:-0.01em;">You've been invited to ${eOrg}</h1>
            <p style="margin:0;font-size:15px;line-height:1.6;color:${TEXT};">
              ${eInviter} invited you to join <strong>${eOrg}</strong> on Sentimetrx as a <strong>${eRole}</strong>.
            </p>
          </td>
        </tr>
        ${eMsgHtml}
        <tr>
          <td style="padding:24px 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background-color:${ORANGE};border-radius:8px;">
                  <a href="${eUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Accept invitation</a>
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
        </tr>
        <tr>
          <td style="padding:0 40px 28px 40px;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">
              This invitation expires on <strong style="color:${TEXT};">${eExpiry}</strong>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background-color:#fafafa;padding:20px 40px;border-top:1px solid ${BORDER};">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
              Sentimetrx is a Datanautix product. If you weren't expecting this invitation, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="padding:16px 8px;text-align:center;">
            <p style="margin:0;font-size:11px;color:${MUTED};">
              Sent by Datanautix &middot; <a href="https://www.datanautix.com" style="color:${MUTED};text-decoration:underline;">datanautix.com</a>
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
    `${inviterLabel} invited you to join ${orgName} on Sentimetrx as a ${p.role}.`,
    eMsgText,
    `Accept the invitation:`,
    p.inviteUrl,
    ``,
    `This invitation expires on ${expiry}.`,
    ``,
    `Sentimetrx is a Datanautix product. If you weren't expecting this invitation, you can safely ignore this email.`,
  ].filter(Boolean).join('\n')

  return { subject, html, text }
}
