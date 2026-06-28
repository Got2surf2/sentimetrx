// app/api/collections/[id]/project-report/route.ts
// GET — the project report as HTML, purpose-aware (community | competitive |
// brand_360). `?purpose=` overrides the smart default. `[id]` = collection
// dataset_id. Admin-org may build cross-org; non-admins are org-scoped.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { buildProjectReportForCollection, type ReportPurpose } from '@/lib/projectReportLoad'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PURPOSES: ReportPurpose[] = ['community', 'competitive', 'brand_360']

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = new URL(req.url).searchParams.get('purpose')
  const purpose = raw && PURPOSES.includes(raw as ReportPurpose) ? (raw as ReportPurpose) : undefined

  const built = await buildProjectReportForCollection(id, { orgId, isAdmin }, purpose)
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })

  return new Response(built.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
