// POST — search regulations.gov dockets
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchDockets, listComments } from '@/lib/regulations'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { query, page, docketId } = body

  // Single-docket comment count lookup
  // listComments auto-falls back to searchTerm when filter[docketId] returns 0
  if (docketId) {
    try {
      const comments = await listComments(docketId, 1, 1)
      return NextResponse.json({ commentCount: comments.totalElements })
    } catch (err: any) {
      return NextResponse.json({ commentCount: 0, error: err.message })
    }
  }

  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  try {
    const result = await searchDockets(query, page || 1)

    // Return dockets without comment counts (too slow to fetch per-docket)
    const dockets = result.data.map(function(d) {
      return {
        id: d.id,
        title: d.attributes.title,
        agency: d.attributes.agencyId,
        docketType: d.attributes.docketType,
        lastModified: d.attributes.lastModifiedDate,
        commentCount: -1, // unknown until selected
      }
    })

    return NextResponse.json({
      dockets,
      totalElements: result.totalElements,
    })
  } catch (err: any) {
    console.error('[regulations-sources/search]', err)
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 })
  }
}
