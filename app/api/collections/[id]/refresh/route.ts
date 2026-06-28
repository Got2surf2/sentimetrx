// app/api/collections/[id]/refresh/route.ts
// POST /api/collections/[id]/refresh — recompute a collection's cached layers
// after its member datasets changed (synced new rows, gained fields/Dimensions,
// re-analyzed). `[id]` is the collection's dataset_id (same convention as the
// members + DELETE routes). Rebuilds the merged schema + analytics + row_count,
// drops the signal-stats cache, and bumps the collection's updated_at — which
// clears the "members updated — refresh" badge on the card.
//
// The project/competitive REPORTS already read members' live data on each gen,
// so this only refreshes the collection's own cached schema/aggregates.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { refreshCollection } from '@/lib/collectionRecompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Props { params: Promise<{ id: string }> }

export async function POST(_req: Request, props: Props) {
  const { id: collectionDatasetId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const res = await refreshCollection(service, collectionDatasetId, userId)
  if (!res) {
    return NextResponse.json({ error: 'Nothing to refresh — the collection has no analyzable members.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, row_count: res.rowCount })
}
