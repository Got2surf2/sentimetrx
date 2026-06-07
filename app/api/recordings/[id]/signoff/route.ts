// app/api/recordings/[id]/signoff/route.ts
//
// Analyst sign-off (§2.8). POST marks the report reviewed & approved for
// distribution (stamps recordings.signoff with who/when/note); DELETE revokes it.
// Org-scoped with a platform-admin bypass (matching the other recordings routes).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import type { Signoff } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

async function resolveRecording(service: ReturnType<typeof createServiceRoleClient>, recordingId: string, uc: { orgId: string; isAdminOrg: boolean }) {
  let q = service.from('recordings').select('id, org_id').eq('id', recordingId)
  if (!uc.isAdminOrg) q = q.eq('org_id', uc.orgId)
  const { data } = await q.single()
  return data as { id: string; org_id: string } | null
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) || null : null

  const service = createServiceRoleClient()
  const rec = await resolveRecording(service, recording_id, uc)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: u } = await service.from('users').select('full_name, email').eq('id', uc.userId).single()
  const approvedBy = ((u?.full_name as string | null)?.trim()) || (u?.email as string | null) || 'Unknown'

  const signoff: Signoff = {
    approved_by: approvedBy,
    approved_by_member_id: uc.userId,
    approved_at: new Date().toISOString(),
    note,
  }

  const { error } = await service.from('recordings').update({ signoff }).eq('id', recording_id).eq('org_id', rec.org_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, signoff })
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const rec = await resolveRecording(service, recording_id, uc)
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { error } = await service.from('recordings').update({ signoff: null }).eq('id', recording_id).eq('org_id', rec.org_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
