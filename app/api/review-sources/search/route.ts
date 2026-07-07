// app/api/review-sources/search/route.ts
// POST /api/review-sources/search — search DataForSEO for brand locations
// Returns location list without persisting anything (preview step)

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'
import { searchLocations, searchTripadvisorLocations } from '@/lib/dataforseo'
import { scoreBrandMatch } from '@/lib/brandMatch'
import { resolveOrg } from '@/lib/resolveOrg'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SOURCES = ['google', 'tripadvisor'] as const
type ReviewPlatform = (typeof SOURCES)[number]

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: userData } = await supabase
      .from('users')
      .select('org_id, organizations(features, is_admin_org)')
      .eq('id', user.id)
      .single()

    const orgData = resolveOrg(userData?.organizations)
    if (!orgData?.features?.analyze) {
      return NextResponse.json({ error: 'Analyze module not enabled' }, { status: 403 })
    }

    const body = await req.json()
    const { keyword } = body
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'keyword is required' }, { status: 400 })
    }

    const source: ReviewPlatform = SOURCES.includes(body.source) ? body.source : 'google'

    const rawLocations = source === 'tripadvisor'
      ? await searchTripadvisorLocations(keyword.trim())
      : await searchLocations(keyword.trim())

    // Rank by how strongly each result matches the brand the user typed —
    // a "Chuy's" search returns the chain plus unrelated look-alikes.
    const locations = scoreBrandMatch(keyword.trim(), rawLocations)

    return NextResponse.json({
      keyword: keyword.trim(),
      source,
      count: locations.length,
      locations,
    })
  } catch (err: unknown) {
    return serverError(err, 'reviewSources.search')
  }
}
