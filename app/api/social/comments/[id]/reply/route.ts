// app/api/social/comments/[id]/reply/route.ts
// POST — reply to a comment on the platform

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { message } = await req.json()
  if (!message?.trim()) return NextResponse.json({ error: 'Message is required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: comment } = await service
    .from('social_comments')
    .select('*, social_connections(access_token)')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  const token = (comment as { social_connections?: { access_token?: string | null } | null }).social_connections?.access_token
  if (!token) return NextResponse.json({ error: 'No access token' }, { status: 400 })

  // Post reply via Meta Graph API
  const res = await fetch(`https://graph.facebook.com/v19.0/${comment.comment_id}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message.trim(), access_token: token }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error({ at: 'social/reply', msg: "Meta API error", err: err })
    return NextResponse.json({ error: 'Failed to post reply' }, { status: 502 })
  }

  // Update local record
  await service
    .from('social_comments')
    .update({ our_reply: message.trim(), replied_at: new Date().toISOString() })
    .eq('id', params.id)

  await service.from('social_moderation_log').insert({
    org_id: auth.orgId,
    comment_id: params.id,
    action: 'reply',
    reply_text: message.trim(),
    performed_by: auth.userId,
  })

  return NextResponse.json({ ok: true })
}
