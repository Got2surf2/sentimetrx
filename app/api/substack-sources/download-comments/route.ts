// app/api/substack-sources/download-comments/route.ts
// POST — download comments for a single Substack post and insert into dataset rows

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { fetchPostComments, commentToRow as substackCommentToRow } from '@/lib/substack'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CHUNK_SIZE = 50

export async function POST(req: Request) {
  try {
    var supabase = await createClient()
    const user = await getAuthUser(supabase)
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
    var { data: maxRowResp } = await service
      .from('dataset_rows_flat').select('row_index').eq('dataset_id', dataset_id)
      .order('row_index', { ascending: false }).limit(1)
    var nextRowIndex = maxRowResp?.length ? maxRowResp[0].row_index + 1 : 0
    var currentTotal = dataset.row_count || 0

    for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
      var chunk = rows.slice(i, i + CHUNK_SIZE)
      var flatRows = chunk.map(function(r, j) {
        return { dataset_id: dataset_id, row_index: nextRowIndex + j, data: r }
      })
      await service.from('dataset_rows_flat').insert(flatRows)
      currentTotal += chunk.length
      nextRowIndex += chunk.length
    }

    await service.from('datasets').update({
      row_count: currentTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
    }).eq('id', dataset_id)

    return NextResponse.json({
      comments: comments.length,
      rows_inserted: rows.length,
    })
  } catch (err: unknown) {
    return serverError(err, 'substackSources.downloadComments', { orgId })
  }
}
