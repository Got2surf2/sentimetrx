// app/api/reddit-sources/search/route.ts
// POST /api/reddit-sources/search — search Reddit for subreddits + posts
// Returns preview results without persisting anything

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchSubreddits, searchPosts } from '@/lib/reddit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id, organizations(features)')
      .eq('id', user.id)
      .single()

    const rawOrg  = userData?.organizations
    const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    const body = await req.json()
    const { keyword, subreddit } = body
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    // Search for subreddits and posts in parallel
    const [subreddits, posts] = await Promise.all([
      searchSubreddits(keyword.trim()),
      searchPosts(keyword.trim(), subreddit || undefined),
    ])

    return NextResponse.json({
      keyword: keyword.trim(),
      subreddits,
      posts,
    })
  } catch (err: any) {
    console.error('[reddit-sources/search] error:', err)
    return NextResponse.json({ error: err?.message || 'Search failed' }, { status: 500 })
  }
}
