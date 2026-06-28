// app/api/collections/[id]/project-report/pdf/route.ts
// POST — the Project report as a downloadable PDF (headless Chrome). Same gate +
// pipeline as the HTML route. `[id]` = the collection's dataset_id.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildProjectReportForCollection } from '@/lib/projectReportLoad'
import { renderProjectReportHtml } from '@/lib/projectReportHtml'
import { htmlToPdfBuffer, brandedPdfChrome } from '@/lib/htmlToPdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const built = await buildProjectReportForCollection(id, { orgId, isAdmin })
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })

  const html = renderProjectReportHtml(built.model)
  const pdf = await htmlToPdfBuffer(html, {
    format: 'a4',
    ...brandedPdfChrome({ brand: built.model.name }),
  })
  const fileName = (built.model.name || 'Project').replace(/[^\w.-]+/g, '_') + '_Project_Report.pdf'
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
