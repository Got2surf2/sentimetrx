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
  ProceedingsSummary,
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
  setup_inputs?: unknown          // panel roster is pulled from here for the first-page context
  analysis_summary: unknown
  proceedings_summary?: unknown
  entity_map: unknown
  source_duration_sec: number | null
  // Attribution (§2.8) — optional; rendered in the PDF header when present.
  analysis_org?: string | null
  analysts?: Array<{ name: string }>
  objectives?: { summary: string; questions: string[] } | null
  confidentiality_class?: string | null
  signoff?: { approved_by: string; approved_at?: string | null } | null
  analyzed_config_version?: number | null
  draft?: boolean | null
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
  opts: { includeTranscript: boolean; timezone?: string | null },
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

  const panel = (((rec.setup_inputs ?? {}) as { panel?: Array<{ name?: string; role?: string }> }).panel ?? [])
    .filter(p => p?.name)
    .map(p => ({ name: String(p.name), role: p.role ? String(p.role) : undefined }))

  const html = renderTownHallReportHtml({
    name: rec.name,
    meeting_date: rec.meeting_date,
    location: rec.location,
    panel,
    summary: (rec.analysis_summary ?? null) as RecordingAnalysisSummary | null,
    proceedings: (rec.proceedings_summary ?? null) as ProceedingsSummary | null,
    pairs: (extractionsRes.data ?? []) as unknown as Array<
      Pick<RecordingExtractionRow, 'unit_type' | 'topic' | 'payload' | 'sort_order' | 'start_sec' | 'end_sec'>
    >,
    transcript,
    entityMap: (rec.entity_map ?? null) as EntityMap | null,
    includeTranscript,
    source_duration_sec: rec.source_duration_sec ?? null,
    analysis_org: rec.analysis_org ?? null,
    analysts: rec.analysts ?? [],
    objectives: rec.objectives ?? null,
    confidentiality_class: rec.confidentiality_class ?? null,
    signoff: rec.signoff ?? null,
    config_version: rec.analyzed_config_version ?? null,
    draft: rec.draft ?? false,
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
    // Generated-at stamp in the viewer's local timezone (passed from the
    // browser); falls back to the server zone if absent. timeZoneName prints the
    // abbreviation (e.g. EDT) so there's no ambiguity.
    const generatedAt = new Date().toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZoneName: 'short', ...(opts.timezone ? { timeZone: opts.timezone } : {}),
    })
    const pdf = await page.pdf({
      format: 'letter',                 // 8.5 × 11 in
      printBackground: true,
      // Margins live here (not CSS @page) so the header/footer bands are reserved
      // on every page. Header: "powered by datanautix" (top-right). Footer:
      // generated-at timestamp (left) · meeting name (center) · page X of Y (right).
      displayHeaderFooter: true,
      headerTemplate: pageHeaderTemplate(),
      footerTemplate: pageFooterTemplate(rec.name || 'Town Hall', generatedAt),
      margin: { top: '18mm', bottom: '18mm', left: '1in', right: '1in' },
    })
    const fileName = (rec.name || 'Town_Hall').replace(/[^\w.-]+/g, '_') + '_Report.pdf'
    return { buffer: Buffer.from(pdf), fileName }
  } finally {
    await browser.close()
  }
}

const FOOT_FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
// Datanautix wordmark — data=teal, nautix=orange, per CLAUDE.md (one word, no
// separator). Reused in the header.
const DN_WORDMARK = `<span style="font-weight:800;"><span style="color:#1FA8A8">data</span><span style="color:#F07040">nautix</span></span>`

function escFooter(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Repeated per-page header for page.pdf() — "powered by datanautix", top-right.
// Chromium renders header/footer templates at font-size 0 unless set, so sizes
// are inline; side padding matches the 1in body margin so it aligns right.
function pageHeaderTemplate(): string {
  return (
    `<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 1in;text-align:right;${FOOT_FONT};">`
    + `powered by ${DN_WORDMARK}`
    + `</div>`
  )
}

// Repeated per-page footer: generated-at timestamp (left) · meeting name
// (center, ellipsized) · page X of Y (right).
function pageFooterTemplate(name: string, timestamp: string): string {
  return (
    `<div style="width:100%;font-size:8px;color:#94a3b8;padding:0 1in;${FOOT_FONT};`
    + `display:flex;align-items:center;justify-content:space-between;">`
    + `<span style="white-space:nowrap;">${escFooter(timestamp)}</span>`
    + `<span style="flex:1;text-align:center;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escFooter(name)}</span>`
    + `<span style="white-space:nowrap;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`
    + `</div>`
  )
}
