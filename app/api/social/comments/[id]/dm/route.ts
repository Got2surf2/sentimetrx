// app/api/social/comments/[id]/dm/route.ts
// POST — send a DM to the comment author via Messenger/IG Direct

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message, intent, template } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: comment } = await service
    .from('social_comments')
    .select('*, social_connections(id, access_token, platform)')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  if (!comment.author_id) return NextResponse.json({ error: 'No author ID available for DM' }, { status: 400 })

  const token = (comment as any).social_connections?.access_token
  if (!token) return NextResponse.json({ error: 'No access token' }, { status: 400 })

  // Send DM via Messenger (Facebook) or IG Direct
  let apiUrl: string
  let dmBody: any

  if (comment.platform === 'facebook') {
    apiUrl = `https://graph.facebook.com/v19.0/me/messages`
    dmBody = {
      recipient: { id: comment.author_id },
      message: { text: message.trim() },
      access_token: token,
    }
  } else {
    // Instagram Direct
    apiUrl = `https://graph.facebook.com/v19.0/me/messages`
    dmBody = {
      recipient: { id: comment.author_id },
      message: { text: message.trim() },
      access_token: token,
    }
  }

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dmBody),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[social/dm] Messenger API error:', err)
    return NextResponse.json({ error: 'Failed to send DM' }, { status: 502 })
  }

  // Log the DM
  await service.from('social_dm_log').insert({
    org_id: auth.orgId,
    connection_id: (comment as any).social_connections?.id,
    platform: comment.platform,
    recipient_id: comment.author_id,
    recipient_name: comment.author_name,
    trigger_comment_id: params.id,
    intent: intent || null,
    template: template || null,
    message_text: message.trim(),
  })

  await service.from('social_moderation_log').insert({
    org_id: auth.orgId,
    comment_id: params.id,
    action: 'dm',
    reply_text: message.trim(),
    performed_by: auth.userId,
  })

  return NextResponse.json({ ok: true })
}
