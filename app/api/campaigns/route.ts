// app/api/campaigns/route.ts
// GET  — list campaigns for the current user's org
// POST — create a new campaign

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { recordUserEvent, eventContextFromRequest } from '@/lib/userEvents'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const studyId = req.nextUrl.searchParams.get('study_id')

  let query = supabase
    .from('campaigns')
    .select('*, studies(name, status)')
    .order('created_at', { ascending: false })

  if (studyId) query = query.eq('study_id', studyId)

  const { data, error } = await query
  if (error) return serverError(error, 'campaigns.list')

  const campaigns = (data || []).map((c: any) => ({
    ...c,
    study_name: c.studies?.name,
    study_status: c.studies?.status,
    studies: undefined,
  }))

  return NextResponse.json(campaigns)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) return NextResponse.json({ error: 'No organization' }, { status: 400 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, study_id, study_url, hidden_fields, target_responses, email_provider, email_config } = body
  if (!name || !study_id || !study_url) {
    return NextResponse.json({ error: 'Missing required fields: name, study_id, study_url' }, { status: 400 })
  }

  // Verify study belongs to this org
  const { data: study } = await supabase
    .from('studies')
    .select('id, org_id')
    .eq('id', study_id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      org_id: userData.org_id,
      study_id,
      name,
      study_url,
      hidden_fields: hidden_fields || [],
      target_responses: target_responses || null,
      email_provider: email_provider || 'resend',
      email_config: email_config || {},
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return serverError(error, 'campaigns.create', { orgId: userData.org_id })

  const { ip, userAgent } = eventContextFromRequest(req)
  await recordUserEvent({
    userId: user.id, orgId: userData.org_id, event: 'campaign_created',
    metadata: { campaign_id: data.id, study_id, name },
    ip, userAgent,
  })

  return NextResponse.json(data, { status: 201 })
}
