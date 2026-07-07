// app/api/datasets/[datasetId]/ad-hoc-report/route.ts
// POST — the ad-hoc "Ask Ana" report. The user describes exactly what they want;
// Ana writes a focused report over ONLY this dataset's (sampled/filtered) rows,
// rendered to HTML or PDF. The release valve for bespoke one-off cuts that don't
// warrant a hard-coded structured report. Works for collections too (datasetId
// resolves a source='collection' dataset via the shared loadAnaSample).

import { NextResponse } from 'next/server'
import type { SerializedFilters } from '@/lib/filterUtils'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { checkMessage } from '@/lib/contentGuard'
import { callAI } from '@/lib/ai'
import { getSourceLabel } from '@/lib/anaContext'
import { loadAnaSample } from '@/lib/anaReportContext'
import { pdfDoc } from '@/lib/pdf'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'
import { serverError } from '@/lib/apiError'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

interface Props { params: Promise<{ datasetId: string }> }

interface DatasetRow {
  id: string
  name: string
  source: string
  row_count: number | null
  org_id: string
}

const REPORT_CSS =
  '.report-body h2{font-size:20px;margin:0 0 8px}.report-body h3{font-size:15px;margin:18px 0 6px}' +
  '.report-body p,.report-body li{font-size:12px;line-height:1.55}' +
  '.report-body table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11px}' +
  '.report-body th,.report-body td{border:1px solid #e5e7eb;padding:5px 8px;text-align:left}' +
  '.report-body th{background:#f8fafc;font-weight:700}' +
  '.report-body blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid #0f766e;color:#374151;font-style:italic;background:#f8fafc}'

export async function POST(req: Request, props: Props) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { prompt?: string; format?: 'pdf' | 'html'; filters?: Record<string, unknown>; sampleSize?: number }
  const prompt = (body.prompt || '').trim()
  const format = body.format === 'html' ? 'html' : 'pdf'
  if (!prompt) return NextResponse.json({ error: 'Describe what you want the report to cover.' }, { status: 400 })

  const safety = checkMessage('adhoc_' + userId, prompt)
  if (!safety.safe) return NextResponse.json({ error: safety.warning || 'Please rephrase your request.' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, name, source, row_count, org_id').eq('id', datasetId).single<DatasetRow>()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sample = await loadAnaSample({ service, dataset, filters: body.filters as SerializedFilters | undefined, sampleSize: body.sampleSize })
  if (sample.rows.length === 0) return NextResponse.json({ error: 'No analyzable rows in this dataset.' }, { status: 400 })

  const sourceLabel = getSourceLabel(dataset.source)
  const sampleNote = sample.sampled
    ? `This is a random sample of ${sample.rows.length} of ${sample.totalDatasetRows.toLocaleString()} rows — note findings are sample-based.`
    : `All ${sample.rows.length} rows are included.`

  const system = `You are Ana, a senior analyst writing a focused, board-ready report from a dataset of ${sourceLabel} called "${dataset.name}".

CRITICAL: Use ONLY the data provided below. Never use outside knowledge. Every claim must trace to the rows. If the data is insufficient for part of the request, say so plainly rather than inventing.

${sampleNote}${sample.signalNote}

Write the report as a clean, self-contained HTML FRAGMENT (no <html>/<head>/<body>, no inline styles, no scripts) using only: <h2>, <h3>, <p>, <ul>/<ol>/<li>, <strong>, <em>, <blockquote>, and <table>/<thead>/<tbody>/<tr>/<th>/<td>. Open with an <h2> title and a 2-3 sentence executive summary. Use tables for any counts/breakdowns. Quote verbatim with <blockquote> where it strengthens a point. Keep it tight and specific — real numbers and quotes from the data, not filler.

Here is the dataset:
${sample.dataContext}`

  let bodyHtml = ''
  try {
    const res = await callAI({
      tier: 'advanced',
      system,
      messages: [{ role: 'user', content: `Write the report. The request: ${prompt}` }],
      maxTokens: 4000,
      timeoutMs: 110_000,   // large context + full report — generous within maxDuration 120
      usage: { org_id: dataset.org_id, resource_type: 'dataset', resource_id: dataset.id, event_type: 'adhoc_report' },
    })
    bodyHtml = (res.text || '').trim()
  } catch (e: unknown) {
    return serverError(e, 'datasets.adHocReport', { orgId })
  }
  if (!bodyHtml) return NextResponse.json({ error: 'The model returned an empty report.' }, { status: 502 })

  const html = pdfDoc({ title: dataset.name + ' — Report', body: `<div class="report-body">${bodyHtml}</div>`, extraCss: REPORT_CSS })

  if (format === 'html') {
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
  const pdf = await htmlToPdfBuffer(html, { format: 'a4', ...brandedPdfChrome({ brand: dataset.name }) })
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${dataset.name.replace(/[^\w.-]+/g, '_')}_Report.pdf"`,
    },
  })
}
