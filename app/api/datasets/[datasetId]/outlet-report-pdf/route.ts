// app/api/datasets/[datasetId]/outlet-report-pdf/route.ts
// GET ?outlet=<place_id> — the Outlet Deep-Dive as a real, composed PDF.
//
// Replaces "print the page and save as PDF" (2026-07-15). The document is
// typeset server-side from the SAME computed values the page renders, then
// rendered through headless Chrome with the shared branded header/footer — so
// it paginates deliberately instead of inheriting whatever the browser's print
// dialog decided.
//
// ⚠️ This route is listed in next.config.js `outputFileTracingIncludes` with
// `@sparticuz/chromium/bin/**`. Without it the function dies on Vercel with
// "input directory /var/task/node_modules/@sparticuz/chromium/bin does not exist".

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { outletReportingOn } from '@/lib/resolveOrg'
import { computeOutletReport } from '@/lib/outletReport'
import { actionPlanBasis, getOrGenerateActionPlan, type ActionPlan } from '@/lib/outletActionPlan'
import { buildOutletReportHtml } from '@/lib/outletReportPdf'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'
import { logError } from '@/lib/log'
import type { SchemaConfig } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params
  const outlet = new URL(req.url).searchParams.get('outlet')
  if (!outlet) return NextResponse.json({ error: 'Missing ?outlet=<place_id>' }, { status: 400 })

  const supabase = await createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ctx.isAdminOrg && ds.org_id !== ctx.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Same capability gate as the page and the /outlet-* routes — the export must
  // not be a way around a hidden surface.
  const { data: state } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).maybeSingle()
  if (!outletReportingOn(ctx.features, state?.schema_config as SchemaConfig | null)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const report = await computeOutletReport(datasetId, outlet)
  const s = report.selected
  if (!s || s.placeId !== outlet) return NextResponse.json({ error: 'No data for that outlet' }, { status: 404 })

  // Reuse the page's cached plan when its basis still matches, so downloading
  // the PDF doesn't silently pay for a second AI generation.
  let plan: ActionPlan | null = null
  try {
    const basis = actionPlanBasis(s.reviews, s.snapshot.themeTable)
    plan = (await getOrGenerateActionPlan(service, datasetId, outlet, {
      orgId: ds.org_id,
      brand: report.brand,
      outletName: s.name,
      reviews: s.reviews,
      rating: s.rating,
      recent: s.snapshot.recent,
      ownerResponseRate: s.snapshot.ownerResponseRate,
      themeTable: s.snapshot.themeTable,
      lowQuotes: s.lowQuotes,
      praiseVerbatims: s.snapshot.praiseVerbatims,
    }, basis)).plan
  } catch (e) {
    // A failed narration must not cost the whole document — the snapshot and
    // dimensions are the parts that come from measured data.
    void logError('outlet-report-pdf.plan', e, { datasetId, outlet })
  }

  const html = buildOutletReportHtml({
    brand: report.brand,
    selected: s,
    plan,
    networkSize: report.outlets.length,
  })

  const buffer = await htmlToPdfBuffer(html, {
    format: 'letter',
    ...brandedPdfChrome({ brand: report.brand }),
  })

  const fileName = `${(s.name || 'Outlet').replace(/[^a-z0-9]+/gi, '_')}_Report.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
