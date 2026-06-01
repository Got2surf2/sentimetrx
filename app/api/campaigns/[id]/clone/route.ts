// app/api/campaigns/[id]/clone/route.ts
// POST — duplicate a campaign with all email templates and settings

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  const service = createServiceRoleClient()

  // Fetch original campaign (admin-org bypass on cross-org access).
  // Clone stays in the *original* campaign's org — admin cloning a customer's
  // campaign produces a copy in that customer's org, not the admin's.
  const { data: original } = await service
    .from('campaigns')
    .select('*')
    .eq('id', params.id)
    .single()

  if (!original || (!isAdmin && original.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const includeRecipients = body.include_recipients === true

  // Create the clone
  const { data: clone, error: cloneError } = await service
    .from('campaigns')
    .insert({
      org_id: original.org_id,
      study_id: original.study_id,
      name: (body.name || original.name + ' (copy)').trim(),
      status: 'draft',
      study_url: original.study_url,
      hidden_fields: original.hidden_fields,
      target_responses: original.target_responses,
      email_provider: original.email_provider,
      email_config: original.email_config,
      send_thank_you: original.send_thank_you,
      send_incomplete: original.send_incomplete,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (cloneError || !clone) {
    return NextResponse.json({ error: cloneError?.message || 'Failed to clone' }, { status: 500 })
  }

  // Clone email templates
  const { data: emails } = await service
    .from('campaign_emails')
    .select('*')
    .eq('campaign_id', params.id)
    .order('sequence', { ascending: true })

  if (emails && emails.length > 0) {
    const emailClones = emails.map(e => ({
      campaign_id: clone.id,
      sequence: e.sequence,
      subject: e.subject,
      body_html: e.body_html,
      body_text: e.body_text,
      send_delay_hours: e.send_delay_hours,
      send_time: e.send_time,
      send_timezone: e.send_timezone,
      send_to: e.send_to,
      is_thank_you: e.is_thank_you,
    }))

    await service.from('campaign_emails').insert(emailClones)
  }

  // Optionally clone recipients (without status — all start as pending)
  if (includeRecipients) {
    const { data: respondents } = await service
      .from('campaign_respondents')
      .select('email, fields')
      .eq('campaign_id', params.id)

    if (respondents && respondents.length > 0) {
      const generateGuid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      const respondentClones = respondents.map(r => ({
        campaign_id: clone.id,
        email: r.email,
        fields: r.fields,
        status: 'pending',
        recipient_guid: generateGuid(),
      }))

      // Insert in batches of 500
      for (let i = 0; i < respondentClones.length; i += 500) {
        await service.from('campaign_respondents').insert(respondentClones.slice(i, i + 500))
      }
    }
  }

  return NextResponse.json({ id: clone.id }, { status: 201 })
}
