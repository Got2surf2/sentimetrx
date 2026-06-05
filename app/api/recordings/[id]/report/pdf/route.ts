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
// Chrome resolution mirrors the Agent Study PDF route: @sparticuz/chromium on
// the Linux serverless runtime, an installed Chrome locally. Key off
// process.platform, NOT process.env.VERCEL (.env.local sets VERCEL=1).

import { NextResponse } from 'next/server'
import { existsSync } from 'fs'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'
import { renderTownHallReportHtml } from '@/lib/recordings/reportHtml'
import type {
  RecordingAnalysisSummary,
  RecordingExtractionRow,
  TranscriptSegment,
  EntityMap,
} from '@/lib/recordings/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Common Chrome/Chromium locations for local dev (macOS + Linux).
function localChromePath(): string | null {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean) as string[]
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

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
    .select('id, org_id, name, meeting_date, location, status, analysis_summary, entity_map, source_duration_sec')
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

  const [extractionsRes, transcriptRes] = await Promise.all([
    service
      .from('recording_extractions')
      .select('unit_type, topic, payload, sort_order, start_sec, end_sec')
      .eq('recording_id', recording_id)
      .eq('org_id', rec.org_id)
      .order('sort_order', { ascending: true }),
    includeTranscript
      ? service
          .from('recording_transcripts')
          .select('vendor, segments')
          .eq('recording_id', recording_id)
          .eq('org_id', rec.org_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const transcript = transcriptRes.data
    ? {
        vendor: (transcriptRes.data as { vendor: string }).vendor,
        segments: ((transcriptRes.data as { segments: TranscriptSegment[] }).segments ?? []),
      }
    : null

  const html = renderTownHallReportHtml({
    name: rec.name,
    meeting_date: rec.meeting_date,
    location: rec.location,
    summary: (rec.analysis_summary ?? null) as RecordingAnalysisSummary | null,
    pairs: (extractionsRes.data ?? []) as unknown as Array<
      Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order' | 'start_sec' | 'end_sec'>
    >,
    transcript,
    entityMap: (rec.entity_map ?? null) as EntityMap | null,
    includeTranscript,
    source_duration_sec: (rec as { source_duration_sec?: number | null }).source_duration_sec ?? null,
  })

  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = process.platform === 'linux'

  let browser
  try {
    if (onServerless) {
      const chromium = (await import('@sparticuz/chromium')).default
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      })
    } else {
      const exe = localChromePath()
      if (!exe) return NextResponse.json({ error: 'No local Chrome found — set PUPPETEER_EXECUTABLE_PATH' }, { status: 500 })
      browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
    }
  } catch (e: any) {
    console.error({ at: 'recording-pdf', msg: 'launch failed', err: e?.message })
    return NextResponse.json({ error: 'PDF engine failed to start' }, { status: 500 })
  }

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    })
    const fileName = (rec.name || 'Town_Hall').replace(/[^\w.-]+/g, '_') + '_Report.pdf'

    // Fire-and-forget download log for /admin/decks + DD parity.
    void logDeckDownload('recording-pdf-report', rec.name)

    return new NextResponse(Buffer.from(pdf), {
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
  } finally {
    await browser.close()
  }
}
