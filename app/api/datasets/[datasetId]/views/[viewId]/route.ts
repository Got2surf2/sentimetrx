// app/api/datasets/[datasetId]/views/[viewId]/route.ts
// A single saved view / snapshot. See docs/SAVED_VIEWS.md.
//   GET    -- read one (missing/deleted/not-visible → clean 404, drives the
//             "this view was deleted" UX rather than a 500)
//   PATCH  -- views: rename / visibility / re-save filters.
//             snapshots: ONLY the retention clock (expires_at) — content is
//             immutable (keep = null, extend/restore = a future ISO date).
//   DELETE -- remove one. Deleting a view does NOT touch snapshots (they are
//             self-contained — no source_view_id ref, no cascade).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { gateDataset, NOT_AVAILABLE } from '../gate'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string; viewId: string }> }

export async function GET(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate

  // Auth client → RLS hides rows the caller can't see, so this 404s on a private
  // view they don't own just as it does on a deleted one.
  const { data } = await supabase
    .from('saved_views')
    .select('*')
    .eq('id', params.viewId)
    .eq('dataset_id', params.datasetId)
    .maybeSingle()

  if (!data) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate

  let body: Record<string, any>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }

  const service = createServiceRoleClient()
  const { data: row } = await service
    .from('saved_views')
    .select('id, kind, created_by')
    .eq('id', params.viewId)
    .eq('dataset_id', params.datasetId)
    .eq('org_id', gate.datasetOrgId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 404 })
  if (!gate.isAdmin && row.created_by !== gate.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const patch: Record<string, any> = {}
  if (row.kind === 'snapshot') {
    // Content (name / filter_config / frozen) is frozen; reject any such edit.
    if (body.name !== undefined || body.filter_config !== undefined || body.frozen !== undefined || body.visibility !== undefined) {
      return NextResponse.json({ error: 'Snapshots are read-only except their retention clock (expires_at)' }, { status: 400 })
    }
    if (!('expires_at' in body)) return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    if (body.expires_at !== null && typeof body.expires_at !== 'string') {
      return NextResponse.json({ error: 'expires_at must be an ISO date string or null' }, { status: 400 })
    }
    patch.expires_at = body.expires_at
  } else {
    if (typeof body.name === 'string') patch.name = body.name.trim()
    if (body.visibility === 'org' || body.visibility === 'private') patch.visibility = body.visibility
    if (body.filter_config !== undefined) patch.filter_config = body.filter_config
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  const { error } = await service
    .from('saved_views')
    .update(patch)
    .eq('id', params.viewId)
    .eq('org_id', gate.datasetOrgId)
  if (error) return serverError(error, 'datasets.views.update', { orgId: gate.datasetOrgId })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate

  const service = createServiceRoleClient()
  const { data: row } = await service
    .from('saved_views')
    .select('id, created_by')
    .eq('id', params.viewId)
    .eq('dataset_id', params.datasetId)
    .eq('org_id', gate.datasetOrgId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: NOT_AVAILABLE }, { status: 404 })
  if (!gate.isAdmin && row.created_by !== gate.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service
    .from('saved_views')
    .delete()
    .eq('id', params.viewId)
    .eq('org_id', gate.datasetOrgId)
  if (error) return serverError(error, 'datasets.views.delete', { orgId: gate.datasetOrgId })
  return NextResponse.json({ ok: true })
}
