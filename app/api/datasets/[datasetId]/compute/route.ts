// app/api/datasets/[datasetId]/compute/route.ts
// POST -- compute analytics for a dataset and write to dataset_state.analytics
//
// Called automatically after every upload batch completes and after every sync.
// Can also be triggered manually from the Settings page (re-compute button).
//
// This is the ONLY place raw rows are fully read. Everything else reads
// dataset_state.analytics instead.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { recomputeCollectionAnalytics } from '@/lib/collectionRecompute'
import { rebuildBrandSchema, discoverBrandEntitiesIfNeeded } from '@/lib/brandRules'

export const dynamic = 'force-dynamic'

// Vercel Pro timeout is 30s. For very large datasets (>200k rows) this may
// need to move to a Supabase Edge Function or pg_cron job. For now the
// streaming approach handles up to ~100k rows well within 30s.
export const maxDuration = 120

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  const service = createServiceRoleClient()

  // Load current schema from dataset_state
  const { data: stateRow, error: stateErr } = await service
    .from('dataset_state')
    .select('id, schema_config')
    .eq('dataset_id', params.datasetId)
    .single()

  if (stateErr || !stateRow) {
    return NextResponse.json({ error: 'dataset_state not found — upload schema first' }, { status: 404 })
  }

  // Brand-collections: rebuild the merged schema from current members before
  // computing. Member schemas fill in over time (uploads load rows, sources
  // sync), so a brand built earlier can have a stale or empty schema until
  // this runs. Mutates stateRow.schema_config so the checks below see it.
  if ((dataset as any).source === 'collection') {
    const { data: brandCol } = await service
      .from('collections').select('id, kind').eq('dataset_id', params.datasetId).single()
    if (brandCol && (brandCol as any).kind === 'brand') {
      await rebuildBrandSchema(service, (brandCol as any).id)
      const { data: refreshed } = await service
        .from('dataset_state').select('schema_config').eq('dataset_id', params.datasetId).single()
      if (refreshed) stateRow.schema_config = refreshed.schema_config
    }
  }

  const schema = stateRow.schema_config
  if (!schema || !schema.fields || schema.fields.length === 0) {
    return NextResponse.json({ error: 'Schema is empty — configure fields before computing' }, { status: 400 })
  }

  // Auto-detect demo_* / psycho_* columns in row data that are missing from schema.
  // Handles studies where demoFields weren't in config at auto-setup time, or where
  // the survey engine used hardcoded default demographics (age, gender, zip).
  try {
    const { data: sampleFlat } = await service
      .from('dataset_rows_flat').select('data').eq('dataset_id', params.datasetId).limit(1).single()
    const sampleRow: Record<string, unknown> = (sampleFlat?.data as Record<string, unknown>) || {}
    const existingCols = new Set(schema.fields.map((f: any) => f.field as string))
    const newFields: any[] = []
    for (const col of Object.keys(sampleRow)) {
      if (existingCols.has(col)) continue
      const colLower = col.toLowerCase()
      if (colLower.startsWith('demo_') || colLower.startsWith('psycho_')) {
        const prefix  = colLower.startsWith('demo_') ? 'demo_' : 'psycho_'
        const section = prefix === 'demo_' ? 'demographic' : 'psychographic'
        const rawKey  = col.slice(prefix.length)
        const label   = rawKey.charAt(0).toUpperCase() + rawKey.slice(1).replace(/_/g, ' ')
        newFields.push({ field: col, type: 'categorical', section, label })
      }
    }
    if (newFields.length > 0) {
      schema.fields = [...schema.fields, ...newFields]
      await service.from('dataset_state')
        .update({ schema_config: schema })
        .eq('dataset_id', params.datasetId)
    }
  } catch (_e) {
    // Non-fatal: if sample fetch fails, proceed with existing schema
  }

  // ── Collection: recompute aggregates from member rows (shared with the
  // member-sync cascade in lib/collectionRecompute). ───────────────────────
  if ((dataset as any).source === 'collection') {
    try {
      const res = await recomputeCollectionAnalytics(service, params.datasetId, user.id)
      if (!res) return NextResponse.json({ error: 'Collection has no members or schema' }, { status: 400 })
      return NextResponse.json({ ok: true, totalRows: res.analytics.totalRows, computedAt: res.analytics.computedAt, fields: Object.keys(res.analytics.fieldSummaries).length })
    } catch (err) {
      console.error({ at: 'compute/collection', msg: "error", err: err })
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  let analytics
  try {
    analytics = await computeAnalyticsSQL(service, params.datasetId, schema)
  } catch (err) {
    console.error({ at: 'compute', msg: "error", err: err })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }

  // Write analytics back to dataset_state
  const { error: updateErr } = await service
    .from('dataset_state')
    .update({
      analytics:  analytics,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('dataset_id', params.datasetId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // Phase 6: if this is a branded dataset and its rows have just landed,
  // discover its entities into the brand catalog. Runs once per dataset
  // (gated inside) and only does paid AI work the first time — backgrounded
  // via waitUntil so it never adds latency to the compute response.
  waitUntil(
    discoverBrandEntitiesIfNeeded(service, params.datasetId).catch(err => {
      console.error({ at: 'compute', msg: "brand entity discovery failed", err: err })
    }),
  )

  return NextResponse.json({
    ok:         true,
    totalRows:  analytics.totalRows,
    computedAt: analytics.computedAt,
    fields:     Object.keys(analytics.fieldSummaries).length,
  })
}
