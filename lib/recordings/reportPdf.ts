// lib/recordings/reportPdf.ts
//
// Shared server-side renderer for the Town Hall report PDF (docs/RECORDINGS.md
// §4.14). Fetches the recording's Q&A pairs (+ optional transcript), bakes the
// same HTML the public /th share link uses (renderTownHallReportHtml), and
// renders it to a PDF buffer with headless Chrome.
//
// Used by BOTH the download route (report/pdf) and the email route
// (report/send → attach), so the data-fetch + render lives here once. The
// CALLER owns the cross-org gate: pass a `rec` whose id was already paired with
// the caller's org_id (a bare id lookup on the service role is a tenant leak).
//
// Chrome resolution mirrors the Agent Study PDF route: @sparticuz/chromium on
// the Linux serverless runtime, an installed Chrome locally. Key off
// process.platform, NOT process.env.VERCEL (.env.local sets VERCEL=1).

import 'server-only'
import { existsSync } from 'fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderTownHallReportHtml } from './reportHtml'
import type {
  RecordingAnalysisSummary,
  RecordingExtractionRow,
  TranscriptSegment,
  EntityMap,
} from './types'

export interface RecordingForPdf {
  id: string
  org_id: string
  name: string
  meeting_date: string | null
  location: string | null
  analysis_summary: unknown
  entity_map: unknown
  source_duration_sec: number | null
}

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

export async function renderRecordingReportPdf(
  service: SupabaseClient,
  rec: RecordingForPdf,
  opts: { includeTranscript: boolean },
): Promise<{ buffer: Buffer; fileName: string }> {
  const { includeTranscript } = opts

  const [extractionsRes, transcriptRes] = await Promise.all([
    service
      .from('recording_extractions')
      .select('unit_type, topic, payload, sort_order, start_sec, end_sec')
      .eq('recording_id', rec.id)
      .eq('org_id', rec.org_id)
      .order('sort_order', { ascending: true }),
    includeTranscript
      ? service
          .from('recording_transcripts')
          .select('vendor, segments')
          .eq('recording_id', rec.id)
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
    source_duration_sec: rec.source_duration_sec ?? null,
  })

  const puppeteer = (await import('puppeteer-core')).default
  const onServerless = process.platform === 'linux'

  let browser
  if (onServerless) {
    const chromium = (await import('@sparticuz/chromium')).default
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  } else {
    const exe = localChromePath()
    if (!exe) throw new Error('No local Chrome found — set PUPPETEER_EXECUTABLE_PATH')
    browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
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
    return { buffer: Buffer.from(pdf), fileName }
  } finally {
    await browser.close()
  }
}
