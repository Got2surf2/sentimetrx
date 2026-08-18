// app/api/datasets/[datasetId]/outlet-action-plan/route.ts
// GET ?outlet=<place_id> — the Outlet Report's LLM-narrated "3 things to work on
// next" action plan for one outlet. Get-or-generate: cached per outlet in
// dataset_state.outlet_action_plans (sql/183), regenerated only when its basis
// (review count + theme READ verdicts) changes. Org-scoped like the report page.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletReport } from '@/lib/outletReport'
import { actionPlanBasis, getOrGenerateActionPlan } from '@/lib/outletActionPlan'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params
  const outlet = new URL(req.url).searchParams.get('outlet')
  if (!outlet) return NextResponse.json({ error: 'Missing ?outlet=<place_id>' }, { status: 400 })

  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && ds.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const report = await computeOutletReport(datasetId, outlet)
  const s = report.selected
  if (!s || s.placeId !== outlet) return NextResponse.json({ error: 'No data for that outlet' }, { status: 404 })

  const basis = actionPlanBasis(s.reviews, s.snapshot.themeTable)

  // Cache read / generate / write-back lives in lib/outletActionPlan so the PDF
  // route shares the exact same semantics (see getOrGenerateActionPlan).
  const { plan, cached } = await getOrGenerateActionPlan(service, datasetId, outlet, {
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
  }, basis)

  return NextResponse.json({ plan, cached })

}
