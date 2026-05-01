// app/api/social/export-dataset/route.ts
// POST — export social comments as a TextMine dataset for analysis
// Creates a dataset with structured fields (sentiment, topics, emotion, etc.)
// so social comments can be analyzed alongside surveys, TH, Reddit, etc.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { buildSocialSchema, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, platform, sentiment, flagged, connectionId } = await req.json() as {
    name?: string
    platform?: string
    sentiment?: string
    flagged?: boolean
    connectionId?: string
  }

  const service = createServiceRoleClient()

  // Fetch comments with filters
  var query = service
    .from('social_comments')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('platform_created_at', { ascending: false })

  if (platform) query = query.eq('platform', platform)
  if (sentiment) query = query.eq('sentiment', sentiment)
  if (flagged) query = query.not('flags', 'eq', '[]')
  if (connectionId) query = query.eq('connection_id', connectionId)

  // Fetch up to 10,000 comments
  query = query.limit(10000)

  const { data: comments, error: fetchErr } = await query
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!comments?.length) return NextResponse.json({ error: 'No comments to export' }, { status: 400 })

  // Create dataset
  const dsName = name || 'Social Comments (' + new Date().toLocaleDateString() + ')'
  const { data: dataset, error: dsErr } = await service
    .from('datasets')
    .insert({
      name: dsName,
      description: JSON.stringify({ type: 'social', platform: platform || 'all', count: comments.length }),
      source: 'social',
      org_id: auth.orgId,
      created_by: auth.userId,
      visibility: 'private',
      status: 'active',
      row_count: comments.length,
    })
    .select('id')
    .single()

  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })

  // Create dataset_state with social schema
  await service.from('dataset_state').insert({
    dataset_id: dataset.id,
    schema_config: buildSocialSchema(),
    theme_model: emptyThemeModel(),
    saved_charts: [],
    saved_stats: [],
    filter_state: {},
    updated_by: auth.userId,
  })

  // Convert comments to flat rows
  var flatRows = comments.map(function(c: any, idx: number) {
    var flags = Array.isArray(c.flags) ? c.flags : []
    var flagTypes = flags.map(function(f: any) { return f.type }).filter(function(t: string) { return t !== 'topics' && t !== 'emotion' && t !== 'intent' }).join(', ')
    var maxSeverity = ''
    var severityRank: Record<string, number> = { mild: 1, rude: 2, severe: 3 }
    for (var f of flags) {
      if (f.severity && (!maxSeverity || (severityRank[f.severity] || 0) > (severityRank[maxSeverity] || 0))) {
        maxSeverity = f.severity
      }
    }
    // Extract topics and intents from flags
    var topics = flags.filter(function(f: any) { return f.type === 'topics' }).map(function(f: any) { return f.action?.replace('Topics: ', '') || '' }).join(', ')
    var intents = flags.filter(function(f: any) { return f.type === 'intent' }).map(function(f: any) { return f.action?.replace(/ intent detected/i, '') || '' }).join(', ')
    var emotion = flags.find(function(f: any) { return f.type === 'emotion' })?.action?.replace('Emotion: ', '') || 'neutral'

    return {
      dataset_id: dataset.id,
      row_index: idx,
      data: {
        comment_id: c.comment_id,
        platform: c.platform,
        author_name: c.author_name || 'Unknown',
        text: c.text,
        sentiment: c.sentiment || 'neutral',
        emotion: emotion,
        topics: topics || 'none',
        intents: intents || 'none',
        is_hidden: c.is_hidden ? 'Yes' : 'No',
        is_deleted: c.is_deleted ? 'Yes' : 'No',
        is_reply: c.is_reply ? 'Yes' : 'No',
        post_text: c.post_text || '',
        comment_date: c.platform_created_at,
        flag_types: flagTypes || 'none',
        max_severity: maxSeverity || 'none',
      },
    }
  })

  // Insert flat rows in batches of 500
  for (var b = 0; b < flatRows.length; b += 500) {
    var batch = flatRows.slice(b, b + 500)
    var { error: insertErr } = await service.from('dataset_rows_flat').insert(batch)
    if (insertErr) {
      console.error('[social/export-dataset] insert error batch', b, ':', insertErr)
    }
  }

  return NextResponse.json({
    ok: true,
    datasetId: dataset.id,
    name: dsName,
    rowCount: comments.length,
  })
}
