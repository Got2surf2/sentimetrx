// app/api/recordings/[id]/process/route.ts
//
// POST /api/recordings/[id]/process — start the pipeline.
// Spec § 4.2. Called by the wizard after all source files report
// upload_status='uploaded'. Transitions uploading → queued and kicks off
// the Workflow DevKit run that drives extract → transcribe → analyze →
// complete. CSRF + same-origin are enforced by middleware.ts.

import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { processRecordingWorkflow } from '@/workflows/recordings'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, ctx: { params: { id: string } }) {
  const recording_id = ctx.params.id
  if (!recording_id) {
    return NextResponse.json({ error: 'missing recording id' }, { status: 400 })
  }

  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  // Pair (id, org_id) — the bare id lookup with service role is a cross-tenant
  // leak per CLAUDE.md multi-tenancy invariants.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, status')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Idempotent: if the workflow is already running or finished, just report.
  // Failed runs are restartable via this route — that's the manual retry path
  // until /api/recordings/[id]/retry lands.
  if (rec.status !== 'uploading' && rec.status !== 'failed') {
    return NextResponse.json({
      ok: true,
      status: rec.status,
      already_running: true,
    })
  }

  const { data: files, error: fErr } = await service
    .from('recording_files')
    .select('id, upload_status')
    .eq('recording_id', recording_id)
    .eq('org_id', org_id)
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })
  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'no source files attached' }, { status: 400 })
  }

  const pending = files.filter(f => f.upload_status !== 'uploaded' && f.upload_status !== 'extracted')
  if (pending.length > 0) {
    return NextResponse.json(
      {
        error: 'not all source files have finished uploading',
        pending: pending.map(f => f.id),
      },
      { status: 409 },
    )
  }

  const { error: updErr } = await service
    .from('recordings')
    .update({ status: 'queued', error_message: null })
    .eq('id', recording_id)
    .eq('org_id', org_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const run = await start(processRecordingWorkflow, [recording_id, org_id])

  return NextResponse.json({ ok: true, status: 'queued', run_id: run.runId })
}
