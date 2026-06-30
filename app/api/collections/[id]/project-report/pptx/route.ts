// app/api/collections/[id]/project-report/pptx/route.ts
// POST — the project report as a downloadable Datanautix PPTX, purpose-aware.
// Body: { purpose?: 'community'|'competitive'|'brand_360', primary?: <dataset_id> }
// (primary = the focus competitor for a competitive deep-dive). `[id]` =
// collection dataset_id. Mirrors the HTML/PDF routes; renders the model
// directly via lib/pptx/projectReportDeck.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildProjectModelForCollection, type ReportPurpose } from '@/lib/projectReportLoad'
import { renderProjectReportDeck } from '@/lib/pptx/projectReportDeck'

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

  const built = await buildProjectModelForCollection(id, { orgId, isAdmin }, purpose, primaryId)
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })

  const pptx = await renderProjectReportDeck(built)
  const fileName = (built.name || 'Project').replace(/[^\w.-]+/g, '_') + '_' + built.purpose + '_Report.pptx'
  return new Response(new Uint8Array(pptx), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
