// app/api/recordings/[id]/transcribe-span/route.ts
//
// POST — targeted re-transcription of one time span (a flagged "quiet stretch"
// in the coverage report, docs/RECORDINGS.md §5.3). Body:
// { start_sec, end_sec, vendor: 'whisper' | 'deepgram' }. Kicks off
// retranscribeSpanWorkflow (async, WDK): slice audio → ASR the clip → fold the
// new segments into recording_transcripts. Does NOT clear Q&A or re-analyze.
//
// Auth: recording OWNER or an admin org. Service-role read pairs id with the
// caller's org for non-admins (404 cross-org). Only from a settled state.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { start } from 'workflow/api'
import { retranscribeSpanWorkflow } from '@/workflows/recordings'

export const dynamic = 'force-dynamic'

const VALID_VENDORS = ['whisper', 'deepgram']

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgId = (userRow as any)?.org_id as string | undefined
  const orgRel = (userRow as any)?.organizations
  const isAdminOrg = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  if (!orgId) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const start_sec = Number(body?.start_sec)
  const end_sec = Number(body?.end_sec)
  const vendor = typeof body?.vendor === 'string' ? body.vendor : 'whisper'
  if (!Number.isFinite(start_sec) || !Number.isFinite(end_sec) || end_sec <= start_sec) {
    return NextResponse.json({ error: 'start_sec/end_sec must be numbers with end > start' }, { status: 400 })
  }
  if (!VALID_VENDORS.includes(vendor)) {
    return NextResponse.json({ error: `vendor must be one of ${VALID_VENDORS.join(', ')}` }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by, status')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (!isAdminOrg && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.created_by !== user.id) {
    return NextResponse.json({ error: 'only the recording owner or an admin can re-transcribe' }, { status: 403 })
  }

  // Only from a settled state — never interrupt an in-flight pipeline.
  if (!['complete', 'transcribed', 'failed'].includes(rec.status)) {
    return NextResponse.json({ error: `recording is ${rec.status} — wait for it to settle`, status: rec.status }, { status: 409 })
  }

  // Flip status so the status page shows progress (the workflow re-sets it too).
  const { error: updErr } = await service
    .from('recordings')
    .update({ status: 'transcribing', error_message: null })
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.transcribeSpan', { orgId: rec.org_id })

  const run = await start(retranscribeSpanWorkflow, [recording_id, rec.org_id, start_sec, end_sec, vendor])
  return NextResponse.json({ ok: true, status: 'transcribing', run_id: run.runId })
}
