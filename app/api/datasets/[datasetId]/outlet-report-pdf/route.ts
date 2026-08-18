// app/api/datasets/[datasetId]/outlet-report-pdf/route.ts
// POST ?outlet=<place_id> — the Outlet Deep-Dive as a real, composed PDF.
//
// Replaces "print the page and save as PDF" (2026-07-15). The document is
// typeset server-side and rendered through headless Chrome with the shared
// branded header/footer, so it paginates deliberately instead of inheriting
// whatever the browser's print dialog decided.
//
// It used to be a GET that recomputed everything — a full dataset_rows_flat
// scan plus, on a cold cache, a second Sonnet call for the action plan. One
// download measured 52s of application time, most of it duplicating work the
// PAGE had already done and was still doing. So it is now a POST: the page
// sends back the payload it already rendered (lib/outletPdfPayload.ts) and this
// route only authenticates, gates, validates and typesets. See that file for
// why client-asserted figures are acceptable here.
//
// ⚠️ This route is listed in next.config.js `outputFileTracingIncludes` with
// `@sparticuz/chromium/bin/**`. Without it the function dies on Vercel with
// "input directory /var/task/node_modules/@sparticuz/chromium/bin does not exist".

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import { outletReportingOn } from '@/lib/resolveOrg'
import { actionPlanBasis, getOrGenerateActionPlan } from '@/lib/outletActionPlan'
import { parseOutletPdfPayload, MAX_PDF_BODY_CHARS } from '@/lib/outletPdfPayload'
import { buildOutletReportHtml } from '@/lib/outletReportPdf'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'
import { logError } from '@/lib/log'
import type { SchemaConfig } from '@/lib/analyzeTypes'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
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

  // Read as text first: the only thing an oversized body can buy is Chrome CPU,
  // and it must cost nothing to reject.
  const raw = await req.text()
  if (raw.length > MAX_PDF_BODY_CHARS) return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const payload = parseOutletPdfPayload(body, outlet)
  if (!payload) return NextResponse.json({ error: 'Payload does not describe this outlet' }, { status: 400 })

  // The page sends the plan it already fetched. If it couldn't get one, fall
  // back to the cache — one indexed read, no scan, and explicitly NEVER a
  // generation: a download must not sit behind a 30s LLM call.
  if (!payload.plan) {
    try {
      const basis = actionPlanBasis(payload.selected.reviews, payload.selected.snapshot.themeTable)
      const { plan } = await getOrGenerateActionPlan(service, datasetId, outlet, null, basis, { cacheOnly: true })
      payload.plan = plan
    } catch (e) {
      // A missing narration must not cost the whole document — the snapshot,
      // dimensions and peer analysis are the parts that come from measured data.
      void logError('outlet-report-pdf.plan', e, { datasetId, outlet })
    }
  }

  const html = buildOutletReportHtml(payload)

  const buffer = await htmlToPdfBuffer(html, {
    format: 'letter',
    ...brandedPdfChrome({ brand: payload.brand }),
  })

  const fileName = `${(payload.selected.name || 'Outlet').replace(/[^a-z0-9]+/gi, '_')}_Report.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
