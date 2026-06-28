// app/api/collections/[id]/project-report/pdf/route.ts
// POST — the project report as a downloadable PDF, purpose-aware. Body:
// { purpose?: 'community'|'competitive'|'brand_360', primary?: <dataset_id> }
// (primary = the focus competitor for a competitive deep-dive). `[id]` =
// collection dataset_id.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildProjectReportForCollection, type ReportPurpose } from '@/lib/projectReportLoad'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PURPOSES: ReportPurpose[] = ['community', 'competitive', 'brand_360']

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { purpose?: string; primary?: string }
  const purpose = body.purpose && PURPOSES.includes(body.purpose as ReportPurpose) ? (body.purpose as ReportPurpose) : undefined
  const primaryId = typeof body.primary === 'string' ? body.primary : undefined

  const built = await buildProjectReportForCollection(id, { orgId, isAdmin }, purpose, primaryId)
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })

  const pdf = await htmlToPdfBuffer(built.html, { format: 'a4', ...brandedPdfChrome({ brand: built.name }) })
  const fileName = (built.name || 'Project').replace(/[^\w.-]+/g, '_') + '_' + built.purpose + '_Report.pdf'
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
