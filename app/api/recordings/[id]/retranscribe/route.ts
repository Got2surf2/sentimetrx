// app/api/recordings/[id]/retranscribe/route.ts
//
// POST — re-transcribe an already-processed recording with a chosen ASR
// strategy (whisper / deepgram / hybrid / auto), then re-extract. Kicks off
// retranscribeRecordingWorkflow (async, WDK) so the long transcribe + analyze
// run as durable steps; the UI watches the status page like a fresh run.
//
// Auth: recording OWNER or an admin org. Service-role read pairs id with the
// caller's org for non-admins (404 cross-org). Only runs from a settled state
// (complete / transcribed / failed) — not mid-pipeline.

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { start } from 'workflow/api'
import { retranscribeRecordingWorkflow } from '@/workflows/recordings'

export const dynamic = 'force-dynamic'

const VALID_STRATEGIES = ['whisper', 'deepgram', 'hybrid', 'auto']

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
  const strategy = typeof body?.strategy === 'string' ? body.strategy : ''
  if (!VALID_STRATEGIES.includes(strategy)) {
    return NextResponse.json({ error: `strategy must be one of ${VALID_STRATEGIES.join(', ')}` }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by, status')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Owner OR admin. 404 (not 403) on cross-org for non-admins.
  if (!isAdminOrg && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const isOwner = rec.created_by === user.id
  if (!isAdminOrg && !isOwner) return NextResponse.json({ error: 'only the recording owner or an admin can re-transcribe' }, { status: 403 })

  // Only from a settled state — never interrupt an in-flight pipeline.
  if (!['complete', 'transcribed', 'failed'].includes(rec.status)) {
    return NextResponse.json({ error: `recording is ${rec.status} — wait for it to settle before re-transcribing`, status: rec.status }, { status: 409 })
  }

  // Persist the chosen strategy + flip status so the status page shows progress
  // immediately (the workflow re-sets it too, but this avoids a "stuck" gap).
  const { error: updErr } = await service
    .from('recordings')
    .update({ asr_strategy: strategy, status: 'transcribing', error_message: null })
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.retranscribe', { orgId: rec.org_id })

  const run = await start(retranscribeRecordingWorkflow, [recording_id, rec.org_id])
  return NextResponse.json({ ok: true, status: 'transcribing', strategy, run_id: run.runId })
}
