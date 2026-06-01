// app/api/campaigns/[id]/test-send/route.ts
// POST — send a test email to the current user

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getEmailProvider, interpolateTemplate } from '@/lib/email/provider'
import type { EmailProviderType } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*, studies(name)')
    .eq('id', params.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const sequence = body.sequence ?? 0
  const { data: emailTemplate } = await supabase
    .from('campaign_emails')
    .select('*')
    .eq('campaign_id', params.id)
    .eq('sequence', sequence)
    .single()

  if (!emailTemplate) {
    return NextResponse.json({ error: 'No email template found for sequence ' + sequence }, { status: 404 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const sampleRespondent = {
    email: user.email!,
    fields: { first_name: 'Test', last_name: 'User', company: 'SentimetrX' },
  }
  const extras = {
    survey_link: campaign.study_url,
    unsubscribe_link: baseUrl + '/api/campaigns/unsubscribe/test-preview',
    study_name: campaign.studies?.name || '',
    campaign_name: campaign.name,
  }

  const subject = '[TEST] ' + interpolateTemplate(emailTemplate.subject, sampleRespondent, extras)
  const html = interpolateTemplate(emailTemplate.body_html, sampleRespondent, extras)

  const provider = getEmailProvider(
    campaign.email_provider as EmailProviderType,
    campaign.email_config || {}
  )

  try {
    await provider.send({ to: user.email!, subject, html })
    return NextResponse.json({ ok: true, sent_to: user.email })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to send test email' }, { status: 500 })
  }
}
