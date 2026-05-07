// app/api/social/comments/[id]/handle/route.ts
// POST — toggle is_handled on a comment (mark as reviewed/approved)

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: comment } = await service
    .from('social_comments')
    .select('id, is_handled')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  // Accept explicit value or toggle
  var body: any = {}
  try { body = await req.json() } catch (e) { /* no body = toggle */ }
  const newHandled = body.handled !== undefined ? !!body.handled : !comment.is_handled

  await service
    .from('social_comments')
    .update({ is_handled: newHandled })
    .eq('id', params.id)

  return NextResponse.json({ ok: true, is_handled: newHandled })
}
