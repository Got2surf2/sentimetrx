// app/api/ana/export-pdf/route.ts
// POST — compose Ana's findings (one exchange or the whole thread) into a
// branded PDF take-away. The client posts the answer content it already has
// (export routes POST the page's data, never recompute); figures are
// client-asserted, which is fine because the document returns to the
// requester alone. Auth mirrors ask-ana: caller must own the dataset's org.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { composeAnaFindingsHtml, type AnaExchange } from '@/lib/anaPdf'
import { brandedPdfChrome, htmlToPdfBuffer } from '@/lib/htmlToPdf'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_EXCHANGES = 30
const MAX_CHARS = 40000

export async function POST(req: Request) {
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { datasetId?: string; exchanges?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (!body.datasetId || !Array.isArray(body.exchanges) || body.exchanges.length === 0) {
    return NextResponse.json({ error: 'datasetId and exchanges are required' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, name, org_id').eq('id', body.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: 'You do not have access to this dataset' }, { status: 403 })
  }

  const exchanges: AnaExchange[] = []
  for (const raw of (body.exchanges as unknown[]).slice(0, MAX_EXCHANGES)) {
    if (typeof raw !== 'object' || raw === null) continue
    const o = raw as Record<string, unknown>
    const question = typeof o.question === 'string' ? o.question.slice(0, 2000) : ''
    const answer = typeof o.answer === 'string' ? o.answer.slice(0, MAX_CHARS) : ''
    if (!answer.trim()) continue
    const logic = Array.isArray(o.logic)
      ? (o.logic as unknown[]).filter(function(l): l is string { return typeof l === 'string' }).slice(0, 40)
      : undefined
    exchanges.push({ question: question || '(opening briefing)', answer, logic })
  }
  if (exchanges.length === 0) return NextResponse.json({ error: 'No exportable answers' }, { status: 400 })

  try {
    const html = composeAnaFindingsHtml({ datasetName: dataset.name, exchanges, generatedAt: new Date() })
    const chrome = brandedPdfChrome({ brand: dataset.name })
    const pdf = await htmlToPdfBuffer(html, chrome)
    const fname = (dataset.name || 'findings').replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_ana_findings.pdf'
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return serverError(err, 'ana.exportPdf', { orgId })
  }
}
