// app/api/cron/social-sync/route.ts
// Cron endpoint: fetches new comments from connected FB/IG accounts.
// Runs every 15 minutes via Vercel Cron.
// On ingest: runs content guard for auto-flagging + lexicon sentiment scoring.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { tagComment, routeResponse, type ModerationSensitivity } from '@/lib/socialTagging'
import { moderateTexts } from '@/lib/moderation'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { checkCronAuth } from '@/lib/cronAuth'
import { serverError } from '@/lib/apiError'
import { resolveOrg } from '@/lib/resolveOrg'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GRAPH_FETCH_CONCURRENCY = 4

interface RawSocialComment {
  post_id: string
  post_text: string | null
  comment_id: string
  parent_comment_id: string | null
  author_name: string | null
  author_id: string | null
  text: string
  is_hidden: boolean
  is_reply: boolean
  platform_created_at: string
}

async function fetchFacebookComments(pageId: string, token: string, since?: string): Promise<RawSocialComment[]> {
  // Use /posts instead of /feed — /feed requires pages_read_engagement which needs App Review
  const sinceParam = since ? `&since=${Math.floor(new Date(since).getTime() / 1000)}` : ''
  const postsUrl = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time&limit=25&access_token=${token}${sinceParam}`

  const postsRes = await fetch(postsUrl)
  if (!postsRes.ok) {
    console.error({ at: 'social-sync', msg: "FB posts error", err: await postsRes.text() })
    return []
  }

  const postsData = await postsRes.json()
  const comments: RawSocialComment[] = []
  const posts = postsData.data || []

  // Fetch comments for each post separately, with bounded concurrency
  for (let i = 0; i < posts.length; i += GRAPH_FETCH_CONCURRENCY) {
    await Promise.all(posts.slice(i, i + GRAPH_FETCH_CONCURRENCY).map(async (post: { id: string; message?: string }) => {
      const commentsUrl = `https://graph.facebook.com/v19.0/${post.id}/comments?fields=id,message,from,created_time,is_hidden,parent{id}&limit=100&access_token=${token}`
      const commentsRes = await fetch(commentsUrl)
      if (!commentsRes.ok) return

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
    }))
  }

  return comments
}

