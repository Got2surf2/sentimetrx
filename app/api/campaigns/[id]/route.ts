// app/api/campaigns/[id]/route.ts
// GET    — fetch campaign details
// PATCH  — update campaign
// DELETE — delete campaign

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
