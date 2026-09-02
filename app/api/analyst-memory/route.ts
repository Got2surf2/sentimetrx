// app/api/analyst-memory/route.ts
// CRUD for "What Ana remembers" (analyst_memories, sql/197) + the
// ana_interviewed flag (user_features) that gates the first-visit interview.
//
// Every operation is scoped to the CALLER's own (user_id, org_id) — an analyst
// can only ever read or mutate their own memories. Service-role queries pair
// org_id AND user_id explicitly (multi-tenancy invariant; RLS is not the
// boundary on service-role access).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { loadAnalystMemories } from '@/lib/analystMemory'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

const SOURCES = ['interview', 'correction', 'observed']
const STATUSES = ['active', 'pending', 'archived']
const INTERVIEW_FLAG = 'ana_interviewed'

async function caller() {
  const supabase = await createClient()
  const { userId, orgId } = await getCallerOrgContext(supabase)
  return { userId, orgId }
}

// GET — the caller's memories + whether they've been interviewed.
export async function GET() {
  const { userId, orgId } = await caller()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()

  const memories = await loadAnalystMemories(service, { userId, orgId })
  const { data: flag } = await service
    .from('user_features')
    .select('enabled')
    .eq('user_id', userId)
    .eq('feature', INTERVIEW_FLAG)
    .maybeSingle()

  return NextResponse.json({ memories, interviewed: !!(flag as { enabled?: boolean } | null)?.enabled })
}

// POST — create a memory, or mark the interview done ({ markInterviewed: true }).
export async function POST(req: Request) {
  const { userId, orgId } = await caller()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (body.markInterviewed === true) {
    const { error } = await service
      .from('user_features')
      .upsert({ user_id: userId, feature: INTERVIEW_FLAG, enabled: true, updated_at: new Date().toISOString() })
    if (error) return serverError(error, 'analystMemory.markInterviewed', { orgId })
    return NextResponse.json({ ok: true })
  }

  const statement = typeof body.statement === 'string' ? body.statement.trim().slice(0, 500) : ''
  const source = typeof body.source === 'string' && SOURCES.includes(body.source) ? body.source : null
  const status = typeof body.status === 'string' && STATUSES.includes(body.status) ? body.status : 'active'
  const datasetId = typeof body.datasetId === 'string' && body.datasetId ? body.datasetId : null
  if (!statement || !source) {
    return NextResponse.json({ error: 'statement and a valid source are required' }, { status: 400 })
  }

  // Dataset-scoped memories must point at a dataset the caller's org owns.
  if (datasetId) {
    const { data: ds } = await service.from('datasets').select('id').eq('id', datasetId).eq('org_id', orgId).maybeSingle()
    if (!ds) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }

  const { data, error } = await service
    .from('analyst_memories')
    .insert({ org_id: orgId, user_id: userId, dataset_id: datasetId, source, status, statement })
    .select('id, dataset_id, source, status, statement, created_at, updated_at')
    .single()
  if (error) return serverError(error, 'analystMemory.create', { orgId })
  return NextResponse.json({ memory: data })
}

// PATCH — edit a memory's statement and/or status (confirm a pending one, archive).
export async function PATCH(req: Request) {
  const { userId, orgId } = await caller()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.statement === 'string') {
    const st = body.statement.trim().slice(0, 500)
    if (!st) return NextResponse.json({ error: 'statement cannot be empty' }, { status: 400 })
    patch.statement = st
  }
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    patch.status = body.status
  }

  const { data, error } = await service
    .from('analyst_memories')
    .update(patch)
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .select('id, dataset_id, source, status, statement, created_at, updated_at')
    .maybeSingle()
  if (error) return serverError(error, 'analystMemory.update', { orgId })
  if (!data) return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  return NextResponse.json({ memory: data })
}

// DELETE — remove a memory outright. Deletion is instant and unceremonious by
// design: if deleting feels heavy, the memory feels like a trap.
export async function DELETE(req: Request) {
  const { userId, orgId } = await caller()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await service
    .from('analyst_memories')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) return serverError(error, 'analystMemory.delete', { orgId })
  if (!data) return NextResponse.json({ error: 'Memory not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