async function fetchInstagramComments(igAccountId: string, token: string, since?: string): Promise<RawSocialComment[]> {
  // Get recent media
  const mediaUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=id,caption,timestamp&limit=25&access_token=${token}`
  const mediaRes = await fetch(mediaUrl)
  if (!mediaRes.ok) {
    console.error({ at: 'social-sync', msg: "IG media error", err: await mediaRes.text() })
    return []
  }

  const mediaData = await mediaRes.json()
  const comments: RawSocialComment[] = []
  const mediaItems = mediaData.data || []

  for (let i = 0; i < mediaItems.length; i += GRAPH_FETCH_CONCURRENCY) {
    await Promise.all(mediaItems.slice(i, i + GRAPH_FETCH_CONCURRENCY).map(async (media: { id: string; caption?: string }) => {
      const commentsUrl = `https://graph.facebook.com/v19.0/${media.id}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&access_token=${token}`
      const commentsRes = await fetch(commentsUrl)
      if (!commentsRes.ok) return

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
    }))
  }

  return comments
}

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  // Get all active connections with org settings
  const { data: connections, error } = await service
    .from('social_connections')
    .select('id, org_id, platform, account_id, access_token, token_expires_at, organizations(features, is_admin_org)')
    .gt('token_expires_at', new Date().toISOString())

  if (error) {
    return serverError(error, 'cron.socialSync.connections')
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

      let rawComments: RawSocialComment[]
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

      // Batch-score all comments through OpenAI moderation (free, async)
      const moderationScores = await moderateTexts(newComments.map(c => c.text), conn.org_id)

      // Get org's moderation sensitivity
      const orgData = resolveOrg((conn as { organizations?: unknown }).organizations)
      const sensitivity = (orgData?.features?.social_auto_config?.moderation_sensitivity || 'moderate') as ModerationSensitivity

      // Process each comment through the shared tagging pipeline
      const rows = newComments.map((c, idx) => {
        const tagged = tagComment(c.text, c.post_text, moderationScores[idx], sensitivity)

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
          sentiment: tagged.sentiment,
          sentiment_score: tagged.sentimentScore,
          flags: tagged.flags,
          is_hidden: c.is_hidden || tagged.isHidden,
          is_reply: c.is_reply,
          platform_created_at: c.platform_created_at,
        }
      })

      const { error: insertError } = await service
        .from('social_comments')
        .insert(rows)

      if (insertError) {
        console.error({ at: 'social-sync', msg: 'insert error', connectionId: conn.id, err: insertError })
        continue
      }

      totalIngested += rows.length

      // ── Auto-hide on platform (Meta API) ──────────────────────────
      const autoConfig = orgData?.features?.social_auto_config || {}
      if (autoConfig.auto_hide_enabled) {
        const toHide = newComments.filter(function(c, idx) {
          var tagged = tagComment(c.text, c.post_text, moderationScores[idx], sensitivity)
          return tagged.isHidden && !c.is_hidden && !c.comment_id.startsWith('demo_')
        })
        for (const c of toHide) {
          try {
            await fetch(`https://graph.facebook.com/v19.0/${c.comment_id}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_hidden: true, access_token: conn.access_token }),
            })
          } catch (e: unknown) {
            console.error({ at: 'social-sync', msg: 'auto-hide error', commentId: c.comment_id, err: e })
          }
        }
        if (toHide.length > 0) console.log('[social-sync] auto-hid', toHide.length, 'comments for connection', conn.id)
      }

      // ── Auto-reply (template or AI) ───────────────────────────────
      if (autoConfig.auto_reply_enabled) {
        const replyMode = autoConfig.auto_reply_mode || 'queue'
        for (var idx = 0; idx < newComments.length; idx++) {
          const c = newComments[idx]
          if (c.is_reply) continue // don't reply to replies
          if (c.comment_id.startsWith('demo_')) continue

          const tagged = tagComment(c.text, c.post_text, moderationScores[idx], sensitivity)
          const route = routeResponse(tagged, c.author_name, c.post_text?.substring(0, 50))

          // Skip if mode is queue (human review only)
          if (replyMode === 'queue') continue
          // Skip negative if mode is positive_neutral
          if (replyMode === 'positive_neutral' && tagged.sentiment === 'negative') continue
          // Skip silent/review routes
          if (route.route === 'silent' || route.route === 'review') continue

          var replyText: string | null = null

          if (route.route === 'template' && route.response) {
            replyText = route.response
          } else if (route.route === 'ai' && replyMode === 'all') {
            try {
              const result = await callAI({
                tier: 'fast',
                maxTokens: 200,
                timeoutMs: 15000,
                system: 'You are a social media manager replying to a comment on ' + conn.platform + '. Keep replies concise (1-3 sentences), friendly, and on-brand. Never be defensive or argumentative.\n\nCRITICAL: NEVER mention "Datanautix", "sentimetrx", "Sentimetrx", "Sarina", "Ana", or any internal platform/tool names. You are replying on behalf of the page owner, not as a software company. Do not reference any AI tools, moderation systems, or analytics platforms.',
                messages: [{ role: 'user', content: 'Reply to this comment: "' + c.text + '"' }],
              })
              logUsage({ org_id: conn.org_id, resource_type: 'social', event_type: 'auto_reply' }, result.usage)
              replyText = result.text.trim()
            } catch (e: unknown) {
              console.error({ at: 'social-sync', msg: "AI reply error", err: e instanceof Error ? e.message : String(e) })
            }
          }

          if (replyText) {
            try {
              await fetch(`https://graph.facebook.com/v19.0/${c.comment_id}/replies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: replyText, access_token: conn.access_token }),
              })
              // Update the stored comment with our reply
              await service
                .from('social_comments')
                .update({ our_reply: replyText, replied_at: new Date().toISOString() })
                .eq('comment_id', c.comment_id)
                .eq('org_id', conn.org_id)
            } catch (e: unknown) {
              console.error({ at: 'social-sync', msg: 'auto-reply error', commentId: c.comment_id, err: e })
            }
          }
        }
      }
    } catch (err: unknown) {
      console.error({ at: 'social-sync', msg: 'error processing connection', connectionId: conn.id, err })
    }
  }

  return NextResponse.json({ ok: true, synced: totalIngested, connections: connections.length })
}
