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

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const recording_id = ctx.params.id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

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

  const { data: recRow, error: rErr } = await service
    .from('recordings')
    .select(
      'id, org_id, created_by, dataset_id, name, session_type, meeting_date, location, language, ' +
      'setup_inputs, asr_strategy, asr_vendor_chosen, status, error_message, ' +
      'source_duration_sec, source_size_bytes, cost_cents, coverage_report, ' +
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
