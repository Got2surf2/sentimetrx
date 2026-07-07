// app/api/social/comments/[id]/delete/route.ts
// POST — delete a comment on the platform

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

  const { data: comment } = await service
    .from('social_comments')
    .select('*, social_connections(access_token)')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  // Call Meta API to delete (skip for demo comments with no real platform ID)
  const token = (comment as { social_connections?: { access_token?: string } | null }).social_connections?.access_token
  const isDemo = comment.comment_id.startsWith('demo_') || comment.comment_id.startsWith('test_comment_')
  if (!isDemo) {
    if (!token) return NextResponse.json({ error: 'No access token' }, { status: 400 })
    const res = await fetch(`https://graph.facebook.com/v19.0/${comment.comment_id}?access_token=${token}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      const err = await res.text()
      console.error({ at: 'social/delete', msg: "Meta API error", err: err })
      return NextResponse.json({ error: 'Failed to delete on platform' }, { status: 502 })
    }
  }

  // Soft-delete locally
  await service
    .from('social_comments')
    .update({ is_deleted: true })
    .eq('id', params.id)

  await service.from('social_moderation_log').insert({
    org_id: auth.orgId,
    comment_id: params.id,
    action: 'delete',
    performed_by: auth.userId,
  })

  return NextResponse.json({ ok: true })
}
