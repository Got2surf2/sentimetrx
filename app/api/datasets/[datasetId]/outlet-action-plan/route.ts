// app/api/datasets/[datasetId]/outlet-action-plan/route.ts
// POST ?outlet=<place_id> — the Outlet Report's LLM-narrated "3 things to work on
// next" action plan for one outlet. Get-or-generate: cached per outlet in
// dataset_state.outlet_action_plans (sql/183), regenerated only when its basis
// (review count + theme READ verdicts) changes. Org-scoped like the report page.
//
// Why POST (2026-08-18): the cache key is `actionPlanBasis(reviews, themeTable)`,
// and this route used to rebuild those two inputs by re-running
// `computeOutletReport` — a full dataset_rows_flat scan (~7s) paid on EVERY page
// view, including pure cache hits. The page already rendered both values, so it
// posts them and the warm path costs one indexed read. On a cache MISS the route
// still scans and generates server-side, so nothing client-supplied is ever
// persisted into the shared plan cache.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletReport } from '@/lib/outletReport'
import { actionPlanBasis, getOrGenerateActionPlan } from '@/lib/outletActionPlan'
import type { ThemeTableRow } from '@/lib/outletReport'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The basis inputs as the page already has them. Only ever used to LOOK UP a
// cached plan — never to generate or store one — so a wrong value costs the
// caller a cache miss and nothing else.
function readBasisHint(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.reviews !== 'number' || !Number.isFinite(b.reviews)) return null
  if (!Array.isArray(b.themeTable)) return null
  const rows: ThemeTableRow[] = []
  for (const r of b.themeTable.slice(0, 40)) {
    if (typeof r !== 'object' || r === null) return null
    const row = r as Record<string, unknown>
    if (typeof row.theme !== 'string' || typeof row.read !== 'string') return null
    rows.push({ theme: row.theme, read: row.read as ThemeTableRow['read'], mentions: 0, avgStar: 0, pctNegative: 0 })
  }
  return actionPlanBasis(b.reviews, rows)
}

export async function POST(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
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

  // Fast path: the caller told us the basis, so try the cache before scanning.
  const hinted = await req.json().then(readBasisHint).catch(() => null)
  if (hinted) {
    const { plan } = await getOrGenerateActionPlan(service, datasetId, outlet, null, hinted, { cacheOnly: true })
    if (plan) return NextResponse.json({ plan, cached: true })
  }

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
