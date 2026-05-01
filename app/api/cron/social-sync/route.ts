// app/api/cron/social-sync/route.ts
// Cron endpoint: fetches new comments from connected FB/IG accounts.
// Runs every 15 minutes via Vercel Cron.
// On ingest: runs content guard for auto-flagging + lexicon sentiment scoring.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { auditContent } from '@/lib/contentGuard'
import { POSITIVE_WORDS, NEGATIVE_WORDS, NEGATORS } from '@/lib/sentimentLexicon'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const words = text.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/)
  let score = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const negated = i > 0 && NEGATORS.has(words[i - 1])
    if (POSITIVE_WORDS.has(w)) score += negated ? -1 : 1
    else if (NEGATIVE_WORDS.has(w)) score += negated ? 1 : -1
  }
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

async function fetchFacebookComments(pageId: string, token: string, since?: string): Promise<any[]> {
  // Use /posts instead of /feed — /feed requires pages_read_engagement which needs App Review
  const sinceParam = since ? `&since=${Math.floor(new Date(since).getTime() / 1000)}` : ''
  const postsUrl = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time&limit=25&access_token=${token}${sinceParam}`

  const postsRes = await fetch(postsUrl)
  if (!postsRes.ok) {
    console.error('[social-sync] FB posts error:', await postsRes.text())
    return []
  }

  const postsData = await postsRes.json()
  const comments: any[] = []

  for (const post of (postsData.data || [])) {
    // Fetch comments for each post separately
    const commentsUrl = `https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,message,from,created_time,is_hidden,parent{id}&limit=100&access_token=${token}`
    const commentsRes = await fetch(commentsUrl)
    if (!commentsRes.ok) continue

    const commentsData = await commentsRes.json()
    for (const c of (commentsData.data || [])) {
      comments.push({
        post_id: post.id,
        post_text: post.message || null,
        comment_id: c.id,
        parent_comment_id: c.parent?.id || null,
        author_name: c.from?.name || null,
        author_id: c.from?.id || null,
        text: c.message,
        is_hidden: c.is_hidden || false,
        is_reply: !!c.parent?.id,
        platform_created_at: c.created_time,
      })
    }
  }

  return comments
}

async function fetchInstagramComments(igAccountId: string, token: string, since?: string): Promise<any[]> {
  // Get recent media
  const mediaUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,caption,timestamp&limit=25&access_token=${token}`
  const mediaRes = await fetch(mediaUrl)
  if (!mediaRes.ok) {
    console.error('[social-sync] IG media error:', await mediaRes.text())
    return []
  }

  const mediaData = await mediaRes.json()
  const comments: any[] = []

  for (const media of (mediaData.data || [])) {
    const commentsUrl = `https://graph.facebook.com/v19.0/${media.id}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&access_token=${token}`
    const commentsRes = await fetch(commentsUrl)
    if (!commentsRes.ok) continue

    const commentsData = await commentsRes.json()
    for (const c of (commentsData.data || [])) {
      comments.push({
        post_id: media.id,
        post_text: media.caption || null,
        comment_id: c.id,
        parent_comment_id: null,
        author_name: c.username || null,
        author_id: c.username || null,
        text: c.text,
        is_hidden: false,
        is_reply: false,
        platform_created_at: c.timestamp,
      })

      // Add replies
      for (const r of (c.replies?.data || [])) {
        comments.push({
          post_id: media.id,
          post_text: media.caption || null,
          comment_id: r.id,
          parent_comment_id: c.id,
          author_name: r.username || null,
          author_id: r.username || null,
          text: r.text,
          is_hidden: false,
          is_reply: true,
          platform_created_at: r.timestamp,
        })
      }
    }
  }

  return comments
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()

  // Get all active connections
  const { data: connections, error } = await service
    .from('social_connections')
    .select('id, org_id, platform, account_id, access_token, token_expires_at')
    .gt('token_expires_at', new Date().toISOString())

  if (error) {
    console.error('[social-sync] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!connections?.length) {
    return NextResponse.json({ ok: true, synced: 0, message: 'No active connections' })
  }

  let totalIngested = 0

  for (const conn of connections) {
    try {
      // Get the latest ingested comment timestamp for this connection
      const { data: latest } = await service
        .from('social_comments')
        .select('platform_created_at')
        .eq('connection_id', conn.id)
        .order('platform_created_at', { ascending: false })
        .limit(1)
        .single()

      const since = latest?.platform_created_at || undefined

      let rawComments: any[]
      if (conn.platform === 'facebook') {
        rawComments = await fetchFacebookComments(conn.account_id, conn.access_token, since)
      } else {
        rawComments = await fetchInstagramComments(conn.account_id, conn.access_token, since)
      }

      if (rawComments.length === 0) continue

      // Dedupe against existing comment_ids
      const existingIds = new Set<string>()
      const ids = rawComments.map(c => c.comment_id)
      const { data: existing } = await service
        .from('social_comments')
        .select('comment_id')
        .in('comment_id', ids)

      if (existing) for (const e of existing) existingIds.add(e.comment_id)

      const newComments = rawComments.filter(c => !existingIds.has(c.comment_id))
      if (newComments.length === 0) continue

      // Process each comment: sentiment + content flags
      const rows = newComments.map(c => {
        const sentiment = scoreSentiment(c.text)
        const audit = auditContent(c.text)
        const flags = audit.flags.map(f => ({ type: f, severity: audit.maxSeverity }))

        return {
          org_id: conn.org_id,
          connection_id: conn.id,
          platform: conn.platform,
          post_id: c.post_id,
          post_text: c.post_text,
          comment_id: c.comment_id,
          parent_comment_id: c.parent_comment_id,
          author_name: c.author_name,
          author_id: c.author_id,
          text: c.text,
          sentiment,
          flags,
          is_hidden: c.is_hidden,
          is_reply: c.is_reply,
          platform_created_at: c.platform_created_at,
        }
      })

      const { error: insertError } = await service
        .from('social_comments')
        .insert(rows)

      if (insertError) {
        console.error('[social-sync] insert error for connection', conn.id, ':', insertError)
      } else {
        totalIngested += rows.length
      }
    } catch (err: any) {
      console.error('[social-sync] error processing connection', conn.id, ':', err.message)
    }
  }

  return NextResponse.json({ ok: true, synced: totalIngested, connections: connections.length })
}
