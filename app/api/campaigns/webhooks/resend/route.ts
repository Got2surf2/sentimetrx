// app/api/campaigns/webhooks/resend/route.ts
// Receives delivery events from Resend (open, click, bounce, etc.)
// and updates campaign_respondent + campaign_send_log status.
//
// Configure in Resend dashboard: https://resend.com/webhooks
// Endpoint URL: https://your-domain/api/campaigns/webhooks/resend
// Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained
//
// Auth: Resend signs every webhook via Svix. We verify the signature
// against RESEND_WEBHOOK_SECRET before trusting any field on the payload.
// Without this check anyone could mark any respondent as opened/bounced.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'

export const dynamic = 'force-dynamic'

// Resend webhook event types we handle
type ResendEventType =
  | 'email.sent'
  | 'email.delivered'
  | 'email.opened'
  | 'email.clicked'
  | 'email.bounced'
  | 'email.complained'

interface ResendWebhookPayload {
  type: ResendEventType
  data: {
    email_id: string    // Resend message ID
    to: string[]
    created_at: string
  }
}

// Map Resend events to our respondent status
const EVENT_TO_STATUS: Record<string, string> = {
  'email.delivered': 'sent',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'bounced',
}

// Status hierarchy — only upgrade, never downgrade
const STATUS_RANK: Record<string, number> = {
  pending: 0, sent: 1, opened: 2, clicked: 3, completed: 4, bounced: 5, unsubscribed: 6,
}

// Reject events older than 5 minutes — protects against replay of
// old captured webhooks even if the secret leaked briefly.
const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000

// Validates a Svix-style signed webhook (used by Resend). The secret in the
// dashboard is `whsec_<base64>`; we strip the prefix and decode. Returns
// true only when at least one of the v1 signatures matches in constant time.
function verifySvixSignature(secret: string, id: string, timestamp: string, body: string, signatureHeader: string): boolean {
  const cleaned = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let secretBytes: Buffer
  try { secretBytes = Buffer.from(cleaned, 'base64') } catch { return false }
  if (secretBytes.length === 0) return false

  const expected = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest()

  // Header looks like "v1,abc123 v1,def456" — any matching v1 sig wins.
  const parts = signatureHeader.split(' ')
  for (const part of parts) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    let provided: Buffer
    try { provided = Buffer.from(sig, 'base64') } catch { continue }
    if (provided.length !== expected.length) continue
    if (timingSafeEqual(provided, expected)) return true
  }
  return false
}

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('[resend/webhook] RESEND_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 })
  }

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 })
  }

  // Reject events whose timestamp is too far from now (replay protection).
  const tsMs = Number(svixTimestamp) * 1000
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > MAX_TIMESTAMP_SKEW_MS) {
    return NextResponse.json({ error: 'Timestamp skew too large' }, { status: 401 })
  }

  // Read the raw body once; we need it for signature verification before parsing.
  const rawBody = await req.text()
  if (!verifySvixSignature(secret, svixId, svixTimestamp, rawBody, svixSignature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: ResendWebhookPayload
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, data } = body
  if (!type || !data?.email_id) {
    return NextResponse.json({ error: 'Missing type or email_id' }, { status: 400 })
  }

  const newStatus = EVENT_TO_STATUS[type]
  if (!newStatus) {
    // Event type we don't handle — acknowledge silently
    return NextResponse.json({ ok: true, ignored: true })
  }

  const service = createServiceRoleClient()
  const providerMsgId = data.email_id
  const eventTime = data.created_at || new Date().toISOString()

  // Find the send log entry by provider message ID
  const { data: logEntry } = await service
    .from('campaign_send_log')
    .select('id, campaign_id, respondent_id, status')
    .eq('provider_msg_id', providerMsgId)
    .limit(1)
    .single()

  if (!logEntry) {
    // Unknown message ID — might be from a non-campaign email
    return NextResponse.json({ ok: true, no_match: true })
  }

  // Update send log status
  await service
    .from('campaign_send_log')
    .update({ status: newStatus })
    .eq('id', logEntry.id)

  // Update respondent status — only upgrade, never downgrade
  // (except bounced which always applies)
  const { data: respondent } = await service
    .from('campaign_respondents')
    .select('id, status')
    .eq('id', logEntry.respondent_id)
    .single()

  if (respondent) {
    const currentRank = STATUS_RANK[respondent.status] ?? 0
    const newRank = STATUS_RANK[newStatus] ?? 0

    // Upgrade status (or set bounced regardless)
    if (newStatus === 'bounced' || (newRank > currentRank && respondent.status !== 'completed')) {
      const updates: Record<string, unknown> = { status: newStatus }
      if (newStatus === 'opened') updates.opened_at = eventTime
      if (newStatus === 'clicked') updates.clicked_at = eventTime

      await service
        .from('campaign_respondents')
        .update(updates)
        .eq('id', respondent.id)
    }
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
