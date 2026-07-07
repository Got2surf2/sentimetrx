// app/api/social/comments/bulk/route.ts
// POST — bulk hide or delete comments

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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, commentIds } = await req.json()
  if (!action || !Array.isArray(commentIds) || commentIds.length === 0) {
    return NextResponse.json({ error: 'action and commentIds[] required' }, { status: 400 })
  }
  if (!['hide', 'delete'].includes(action)) {
    return NextResponse.json({ error: 'action must be hide or delete' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Load all comments with their tokens
  const { data: comments } = await service
    .from('social_comments')
    .select('id, comment_id, platform, is_hidden, social_connections(access_token)')
    .in('id', commentIds)
    .eq('org_id', auth.orgId)

  if (!comments?.length) return NextResponse.json({ error: 'No matching comments' }, { status: 404 })

  let succeeded = 0
  let failed = 0

  for (const c of comments) {
    const token = (c as { social_connections?: { access_token?: string } | null }).social_connections?.access_token
    if (!token) { failed++; continue }

    try {
      if (action === 'hide') {
        const res = await fetch(`https://graph.facebook.com/v19.0/${c.comment_id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_hidden: true, access_token: token }),
        })
        if (res.ok) {
          await service.from('social_comments').update({ is_hidden: true }).eq('id', c.id)
          succeeded++
        } else { failed++ }
      } else {
        const res = await fetch(`https://graph.facebook.com/v19.0/${c.comment_id}?access_token=${token}`, { method: 'DELETE' })
        if (res.ok) {
          await service.from('social_comments').update({ is_deleted: true }).eq('id', c.id)
          succeeded++
        } else { failed++ }
      }

      await service.from('social_moderation_log').insert({
        org_id: auth.orgId,
        comment_id: c.id,
        action,
        performed_by: auth.userId,
      })
    } catch {
      failed++
    }
  }

  return NextResponse.json({ ok: true, succeeded, failed })
}
