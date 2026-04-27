// POST — download a batch of comments from regulations.gov into a dataset
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { listComments, fetchCommentsBatch, commentToRow } from '@/lib/regulations'
import { enrichSchemaWithStats } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { ROWS_PER_BATCH } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 500

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { dataset_id, docket_id, page, finalize, use_search } = body

  if (!dataset_id || !docket_id) return NextResponse.json({ error: 'dataset_id and docket_id required' }, { status: 400 })

  const service = createServiceRoleClient()

  // If finalizing (last step), compute analytics and mark complete
  if (finalize) {
    try {
      const { data: stateRow } = await service.from('dataset_state').select('schema_config').eq('dataset_id', dataset_id).single()
      const schema = stateRow?.schema_config
      if (schema?.fields?.length) {
        const { data: sampleBatch } = await service.from('dataset_rows').select('rows').eq('dataset_id', dataset_id).limit(1)
        if (sampleBatch?.[0]?.rows) {
          const enriched = enrichSchemaWithStats(schema, sampleBatch[0].rows)
          await service.from('dataset_state').update({ schema_config: enriched, updated_at: new Date().toISOString() }).eq('dataset_id', dataset_id)
        }
        const analytics = await computeAnalyticsSQL(service, dataset_id, schema)
        await service.from('dataset_state').update({ analytics, updated_at: new Date().toISOString() }).eq('dataset_id', dataset_id)
      }
    } catch (err) {
      console.error('[regulations] analytics compute failed:', err)
    }
    // Mark download as complete in description
    try {
      const { data: ds } = await service.from('datasets').select('description').eq('id', dataset_id).single()
      if (ds?.description) {
        const meta = typeof ds.description === 'string' ? JSON.parse(ds.description) : ds.description
        meta.download_status = 'complete'
        await service.from('datasets').update({ description: JSON.stringify(meta) }).eq('id', dataset_id)
      }
    } catch {}
    return NextResponse.json({ ok: true })
  }

  // Step 1: List comment IDs for this page (10 per batch to stay within 60s timeout)
  const listResult = await listComments(docket_id, page || 1, 10, use_search || false)
  console.log('[regulations-dl] page', page, 'listed', listResult.data.length, 'total', listResult.totalElements, 'usedSearch', listResult.usedSearch)
  const commentIds = listResult.data.map(function(c) { return c.id })

  if (commentIds.length === 0) {
    return NextResponse.json({ inserted: 0, fetched: 0, totalElements: listResult.totalElements, lastPage: listResult.lastPage, usedSearch: listResult.usedSearch || false })
  }

  // Step 2: Fetch full text for each comment
  const details = await fetchCommentsBatch(commentIds)

  // Step 3: Convert to rows and insert
  const rows = details.map(commentToRow).filter(Boolean) as Record<string, unknown>[]

  if (rows.length > 0) {
    const syncTimestamp = new Date().toISOString()
    const { data: existingBatches } = await service
      .from('dataset_rows').select('batch_index').eq('dataset_id', dataset_id)
      .order('batch_index', { ascending: false }).limit(1)
    let nextBatchIndex = existingBatches?.length ? existingBatches[0].batch_index + 1 : 0
    const { data: dsData } = await service
      .from('datasets').select('row_count').eq('id', dataset_id).single()
    let currentTotal = dsData?.row_count || 0

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE)
      await service.from('dataset_rows').insert({
        dataset_id, rows: chunk, row_count: chunk.length,
        batch_index: nextBatchIndex, source_ref: 'regulations:' + syncTimestamp,
      })
      const flatRows = chunk.map(function(r, j) {
        return { dataset_id, row_index: nextBatchIndex * ROWS_PER_BATCH + j, data: r }
      })
      try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
      currentTotal += chunk.length
      nextBatchIndex++
    }

    await service.from('datasets').update({
      row_count: currentTotal, updated_at: syncTimestamp,
    }).eq('id', dataset_id)
  }

  // Update download progress in description
  try {
    const { data: ds } = await service.from('datasets').select('description').eq('id', dataset_id).single()
    if (ds?.description) {
      const meta = typeof ds.description === 'string' ? JSON.parse(ds.description) : ds.description
      meta.next_page = (page || 1) + 1
      if (listResult.usedSearch) meta.use_search = true
      await service.from('datasets').update({ description: JSON.stringify(meta) }).eq('id', dataset_id)
    }
  } catch {}

  return NextResponse.json({
    inserted: rows.length,
    fetched: commentIds.length,
    totalElements: listResult.totalElements,
    lastPage: listResult.lastPage,
    usedSearch: listResult.usedSearch || false,
  })
}
