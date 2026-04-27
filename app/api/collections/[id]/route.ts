// app/api/collections/[id]/route.ts
// GET /api/collections/[id] — returns collection members with their existing theme models
// The [id] here is the collection's dataset_id (not the collections table id)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Props { params: { id: string } }

export async function GET(_req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  // Look up collection by its dataset_id
  const { data: collection } = await service
    .from('collections')
    .select('id')
    .eq('dataset_id', params.id)
    .eq('org_id', orgId)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

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
    .select('id, name, row_count')
    .in('id', memberIds)

  const stateMap: Record<string, any> = {}
  ;(states || []).forEach(function(s) { stateMap[s.dataset_id] = s.theme_model })

  const dsMap: Record<string, { name: string; row_count: number }> = {}
  ;(memberDs || []).forEach(function(d) { dsMap[d.id] = { name: d.name, row_count: d.row_count || 0 } })

  const enriched = members.map(function(m) {
    var tm = stateMap[m.dataset_id] || null
    var ds = dsMap[m.dataset_id] || { name: m.label || 'Unknown', row_count: 0 }
    return {
      dataset_id: m.dataset_id,
      label: m.label,
      name: ds.name,
      row_count: ds.row_count,
      theme_model: tm,
      has_themes: !!(tm && tm.themes && tm.themes.length > 0),
    }
  })

  return NextResponse.json({ members: enriched })
}

// DELETE /api/collections/[id]?member=<datasetId> — remove a member from collection
// If removing the last member, auto-deletes the collection
export async function DELETE(req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id
  if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

  const url = new URL(req.url)
  const memberDatasetId = url.searchParams.get('member')
  if (!memberDatasetId) return NextResponse.json({ error: 'member query param required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: collection } = await service
    .from('collections')
    .select('id, dataset_id')
    .eq('dataset_id', params.id)
    .eq('org_id', orgId)
    .single()

  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  // Remove the member
  await service.from('collection_members').delete()
    .eq('collection_id', collection.id)
    .eq('dataset_id', memberDatasetId)

  // Check remaining members
  const { count } = await service
    .from('collection_members')
    .select('id', { count: 'exact', head: true })
    .eq('collection_id', collection.id)

  if ((count || 0) === 0) {
    // Last member removed — delete the collection dataset
    try { await service.from('dataset_rows_flat').delete().eq('dataset_id', collection.dataset_id) } catch {}
    await service.from('dataset_rows').delete().eq('dataset_id', collection.dataset_id)
    await service.from('dataset_state').delete().eq('dataset_id', collection.dataset_id)
    await service.from('datasets').delete().eq('id', collection.dataset_id)
    return NextResponse.json({ ok: true, deleted_collection: true })
  }

  return NextResponse.json({ ok: true, remaining_members: count })
}
