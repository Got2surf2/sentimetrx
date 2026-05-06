// lib/redditSync.ts
// On-demand download of Reddit thread comments into dataset_rows_flat

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchThreadComments, commentToRow, type RedditComment } from './reddit'
import { buildRedditSchema, enrichSchemaWithStats } from './datasetUtils'
import { computeAnalyticsSQL } from './analyticsCompute'

export interface RedditSyncResult {
  total_comments: number
  total_posts: number
  threads_processed: number
  threads_remaining: number
  threads_errored: number
  errors: string[]
}

const CHUNK_SIZE = 50

/**
 * Download comments for all selected threads in a reddit_source.
 * Designed for on-demand use — call once, downloads everything.
 */
export async function syncRedditSource(
  sourceId: string,
  service: SupabaseClient,
  maxCommentsPerThread: number = 500,
): Promise<RedditSyncResult> {
  const result: RedditSyncResult = {
    total_comments: 0, total_posts: 0,
    threads_processed: 0, threads_remaining: 0, threads_errored: 0,
    errors: [],
  }

  // Load source
  const { data: source, error: srcErr } = await service
    .from('reddit_sources')
    .select('*')
    .eq('id', sourceId)
    .single()

  if (srcErr || !source) {
    result.errors.push('Source not found')
    return result
  }

  if (!source.dataset_id) {
    result.errors.push('No dataset linked to this source')
    return result
  }

  // Mark as downloading
  await service.from('reddit_sources').update({
    status: 'downloading', updated_at: new Date().toISOString(),
  }).eq('id', sourceId)

  // Load threads that need downloading
  const { data: threads } = await service
    .from('reddit_source_threads')
    .select('*')
    .eq('reddit_source_id', sourceId)
    .eq('selected', true)
    .is('error_message', null)
    .eq('total_pulled', 0)
    .order('score', { ascending: false })

  if (!threads?.length) {
    await service.from('reddit_sources').update({
      status: 'done', updated_at: new Date().toISOString(),
    }).eq('id', sourceId)
    return result
  }

  result.threads_remaining = threads.length
  const allRows: Record<string, unknown>[] = []

  for (const thread of threads) {
    try {
      const permalink = thread.permalink
      if (!permalink) {
        result.threads_errored++
        result.threads_remaining--
        await service.from('reddit_source_threads').update({
          error_message: 'No permalink',
        }).eq('id', thread.id)
        continue
      }

      const { post, comments } = await fetchThreadComments(permalink, maxCommentsPerThread)
      result.total_posts++

      // Add the post itself as a row (if it has body text)
      if (post.selftext && post.selftext.trim()) {
        allRows.push(commentToRow({
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
          depth: -1, // marks it as original post
          parent_id: '',
        }))
      }

      // Add all comments
      for (const comment of comments) {
        allRows.push(commentToRow(comment))
      }

      result.total_comments += comments.length
      result.threads_processed++
      result.threads_remaining--

      // Update thread record
      await service.from('reddit_source_threads').update({
        total_pulled: comments.length,
      }).eq('id', thread.id)

    } catch (err: any) {
      result.threads_errored++
      result.threads_remaining--
      result.errors.push(`${thread.subreddit}/${thread.thread_id}: ${err?.message || 'Unknown error'}`)
      await service.from('reddit_source_threads').update({
        error_message: (err?.message || 'Download failed').slice(0, 500),
      }).eq('id', thread.id)
    }
  }

  // Insert all rows into dataset
  if (allRows.length > 0) {
    await insertRedditRows(service, source.dataset_id, allRows)
    await ensureSchemaAndRecompute(service, source.dataset_id, allRows.slice(0, 100))
  }

  // Update source totals
  const finalStatus = result.threads_errored > 0 && result.threads_processed === 0 ? 'error' : 'done'
  await service.from('reddit_sources').update({
    status: finalStatus,
    total_posts: result.total_posts,
    total_comments: result.total_comments,
    error_message: result.errors.length > 0 ? result.errors.join('; ').slice(0, 500) : null,
    updated_at: new Date().toISOString(),
  }).eq('id', sourceId)

  return result
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function insertRedditRows(service: SupabaseClient, datasetId: string, rows: Record<string, unknown>[]): Promise<void> {
  const syncTimestamp = new Date().toISOString()
  const { data: maxRowResp } = await service
    .from('dataset_rows_flat').select('row_index').eq('dataset_id', datasetId)
    .order('row_index', { ascending: false }).limit(1)
  let nextRowIndex = maxRowResp?.length ? maxRowResp[0].row_index + 1 : 0
  const { data: dsData } = await service
    .from('datasets').select('row_count').eq('id', datasetId).single()
  let currentTotal = dsData?.row_count || 0

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)
    const flatRows = chunk.map(function(r, j) {
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

async function ensureSchemaAndRecompute(service: SupabaseClient, datasetId: string, sampleRows: Record<string, unknown>[]): Promise<void> {
  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config').eq('dataset_id', datasetId).single()
  let schema = stateRow?.schema_config
  if (!schema?.fields?.length) {
    schema = buildRedditSchema()
    schema = enrichSchemaWithStats(schema, sampleRows)
    await service.from('dataset_state').update({
      schema_config: schema, updated_at: new Date().toISOString(),
    }).eq('dataset_id', datasetId)
  }
  if (schema?.fields?.length) {
    try {
      const analytics = await computeAnalyticsSQL(service, datasetId, schema)
      await service.from('dataset_state').update({
        analytics, updated_at: new Date().toISOString(),
      }).eq('dataset_id', datasetId)
    } catch (err) { console.error('[redditSync] analytics compute failed:', err) }
  }
}
