// app/api/studies/[id]/analyze/route.ts
// POST — Create or find a dataset linked to this study, sync responses, redirect to Ana.
// First call: creates dataset + schema + syncs all completed responses.
// Subsequent: syncs only new responses since last sync.
// Returns { dataset_id, synced, total, created }

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { buildStudySchema, formatResponsesAsRows } from '@/lib/datasetUtils'
import { computeAnalytics, computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { ROWS_PER_BATCH } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: { id: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const studyId = params.id

  // Verify study exists and belongs to this org
  const { data: study } = await service
    .from('studies')
    .select('id, name, config, org_id')
    .eq('id', studyId)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  if (study.org_id !== userData.org_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Check for existing dataset linked to this study
  const { data: existing } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('source', 'study')
    .eq('study_id', studyId)
    .limit(1)

  let datasetId: string
  let created = false

  if (existing && existing.length > 0) {
    datasetId = existing[0].id
  } else {
    // Create new dataset
    const { data: newDs, error: createErr } = await service
      .from('datasets')
      .insert({
        name: study.name + ' \u2014 Analytics',
        source: 'study',
        study_id: studyId,
        org_id: userData.org_id,
        created_by: user.id,
        visibility: 'private',
        status: 'active',
        row_count: 0,
      })
      .select('id')
      .single()

    if (createErr || !newDs) {
      return NextResponse.json({ error: 'Failed to create dataset', detail: createErr?.message }, { status: 500 })
    }

    datasetId = newDs.id
    created = true

    // Create dataset_state with study schema
    const schema = buildStudySchema(study.config)
    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: schema,
      theme_model: { themes: [], aiGenerated: false, version: 1 },
    })
  }

  // Fetch all responses (complete + partial), newer than last sync
  const lastSynced = (!created && existing?.[0]?.last_synced_at) || null
  let respQuery = service
    .from('responses')
    .select('id, completed_at, nps_score, experience_score, sentiment, duration_sec, payload, status')
    .eq('study_id', studyId)
    .order('id', { ascending: true })

  if (lastSynced) {
    respQuery = respQuery.gt('completed_at', lastSynced)
  }

  const { data: responses, error: respErr } = await respQuery
  if (respErr) return NextResponse.json({ error: 'Failed to fetch responses', detail: respErr.message }, { status: 500 })

  if (!responses || responses.length === 0) {
    return NextResponse.json({ dataset_id: datasetId, synced: 0, total: existing?.[0]?.row_count || 0, created })
  }

  // Format responses as dataset rows
  const rows = formatResponsesAsRows(responses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])

  // Get next batch index
  const { data: existingBatches } = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)

  const nextIndex = existingBatches && existingBatches.length > 0 ? existingBatches[0].batch_index + 1 : 0
  const syncTimestamp = new Date().toISOString()

  // Insert batch
  const { error: batchErr } = await service
    .from('dataset_rows')
    .insert({ dataset_id: datasetId, rows, row_count: rows.length, batch_index: nextIndex, source_ref: 'study-sync:' + syncTimestamp })

  if (batchErr) return NextResponse.json({ error: 'Failed to insert rows', detail: batchErr.message }, { status: 500 })

  // Insert flat rows
  const flatRows = rows.map(function(r: Record<string, unknown>, i: number) {
    return { dataset_id: datasetId, row_index: nextIndex * ROWS_PER_BATCH + i, data: r }
  })
  if (flatRows.length > 0) {
    try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
  }

  const newTotal = (existing?.[0]?.row_count || 0) + rows.length

  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', datasetId)

  return NextResponse.json({ dataset_id: datasetId, synced: rows.length, total: newTotal, created })
}
