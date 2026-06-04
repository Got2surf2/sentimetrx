// app/api/recordings/[id]/route.ts
//
// GET /api/recordings/[id] — § 4.3 status + details.
//
// Drives the status surface (§ 5.3) and the report page header. Returns the
// recording row + files + transcript metadata (if any) + extraction count
// + coverage report. Deliberately does NOT return the transcript segments
// or extraction payloads — those are big and only the report page needs
// them (loaded server-side directly).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = 'recordings'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

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

  const { data: recRow, error: rErr } = await service
    .from('recordings')
    .select(
      'id, org_id, created_by, dataset_id, name, session_type, meeting_date, location, language, ' +
      'setup_inputs, asr_strategy, asr_vendor_chosen, status, error_message, ' +
      'source_duration_sec, source_size_bytes, cost_cents, coverage_report, analysis_summary, ' +
      'meeting_profile, phase_map, presentation_outline, entity_map, ' +
      'share_token, share_enabled, share_expires_at, ' +
      'created_at, started_at, completed_at',
    )
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !recRow) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const rec = recRow as unknown as Record<string, unknown>

  const [filesRes, transcriptRes, extractionCountRes] = await Promise.all([
    service
      .from('recording_files')
      .select('id, original_filename, mime_type, size_bytes, duration_sec, is_video, audio_storage_path, sort_order, upload_status')
      .eq('recording_id', recording_id)
      .eq('org_id', org_id)
      .order('sort_order', { ascending: true }),
    service
      .from('recording_transcripts')
      .select('id, vendor, language_detected, word_count, duration_sec, cost_cents, completed_at')
      .eq('recording_id', recording_id)
      .eq('org_id', org_id)
      .maybeSingle(),
    service
      .from('recording_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('recording_id', recording_id)
      .eq('org_id', org_id),
  ])

  // Don't leak share_token to non-owners. Owners get the share state; everyone
  // else in the org sees share_enabled but not the raw token.
  const isOwner = rec.created_by === user.id
  const share = {
    enabled: rec.share_enabled as boolean,
    expires_at: rec.share_expires_at as string | null,
    token: isOwner ? (rec.share_token as string | null) : null,
  }

  return NextResponse.json({
    recording: {
      id: rec.id,
      name: rec.name,
      session_type: rec.session_type,
      meeting_date: rec.meeting_date,
      location: rec.location,
      language: rec.language,
      setup_inputs: rec.setup_inputs,
      asr_strategy: rec.asr_strategy,
      asr_vendor_chosen: rec.asr_vendor_chosen,
      status: rec.status,
      error_message: rec.error_message,
      source_duration_sec: rec.source_duration_sec,
      source_size_bytes: rec.source_size_bytes,
      cost_cents: rec.cost_cents,
      coverage_report: rec.coverage_report,
      meeting_profile: rec.meeting_profile,
      phase_map: rec.phase_map,
      presentation_outline: rec.presentation_outline,
      entity_map: rec.entity_map,
      dataset_id: rec.dataset_id,
      created_at: rec.created_at,
      started_at: rec.started_at,
      completed_at: rec.completed_at,
    },
    files: filesRes.data ?? [],
    transcript: transcriptRes.data ?? null,
    extraction_count: extractionCountRes.count ?? 0,
    share,
  })
}

// DELETE /api/recordings/[id] — hard-delete a recording and EVERYTHING it owns:
// all source/audio/stitched/report objects in storage, the derived dataset +
// its mirrored rows, and the recording row (which cascades recording_files,
// recording_transcripts, recording_extractions). Permitted for the owner, an
// org admin, or a platform admin. This is irreversible.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Load the recording, org-scoped (platform admins can reach any org).
  let recQ = service.from('recordings').select('id, org_id, created_by, dataset_id').eq('id', recording_id)
  if (!uc.isAdminOrg) recQ = recQ.eq('org_id', uc.orgId)
  const { data: rec } = await recQ.single()
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Owner, org admin, or platform admin may delete.
  if (!(uc.isAdminOrg || uc.isAdmin || rec.created_by === uc.userId)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const org_id = rec.org_id as string

  // 1) Storage — collect every object under <org>/<recording_id>/ and remove it.
  const { data: files } = await service
    .from('recording_files')
    .select('storage_path, audio_storage_path')
    .eq('recording_id', recording_id)
  const paths = new Set<string>()
  for (const f of (files ?? []) as any[]) {
    if (f.storage_path) paths.add(f.storage_path)
    if (f.audio_storage_path) paths.add(f.audio_storage_path)
  }
  paths.add(`${org_id}/${recording_id}/audio/stitched.mp3`)
  paths.add(`${org_id}/${recording_id}/report.pdf`)
  // Catch any strays the DB doesn't track by listing the folders directly.
  for (const dir of [`${org_id}/${recording_id}`, `${org_id}/${recording_id}/audio`]) {
    const { data: listed } = await service.storage.from(BUCKET).list(dir, { limit: 1000 })
    for (const o of (listed ?? []) as any[]) {
      if (o?.name && o.id !== null) paths.add(`${dir}/${o.name}`)  // id null = subfolder, skip
    }
  }
  if (paths.size > 0) {
    const { error: rmErr } = await service.storage.from(BUCKET).remove(Array.from(paths))
    if (rmErr) console.error('[recordings:delete] storage remove failed:', rmErr.message)  // best-effort
  }

  // 2) Derived dataset (recording → dataset is 1:1) + its mirrored rows.
  if (rec.dataset_id) {
    await service.from('dataset_rows_flat').delete().eq('dataset_id', rec.dataset_id)
    await service.from('datasets').delete().eq('id', rec.dataset_id).eq('org_id', org_id)
  }

  // 3) The recording row — cascades recording_files / _transcripts / _extractions.
  const { error: delErr } = await service.from('recordings').delete().eq('id', recording_id).eq('org_id', org_id)
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, deleted: recording_id })
}
