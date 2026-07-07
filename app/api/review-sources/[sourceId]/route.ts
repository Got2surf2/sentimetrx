// app/api/review-sources/[sourceId]/route.ts
// GET    — source detail with locations
// PATCH  — update status, sync frequency
// DELETE — delete source (dataset cascades via FK)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ sourceId: string }> }

interface OrgRow {
  features?: { analyze?: boolean } | null
  is_admin_org?: boolean | null
}

async function resolveOrg(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return { error: 'Unauthorized', status: 401, user: null, orgId: null }
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()
  const rawOrg  = userData?.organizations as OrgRow | OrgRow[] | null | undefined
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg
  if (!orgData?.features?.analyze) return { error: 'Analyze module not enabled', status: 403, user: null, orgId: null }
  const orgId = userData?.org_id
  if (!orgId) return { error: 'Org not found', status: 403, user: null, orgId: null }
  return { error: null, status: 200, user, orgId }
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
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

    // Get filtered dataset row count (after date range filtering)
    let datasetRowCount = 0
    if (source.dataset_id) {
      const { data: ds } = await service
        .from('datasets').select('row_count').eq('id', source.dataset_id).single()
      datasetRowCount = ds?.row_count || 0
    }

    return NextResponse.json({ source, locations: locations || [], datasetRowCount })
  } catch (err: unknown) {
    return serverError(err, 'reviewSources.detail')
  }
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
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
    // sync_frequency_hours: positive int = auto-sync every N hours.
    // Zero = manual mode (no auto-sync); user must click Sync explicitly.
    // Was previously gated on truthiness, which rejected 0 (manual).
    if (typeof body.sync_frequency_hours === 'number' && body.sync_frequency_hours >= 0) {
      updates.sync_frequency_hours = Math.floor(body.sync_frequency_hours)
      // When switching to manual, push next_sync_at far out so the cron
      // never picks the source up. When switching back to auto, reset to
      // "now" so the next cron run re-engages.
      if (body.sync_frequency_hours === 0) {
        updates.next_sync_at = new Date('2999-01-01').toISOString()
      } else {
        updates.next_sync_at = new Date().toISOString()
      }
    }

    const { error } = await service
      .from('review_sources')
      .update(updates)
      .eq('id', params.sourceId)
    if (error) return serverError(error, 'reviewSources.update', { orgId: auth.orgId })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return serverError(err, 'reviewSources.update')
  }
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  try {
    const supabase = await createClient()
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
  } catch (err: unknown) {
    return serverError(err, 'reviewSources.delete')
  }
}
