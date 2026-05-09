// app/api/cron/campaign-scheduler/route.ts
// Cron endpoint: processes pending campaign schedules and sends emails.
// Call every 15 minutes via Vercel Cron or external scheduler.
//
// vercel.json config:
// { "crons": [{ "path": "/api/cron/campaign-scheduler", "schedule": "*/15 * * * *" }] }

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getEmailProvider, interpolateTemplate, buildSurveyUrl } from '@/lib/email/provider'
import type { EmailProviderType } from '@/lib/types'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for batch sends

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()
  const now = new Date()

  // Find pending schedules that are due
  const { data: pendingSchedules } = await service
    .from('campaign_schedules')
    .select('*, campaign_emails(*), campaigns(*, studies(name, guid, slug))')
    .eq('status', 'pending')
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(10) // Process max 10 per run to avoid timeout

  if (!pendingSchedules || pendingSchedules.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 })
  }

  let totalSent = 0
  let totalFailed = 0

  for (const schedule of pendingSchedules) {
    // Mark as processing
    await service
      .from('campaign_schedules')
      .update({ status: 'processing' })
      .eq('id', schedule.id)

    const campaign = schedule.campaigns
    const emailTemplate = schedule.campaign_emails
    if (!campaign || !emailTemplate) {
      await service.from('campaign_schedules').update({ status: 'failed' }).eq('id', schedule.id)
      continue
    }

    // Check if campaign is still active
    if (campaign.status !== 'active') {
      await service.from('campaign_schedules').update({ status: 'cancelled' }).eq('id', schedule.id)
      continue
    }

    // Get target respondents
    let respondentQuery = service
      .from('campaign_respondents')
      .select('*')
      .eq('campaign_id', campaign.id)

    if (emailTemplate.send_to === 'non_responders') {
      respondentQuery = respondentQuery.in('status', ['sent', 'opened', 'clicked'])
    } else if (emailTemplate.send_to === 'incompletes') {
      respondentQuery = respondentQuery.in('status', ['clicked'])
    } else {
      respondentQuery = respondentQuery.eq('status', 'pending')
    }

    const { data: respondents } = await respondentQuery
    if (!respondents || respondents.length === 0) {
      await service.from('campaign_schedules').update({ status: 'completed', executed_at: now.toISOString() }).eq('id', schedule.id)
      continue
    }

    // Send emails
    const provider = getEmailProvider(
      campaign.email_provider as EmailProviderType,
      campaign.email_config || {}
    )
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    const unsubscribeBase = baseUrl + '/api/campaigns/unsubscribe/'

    let sent = 0
    let failed = 0

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

      try {
        const result = await provider.send({ to: respondent.email, subject, html })

        await service.from('campaign_send_log').insert({
          campaign_id: campaign.id,
          respondent_id: respondent.id,
          email_id: emailTemplate.id,
          provider: campaign.email_provider,
          provider_msg_id: result.messageId,
          status: 'sent',
          sent_at: now.toISOString(),
          schedule_id: schedule.id,
        })

        // Update respondent status (don't downgrade)
        if (respondent.status === 'pending') {
          await service.from('campaign_respondents')
            .update({ status: 'sent', sent_at: now.toISOString() })
            .eq('id', respondent.id)
        }

        sent++
      } catch (err: any) {
        await service.from('campaign_send_log').insert({
          campaign_id: campaign.id,
          respondent_id: respondent.id,
          email_id: emailTemplate.id,
          provider: campaign.email_provider,
          status: 'failed',
          error_message: err.message || 'Unknown error',
          schedule_id: schedule.id,
        })
        failed++
      }
    }

    totalSent += sent
    totalFailed += failed

    await service
      .from('campaign_schedules')
      .update({ status: 'completed', executed_at: now.toISOString() })
      .eq('id', schedule.id)
  }

  return NextResponse.json({
    ok: true,
    processed: pendingSchedules.length,
    sent: totalSent,
    failed: totalFailed,
  })
}
