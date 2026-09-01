// app/api/datasets/[datasetId]/hierarchy-report-pdf/route.ts
// POST — a rolled-up hierarchy rung (Network / Region / District) as a real,
// composed PDF (2026-09-02). The per-outlet deep-dive got its composed
// document on 2026-08-18; the rung view kept the print dialog "for now" —
// this retires it. Same POST-the-page's-data contract as its siblings.
//
// ⚠️ Listed in next.config.js `outputFileTracingIncludes` with
// `@sparticuz/chromium/bin/**` — required on every headless-Chrome route.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { outletReportingOn } from '@/lib/resolveOrg'
import { parseHierarchyPdfPayload, MAX_PDF_BODY_CHARS } from '@/lib/outletPdfPayload'
import { buildHierarchyRungHtml } from '@/lib/outletReportPdf'
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

  const payload = parseHierarchyPdfPayload(body)
  if (!payload) return NextResponse.json({ error: 'Payload does not describe a hierarchy node' }, { status: 400 })

  const html = buildHierarchyRungHtml(payload)
  const buffer = await htmlToPdfBuffer(html, { format: 'letter', ...brandedPdfChrome({ brand: payload.brand }) })

  const fileName = `${(payload.name || 'Network').replace(/[^a-z0-9]+/gi, '_')}_${(payload.levelLabel || 'Rollup').replace(/[^a-z0-9]+/gi, '_')}_Report.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
