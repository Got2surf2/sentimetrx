// app/api/datasets/[datasetId]/search-interest/route.ts
// Fetches Google search volume for theme names via DataForSEO.
// Returns per-theme search interest tiers (high/moderate/low/null).
// Only available for Reddit and Substack datasets.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSearchVolumes, classifySearchInterest } from '@/lib/dataforseo'
import type { SearchInterestTier } from '@/lib/themeUtils'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

export async function POST(request: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, source')
    .eq('id', params.datasetId)
    .single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  if (dataset.source !== 'reddit' && dataset.source !== 'substack') {
    return NextResponse.json({ error: 'Search interest is only available for Reddit and Substack datasets' }, { status: 400 })
  }

  let body: { themeNames?: string[] }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const names = body.themeNames
  if (!Array.isArray(names) || !names.length) {
    return NextResponse.json({ error: 'themeNames array required' }, { status: 400 })
  }

  try {
    const results = await getSearchVolumes(names)
    const interests: Record<string, SearchInterestTier> = {}
    for (const r of results) {
      interests[r.keyword] = classifySearchInterest(r.searchVolume)
    }
    return NextResponse.json({ interests })
  } catch (err: any) {
    console.error('[search-interest] DataForSEO error:', err?.message)
    return NextResponse.json({ error: 'Failed to fetch search volume' }, { status: 502 })
  }
}
