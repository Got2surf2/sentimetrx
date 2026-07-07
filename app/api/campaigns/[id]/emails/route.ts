// app/api/campaigns/[id]/emails/route.ts
// GET  — list email templates for a campaign
// POST — create a new email template

import { createClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

interface EmailCreateBody {
  sequence?: number
  subject?: string
  body_html?: string
  body_text?: string
  send_delay_hours?: number
  send_to?: string
  is_thank_you?: boolean
}

interface EmailPatchBody {
  email_id?: string
  [key: string]: unknown
}

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('campaign_emails')
    .select('*')
    .eq('campaign_id', params.id)
    .order('sequence', { ascending: true })

  if (error) return serverError(error, 'campaigns.emails.list')
  return NextResponse.json(data || [])
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify campaign access
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id')
    .eq('id', params.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  let body: EmailCreateBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { sequence, subject, body_html, body_text, send_delay_hours, send_to, is_thank_you } = body
  if (!subject || !body_html) {
    return NextResponse.json({ error: 'subject and body_html are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('campaign_emails')
    .insert({
      campaign_id: params.id,
      sequence: sequence ?? 0,
      subject,
      body_html,
      body_text: body_text || null,
      send_delay_hours: send_delay_hours ?? 0,
      send_to: send_to || 'all',
      is_thank_you: is_thank_you || false,
    })
    .select('id, sequence')
    .single()

  if (error) return serverError(error, 'campaigns.emails.create')
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: EmailPatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { email_id, ...updates } = body
  if (!email_id) return NextResponse.json({ error: 'email_id is required' }, { status: 400 })

  const allowed = ['subject', 'body_html', 'body_text', 'send_delay_hours', 'send_time', 'send_timezone', 'send_to', 'is_thank_you', 'sequence']
  const filtered: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in updates) filtered[key] = updates[key]
  }

  const { error } = await supabase
    .from('campaign_emails')
    .update(filtered)
    .eq('id', email_id)
    .eq('campaign_id', params.id)

  if (error) return serverError(error, 'campaigns.emails.update')
  return NextResponse.json({ ok: true })
}
