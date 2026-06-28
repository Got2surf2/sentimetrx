// app/api/collections/[id]/route.ts
// GET /api/collections/[id] — returns collection members with their existing theme models
// The [id] here is the collection's dataset_id (not the collections table id)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildMergedCollectionSchema } from '@/lib/collectionSchema'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function GET(_req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })
  const orgRow: any = Array.isArray(userData?.organizations) ? userData?.organizations[0] : userData?.organizations
  const isAdmin = !!orgRow?.is_admin_org

  const service = createServiceRoleClient()

  // Look up collection by its dataset_id (admin-aware — collections can live in a
  // client org, so an admin must still be able to read members for management).
  const { data: collection } = await service
    .from('collections')
    .select('id, org_id')
    .eq('dataset_id', params.id)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!isAdmin && collection.org_id !== orgId) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  // Fetch members with their dataset names and theme models
  const { data: members } = await service
    .from('collection_members')
    .select('dataset_id, label, sort_order')
    .eq('collection_id', collection.id)
    .order('sort_order', { ascending: true })

  if (!members?.length) return NextResponse.json({ members: [] })

  // Fetch theme models and dataset info for each member
  const memberIds = members.map(function(m) { return m.dataset_id })
  const { data: states } = await service
    .from('dataset_state')
    .select('dataset_id, theme_model')
    .in('dataset_id', memberIds)

  const { data: memberDs } = await service
    .from('datasets')
    .select('id, name, row_count, source')
    .in('id', memberIds)

  const stateMap: Record<string, any> = {}
  ;(states || []).forEach(function(s) { stateMap[s.dataset_id] = s.theme_model })

  const dsMap: Record<string, { name: string; row_count: number; source: string }> = {}
  ;(memberDs || []).forEach(function(d) { dsMap[d.id] = { name: d.name, row_count: d.row_count || 0, source: d.source } })

  const enriched = members.map(function(m) {
    var tm = stateMap[m.dataset_id] || null
    var ds = dsMap[m.dataset_id] || { name: m.label || 'Unknown', row_count: 0, source: '' }
    return {
      dataset_id: m.dataset_id,
      label: m.label,
      name: ds.name,
      row_count: ds.row_count,
      source: ds.source,
      theme_model: tm,
      has_themes: !!(tm && tm.themes && tm.themes.length > 0),
    }
  })

  return NextResponse.json({ members: enriched })
}

// DELETE /api/collections/[id]?member=<datasetId> — remove a member from collection
// If removing the last member, auto-deletes the collection
export async function DELETE(req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Admin-aware (collections can live in a client org — see the dataset-delete fix).
  const { data: userData } = await supabase.from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })
  const orgRow: any = Array.isArray(userData?.organizations) ? userData?.organizations[0] : userData?.organizations
  const isAdmin = !!orgRow?.is_admin_org

  const url = new URL(req.url)
  const memberDatasetId = url.searchParams.get('member')
  if (!memberDatasetId) return NextResponse.json({ error: 'member query param required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: collection } = await service
    .from('collections')
    .select('id, dataset_id, org_id')
    .eq('dataset_id', params.id)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!isAdmin && collection.org_id !== orgId) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  // Remove the member
  await service.from('collection_members').delete()
    .eq('collection_id', collection.id)
    .eq('dataset_id', memberDatasetId)

  // Remaining members
  const { data: remaining } = await service
    .from('collection_members')
    .select('dataset_id')
    .eq('collection_id', collection.id)
  const remainingIds = (remaining || []).map(m => m.dataset_id)

  if (remainingIds.length === 0) {
    // Last member removed — delete the collection dataset
    try { await service.from('dataset_rows_flat').delete().eq('dataset_id', collection.dataset_id) } catch {}
    await service.from('dataset_rows').delete().eq('dataset_id', collection.dataset_id)
    await service.from('dataset_state').delete().eq('dataset_id', collection.dataset_id)
    await service.from('datasets').delete().eq('id', collection.dataset_id)
    return NextResponse.json({ ok: true, deleted_collection: true })
  }

  // Recompute the merged schema + row_count over the remaining members (parity
  // with the add-members route so the two can't drift).
  const mergedSchema = await buildMergedCollectionSchema(service, remainingIds)
  await service.from('dataset_state').update({ schema_config: mergedSchema }).eq('dataset_id', collection.dataset_id)
  const { data: remDs } = await service.from('datasets').select('row_count').in('id', remainingIds)
  const totalRows = (remDs || []).reduce((s, d) => s + (d.row_count || 0), 0)
  // Bump updated_at so the freshness check treats this recompute as the baseline.
  await service.from('datasets').update({ row_count: totalRows, updated_at: new Date().toISOString() }).eq('id', collection.dataset_id)

  return NextResponse.json({ ok: true, remaining_members: remainingIds.length, row_count: totalRows })
}
