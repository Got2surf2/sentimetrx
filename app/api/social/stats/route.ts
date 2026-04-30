// app/api/social/stats/route.ts
// GET — dashboard stats: counts, sentiment breakdown, flag counts

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // Default: last 24 hours
  const since = from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('social_comments')
    .select('id, sentiment, flags, is_hidden, our_reply, platform')
    .eq('org_id', auth.orgId)
    .eq('is_deleted', false)
    .gte('platform_created_at', since)

  if (to) query = query.lte('platform_created_at', to)

  const { data: comments } = await query

  const rows = comments || []
  const total = rows.length
  const positive = rows.filter(c => c.sentiment === 'positive').length
  const negative = rows.filter(c => c.sentiment === 'negative').length
  const neutral = rows.filter(c => c.sentiment === 'neutral').length
  const flagged = rows.filter(c => {
    const f = c.flags as any
    return Array.isArray(f) && f.length > 0
  }).length
  const hidden = rows.filter(c => c.is_hidden).length
  const replied = rows.filter(c => !!c.our_reply).length
  const responseRate = total > 0 ? Math.round((replied / total) * 100) : 0

  const byPlatform: Record<string, number> = {}
  for (const c of rows) {
    byPlatform[c.platform] = (byPlatform[c.platform] || 0) + 1
  }

  return NextResponse.json({
    total,
    sentiment: { positive, negative, neutral },
    flagged,
    hidden,
    replied,
    responseRate,
    byPlatform,
  })
}
