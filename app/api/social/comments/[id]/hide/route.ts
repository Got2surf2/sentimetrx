// app/api/social/comments/[id]/hide/route.ts
// POST — hide or unhide a comment on the platform

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

  const service = createServiceRoleClient()

  // Get the comment + its connection token
  const { data: comment } = await service
    .from('social_comments')
    .select('*, social_connections(access_token)')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  const token = (comment as { social_connections?: { access_token?: string } | null }).social_connections?.access_token
  const newHidden = !comment.is_hidden
  const isDemo = comment.comment_id.startsWith('demo_') || comment.comment_id.startsWith('test_comment_')

  // Call Meta API to hide/unhide (skip for demo comments)
  if (!isDemo) {
    if (!token) return NextResponse.json({ error: 'No access token for this connection' }, { status: 400 })
    if (comment.platform === 'facebook') {
      const res = await fetch(`https://graph.facebook.com/v19.0/${comment.comment_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: newHidden, access_token: token }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error({ at: 'social/hide', msg: "Meta API error", err: err })
        return NextResponse.json({ error: 'Failed to update on platform' }, { status: 502 })
      }
    }
  }
  // Instagram comment hiding uses the same Graph API endpoint

  // Update local record
  await service
    .from('social_comments')
    .update({ is_hidden: newHidden })
    .eq('id', params.id)

  // Log the action
  await service.from('social_moderation_log').insert({
    org_id: auth.orgId,
    comment_id: params.id,
    action: newHidden ? 'hide' : 'unhide',
    performed_by: auth.userId,
  })

  return NextResponse.json({ ok: true, is_hidden: newHidden })
}
