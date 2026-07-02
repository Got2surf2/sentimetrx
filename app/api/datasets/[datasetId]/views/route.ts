// app/api/datasets/[datasetId]/views/route.ts
// Saved views + snapshots for a dataset. See docs/SAVED_VIEWS.md.
//   GET  -- list views + snapshots visible to the caller (RLS-scoped)
//   POST -- create a view, or freeze a snapshot (body.kind)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { gateDataset } from './gate'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

const SNAPSHOT_DEFAULT_TTL_DAYS = 30

export async function GET(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate

  // Auth client → RLS returns only caller-visible rows (own private + org-shared).
  const { data, error } = await supabase
    .from('saved_views')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .order('created_at', { ascending: false })

  if (error) return serverError(error, 'datasets.views.list')
  return NextResponse.json({ views: data || [] })
}

export async function POST(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate

  let body: Record<string, any>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const kind = body.kind === 'snapshot' ? 'snapshot' : 'view'
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
  const visibility = body.visibility === 'org' ? 'org' : 'private'

  const row: Record<string, any> = {
    dataset_id:    params.datasetId,
    org_id:        gate.datasetOrgId,
    created_by:    gate.userId,
    name:          name,
    kind:          kind,
    visibility:    visibility,
    filter_config: body.filter_config ?? {},
  }

  if (kind === 'snapshot') {
    // Snapshots are self-contained: capture frozen aggregates now and carry only
    // a provenance LABEL (never a ref). Default a 30-day retention clock unless
    // the caller pins one (ISO string) or opts out (null = kept forever).
    row.frozen = body.frozen ?? {}
    row.source_view_name = typeof body.source_view_name === 'string' ? body.source_view_name : null
    if (body.expires_at === null) row.expires_at = null
    else if (typeof body.expires_at === 'string') row.expires_at = body.expires_at
    else row.expires_at = new Date(Date.now() + SNAPSHOT_DEFAULT_TTL_DAYS * 86_400_000).toISOString()
  }

  const service = createServiceRoleClient()
  const { data, error } = await service.from('saved_views').insert(row).select('*').single()
  if (error) return serverError(error, 'datasets.views.create', { orgId: gate.datasetOrgId })
  return NextResponse.json(data, { status: 201 })
}
