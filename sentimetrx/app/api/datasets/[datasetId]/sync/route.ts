import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { formatResponsesAsRows } from '@/lib/datasetUtils'
import type { Study } from '@/lib/types'

function serviceRole() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type Params = { params: { datasetId: string } }

// POST /api/datasets/[datasetId]/sync
// Appends new study responses since last_synced_at.
// Returns { synced, total, dataset_id }
export async function POST(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Load the dataset
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, study_id, row_count, last_synced_at, source')
    .eq('id', params.datasetId)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (dataset.source !== 'study' || !dataset.study_id) {
    return NextResponse.json({ error: 'This dataset is not linked to a study' }, { status: 400 })
  }

  // Load the study config
  const { data: study } = await supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, config, created_by, org_id, client_id, created_at')
    .eq('id', dataset.study_id)
    .single()

  if (!study) return NextResponse.json({ error: 'Linked study not found' }, { status: 404 })

  // Fetch responses created after last_synced_at
  let responsesQuery = supabase
    .from('responses')
    .select('id, nps_score, experience_score, sentiment, duration_sec, created_at, payload')
    .eq('study_id', dataset.study_id)

  if (dataset.last_synced_at) {
    responsesQuery = responsesQuery.gt('created_at', dataset.last_synced_at)
  }

  const { data: responses, error: respError } = await responsesQuery
  if (respError) return NextResponse.json({ error: respError.message }, { status: 500 })

  const newResponses = responses || []
  const syncedAt = new Date().toISOString()

  if (newResponses.length === 0) {
    // Nothing new -- still update last_synced_at
    const sr = serviceRole()
    await sr
      .from('datasets')
      .update({ last_synced_at: syncedAt, updated_at: syncedAt })
      .eq('id', params.datasetId)

    return NextResponse.json({
      synced:     0,
      total:      dataset.row_count,
      dataset_id: params.datasetId,
    })
  }

  // Format responses as flat rows
  const { rows, schema } = formatResponsesAsRows(newResponses as any, study as Study)

  // Get next batch index
  const { data: lastBatch } = await supabase
    .from('dataset_rows')
    .select('batch_index')
    .eq('dataset_id', params.datasetId)
    .order('batch_index', { ascending: false })
    .limit(1)
    .single()

  const nextBatchIndex = lastBatch ? lastBatch.batch_index + 1 : 0
  const sr = serviceRole()

  // Insert new batch
  const { error: batchError } = await sr
    .from('dataset_rows')
    .insert({
      dataset_id:  params.datasetId,
      rows,
      row_count:   rows.length,
      batch_index: nextBatchIndex,
      source_ref:  'study_sync_' + syncedAt,
    })

  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 500 })

  const newTotal = (dataset.row_count || 0) + rows.length

  // Update dataset metadata
  await sr
    .from('datasets')
    .update({
      row_count:      newTotal,
      last_synced_at: syncedAt,
      updated_at:     syncedAt,
    })
    .eq('id', params.datasetId)

  // If this is the first sync (batch_index === 0), also seed the schema_config
  // so the schema editor has the right field types pre-populated.
  if (nextBatchIndex === 0) {
    await sr
      .from('dataset_state')
      .update({
        schema_config: schema,
        updated_at:    syncedAt,
        updated_by:    user.id,
      })
      .eq('dataset_id', params.datasetId)
  }

  return NextResponse.json({
    synced:     rows.length,
    total:      newTotal,
    dataset_id: params.datasetId,
  })
}
