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
  const { query, page } = body
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 })

  try {
    const result = await searchDockets(query, page || 1)

    // For each docket, get comment count by listing first page
    const dockets = await Promise.all(result.data.map(async function(d) {
      let commentCount = 0
      try {
        const comments = await listComments(d.id, 1, 1)
        commentCount = comments.totalElements
      } catch {}
      return {
        id: d.id,
        title: d.attributes.title,
        agency: d.attributes.agencyId,
        docketType: d.attributes.docketType,
        lastModified: d.attributes.lastModifiedDate,
        commentCount,
      }
    }))

    return NextResponse.json({
      dockets,
      totalElements: result.totalElements,
    })
  } catch (err: any) {
    console.error('[regulations-sources/search]', err)
    return NextResponse.json({ error: err.message || 'Search failed' }, { status: 500 })
  }
}
