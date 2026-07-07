// app/api/recordings/[id]/export/pptx/route.ts
//
// POST — generate the Datanautix-branded Q&A Session PowerPoint for a recording
// (docs/RECORDINGS.md §4.13). Returns the deck as a downloadable binary.
//
// Cross-org gate: the recording + extraction reads use the service role
// (bypasses RLS), so we MUST pair id with the caller's org_id (admin-org may
// export any). A bare id lookup here would be a cross-tenant leak.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { buildRecordingDeck } from '@/lib/pptx/recordingDeck'
import type {
  RecordingExtractionRow,
  RecordingAnalysisSummary,
  ProceedingsSummary,
  MeetingProfile,
} from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Untyped service-role client → the selected recording row is inferred loosely;
// this describes the columns this route reads so the deck-input build is typed.
interface RecordingDeckRow {
  id: string
  org_id: string
  name: string | null
  meeting_date: string | null
  location: string | null
  status: string | null
  analysis_summary: RecordingAnalysisSummary | null
  proceedings_summary: ProceedingsSummary | null
  meeting_profile: MeetingProfile | null
  source_duration_sec: number | null
  analysis_org: string | null
  analysts: Array<{ name: string }> | null
  objectives: { summary: string; questions: string[] } | null
  confidentiality_class: string | null
  signoff: { approved_by: string; approved_at?: string | null } | null
  analyzed_config_version: number | null
  draft: boolean | null
  entity_map: unknown
}

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, name, meeting_date, location, status, analysis_summary, proceedings_summary, meeting_profile, source_duration_sec, analysis_org, analysts, objectives, confidentiality_class, signoff, analyzed_config_version, draft, entity_map')
    .eq('id', recording_id)
    .single()
  // 404 (not 403) on cross-org so we don't confirm the row exists. THE gate.
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdmin && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (rec.status !== 'complete') {
    return NextResponse.json({ error: 'Analysis not finished — the report is only available once the recording is complete.' }, { status: 409 })
  }

  const { data: extractions } = await service
    .from('recording_extractions')
    .select('*')
    .eq('recording_id', recording_id)
    .eq('org_id', rec.org_id)
    .order('sort_order', { ascending: true })

  const r = rec as RecordingDeckRow
  const buf = await buildRecordingDeck({
    name: rec.name,
    meeting_date: rec.meeting_date,
    location: rec.location,
    analysis_org: r.analysis_org ?? null,
    analysts: r.analysts ?? [],
    objectives: r.objectives ?? null,
    confidentiality_class: r.confidentiality_class ?? null,
    signoff: r.signoff ?? null,
    config_version: r.analyzed_config_version ?? null,
    analysis_summary: r.analysis_summary ?? null,
    proceedings_summary: r.proceedings_summary ?? null,
    meeting_profile: r.meeting_profile ?? null,
    extractions: (extractions ?? []) as unknown as RecordingExtractionRow[],
    entity_map: r.entity_map ?? null,
    source_duration_sec: r.source_duration_sec ?? null,
    draft: r.draft === true,
  })

  // Fire-and-forget download log for /admin/decks + DD parity.
  void logDeckDownload('recording-qa-report', rec.name)

  const safe = (rec.name || 'recording').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(buf as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${safe}-qa-report-${date}.pptx"`,
    },
  })
}
