// app/api/datasets/[datasetId]/route.ts
// GET    -- dataset metadata + state
// PATCH  -- update name / description / visibility / status
// DELETE -- delete dataset (cascades rows + state)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { checkTransferTarget, recordOrgTransfer } from '@/lib/orgTransfer'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

async function getOrgAndCheck(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return { user: null, orgId: null, isAdmin: false, error: 'Unauthorized' }

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features, is_admin_org)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
  if (!orgData?.features?.analyze) return { user: null, orgId: null, isAdmin: false, error: 'Analyze module not enabled' }

  return { user, orgId: userData?.org_id as string, isAdmin: !!orgData?.is_admin_org, error: null }
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { user, orgId, isAdmin: _isAdmin, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  const { data, error: dbErr } = await supabase
    .from('datasets')
    .select('*, studies(name), dataset_state(*)')
    .eq('id', params.datasetId)
    .eq('org_id', orgId)
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 404 })

  const studyName = (data as any).studies?.name ?? null
  const state     = (data as any).dataset_state ?? null
  const { studies: _s, dataset_state: _ds, ...rest } = data as any

  return NextResponse.json({ dataset: { ...rest, study_name: studyName, state } })
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { user, orgId, isAdmin, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()

  // Confirm the dataset is in the caller's org before any service-role write.
  // Without this, a service-role .update().eq('id', x) lets any authed user
  // mutate (or transfer) any org's dataset.
  const { data: ownerRow } = await service.from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!ownerRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const datasetOrgId = (ownerRow as any).org_id as string | null
  if (!isAdmin && datasetOrgId !== orgId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const allowed = ['name', 'description', 'visibility', 'status']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }
  // Per-dataset Dimensions (taxonomy) opt-in — coerced to a clean boolean.
  if ('taxonomy_enabled' in body) updates.taxonomy_enabled = !!body.taxonomy_enabled

  // Admin-only: allow changing org_id (transfer dataset to another org)
  let isTransfer = false
  let transferResourceName: string | null = null
  if ('org_id' in body) {
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can transfer datasets' }, { status: 403 })
    }
    const { data: cur } = await service.from('datasets').select('name').eq('id', params.datasetId).single()
    transferResourceName = (cur as any)?.name ?? null
    const check = await checkTransferTarget(service, datasetOrgId, body.org_id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status || 400 })
    updates.org_id = body.org_id
    isTransfer = true
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()

  // Archive/restore: move rows to/from archive tables via SQL functions
  if (updates.status === 'archived') {
    try {
      await service.rpc('archive_dataset', { p_dataset_id: params.datasetId, p_user_id: user.id })
      return NextResponse.json({ ok: true })
    } catch (archErr: any) {
      return NextResponse.json({ error: 'Archive failed: ' + (archErr.message || archErr) }, { status: 500 })
    }
  }
  if (updates.status === 'active') {
    // Check if restoring from archive
    const { data: ds } = await service.from('datasets').select('status').eq('id', params.datasetId).single()
    if (ds?.status === 'archived') {
      try {
        await service.rpc('restore_dataset', { p_dataset_id: params.datasetId })
        return NextResponse.json({ ok: true })
      } catch (restErr: any) {
        return NextResponse.json({ error: 'Restore failed: ' + (restErr.message || restErr) }, { status: 500 })
      }
    }
  }

  const { error: updErr } = await service
    .from('datasets')
    .update(updates)
    .eq('id', params.datasetId)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  if (isTransfer) {
    await recordOrgTransfer({
      service, resourceType: 'dataset', resourceId: params.datasetId,
      resourceName: transferResourceName,
      fromOrgId: datasetOrgId, toOrgId: updates.org_id as string,
      initiatedBy: user.id, initiatedByEmail: user.email || null,
    })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { user, orgId, isAdmin: _isAdminDel, error } = await getOrgAndCheck(supabase)
  if (error || !user || !orgId) {
    return NextResponse.json({ error: error || 'Unauthorized' }, { status: 401 })
  }

  // Verify user owns the dataset before deleting
  const { data: ds } = await supabase
    .from('datasets')
    .select('created_by')
    .eq('id', params.datasetId)
    .eq('org_id', orgId)
    .single()

  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (ds.created_by !== user.id) {
    return NextResponse.json({ error: 'Only the creator can delete a dataset' }, { status: 403 })
  }

  const service = createServiceRoleClient()

  // Delete associated review source + locations + user_locations (google_reviews datasets)
  const { data: reviewSources } = await service
    .from('review_sources').select('id').eq('dataset_id', params.datasetId)
  if (reviewSources?.length) {
    for (const rs of reviewSources) {
      await service.from('user_locations').delete().eq('review_source_id', rs.id)
      await service.from('review_source_locations').delete().eq('review_source_id', rs.id)
    }
    await service.from('review_sources').delete().eq('dataset_id', params.datasetId)
  }

  // Explicitly delete child records first (belt-and-suspenders with CASCADE)
  try { await service.from('dataset_rows_flat').delete().eq('dataset_id', params.datasetId) } catch {}
  await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)
  await service.from('dataset_state').delete().eq('dataset_id', params.datasetId)

  // Before deleting: find collections this dataset belongs to (as a member)
  const { data: memberships } = await service
    .from('collection_members')
    .select('collection_id, collections(dataset_id)')
    .eq('dataset_id', params.datasetId)

  const { error: delErr } = await service
    .from('datasets')
    .delete()
    .eq('id', params.datasetId)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Auto-delete empty collections: if removing this member left a collection with 0 members, delete it
  if (memberships && memberships.length > 0) {
    for (const m of memberships) {
      const colId = m.collection_id
      const { count } = await service
        .from('collection_members')
        .select('id', { count: 'exact', head: true })
        .eq('collection_id', colId)
      if ((count || 0) === 0) {
        // Collection is empty — delete the collection dataset (cascades to collection record)
        const colDatasetId = (m.collections as any)?.dataset_id
        if (colDatasetId) {
          try { await service.from('dataset_rows_flat').delete().eq('dataset_id', colDatasetId) } catch {}
          await service.from('dataset_rows').delete().eq('dataset_id', colDatasetId)
          await service.from('dataset_state').delete().eq('dataset_id', colDatasetId)
          await service.from('datasets').delete().eq('id', colDatasetId)
        }
      }
    }
  }

  return NextResponse.json({ ok: true })
}


