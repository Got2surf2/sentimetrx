// app/api/review-sources/search/route.ts
// POST /api/review-sources/search — search DataForSEO for brand locations
// Returns location list without persisting anything (preview step)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchLocations } from '@/lib/dataforseo'

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
    const { keyword } = body
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    const locations = await searchLocations(keyword.trim())

    return NextResponse.json({
      keyword: keyword.trim(),
      count: locations.length,
      locations,
    })
  } catch (err: any) {
    console.error('[review-sources/search] error:', err)
    return NextResponse.json({ error: err?.message || 'Search failed' }, { status: 500 })
  }
}
