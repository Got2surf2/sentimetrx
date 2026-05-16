// app/api/social/export-dataset/route.ts
// POST — export social comments as a TextMine dataset for analysis
// First call: creates a new dataset with structured fields
// Subsequent calls: incremental sync — only adds comments since last sync
// GET — check if a social dataset already exists for this org

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildSocialSchema, emptyThemeModel } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

// ── GET: check for existing social dataset ─────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: existing } = await service
    .from('datasets')
    .select('id, name, row_count, last_synced_at, created_at')
    .eq('org_id', auth.orgId)
    .eq('source', 'social')
    .order('created_at', { ascending: false })
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ exists: true, dataset: existing[0] })
  }
  return NextResponse.json({ exists: false })
}

// ── POST: create or sync ───────────────────────────────────────────
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

  // Check for existing social dataset for this org
  const { data: existingDs } = await service
    .from('datasets')
    .select('id, row_count, last_synced_at')
    .eq('org_id', auth.orgId)
    .eq('source', 'social')
    .order('created_at', { ascending: false })
    .limit(1)

  const existing = existingDs?.[0]
  const isSync = !!existing
  const lastSynced = existing?.last_synced_at || null

  // Fetch comments — if syncing, only newer than last sync
  var query = service
    .from('social_comments')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('platform_created_at', { ascending: false })

  if (platform) query = query.eq('platform', platform)
  if (sentiment) query = query.eq('sentiment', sentiment)
  if (flagged) query = query.not('flags', 'eq', '[]')
  if (connectionId) query = query.eq('connection_id', connectionId)

  // For sync: only new comments since last sync
  if (isSync && lastSynced) {
    query = query.gt('created_at', lastSynced)
  }

  query = query.limit(10000)

  const { data: comments, error: fetchErr } = await query
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })

  if (!comments?.length && isSync) {
    return NextResponse.json({ ok: true, synced: 0, total: existing.row_count, datasetId: existing.id, message: 'Already up to date' })
  }
  if (!comments?.length) {
    return NextResponse.json({ error: 'No comments to export' }, { status: 400 })
  }

  // Dedup: if syncing, exclude comments already in the dataset by comment_id
  var newComments = comments
  if (isSync) {
    const { data: existingRows } = await service
      .from('dataset_rows_flat')
      .select('data')
      .eq('dataset_id', existing.id)
      .limit(10000)

    var existingIds = new Set<string>()
    for (var er of existingRows || []) {
      if (er.data?.comment_id) existingIds.add(er.data.comment_id)
    }
    newComments = comments.filter(function(c: any) { return !existingIds.has(c.comment_id) })

    if (newComments.length === 0) {
      var syncTs = new Date().toISOString()
      await service.from('datasets').update({ last_synced_at: syncTs, updated_at: syncTs }).eq('id', existing.id)
      return NextResponse.json({ ok: true, synced: 0, total: existing.row_count, datasetId: existing.id, message: 'Already up to date' })
    }
  }

  // Create dataset if first time
  var datasetId: string
  var created = false

  if (isSync) {
    datasetId = existing.id
  } else {
    const dsName = name || 'Social Comments'
    const { data: dataset, error: dsErr } = await service
      .from('datasets')
      .insert({
        name: dsName,
        description: JSON.stringify({ type: 'social', platform: platform || 'all', count: newComments.length }),
        source: 'social',
        org_id: auth.orgId,
        created_by: auth.userId,
        visibility: 'private',
        status: 'active',
        row_count: newComments.length,
      })
      .select('id')
      .single()

    if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })
    datasetId = dataset.id
    created = true

    // Create dataset_state with social schema
    await service.from('dataset_state').insert({
      dataset_id: datasetId,
      schema_config: buildSocialSchema(),
      theme_model: emptyThemeModel(),
      saved_charts: [],
      saved_stats: [],
      filter_state: {},
      updated_by: auth.userId,
    })
  }

  // Get next row_index
  var startIndex = 0
  if (isSync) {
    const { data: maxRow } = await service
      .from('dataset_rows_flat')
      .select('row_index')
      .eq('dataset_id', datasetId)
      .order('row_index', { ascending: false })
      .limit(1)
    startIndex = (maxRow?.[0]?.row_index ?? -1) + 1
  }

  // Convert comments to flat rows
  var flatRows = newComments.map(function(c: any, idx: number) {
    var flags = Array.isArray(c.flags) ? c.flags : []
    var flagTypes = flags.map(function(f: any) { return f.type }).filter(function(t: string) { return t !== 'topics' && t !== 'emotion' && t !== 'intent' }).join(', ')
    var maxSeverity = ''
    var severityRank: Record<string, number> = { mild: 1, rude: 2, severe: 3 }
    for (var f of flags) {
      if (f.severity && (!maxSeverity || (severityRank[f.severity] || 0) > (severityRank[maxSeverity] || 0))) {
        maxSeverity = f.severity
      }
    }
    var topics = flags.filter(function(f: any) { return f.type === 'topics' }).map(function(f: any) { return f.action?.replace('Topics: ', '') || '' }).join(', ')
    var intents = flags.filter(function(f: any) { return f.type === 'intent' }).map(function(f: any) { return f.action?.replace(/ intent detected/i, '') || '' }).join(', ')
    var emotion = flags.find(function(f: any) { return f.type === 'emotion' })?.action?.replace('Emotion: ', '') || 'neutral'

    return {
      dataset_id: datasetId,
      row_index: startIndex + idx,
      data: {
        comment_id: c.comment_id,
        platform: c.platform,
        author_name: c.author_name || 'Unknown',
        text: c.text,
        sentiment: c.sentiment || 'neutral',
        sentiment_score: c.sentiment_score ?? 0,
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
      console.error({ at: 'social/export-dataset', msg: 'insert error', batch: b, err: insertErr })
    }
  }

  // Update dataset metadata
  var syncTimestamp = new Date().toISOString()
  var newTotal = (existing?.row_count || 0) + newComments.length
  await service.from('datasets').update({
    row_count: newTotal,
    last_synced_at: syncTimestamp,
    updated_at: syncTimestamp,
  }).eq('id', datasetId)

  return NextResponse.json({
    ok: true,
    datasetId: datasetId,
    name: name || 'Social Comments',
    synced: newComments.length,
    total: newTotal,
    created: created,
  })
}
