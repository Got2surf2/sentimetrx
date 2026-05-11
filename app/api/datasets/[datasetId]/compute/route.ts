// app/api/datasets/[datasetId]/compute/route.ts
// POST -- compute analytics for a dataset and write to dataset_state.analytics
//
// Called automatically after every upload batch completes and after every sync.
// Can also be triggered manually from the Settings page (re-compute button).
//
// This is the ONLY place raw rows are fully read. Everything else reads
// dataset_state.analytics instead.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeAnalyticsSQL, computeAnalyticsFromRows } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'

// Vercel Pro timeout is 30s. For very large datasets (>200k rows) this may
// need to move to a Supabase Edge Function or pg_cron job. For now the
// streaming approach handles up to ~100k rows well within 30s.
export const maxDuration = 120

interface Params { params: { datasetId: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const { data: dataset } = await supabase.from('datasets').select('org_id, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  // ── Collection: fetch rows from member datasets and compute in-memory ────
  if ((dataset as any).source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (!col) return NextResponse.json({ error: 'Collection metadata not found' }, { status: 404 })
    const { data: colMembers } = await service.from('collection_members').select('dataset_id, label').eq('collection_id', col.id).order('sort_order')
    if (!colMembers?.length) return NextResponse.json({ error: 'Collection has no members' }, { status: 400 })

    const allRows: Record<string, unknown>[] = []
    const FLAT_PAGE = 1000
    for (var cm = 0; cm < colMembers.length; cm++) {
      var mid = colMembers[cm].dataset_id, mlabel = colMembers[cm].label
      var off = 0, more = true
      while (more) {
        var { data: fRows } = await service.from('dataset_rows_flat').select('data').eq('dataset_id', mid).order('row_index', { ascending: true }).range(off, off + FLAT_PAGE - 1)
        if (!fRows || fRows.length === 0) { more = false; break }
        for (var fri = 0; fri < fRows.length; fri++) allRows.push({ ...fRows[fri].data, _collection_label: mlabel })
        if (fRows.length < FLAT_PAGE) more = false
        off += FLAT_PAGE
      }
    }

    try {
      var colAnalytics = computeAnalyticsFromRows(allRows, schema)
      await service.from('dataset_state').update({ analytics: colAnalytics, updated_at: new Date().toISOString(), updated_by: user.id }).eq('dataset_id', params.datasetId)
      await service.from('datasets').update({ row_count: allRows.length, updated_at: new Date().toISOString() }).eq('id', params.datasetId)
      return NextResponse.json({ ok: true, totalRows: colAnalytics.totalRows, computedAt: colAnalytics.computedAt, fields: Object.keys(colAnalytics.fieldSummaries).length })
    } catch (err) {
      console.error('[compute/collection] error:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  let analytics
  try {
    analytics = await computeAnalyticsSQL(service, params.datasetId, schema)
  } catch (err) {
    console.error('[compute] error:', err)
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

  return NextResponse.json({
    ok:         true,
    totalRows:  analytics.totalRows,
    computedAt: analytics.computedAt,
    fields:     Object.keys(analytics.fieldSummaries).length,
  })
}
