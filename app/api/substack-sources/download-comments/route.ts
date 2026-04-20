// app/api/substack-sources/download-comments/route.ts
// POST — download comments for a single Substack post and insert into dataset rows

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { fetchPostComments, commentToRow as substackCommentToRow } from '@/lib/substack'
import { ROWS_PER_BATCH } from '@/lib/constants'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 50

export async function POST(req: Request) {
  try {
    var supabase = createClient()
    var { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    var { data: userData } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    var orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    var body = await req.json()
    var { dataset_id, base_url, post_id, post_title, post_date } = body

    if (!dataset_id || !base_url || !post_id) {
      return NextResponse.json({ error: 'dataset_id, base_url, and post_id are required' }, { status: 400 })
    }

    var service = createServiceRoleClient()

    // Verify dataset ownership
    var { data: dataset } = await service
      .from('datasets').select('id, org_id, row_count')
      .eq('id', dataset_id).eq('org_id', orgId).single()
    if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

    // Fetch comments
    var comments = await fetchPostComments(base_url, post_id, post_title || '', post_date || '')

    if (comments.length === 0) {
      return NextResponse.json({ comments: 0, rows_inserted: 0 })
    }

    // Convert to rows
    var rows = comments.map(substackCommentToRow)

    // Insert rows into dataset
    var syncTimestamp = new Date().toISOString()
    var { data: existingBatches } = await service
      .from('dataset_rows').select('batch_index').eq('dataset_id', dataset_id)
      .order('batch_index', { ascending: false }).limit(1)
    var nextBatchIndex = existingBatches?.length ? existingBatches[0].batch_index + 1 : 0
    var currentTotal = dataset.row_count || 0

    for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
      var chunk = rows.slice(i, i + CHUNK_SIZE)
      await service.from('dataset_rows').insert({
        dataset_id: dataset_id, rows: chunk, row_count: chunk.length,
        batch_index: nextBatchIndex, source_ref: 'substack:' + syncTimestamp,
      })
      var flatRows = chunk.map(function(r, j) {
        return { dataset_id: dataset_id, row_index: nextBatchIndex * ROWS_PER_BATCH + j, data: r }
      })
      try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
      currentTotal += chunk.length
      nextBatchIndex++
    }

    await service.from('datasets').update({
      row_count: currentTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
    }).eq('id', dataset_id)

    return NextResponse.json({
      comments: comments.length,
      rows_inserted: rows.length,
    })
  } catch (err: any) {
    console.error('[substack/download-comments] error:', err)
    return NextResponse.json({ error: err?.message || 'Download failed' }, { status: 500 })
  }
}
