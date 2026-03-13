// app/api/datasets/[datasetId]/sync/route.ts
// POST -- sync new study responses into an existing study-linked dataset,
//         then trigger analytics recompute.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { formatResponsesAsRows } from '@/lib/datasetUtils'
import { computeAnalytics } from '@/lib/analyticsCompute'

export const dynamic  = 'force-dynamic'
export const maxDuration = 30

interface Params { params: { datasetId: string } }

export async function POST(_req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: dataset, error: dsErr } = await service
    .from('datasets').select('*').eq('id', params.datasetId).single()

  if (dsErr || !dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (dataset.source !== 'study' || !dataset.study_id) {
    return NextResponse.json({ error: 'Dataset is not linked to a study' }, { status: 400 })
  }

  const { data: study, error: studyErr } = await service
    .from('studies').select('id, name, config').eq('id', dataset.study_id).single()

  if (studyErr || !study) return NextResponse.json({ error: 'Linked study not found' }, { status: 404 })

  let responsesQuery = service
    .from('responses')
    .select('id, created_at, nps_score, experience_score, sentiment, duration_sec, payload')
    .eq('study_id', dataset.study_id)
    .order('created_at', { ascending: true })

  if (dataset.last_synced_at) {
    responsesQuery = responsesQuery.gt('created_at', dataset.last_synced_at)
  }

  const { data: responses, error: respErr } = await responsesQuery
  if (respErr) return NextResponse.json({ error: respErr.message }, { status: 500 })

  const newResponses = responses || []

  const { count: totalCount } = await service
    .from('responses')
    .select('id', { count: 'exact', head: true })
    .eq('study_id', dataset.study_id)

  if (newResponses.length === 0) {
    return NextResponse.json({ synced: 0, total: totalCount || dataset.row_count, dataset_id: dataset.id })
  }

  const rows = formatResponsesAsRows(newResponses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])

  const { data: existingBatches } = await service
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', dataset.id)
    .order('batch_index', { ascending: false })
    .limit(1)

  const nextIndex     = existingBatches && existingBatches.length > 0 ? existingBatches[0].batch_index + 1 : 0
  const syncTimestamp = new Date().toISOString()

  const { error: batchErr } = await service
    .from('dataset_rows')
    .insert({ dataset_id: dataset.id, rows, row_count: rows.length, batch_index: nextIndex, source_ref: 'sync:' + syncTimestamp })

  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 })

  const newTotal = dataset.row_count + rows.length

  await service
    .from('datasets')
    .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
    .eq('id', dataset.id)

  // Re-compute analytics with the new data included
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config')
    .eq('dataset_id', dataset.id)
    .single()

  if (stateRow && stateRow.schema_config?.fields?.length > 0) {
    try {
      const analytics = await computeAnalytics(service, dataset.id, stateRow.schema_config)
      await service
        .from('dataset_state')
        .update({ analytics, updated_at: syncTimestamp, updated_by: user.id })
        .eq('dataset_id', dataset.id)
    } catch (err) {
      // Non-fatal: sync still succeeded, analytics will be stale
      console.error('[sync] analytics compute failed:', err)
    }
  }

  return NextResponse.json({ synced: rows.length, total: newTotal, dataset_id: dataset.id })
}
