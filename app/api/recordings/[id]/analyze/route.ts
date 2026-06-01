// app/api/recordings/[id]/analyze/route.ts
//
// POST /api/recordings/[id]/analyze — Gate 1: user-triggered analysis.
// Called from the review-and-generate gate (§ 5.3) after the pipeline pauses
// at status='transcribed'. Optionally persists last-minute setup edits (agenda
// / panel roster) and a free-text steer, then kicks off analyzeRecordingWorkflow
// (analyzing → complete). CSRF + same-origin are enforced by middleware.ts.

import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { analyzeRecordingWorkflow } from '@/workflows/recordings'

export const dynamic = 'force-dynamic'

interface Body {
  setup_inputs?: Record<string, unknown>
  instructions?: string
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const recording_id = ctx.params.id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
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

  // Pair (id, org_id) — bare id lookup with service role is a cross-tenant leak.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, status')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Only generate from the paused-after-transcription state, or retry a failed
  // analysis. A transcript must already exist for either to make sense — the
  // workflow FatalErrors cleanly if it doesn't.
  if (rec.status !== 'transcribed' && rec.status !== 'failed') {
    return NextResponse.json({
      ok: true,
      status: rec.status,
      already_running: rec.status === 'analyzing',
    })
  }

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* empty body is fine */ }

  const instructions = body.instructions?.trim() || undefined
  if (instructions && instructions.length > 4000) {
    return NextResponse.json({ error: 'instructions too long (4000 char max)' }, { status: 400 })
  }

  // Persist last-minute setup edits (agenda / panel roster) before analysis so
  // the extraction prompt sees them. Replaces setup_inputs wholesale — the gate
  // sends the full edited object.
  if (body.setup_inputs && typeof body.setup_inputs === 'object' && !Array.isArray(body.setup_inputs)) {
    const { error: updErr } = await service
      .from('recordings')
      .update({ setup_inputs: body.setup_inputs })
      .eq('id', recording_id)
      .eq('org_id', org_id)
    if (updErr) return NextResponse.json({ error: `setup update failed: ${updErr.message}` }, { status: 500 })
  }

  const run = await start(analyzeRecordingWorkflow, [recording_id, org_id, instructions])

  return NextResponse.json({ ok: true, status: 'analyzing', run_id: run.runId })
}
