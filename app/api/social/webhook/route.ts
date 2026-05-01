// app/api/social/webhook/route.ts
// Meta Webhooks endpoint — receives real-time comment notifications
// GET  — verification handshake (Meta sends challenge on setup)
// POST — incoming events (new comments, edits, deletes)

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { auditContent } from '@/lib/contentGuard'
import { POSITIVE_WORDS, NEGATIVE_WORDS, NEGATORS } from '@/lib/sentimentLexicon'

export const dynamic = 'force-dynamic'

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

// ── GET: Meta verification handshake ─────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!verifyToken) {
    console.error('[social/webhook] META_WEBHOOK_VERIFY_TOKEN not configured')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[social/webhook] Verification successful')
    return new NextResponse(challenge, { status: 200 })
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

// ── POST: incoming webhook events ────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json()

  // Meta sends { object: 'page', entry: [...] }
  if (body.object !== 'page' && body.object !== 'instagram') {
    return NextResponse.json({ received: true })
  }

  const service = createServiceRoleClient()

  for (const entry of (body.entry || [])) {
    const pageId = entry.id

    // Find the connection for this page/account
    const { data: connection } = await service
      .from('social_connections')
      .select('id, org_id, platform, access_token')
      .eq('account_id', pageId)
      .limit(1)
      .single()

    if (!connection) {
      console.log('[social/webhook] No connection found for page:', pageId)
      continue
    }

    // Process changes (comments on posts)
    for (const change of (entry.changes || [])) {
      if (change.field === 'feed' && change.value?.item === 'comment') {
        await processComment(service, connection, change.value, 'facebook')
      }
    }

    // Instagram comment webhooks come in entry.messaging or entry.changes
    if (body.object === 'instagram') {
      for (const change of (entry.changes || [])) {
        if (change.field === 'comments') {
          await processComment(service, connection, change.value, 'instagram')
        }
      }
    }
  }

  // Always return 200 quickly — Meta retries on non-200
  return NextResponse.json({ received: true })
}

async function processComment(
  service: ReturnType<typeof createServiceRoleClient>,
  connection: { id: string; org_id: string; platform: string; access_token: string },
  value: any,
  platform: string
) {
  const commentId = value.comment_id || value.id
  if (!commentId) return

  // Check if we already have this comment
  const { data: existing } = await service
    .from('social_comments')
    .select('id')
    .eq('comment_id', commentId)
    .limit(1)

  if (existing && existing.length > 0) return // already ingested

  // Fetch full comment details from Graph API
  const fields = platform === 'facebook'
    ? 'id,message,from,created_time,is_hidden,parent'
    : 'id,text,username,timestamp'

  const res = await fetch(`https://graph.facebook.com/v19.0/${commentId}?fields=${fields}&access_token=${connection.access_token}`)
  if (!res.ok) {
    console.error('[social/webhook] Failed to fetch comment:', commentId, await res.text())
    return
  }

  const comment = await res.json()
  const text = comment.message || comment.text || ''
  if (!text) return

  const sentiment = scoreSentiment(text)
  const audit = auditContent(text)
  const flags = audit.flags.map(f => ({ type: f, severity: audit.maxSeverity }))

  const row = {
    org_id: connection.org_id,
    connection_id: connection.id,
    platform,
    post_id: value.post_id || value.media_id || '',
    post_text: null,
    comment_id: commentId,
    parent_comment_id: comment.parent?.id || null,
    author_name: comment.from?.name || comment.username || null,
    author_id: comment.from?.id || comment.username || null,
    text,
    sentiment,
    flags,
    is_hidden: comment.is_hidden || false,
    is_reply: !!comment.parent?.id,
    platform_created_at: comment.created_time || comment.timestamp,
  }

  const { error } = await service.from('social_comments').insert(row)
  if (error) {
    console.error('[social/webhook] Insert error:', error.message)
  } else {
    console.log('[social/webhook] Ingested comment:', commentId, '| sentiment:', sentiment, '| flags:', audit.flags.length)
  }
}
