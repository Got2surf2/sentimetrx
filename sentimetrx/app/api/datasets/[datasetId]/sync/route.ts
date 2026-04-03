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

export async function POST(req: Request, { params }: Params) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceRoleClient()

    // ?full=true clears all existing rows and re-imports from scratch
    const url     = new URL(req.url)
    const fullSync = url.searchParams.get('full') === 'true'

    const { data: dataset, error: dsErr } = await service
      .from('datasets').select('*').eq('id', params.datasetId).single()

    if (dsErr || !dataset) return NextResponse.json({ error: 'Dataset not found', detail: dsErr?.message }, { status: 404 })
    if (dataset.source !== 'study' || !dataset.study_id) {
      return NextResponse.json({ error: 'Dataset is not linked to a study' }, { status: 400 })
    }

    const { data: study, error: studyErr } = await service
      .from('studies').select('id, name, config').eq('id', dataset.study_id).single()

    if (studyErr || !study) return NextResponse.json({ error: 'Linked study not found', detail: studyErr?.message }, { status: 404 })

    // Full resync: delete existing rows so we start clean
    if (fullSync) {
      await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)
      await service.from('datasets').update({ row_count: 0, last_synced_at: null }).eq('id', params.datasetId)
      // Reload dataset with cleared values
      const { data: refreshed } = await service.from('datasets').select('*').eq('id', params.datasetId).single()
      if (refreshed) Object.assign(dataset, refreshed)
    }

    let responsesQuery = service
      .from('responses')
      .select('id, completed_at, nps_score, experience_score, sentiment, duration_sec, payload')
      .eq('study_id', dataset.study_id)
      .not('completed_at', 'is', null)   // exclude partial/incomplete responses
      .order('completed_at', { ascending: true })

    if (dataset.last_synced_at) {
      responsesQuery = responsesQuery.gt('completed_at', dataset.last_synced_at)
    }

    const { data: responses, error: respErr } = await responsesQuery
    if (respErr) return NextResponse.json({ error: 'Failed to query responses', detail: respErr.message }, { status: 500 })

    const newResponses = responses || []

    const { count: totalCount } = await service
      .from('responses')
      .select('id', { count: 'exact', head: true })
      .eq('study_id', dataset.study_id)

    if (newResponses.length === 0) {
      return NextResponse.json({
        synced: 0,
        total: totalCount || dataset.row_count,
        dataset_id: dataset.id,
        debug: {
          study_id: dataset.study_id,
          last_synced_at: dataset.last_synced_at,
          total_responses_found: totalCount,
          responses_queried: newResponses.length,
        }
      })
    }

    // Debug: trace q3/q4 data from first few responses
    const sampleSize = Math.min(3, newResponses.length)
    for (let di = 0; di < sampleSize; di++) {
      const r = newResponses[di] as any
      console.log('[sync/bridge] response', di, 'id:', r.id)
      console.log('[sync/bridge]   payload keys:', r.payload ? Object.keys(r.payload) : 'no payload')
      console.log('[sync/bridge]   openEnded (q1=nps_followup, q2=exp_followup, q3/q4=open):', r.payload?.openEnded)
      console.log('[sync/bridge]   customAnswers keys:', r.payload?.customAnswers ? Object.keys(r.payload.customAnswers) : 'none')
    }

    const rows = formatResponsesAsRows(newResponses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])

    // Debug: show what q3_response/q4_response look like in the first few rows
    for (let ri = 0; ri < Math.min(3, rows.length); ri++) {
      const row = rows[ri] as any
      console.log('[sync/bridge] row', ri, '→ nps_followup:', JSON.stringify(row.nps_followup), '| experience_followup:', JSON.stringify(row.experience_followup), '| q3_response:', JSON.stringify(row.q3_response), '| q4_response:', JSON.stringify(row.q4_response))
      console.log('[sync/bridge] row', ri, '→ all open-ended keys:', Object.entries(row).filter(([, v]) => typeof v === 'string' && v.length > 20).map(([k]) => k))
    }

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

    if (batchErr) return NextResponse.json({ error: 'Failed to insert rows', detail: batchErr.message }, { status: 500 })

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
  } catch (err: any) {
    console.error('[sync] unhandled error:', err)
    return NextResponse.json({ error: 'Internal sync error', detail: err?.message || String(err) }, { status: 500 })
  }
}
