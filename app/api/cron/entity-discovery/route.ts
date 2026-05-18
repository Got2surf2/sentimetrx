// app/api/cron/entity-discovery/route.ts
// Cron endpoint: weekly entity-catalog refresh for every brand-collection.
// Re-samples each brand's datasets via Haiku NER and upserts any newly
// surfaced entities into entity_catalog.
//
// Brand scope only — plain (un-branded) datasets are NOT refreshed on a
// schedule. This bounds AI cost: brand-level analysis is the use case, and a
// brand's catalog is the one that benefits from staying fresh as new sources
// sync in. Plain datasets still get one-time discovery from the Schema-tab
// button (mode 'manual'); branded ones also get the once-per-dataset
// incremental run from the compute route (mode 'incremental').
//
// vercel.json config:
// { "crons": [{ "path": "/api/cron/entity-discovery", "schedule": "0 5 * * 0" }] }

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { discoverEntities } from '@/lib/entityDiscovery'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Safety guard on per-run work — discovery does paid AI calls and each brand
// takes a few seconds. Well above the current brand count; oldest-first
// ordering means any overflow is picked up on the next weekly run.
const MAX_BRANDS_PER_RUN = 50

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  const { data: brands, error } = await service
    .from('collections')
    .select('id, slug, dataset_id')
    .eq('kind', 'brand')
    .order('created_at', { ascending: true })
    .limit(MAX_BRANDS_PER_RUN)

  if (error) {
    console.error({ at: 'cron/entity-discovery', msg: "query error", err: error })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!brands?.length) {
    return NextResponse.json({ ok: true, brands_processed: 0, message: 'No brand-collections' })
  }

  const results: {
    brand: string
    entities_new: number
    entities_after: number
    cost_cents: number
    error: string | null
  }[] = []

  for (const brand of brands) {
    try {
      // discoverEntities resolves the brand-collection's virtual dataset to
      // its ('collection', brandCollectionId) scope and samples across every
      // member dataset. autoExcludeFromCurated=true checks the scope's
      // catalog for source='manual' rows by category and skips any category
      // with a meaningful curated set (default >=10 rows) — saves AI cost on
      // brands that already have a menu seed. Manual ("Discover" button) runs
      // do NOT auto-exclude — the user may want to re-explore even curated
      // categories.
      const r = await discoverEntities({
        service,
        datasetId:              brand.dataset_id,
        mode:                   'cron',
        autoExcludeFromCurated: true,
      })
      results.push({
        brand:          brand.slug || brand.id,
        entities_new:   r.entities_new,
        entities_after: r.entities_after,
        cost_cents:     r.cost_est_cents,
        error:          r.error,
      })
    } catch (err: any) {
      console.error({ at: 'cron/entity-discovery', msg: 'brand failed', brand: brand.slug, err })
      results.push({
        brand:          brand.slug || brand.id,
        entities_new:   0,
        entities_after: 0,
        cost_cents:     0,
        error:          err?.message || 'discovery failed',
      })
    }
  }

  const totalNew  = results.reduce((s, r) => s + r.entities_new, 0)
  const totalCost = results.reduce((s, r) => s + r.cost_cents, 0)

  return NextResponse.json({
    ok:                 true,
    brands_processed:   results.length,
    total_entities_new: totalNew,
    total_cost_cents:   totalCost,
    results,
  })
}
