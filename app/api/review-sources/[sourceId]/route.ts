// app/api/review-sources/[sourceId]/route.ts
// GET    — source detail with locations
// PATCH  — update status, sync frequency
// DELETE — delete source (dataset cascades via FK)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { sourceId: string } }

async function resolveOrg(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401, user: null, orgId: null }
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()
  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) return { error: 'Analyze module not enabled', status: 403, user: null, orgId: null }
  const orgId = userData?.org_id
  if (!orgId) return { error: 'Org not found', status: 403, user: null, orgId: null }
  return { error: null, status: 200, user, orgId }
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const auth = await resolveOrg(supabase)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const service = createServiceRoleClient()

    const { data: source, error } = await service
      .from('review_sources')
      .select('*')
      .eq('id', params.sourceId)
      .eq('org_id', auth.orgId!)
      .single()

    if (error || !source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: locations } = await service
      .from('review_source_locations')
      .select('*')
      .eq('review_source_id', source.id)
      .order('state', { ascending: true })
      .order('city', { ascending: true })

    return NextResponse.json({ source, locations: locations || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const auth = await resolveOrg(supabase)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const service = createServiceRoleClient()

    // Verify ownership
    const { data: source } = await service
      .from('review_sources')
      .select('id')
      .eq('id', params.sourceId)
      .eq('org_id', auth.orgId!)
      .single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await req.json()
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.status && ['active', 'paused'].includes(body.status)) updates.status = body.status
    if (body.sync_frequency_hours && typeof body.sync_frequency_hours === 'number') {
      updates.sync_frequency_hours = body.sync_frequency_hours
    }

    const { error } = await service
      .from('review_sources')
      .update(updates)
      .eq('id', params.sourceId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const auth = await resolveOrg(supabase)
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const service = createServiceRoleClient()

    const { data: source } = await service
      .from('review_sources')
      .select('id, dataset_id')
      .eq('id', params.sourceId)
      .eq('org_id', auth.orgId!)
      .single()
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Delete source (locations cascade via FK)
    await service.from('review_sources').delete().eq('id', params.sourceId)

    // Also delete the linked dataset if it exists
    if (source.dataset_id) {
      await service.from('dataset_rows_flat').delete().eq('dataset_id', source.dataset_id)
      await service.from('dataset_rows').delete().eq('dataset_id', source.dataset_id)
      await service.from('dataset_state').delete().eq('dataset_id', source.dataset_id)
      await service.from('datasets').delete().eq('id', source.dataset_id)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed' }, { status: 500 })
  }
}
