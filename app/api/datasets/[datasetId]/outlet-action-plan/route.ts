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
import { generateActionPlan, actionPlanBasis, type ActionPlan } from '@/lib/outletActionPlan'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CacheEntry = { basis: string; plan: ActionPlan; generatedAt: string }

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

  // Serve the cached plan if its basis still matches.
  const { data: state } = await service.from('dataset_state').select('outlet_action_plans').eq('dataset_id', datasetId).maybeSingle()
  const cache = (state?.outlet_action_plans || {}) as Record<string, CacheEntry>
  const hit = cache[outlet]
  if (hit && hit.basis === basis && hit.plan) {
    return NextResponse.json({ plan: hit.plan, cached: true })
  }

  const plan = await generateActionPlan({
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
  })

  // Write-through the cache with an atomic top-level merge (per-outlet key), so
  // concurrent generation for different outlets can't lose-update the map.
  try {
    const entry: CacheEntry = { basis, plan, generatedAt: plan.generatedAt }
    // Ensure a dataset_state row exists, then atomically merge the one key in.
    // p_patch must be a jsonb OBJECT (not a stringified string, which arrives as
    // a scalar and corrupts the `||` merge).
    await service.from('dataset_state').upsert({ dataset_id: datasetId }, { onConflict: 'dataset_id', ignoreDuplicates: true })
    await service.rpc('merge_outlet_action_plan', { p_dataset_id: datasetId, p_patch: { [outlet]: entry } })
  } catch (e) {
    void logError('outlet-action-plan.cache', e) // non-fatal — still return the fresh plan
  }

  return NextResponse.json({ plan, cached: false })
}
