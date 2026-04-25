// app/api/datasets/[datasetId]/sync/route.ts
// POST -- sync new study responses into an existing study-linked dataset,
//         then trigger analytics recompute.
// Always does a full resync: delete existing rows, re-import all responses.
// This prevents duplicates and ensures counts match.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { formatResponsesAsRows } from '@/lib/datasetUtils'
import { computeAnalytics, computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { ROWS_PER_BATCH } from '@/lib/constants'

export const dynamic  = 'force-dynamic'
export const maxDuration = 30

interface Params { params: { datasetId: string } }

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceRoleClient()

    const { data: dataset, error: dsErr } = await service
      .from('datasets').select('*').eq('id', params.datasetId).single()

    if (dsErr || !dataset) return NextResponse.json({ error: 'Dataset not found', detail: dsErr?.message }, { status: 404 })
    if (dataset.source !== 'study' || !dataset.study_id) {
      return NextResponse.json({ error: 'Dataset is not linked to a study' }, { status: 400 })
    }

    const { data: study, error: studyErr } = await service
      .from('studies').select('id, name, config').eq('id', dataset.study_id).single()

    if (studyErr || !study) return NextResponse.json({ error: 'Linked study not found', detail: studyErr?.message }, { status: 404 })

    // Always do a clean resync: delete existing rows first to prevent duplicates
    await service.from('dataset_rows_flat').delete().eq('dataset_id', params.datasetId)
    await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)

    // Fetch ALL responses for this study
    const { data: responses, error: respErr } = await service
      .from('responses')
      .select('id, completed_at, nps_score, experience_score, sentiment, duration_sec, payload, status')
      .eq('study_id', dataset.study_id)
      .order('id', { ascending: true })

    if (respErr) return NextResponse.json({ error: 'Failed to query responses', detail: respErr.message }, { status: 500 })

    const allResponses = responses || []

    if (allResponses.length === 0) {
      await service.from('datasets').update({ row_count: 0, last_synced_at: new Date().toISOString() }).eq('id', params.datasetId)
      return NextResponse.json({ synced: 0, total: 0, dataset_id: dataset.id })
    }

    const rows = formatResponsesAsRows(allResponses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])
    const syncTimestamp = new Date().toISOString()

    // Insert into batched table
    const { error: batchErr } = await service
      .from('dataset_rows')
      .insert({ dataset_id: dataset.id, rows, row_count: rows.length, batch_index: 0, source_ref: 'sync:' + syncTimestamp })

    if (batchErr) return NextResponse.json({ error: 'Failed to insert rows', detail: batchErr.message }, { status: 500 })

    // Insert into flat table (paginated to avoid payload limits)
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(function(r: Record<string, unknown>, j: number) {
        return { dataset_id: dataset.id, row_index: i + j, data: r }
      })
      await service.from('dataset_rows_flat').insert(chunk)
    }

    // Update dataset metadata
    await service
      .from('datasets')
      .update({ row_count: rows.length, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
      .eq('id', dataset.id)

    // Re-compute analytics
    const { data: stateRow } = await service
      .from('dataset_state')
      .select('schema_config')
      .eq('dataset_id', dataset.id)
      .single()

    if (stateRow && stateRow.schema_config?.fields?.length > 0) {
      try {
        const analytics = await computeAnalyticsSQL(service, dataset.id, stateRow.schema_config)
        await service
          .from('dataset_state')
          .update({ analytics, updated_at: syncTimestamp, updated_by: user.id })
          .eq('dataset_id', dataset.id)
      } catch (err) {
        console.error('[sync] analytics compute failed:', err)
      }
    }

    return NextResponse.json({ synced: rows.length, total: rows.length, dataset_id: dataset.id })
  } catch (err: any) {
    console.error('[sync] unhandled error:', err)
    return NextResponse.json({ error: 'Internal sync error', detail: err?.message || String(err) }, { status: 500 })
  }
}
