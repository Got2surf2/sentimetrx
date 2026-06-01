// app/api/datasets/[datasetId]/entities/reset-discovered/route.ts
// POST — wipe every `source='discovered'` row in this dataset's scope.
//        `source='manual'` rows (menu seeds, hand-curated entries) survive.
//        Separate URL from re-discover so the destructive intent is explicit
//        — "Reset" and "Re-discover" are different buttons in the UI.
//
// Used by the Manage Entities panel when discovery has accumulated noise the
// user wants to wholesale clear before a fresh run. Safe to call on a scope
// with no discovered rows (no-op).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { resolveEntityScope } from '@/lib/entityFilter'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const dsQuery = service.from('datasets').select('id, org_id').eq('id', params.datasetId)
  const { data: ds } = isAdmin ? await dsQuery.single() : await dsQuery.eq('org_id', orgId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const scope = await resolveEntityScope(service, params.datasetId)
  if (!scope.found) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  // Count what we're about to delete for the audit log.
  const { data: existing } = await service
    .from('entity_catalog')
    .select('slug')
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('source', 'discovered')
  const before = (existing || []).length

  const { error } = await service
    .from('entity_catalog')
    .delete()
    .eq('scope_type', scope.scopeType)
    .eq('scope_id', scope.scopeId)
    .eq('source', 'discovered')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await service.from('entity_catalog_refresh').insert({
    scope_type:           scope.scopeType,
    scope_id:             scope.scopeId,
    triggered_by:         'manual',
    triggered_by_user:    userId,
    sample_size:          0,
    datasets_sampled:     scope.memberDatasetIds,
    entities_before:      before,
    entities_after:       0,
    entities_new:         0,
    haiku_cost_est_cents: 0,
    duration_ms:          0,
    error:                `reset-discovered: removed ${before} discovered entries`,
  })

  return NextResponse.json({ removed: before })
}
