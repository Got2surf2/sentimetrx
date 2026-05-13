// app/api/datasets/[datasetId]/extract-entities/route.ts
// POST — run entity canonicalisation on an open-ended field and persist
// per-row results to public.entity_mentions. Triggered explicitly by the
// Schema tab; intentionally not auto-run on sync (AI cost).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { extractAndPersistEntities } from '@/lib/entityExtraction'
import { recordUserEvent, eventContextFromRequest } from '@/lib/userEvents'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

interface Params { params: { datasetId: string } }

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  let body: { field?: string } = {}
  try { body = await req.json() } catch { /* allow empty body */ }
  const field = (body.field || '').trim()
  if (!field) return NextResponse.json({ error: 'field is required' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, name, org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (dataset as any).org_id !== userData.org_id) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  try {
    const result = await extractAndPersistEntities({
      service,
      datasetId: params.datasetId,
      field,
    })

    const ctx = eventContextFromRequest(req as any)
    await recordUserEvent({
      userId: user.id,
      orgId: (dataset as any).org_id,
      event: 'entities_extracted',
      metadata: {
        dataset_id: params.datasetId,
        dataset_name: (dataset as any).name,
        field,
        rows_scanned: result.rows_scanned,
        mentions_inserted: result.mentions_inserted,
        distinct_canonical: result.distinct_canonical,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    })

    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Extraction failed' }, { status: 500 })
  }
}
