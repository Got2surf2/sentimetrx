// app/api/reddit-sources/[sourceId]/download-thread/route.ts
// POST — download comments for a single thread (called per-thread from UI for progress)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { fetchThreadComments, type RedditComment } from '@/lib/reddit'
import { buildRedditSchema, enrichSchemaWithStats } from '@/lib/datasetUtils'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: { sourceId: string } }

const CHUNK_SIZE = 50

function commentToRow(c: RedditComment): Record<string, unknown> {
  var dateStr = c.created_utc
    ? new Date(c.created_utc * 1000).toISOString().split('T')[0]
    : ''
  return {
    comment_id: c.comment_id,
    author: c.author,
    body: c.body,
    score: c.score,
    post_date: dateStr,
    subreddit: c.subreddit,
    thread_title: c.thread_title,
    thread_id: c.thread_id,
    depth: c.depth,
    permalink: c.permalink ? 'https://www.reddit.com' + c.permalink : '',
  }
}

export async function POST(req: Request, { params }: Params) {
  try {
    var supabase = createClient()
    var { data: { user } } = await supabase.auth.getUser()
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
      var { data: existingBatches } = await service
        .from('dataset_rows').select('batch_index').eq('dataset_id', source.dataset_id)
        .order('batch_index', { ascending: false }).limit(1)
      var nextBatchIndex = existingBatches?.length ? existingBatches[0].batch_index + 1 : 0
      var { data: dsData } = await service
        .from('datasets').select('row_count').eq('id', source.dataset_id).single()
      var currentTotal = dsData?.row_count || 0

      for (var i = 0; i < rows.length; i += CHUNK_SIZE) {
        var chunk = rows.slice(i, i + CHUNK_SIZE)
        await service.from('dataset_rows').insert({
          dataset_id: source.dataset_id, rows: chunk, row_count: chunk.length,
          batch_index: nextBatchIndex, source_ref: 'reddit:' + syncTimestamp,
        })
        var flatRows = chunk.map(function(r, j) {
          return { dataset_id: source.dataset_id, row_index: nextBatchIndex * 200 + j, data: r }
        })
        try { await service.from('dataset_rows_flat').insert(flatRows) } catch {}
        currentTotal += chunk.length
        nextBatchIndex++
      }

      await service.from('datasets').update({
        row_count: currentTotal, last_synced_at: syncTimestamp, updated_at: syncTimestamp,
      }).eq('id', source.dataset_id)
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
  } catch (err: any) {
    console.error('[reddit/download-thread] error:', err)
    return NextResponse.json({ error: err?.message || 'Download failed' }, { status: 500 })
  }
}
