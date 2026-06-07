// app/api/recordings/[id]/analyze/route.ts
//
// POST /api/recordings/[id]/analyze — Gate 1: user-triggered analysis.
// Called from the review-and-generate gate (§ 5.3) after the pipeline pauses
// at status='transcribed'. Optionally persists last-minute setup edits (agenda
// / panel roster) and a free-text steer, then kicks off analyzeRecordingWorkflow
// (analyzing → complete). CSRF + same-origin are enforced by proxy.ts.

import { NextResponse } from 'next/server'
import { start } from 'workflow/api'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { analyzeRecordingWorkflow } from '@/workflows/recordings'
import { sanitizeEntityMap } from '@/lib/recordings/entities'
import { snapshotConfigVersion } from '@/lib/recordings/configVersion'
import type { PhaseMap } from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'

interface Body {
  setup_inputs?: Record<string, unknown>
  instructions?: string
  phase_map?: PhaseMap          // user-adjusted phase boundaries from the review gate
  entity_map?: unknown          // user-corrected entity-spelling map from the gate (§3.5b)
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
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
  const setupPatch: Record<string, unknown> = {}
  if (body.setup_inputs && typeof body.setup_inputs === 'object' && !Array.isArray(body.setup_inputs)) {
    setupPatch.setup_inputs = body.setup_inputs
  }
  // User-adjusted phase boundaries from the gate — mark edited so detection
  // won't be assumed authoritative, and analysis scopes to these spans.
  if (body.phase_map && Array.isArray(body.phase_map.phases) && body.phase_map.phases.length > 0) {
    setupPatch.phase_map = { ...body.phase_map, edited_by_user: true }
  }
  // User-corrected entity-spelling map (§3.5b) — persist before analysis so the
  // polish glossary uses the confirmed canonical spellings. Sending an empty map
  // clears it (entity_map → null).
  if ('entity_map' in body) {
    setupPatch.entity_map = sanitizeEntityMap(body.entity_map, new Date().toISOString())
  }
  if (Object.keys(setupPatch).length > 0) {
    const { error: updErr } = await service
      .from('recordings')
      .update(setupPatch)
      .eq('id', recording_id)
      .eq('org_id', org_id)
    if (updErr) return NextResponse.json({ error: `setup update failed: ${updErr.message}` }, { status: 500 })
  }

  // Snapshot the config this analysis runs against (after the gate edits above),
  // and stamp the version onto the recording so the deliverable traces to it.
  // Non-fatal: a snapshot failure shouldn't block analysis.
  try {
    const { version_number } = await snapshotConfigVersion(service, recording_id, org_id, {
      source: 'analysis',
      createdBy: user.id,
    })
    await service.from('recordings').update({ analyzed_config_version: version_number }).eq('id', recording_id).eq('org_id', org_id)
  } catch (e) {
    console.error({ at: 'recordings.analyze', msg: 'config snapshot failed', err: (e as Error)?.message })
  }

  const run = await start(analyzeRecordingWorkflow, [recording_id, org_id, instructions])

  return NextResponse.json({ ok: true, status: 'analyzing', run_id: run.runId })
}
