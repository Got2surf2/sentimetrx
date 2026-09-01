// app/api/datasets/[datasetId]/outlet-leaderboard-pdf/route.ts
// POST — the Outlet Leaderboard as a real, composed PDF (2026-09-02; replaces
// the page's "print to PDF"). The page posts back the leaderboard it already
// rendered (parseLeaderboardPdfPayload) and this route only authenticates,
// gates, validates and typesets — same contract as outlet-report-pdf.
//
// ⚠️ Listed in next.config.js `outputFileTracingIncludes` with
// `@sparticuz/chromium/bin/**` — required on every headless-Chrome route.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { outletReportingOn } from '@/lib/resolveOrg'
import { parseLeaderboardPdfPayload, MAX_PDF_BODY_CHARS } from '@/lib/outletPdfPayload'
import { buildLeaderboardHtml } from '@/lib/outletReportPdf'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'
import type { SchemaConfig } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: state } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).maybeSingle()
  if (!outletReportingOn(ctx.features, state?.schema_config as SchemaConfig | null)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const raw = await req.text()
  if (raw.length > MAX_PDF_BODY_CHARS) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const payload = parseLeaderboardPdfPayload(body)
  if (!payload) return NextResponse.json({ error: 'Payload has no leaderboard items' }, { status: 400 })

  const html = buildLeaderboardHtml(payload)
  const buffer = await htmlToPdfBuffer(html, { format: 'letter', ...brandedPdfChrome({ brand: payload.brand }) })

  const fileName = `${(payload.brand || 'Brand').replace(/[^a-z0-9]+/gi, '_')}_Outlet_Leaderboard.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
