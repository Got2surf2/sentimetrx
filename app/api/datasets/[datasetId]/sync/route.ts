// app/api/datasets/[datasetId]/sync/route.ts
// POST -- incremental sync: only insert responses not already in the dataset.
// Deduplicates by response_id stored inside each flat row's data field.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { formatResponsesAsRows } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'

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

    // ?full=true: wipe all rows and re-import from scratch (for schema changes, field additions, etc.)
    const url = new URL(req.url)
    const fullSync = url.searchParams.get('full') === 'true'

    if (fullSync) {
      await service.from('dataset_rows_flat').delete().eq('dataset_id', params.datasetId)
      await service.from('dataset_rows').delete().eq('dataset_id', params.datasetId)
    }

    // Collect existing response_ids from flat table to skip duplicates
    const existingIds = new Set<string>()
    let offset = 0
    const PAGE = 1000
    while (true) {
      const { data: batch } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', params.datasetId)
        .range(offset, offset + PAGE - 1)
      if (!batch || batch.length === 0) break
      for (const row of batch) {
        const rid = (row.data as any)?.response_id
        if (rid) existingIds.add(String(rid))
      }
      if (batch.length < PAGE) break
      offset += PAGE
    }

    // Fetch all responses from the study
    const { data: responses, error: respErr } = await service
      .from('responses')
      .select('id, completed_at, nps_score, experience_score, sentiment, duration_sec, payload, status')
      .eq('study_id', dataset.study_id)
      .order('id', { ascending: true })

    if (respErr) return NextResponse.json({ error: 'Failed to query responses', detail: respErr.message }, { status: 500 })

    // Filter to only new responses
    const newResponses = (responses || []).filter(r => !existingIds.has(String(r.id)))

    if (newResponses.length === 0) {
      return NextResponse.json({ synced: 0, total: existingIds.size, dataset_id: dataset.id })
    }

    const newRows = formatResponsesAsRows(newResponses as Parameters<typeof formatResponsesAsRows>[0], study as Parameters<typeof formatResponsesAsRows>[1])
    const syncTimestamp = new Date().toISOString()

    // Determine next row_index (after existing rows)
    const startIndex = existingIds.size

    // Insert new rows into flat table
    const CHUNK = 500
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const chunk = newRows.slice(i, i + CHUNK).map(function(r: Record<string, unknown>, j: number) {
        return { dataset_id: dataset.id, row_index: startIndex + i + j, data: r }
      })
      await service.from('dataset_rows_flat').insert(chunk)
    }

    // Insert into batched table
    const { data: lastBatch } = await service
      .from('dataset_rows')
      .select('batch_index')
      .eq('dataset_id', dataset.id)
      .order('batch_index', { ascending: false })
      .limit(1)

    const nextBatch = lastBatch && lastBatch.length > 0 ? lastBatch[0].batch_index + 1 : 0
    await service
      .from('dataset_rows')
      .insert({ dataset_id: dataset.id, rows: newRows, row_count: newRows.length, batch_index: nextBatch, source_ref: 'sync:' + syncTimestamp })

    // Update dataset metadata
    const newTotal = existingIds.size + newRows.length
    await service
      .from('datasets')
      .update({ row_count: newTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp })
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

    return NextResponse.json({ synced: newRows.length, total: newTotal, dataset_id: dataset.id })
  } catch (err: any) {
    console.error('[sync] unhandled error:', err)
    return NextResponse.json({ error: 'Internal sync error', detail: err?.message || String(err) }, { status: 500 })
  }
}
