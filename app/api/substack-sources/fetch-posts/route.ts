// app/api/substack-sources/fetch-posts/route.ts
// POST — fetch posts from a Substack publication (for wizard step 1→2)

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { resolveBaseUrl, fetchPublication, fetchPosts } from '@/lib/substack'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  var supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body = await req.json()
  var { url, offset } = body as { url: string; offset?: number }

  if (!url?.trim()) return NextResponse.json({ error: 'url is required' }, { status: 400 })

  try {
    var baseUrl = resolveBaseUrl(url)

    // Fetch publication info on first call
    var publication = null
    if (!offset || offset === 0) {
      try { publication = await fetchPublication(baseUrl) } catch {}
    }

    var posts = await fetchPosts(baseUrl, 50, offset || 0)

    return NextResponse.json({
      publication: publication,
      posts: posts,
      base_url: baseUrl,
      has_more: posts.length >= 50,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to fetch posts' }, { status: 500 })
  }
}
