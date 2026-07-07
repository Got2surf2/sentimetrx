// app/api/reddit-sources/route.ts
// POST /api/reddit-sources — create a reddit source + dataset (no auto-download)

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { emptySchemaConfig, emptyThemeModel } from '@/lib/datasetUtils'
import { serverError } from '@/lib/apiError'
import { resolveOrg } from '@/lib/resolveOrg'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface RedditThreadInput {
  thread_id: string
  subreddit: string
  title?: string
  author?: string | null
  score?: number
  comment_count?: number
  permalink?: string | null
  created_utc?: number | null
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id, organizations(features, is_admin_org)')
      .eq('id', user.id)
      .single()

    const orgData = resolveOrg(userData?.organizations)
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    const orgId = userData?.org_id
    if (!orgId) return NextResponse.json({ error: 'Org not found' }, { status: 403 })

    const body = await req.json()
    const { search_query, dataset_name, threads, max_comments_per_thread, brand_tag } = body

    if (!search_query?.trim()) return NextResponse.json({ error: 'search_query is required' }, { status: 400 })
    if (!threads?.length) return NextResponse.json({ error: 'At least one thread is required' }, { status: 400 })

    const service = createServiceRoleClient()

    // 1. Create dataset
    const dsName = (dataset_name || `Reddit: ${search_query.trim()}`).trim()
    const subreddits = Array.from(new Set((threads as RedditThreadInput[]).map(function(t) { return t.subreddit })))
    const { data: dataset, error: dsErr } = await service
      .from('datasets')
      .insert({
        name:        dsName,
        description: JSON.stringify({ type: 'reddit', query: search_query.trim(), subreddits, threads: threads.length }),
        source:      'reddit',
        org_id:      orgId,
        created_by:  user.id,
        visibility:  'private',
        status:      'active',
        row_count:   0,
        brand_tag:   (brand_tag && brand_tag.trim()) || null,
      })
      .select('id')
      .single()

    if (dsErr) return serverError(dsErr, 'redditSources.create.dataset', { orgId })

    // 2. Create dataset_state
    await service.from('dataset_state').insert({
      dataset_id:    dataset.id,
      schema_config: emptySchemaConfig(),
      theme_model:   emptyThemeModel(),
      saved_charts:  [],
      saved_stats:   [],
      filter_state:  {},
      updated_by:    user.id,
    })

    // 3. Create reddit source
    const { data: source, error: srcErr } = await service
      .from('reddit_sources')
      .insert({
        org_id:        orgId,
        dataset_id:    dataset.id,
        search_query:  search_query.trim(),
        subreddits:    subreddits,
        status:        'pending',
        created_by:    user.id,
      })
      .select('id')
      .single()

    if (srcErr) return serverError(srcErr, 'redditSources.create.source', { orgId })

    // 4. Insert all selected threads
    const threadRows = (threads as RedditThreadInput[]).map(function(t) {
      return {
        reddit_source_id: source.id,
        thread_id:        t.thread_id,
        subreddit:        t.subreddit,
        title:            t.title || '',
        author:           t.author || null,
        score:            t.score || 0,
        comment_count:    t.comment_count || 0,
        permalink:        t.permalink || null,
        created_utc:      t.created_utc ? new Date(t.created_utc * 1000).toISOString() : null,
        selected:         true,
      }
    })

    const { error: thrErr } = await service
      .from('reddit_source_threads')
      .insert(threadRows)

    if (thrErr) return serverError(thrErr, 'redditSources.create.threads', { orgId })

    return NextResponse.json({
      source_id:  source.id,
      dataset_id: dataset.id,
      threads:    threads.length,
      status:     'created',
    }, { status: 201 })
  } catch (err) {
    return serverError(err, 'redditSources.create')
  }
}
