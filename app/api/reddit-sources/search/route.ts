// app/api/reddit-sources/search/route.ts
// POST /api/reddit-sources/search — fetch posts from a subreddit
// Reddit blocked unauthenticated search endpoints (403), so we use direct
// subreddit listing (/r/{name}/{sort}.json) which still works.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchSubredditPosts } from '@/lib/reddit'

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
    const { subreddit, sort } = body
    if (!subreddit?.trim()) {
      return NextResponse.json({ error: 'subreddit name is required' }, { status: 400 })
    }

    // Clean subreddit name (strip r/ prefix if present)
    const subName = subreddit.trim().replace(/^r\//, '').replace(/^\/r\//, '')

    // Fetch posts from subreddit (hot/new/top)
    const posts = await fetchSubredditPosts(subName, sort || 'hot', 100)

    return NextResponse.json({
      subreddit: subName,
      posts,
    })
  } catch (err: any) {
    console.error('[reddit-sources/search] error:', err)
    // If 404/403, subreddit probably doesn't exist
    if (err?.message?.includes('403') || err?.message?.includes('404')) {
      return NextResponse.json({ error: 'Subreddit "r/' + (req as any)._subreddit + '" not found or is private. Check the spelling and try again.' }, { status: 404 })
    }
    return NextResponse.json({ error: err?.message || 'Failed to load subreddit' }, { status: 500 })
  }
}
