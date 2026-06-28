// app/api/collections/[id]/project-report/route.ts
// GET — the Project (brand-level) report as HTML, synthesized across every town
// hall + agent in the collection. `[id]` = the collection's dataset_id.
// Tenancy: admin-org may build cross-org (collections can live in a client org);
// non-admins are scoped to their own org.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildProjectReportForCollection } from '@/lib/projectReportLoad'
import { renderProjectReportHtml } from '@/lib/projectReportHtml'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const built = await buildProjectReportForCollection(id, { orgId, isAdmin })
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })

  return new Response(renderProjectReportHtml(built.model), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
