// app/api/campaigns/[id]/route.ts
// GET    — fetch campaign details
// PATCH  — update campaign
// DELETE — delete campaign

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('campaigns')
    .select('*, studies(name, status, guid, slug, config)')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  return NextResponse.json({
    ...data,
    study_name: data.studies?.name,
    study_status: data.studies?.status,
    study_guid: data.studies?.guid,
    study_slug: data.studies?.slug,
    study_config: data.studies?.config,
    studies: undefined,
  })
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const allowed = ['name', 'status', 'target_responses', 'email_provider', 'email_config', 'send_thank_you', 'send_incomplete', 'study_url', 'hidden_fields']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', params.id)

  if (error) return serverError(error, 'campaigns.update')
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', params.id)

  if (error) return serverError(error, 'campaigns.delete')
  return NextResponse.json({ ok: true })
}
