// app/api/recordings/[id]/report/pdf/route.ts
//
// POST — server-rendered PDF of the Town Hall report (docs/RECORDINGS.md §4.14).
// Renders the same baked HTML the public /th share link uses
// (renderTownHallReportHtml) with headless Chrome's page.pdf(), so the download
// reads like the report. Body { includeTranscript?: boolean } appends the full
// (spelling-corrected) transcript — the one thing the public page never shows.
//
// Cross-org gate mirrors export/pptx: the recording/extraction/transcript reads
// use the service role (bypasses RLS), so we MUST pair id with the caller's
// org_id (admin-org may export any). A bare id lookup would be a tenant leak.
//
// Chrome resolution + data fetch + HTML render live in the shared
// lib/recordings/reportPdf renderer (also used by report/send → attach). This
// route owns auth + the cross-org gate, then hands a paired `rec` to it.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { renderRecordingReportPdf } from '@/lib/recordings/reportPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const includeTranscript = body?.includeTranscript === true

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, name, meeting_date, location, status, analysis_summary, entity_map, source_duration_sec, analysis_org, analysts, objectives, confidentiality_class, signoff, analyzed_config_version')
    .eq('id', recording_id)
    .single()
  // 404 (not 403) on cross-org so we don't confirm the row exists. THE gate.
  if (!rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdmin && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (rec.status !== 'complete') {
    return NextResponse.json(
      { error: 'Analysis not finished — the report is only available once the recording is complete.' },
      { status: 409 },
    )
  }

  try {
    const { buffer, fileName } = await renderRecordingReportPdf(service, rec, { includeTranscript })

    // Fire-and-forget download log for /admin/decks + DD parity.
    void logDeckDownload('recording-pdf-report', rec.name)

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e: any) {
    console.error({ at: 'recording-pdf', msg: 'render failed', err: e?.message })
    return NextResponse.json({ error: 'PDF render failed' }, { status: 500 })
  }
}
