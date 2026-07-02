// app/api/datasets/[datasetId]/discover-entities/route.ts
// POST — run entity discovery for this dataset's scope (its own catalog, or
// the shared brand-/collection catalog it belongs to). Samples rows, runs
// Haiku NER, upserts entity_catalog, logs the run to entity_catalog_refresh.
// Triggered explicitly from the Schema tab; not auto-run on sync (AI cost).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { discoverEntities } from '@/lib/entityDiscovery'
import { recordUserEvent, eventContextFromRequest } from '@/lib/userEvents'
import { serverError } from '@/lib/apiError'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets').select('id, name, org_id').eq('id', params.datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (ds as any).org_id !== orgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  try {
    const result = await discoverEntities({
      service,
      datasetId:       params.datasetId,
      mode:            'manual',
      triggeredByUser: userId,
    })

    const ctx = eventContextFromRequest(req as any)
    await recordUserEvent({
      userId,
      orgId: (ds as any).org_id,
      event: 'entities_discovered',
      metadata: {
        dataset_id:     params.datasetId,
        dataset_name:   (ds as any).name,
        scope_type:     result.scope_type,
        sample_size:    result.sample_size,
        entities_after: result.entities_after,
        entities_new:   result.entities_new,
        cost_est_cents: result.cost_est_cents,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return serverError(err, 'datasets.discoverEntities', { orgId })
  }
}
