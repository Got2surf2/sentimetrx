// app/api/recordings/[id]/duplicate/route.ts
//
// POST /api/recordings/[id]/duplicate — clone a Town Hall's PROJECT SETUP into a
// fresh recording. Inherits all configuration (name, session type, setup inputs,
// meeting profile, panel/agenda, objectives, analysts, brand/agent, confidentiality)
// but NONE of the media, transcripts, extractions, analysis, sharing, or sign-off.
// The copy starts at 'awaiting_media' so the user just adds new audio.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!uc.features.recordings) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const service = createServiceRoleClient()

  // Load the source. Pair (id, org_id) for non-admins — bare id is a cross-tenant leak.
  let q = service.from('recordings').select('*').eq('id', recording_id)
  if (!uc.isAdminOrg) q = q.eq('org_id', uc.orgId)
  const { data: src, error: sErr } = await q.single()
  if (sErr || !src) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Copy ONLY the setup/config columns. Everything media/result/share/signoff is
  // intentionally omitted so the duplicate is a clean project awaiting media.
  const s = src as Record<string, unknown>
  const insert: Record<string, unknown> = {
    org_id: s.org_id,
    created_by: uc.userId,
    name: `${(s.name as string) ?? 'Recording'} (Copy)`,
    session_type: s.session_type,
    meeting_date: s.meeting_date ?? null,
    location: s.location ?? null,
    language: s.language ?? 'en',
    setup_inputs: s.setup_inputs ?? {},
    asr_strategy: s.asr_strategy ?? 'auto',
    meeting_profile: s.meeting_profile ?? null,
    status: 'awaiting_media',
  }
  for (const col of ['brand_tag', 'underlying_agent_id', 'analysis_org', 'analysts', 'objectives', 'setup_provenance', 'confidentiality_class'] as const) {
    if (s[col] !== null && s[col] !== undefined) insert[col] = s[col]
  }

  const { data: rec, error: iErr } = await service.from('recordings').insert(insert).select('id').single()
  if (iErr || !rec) return serverError(iErr, 'recordings.duplicate', { orgId: s.org_id as string })

  return NextResponse.json({ ok: true, id: rec.id as string })
}
