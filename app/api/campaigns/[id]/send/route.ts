// app/api/campaigns/[id]/send/route.ts
// POST — send campaign emails to respondents
// Sends the initial email (sequence 0) to all pending respondents

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getEmailProvider, interpolateTemplate, buildSurveyUrl, getSMSProvider, buildSMSBody } from '@/lib/email/provider'
import type { EmailProviderType, CampaignChannel } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role for all campaign data reads (bypasses RLS)
  const service = createServiceRoleClient()

  // Fetch campaign with study info
  const { data: campaign } = await service
    .from('campaigns')
    .select('*, studies(name, guid, slug)')
    .eq('id', params.id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  if (campaign.status === 'completed') {
    return NextResponse.json({ error: 'Campaign is already completed' }, { status: 400 })
  }

  // Get the email template to send
  let body: any = {}
  try { body = await req.json() } catch { /* no body needed for initial send */ }
  const emailSequence = body.sequence ?? 0

  const { data: emailTemplate } = await service
    .from('campaign_emails')
    .select('*')
    .eq('campaign_id', params.id)
    .eq('sequence', emailSequence)
    .single()

  if (!emailTemplate) {
    return NextResponse.json({ error: 'No email template found for sequence ' + emailSequence }, { status: 404 })
  }

  // Get target respondents based on send_to setting
  let respondentQuery = service
    .from('campaign_respondents')
    .select('*')
    .eq('campaign_id', params.id)

  if (emailTemplate.send_to === 'non_responders') {
    // Reminders: send to those who received but haven't completed
    respondentQuery = respondentQuery.in('status', ['sent', 'opened', 'clicked'])
  } else if (emailTemplate.send_to === 'incompletes') {
    respondentQuery = respondentQuery.in('status', ['clicked'])
  } else {
    // 'all' for initial send: only send to those not yet emailed (pending)
    // This prevents duplicate sends to recipients who already received the email
    respondentQuery = respondentQuery.eq('status', 'pending')
  }

  const { data: respondents } = await respondentQuery
  if (!respondents || respondents.length === 0) {
    return NextResponse.json({ error: 'No eligible respondents', sent: 0 }, { status: 200 })
  }

  // Set up providers
  const channel: CampaignChannel = campaign.channel || 'email'
  const provider = getEmailProvider(
    campaign.email_provider as EmailProviderType,
    campaign.email_config || {}
  )
  const smsProvider = (channel === 'sms' || channel === 'both')
    ? getSMSProvider(campaign.sms_config || {})
    : null

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const unsubscribeBase = baseUrl + '/api/campaigns/unsubscribe/'

  let sentCount = 0
  let failCount = 0
  const errors: { email: string; error: string }[] = []

  // Update campaign status to active
  if (campaign.status === 'draft' || campaign.status === 'scheduled') {
    await service.from('campaigns').update({ status: 'active' }).eq('id', params.id)
  }

  // Send emails in batches
  for (const respondent of respondents) {
    const surveyUrl = buildSurveyUrl(campaign.study_url, respondent, campaign.hidden_fields)
    const unsubscribeUrl = unsubscribeBase + respondent.unsubscribe_token

    const extras = {
      survey_link: surveyUrl,
      unsubscribe_link: unsubscribeUrl,
      study_name: campaign.studies?.name || '',
      campaign_name: campaign.name,
    }

    const subject = interpolateTemplate(emailTemplate.subject, respondent, extras)
    const html = interpolateTemplate(emailTemplate.body_html, respondent, extras)
      + `<p style="font-size:11px;color:#9ca3af;margin-top:32px"><a href="${unsubscribeUrl}" style="color:#9ca3af">Unsubscribe</a></p>`
    const text = emailTemplate.body_text
      ? interpolateTemplate(emailTemplate.body_text, respondent, extras) + '\n\nUnsubscribe: ' + unsubscribeUrl
      : undefined

    try {
      // Send email (unless SMS-only channel)
      let result = { messageId: '' }
      if (channel !== 'sms') {
        result = await provider.send({ to: respondent.email, subject, html, text })
      }

      // Send SMS if configured
      if (smsProvider && respondent.phone) {
        const smsBody = emailTemplate.sms_body
          ? buildSMSBody(emailTemplate.sms_body, respondent, extras)
          : `${campaign.name}: We'd love your feedback! Take our survey: ${surveyUrl}`
        try {
          await smsProvider.send({ to: respondent.phone, body: smsBody })
        } catch (smsErr: any) {
          console.error('SMS send failed for', respondent.phone, smsErr.message)
        }
      }

      // Use email result (or generate ID for SMS-only)
      if (!result.messageId && channel === 'sms') {
        result = { messageId: 'sms_' + Date.now().toString(36) }
      }

      // Log the send
      await service.from('campaign_send_log').insert({
        campaign_id: params.id,
        respondent_id: respondent.id,
        email_id: emailTemplate.id,
        provider: campaign.email_provider,
        provider_msg_id: result.messageId,
        status: 'sent',
        sent_at: new Date().toISOString(),
      })

      // Update respondent status
      await service.from('campaign_respondents')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', respondent.id)
        .in('status', ['pending']) // don't downgrade status

      sentCount++
    } catch (err: any) {
      failCount++
      errors.push({ email: respondent.email, error: err.message || 'Unknown error' })

      await service.from('campaign_send_log').insert({
        campaign_id: params.id,
        respondent_id: respondent.id,
        email_id: emailTemplate.id,
        provider: campaign.email_provider,
        status: 'failed',
        error_message: err.message || 'Unknown error',
      })
    }
  }

  // Auto-schedule reminder emails if this was the initial send (sequence 0)
  if (emailSequence === 0 && sentCount > 0) {
    try {
      const { data: reminderEmails } = await service
        .from('campaign_emails')
        .select('id, sequence, send_delay_hours, send_time, send_timezone')
        .eq('campaign_id', params.id)
        .gt('sequence', 0)
        .order('sequence', { ascending: true })

      for (const reminder of (reminderEmails || [])) {
        const delayMs = (reminder.send_delay_hours || 72) * 3600 * 1000
        let scheduledAt = new Date(Date.now() + delayMs)

        // If send_time is set, adjust to that time of day
        if (reminder.send_time) {
          const [hours, minutes] = reminder.send_time.split(':').map(Number)
          scheduledAt.setHours(hours, minutes, 0, 0)
          // If the calculated time is in the past, push to next day
          if (scheduledAt.getTime() < Date.now()) {
            scheduledAt.setDate(scheduledAt.getDate() + 1)
          }
        }

        // Check if schedule already exists for this email
        const { data: existing } = await service
          .from('campaign_schedules')
          .select('id')
          .eq('campaign_id', params.id)
          .eq('email_id', reminder.id)
          .in('status', ['pending', 'processing'])
          .limit(1)

        if (!existing || existing.length === 0) {
          await service.from('campaign_schedules').insert({
            campaign_id: params.id,
            email_id: reminder.id,
            scheduled_at: scheduledAt.toISOString(),
            status: 'pending',
          })
        }
      }
    } catch (err) {
      console.error('Failed to schedule reminders:', err)
    }
  }

  return NextResponse.json({
    sent: sentCount,
    failed: failCount,
    errors: errors.slice(0, 10),
  })
}
