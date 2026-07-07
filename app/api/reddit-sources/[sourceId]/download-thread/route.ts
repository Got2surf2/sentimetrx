// app/api/reddit-sources/[sourceId]/download-thread/route.ts
// POST — download comments for a single thread (called per-thread from UI for progress)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { fetchThreadComments, commentToRow, type RedditComment } from '@/lib/reddit'
import { buildRedditSchema, enrichSchemaWithStats } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ sourceId: string }> }

const CHUNK_SIZE = 50

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  try {
    var supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    var { data: userData } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    var orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    var service = createServiceRoleClient()

    // Verify ownership
    var { data: source } = await service
      .from('reddit_sources')
      .select('id, dataset_id, org_id')
      .eq('id', params.sourceId)
      .eq('org_id', orgId)
      .single()
    if (!source || !source.dataset_id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    var datasetId = source.dataset_id as string

    var body = await req.json()
    var { thread_id, max_comments } = body
    if (!thread_id) return NextResponse.json({ error: 'thread_id required' }, { status: 400 })

    // Find the thread record
    var { data: thread } = await service
      .from('reddit_source_threads')
      .select('*')
      .eq('reddit_source_id', source.id)
      .eq('thread_id', thread_id)
      .single()
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    if (thread.total_pulled > 0) {
      return NextResponse.json({ comments: thread.total_pulled, skipped: true })
    }

    // Download comments
    var permalink = thread.permalink
    if (!permalink) {
      await service.from('reddit_source_threads').update({ error_message: 'No permalink' }).eq('id', thread.id)
      return NextResponse.json({ error: 'No permalink for thread' }, { status: 400 })
    }

    var { post, comments } = await fetchThreadComments(permalink, max_comments || 500)

    // Build rows
    var rows: Record<string, unknown>[] = []

    // Add post body if it has text
    if (post.selftext && post.selftext.trim()) {
      rows.push(commentToRow({
        comment_id: 'post_' + post.thread_id,
        thread_id: post.thread_id,
        subreddit: post.subreddit,
        thread_title: post.title,
        author: post.author,
        body: post.selftext,
        score: post.score,
        ups: post.ups,
        downs: post.downs,
        controversiality: 0,
        is_submitter: true,
        gilded: post.gilded,
        total_awards: post.total_awards,
        permalink: post.permalink,
        created_utc: post.created_utc,
        depth: -1,
        parent_id: '',
      }))
    }

    for (var c of comments) {
      rows.push(commentToRow(c))
    }

    // Insert rows
    if (rows.length > 0) {
      var syncTimestamp = new Date().toISOString()
      var { data: maxRowResp } = await service
        .from('dataset_rows_flat').select('row_index').eq('dataset_id', datasetId)
        .order('row_index', { ascending: false }).limit(1)
      var nextRowIndex = maxRowResp?.length ? maxRowResp[0].row_index + 1 : 0
      var { data: dsData } = await service
        .from('datasets').select('row_count').eq('id', datasetId).single()
      var currentTotal = dsData?.row_count || 0

      for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
        var chunk = rows.slice(i, i + CHUNK_SIZE)
        var flatRows = chunk.map(function(r, j) {
          return { dataset_id: datasetId, row_index: nextRowIndex + j, data: r }
        })
        await service.from('dataset_rows_flat').insert(flatRows)
        currentTotal += chunk.length
        nextRowIndex += chunk.length
      }

      await service.from('datasets').update({
        row_count: currentTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
      }).eq('id', datasetId)
    }

    // Update thread record
    await service.from('reddit_source_threads').update({
      total_pulled: comments.length,
    }).eq('id', thread.id)

    return NextResponse.json({
      comments: comments.length,
      has_post: post.selftext && post.selftext.trim() ? true : false,
      rows_inserted: rows.length,
    })
  } catch (err: unknown) {
    return serverError(err, 'redditSources.downloadThread', { orgId })
  }
}
