// app/api/social/comments/route.ts
// GET — list comments with filtering, pagination

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const platform = searchParams.get('platform')
  const sentiment = searchParams.get('sentiment')
  const flagged = searchParams.get('flagged')
  const hidden = searchParams.get('hidden')
  const postId = searchParams.get('post_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const handled = searchParams.get('handled')
  const search = searchParams.get('search')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
  const offset = (page - 1) * limit

  const service = createServiceRoleClient()
  let query = service
    .from('social_comments')
    .select('*', { count: 'exact' })
    .eq('org_id', auth.orgId)
    .order('platform_created_at', { ascending: false })

  if (platform) query = query.eq('platform', platform)
  if (sentiment) query = query.eq('sentiment', sentiment)
  if (flagged === 'true') query = query.not('flags', 'eq', '[]')
  if (hidden === 'true') query = query.eq('is_hidden', true)
  if (hidden === 'false') query = query.eq('is_hidden', false)
  if (handled === 'true') query = query.eq('is_handled', true)
  if (handled === 'false') query = query.eq('is_handled', false)
  const deleted = searchParams.get('deleted')
  if (deleted === 'true') query = query.eq('is_deleted', true)
  if (deleted === 'false') query = query.eq('is_deleted', false)
  const replied = searchParams.get('replied')
  if (replied === 'true') query = query.not('our_reply', 'is', null)
  if (replied === 'false') query = query.is('our_reply', null)
  const flagType = searchParams.get('flag_type')
  if (flagType) query = query.contains('flags', [{ type: flagType }])
  if (postId) query = query.eq('post_id', postId)
  if (from) query = query.gte('platform_created_at', from)
  if (to) query = query.lte('platform_created_at', to)
  if (search) query = query.ilike('text', `%${search}%`)

  query = query.range(offset, offset + limit - 1)

  const { data, count, error } = await query
  if (error) return serverError(error, 'social.comments.list', { orgId: auth.orgId })

  return NextResponse.json({
    comments: data || [],
    total: count || 0,
    page,
    limit,
    pages: Math.ceil((count || 0) / limit),
  })
}
