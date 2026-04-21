// app/api/datasets/[datasetId]/search-interest/route.ts
// Fetches Google search volume for theme keywords via DataForSEO.
// Returns per-theme search interest tiers (high/moderate/low/null).
// Only available for Reddit and Substack datasets.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSearchVolumes, classifySearchInterest } from '@/lib/dataforseo'
import type { SearchInterestTier } from '@/lib/themeUtils'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

const TIER_RANK: Record<string, number> = { high: 3, moderate: 2, low: 1 }

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

  let body: { themeKeywords?: Record<string, string[]> }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const themeKeywords = body.themeKeywords
  if (!themeKeywords || typeof themeKeywords !== 'object' || !Object.keys(themeKeywords).length) {
    return NextResponse.json({ error: 'themeKeywords map required' }, { status: 400 })
  }

  // Collect all unique keywords across all themes
  const allKeywords = Array.from(new Set(
    Object.values(themeKeywords).flat().filter(k => k && k.trim())
  ))
  if (!allKeywords.length) {
    return NextResponse.json({ interests: {} })
  }

  try {
    const results = await getSearchVolumes(allKeywords)
    const kwTiers: Record<string, SearchInterestTier> = {}
    for (const r of results) {
      kwTiers[r.keyword] = classifySearchInterest(r.searchVolume)
    }

    // Each theme gets the highest tier among its keywords
    const interests: Record<string, SearchInterestTier> = {}
    for (const [themeName, keywords] of Object.entries(themeKeywords)) {
      let best: SearchInterestTier = null
      for (const kw of keywords) {
        const tier = kwTiers[kw]
        if (tier && (TIER_RANK[tier] || 0) > (TIER_RANK[best || ''] || 0)) {
          best = tier
        }
      }
      interests[themeName] = best
    }
    return NextResponse.json({ interests })
  } catch (err: any) {
    console.error('[search-interest] DataForSEO error:', err?.message)
    return NextResponse.json({ error: 'Failed to fetch search volume', detail: err?.message }, { status: 502 })
  }
}
