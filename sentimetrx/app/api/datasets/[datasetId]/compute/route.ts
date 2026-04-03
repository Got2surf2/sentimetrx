// app/api/datasets/[datasetId]/compute/route.ts
// POST -- compute analytics for a dataset and write to dataset_state.analytics
//
// Called automatically after every upload batch completes and after every sync.
// Can also be triggered manually from the Settings page (re-compute button).
//
// This is the ONLY place raw rows are fully read. Everything else reads
// dataset_state.analytics instead.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { computeAnalytics } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'

// Vercel Pro timeout is 30s. For very large datasets (>200k rows) this may
// need to move to a Supabase Edge Function or pg_cron job. For now the
// streaming approach handles up to ~100k rows well within 30s.
export const maxDuration = 30

interface Params { params: { datasetId: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
    const { data: sampleBatch } = await service
      .from('dataset_rows').select('rows').eq('dataset_id', params.datasetId).limit(1).single()
    const sampleRow: Record<string, unknown> = (sampleBatch?.rows as any[])?.[0] || {}
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

  // Stream through all batches and compute
  let analytics
  try {
    analytics = await computeAnalytics(service, params.datasetId, schema)
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
