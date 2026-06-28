// app/api/collections/[id]/members/route.ts
// POST /api/collections/[id]/members — add one or more datasets to an EXISTING
// collection. `[id]` is the collection's dataset_id (same convention as the
// DELETE on /api/collections/[id]). Mirrors the create route's validation +
// recompute so the two paths can't drift.
//
// Body: { members: [{ dataset_id, label }] }
// Effects: insert collection_members + recompute merged schema + bump row_count.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildMergedCollectionSchema } from '@/lib/collectionSchema'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function POST(req: Request, props: Props) {
  const { id: collectionDatasetId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { members } = body as { members: { dataset_id: string; label: string }[] }
  if (!Array.isArray(members) || members.length === 0) {
    return NextResponse.json({ error: 'Select at least one dataset to add' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Resolve the collection by its dataset_id, paired with org_id (tenancy).
  const { data: collection } = await service
    .from('collections')
    .select('id, dataset_id, org_id')
    .eq('dataset_id', collectionDatasetId)
    .single()
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!isAdmin && collection.org_id !== orgId) {
    return NextResponse.json({ error: "This collection isn't available to your account." }, { status: 404 })
  }

  // Validate the new datasets: exist, same org as the collection, not themselves
  // collections, and not already members.
  const newIds = Array.from(new Set(members.map(m => m.dataset_id)))
  const { data: newDatasets, error: dsErr } = await service
    .from('datasets')
    .select('id, name, row_count, source, org_id')
    .in('id', newIds)
  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })
  if (!newDatasets || newDatasets.length !== newIds.length) {
    return NextResponse.json({ error: 'One or more datasets not found' }, { status: 400 })
  }
  if (newDatasets.some(d => d.org_id !== collection.org_id)) {
    return NextResponse.json({ error: 'All datasets must belong to the same organization as the collection' }, { status: 400 })
  }
  if (newDatasets.some(d => d.source === 'collection')) {
    return NextResponse.json({ error: 'A collection cannot contain another collection' }, { status: 400 })
  }

  // Existing members — for dedupe + sort_order continuation + schema/row recompute.
  const { data: existing } = await service
    .from('collection_members')
    .select('dataset_id, sort_order')
    .eq('collection_id', collection.id)
  const existingIds = new Set((existing || []).map(m => m.dataset_id))
  const toAdd = newIds.filter(id => !existingIds.has(id))
  if (toAdd.length === 0) {
    return NextResponse.json({ error: 'Those datasets are already in this collection' }, { status: 400 })
  }
  const nextSort = (existing || []).reduce((mx, m) => Math.max(mx, m.sort_order ?? 0), -1) + 1

  const labelFor = (id: string) =>
    (members.find(m => m.dataset_id === id)?.label || '').trim() ||
    (newDatasets.find(d => d.id === id)?.name || 'Dataset')

  const memberRows = toAdd.map((id, i) => ({
    collection_id: collection.id,
    dataset_id: id,
    label: labelFor(id),
    sort_order: nextSort + i,
  }))
  const { error: insErr } = await service.from('collection_members').insert(memberRows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Recompute over the FULL member set (existing + added).
  const allMemberIds = [...existingIds, ...toAdd]
  const mergedSchema = await buildMergedCollectionSchema(service, allMemberIds)
  await service.from('dataset_state').update({ schema_config: mergedSchema }).eq('dataset_id', collectionDatasetId)

  const { data: allMemberDs } = await service.from('datasets').select('row_count').in('id', allMemberIds)
  const totalRows = (allMemberDs || []).reduce((s, d) => s + (d.row_count || 0), 0)
  await service.from('datasets').update({ row_count: totalRows }).eq('id', collectionDatasetId)

  return NextResponse.json({ ok: true, added: toAdd.length, total_members: allMemberIds.length, row_count: totalRows })
}
