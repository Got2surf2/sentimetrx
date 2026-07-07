// app/api/datasets/[datasetId]/rows-by-entity/route.ts
// GET — the rows that mention one catalog entity, across the dataset's scope.
//   ?entity=<slug>   entity_catalog.slug (required)
//   ?limit=<n>       default 100, max 500
//   ?offset=<n>      pagination offset
//
// Scope-resolving like the entities route: a branded/collection dataset
// drills into rows across every member dataset. Powers entity drill-down.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getRowsByEntity } from '@/lib/entityFilter'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

export async function GET(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service
    .from('datasets').select('id, org_id').eq('id', params.datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (ds as { org_id: string | null }).org_id !== orgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const entitySlug = (url.searchParams.get('entity') || '').trim()
  if (!entitySlug) return NextResponse.json({ error: 'entity query param is required' }, { status: 400 })
  const limit  = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1), 500)
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0)

  const result = await getRowsByEntity({
    service,
    datasetId: params.datasetId,
    entitySlug,
    limit,
    offset,
  })

  if (result.notFound) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
