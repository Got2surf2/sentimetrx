// app/api/campaigns/webhooks/resend/route.ts
// Receives delivery events from Resend (open, click, bounce, etc.)
// and updates campaign_respondent + campaign_send_log status.
//
// Configure in Resend dashboard: https://resend.com/webhooks
// Endpoint URL: https://your-domain/api/campaigns/webhooks/resend
// Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

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

export async function POST(req: NextRequest) {
  let body: ResendWebhookPayload
  try {
    body = await req.json()
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
