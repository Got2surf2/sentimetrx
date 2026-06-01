// app/api/datasets/[datasetId]/search-interest/route.ts
// Fetches Google search volume for theme keywords via DataForSEO.
// Returns per-theme search interest tiers + trend direction.
// Only available for Reddit and Substack datasets.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getSearchVolumes, classifySearchInterest } from '@/lib/dataforseo'
import type { SearchInterestTier, SearchTrend } from '@/lib/themeUtils'

export const dynamic = 'force-dynamic'

interface Props { params: { datasetId: string } }

const TIER_RANK: Record<string, number> = { high: 3, moderate: 2, low: 1 }
const TREND_RANK: Record<string, number> = { up: 2, steady: 1, down: 0 }

export async function POST(request: Request, { params }: Props) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
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
    return NextResponse.json({ interests: {}, trends: {} })
  }

  try {
    const results = await getSearchVolumes(allKeywords)
    const kwTiers: Record<string, SearchInterestTier> = {}
    const kwTrends: Record<string, SearchTrend> = {}
    for (const r of results) {
      kwTiers[r.keyword] = classifySearchInterest(r.searchVolume)
      kwTrends[r.keyword] = r.trend
    }

    // Each theme gets the highest tier and most notable trend among its keywords
    const interests: Record<string, SearchInterestTier> = {}
    const trends: Record<string, SearchTrend> = {}
    for (const [themeName, keywords] of Object.entries(themeKeywords)) {
      let bestTier: SearchInterestTier = null
      let bestTrend: SearchTrend = null
      for (const kw of keywords) {
        const tier = kwTiers[kw]
        if (tier && (TIER_RANK[tier] || 0) > (TIER_RANK[bestTier || ''] || 0)) {
          bestTier = tier
        }
        const trend = kwTrends[kw]
        if (trend && (TREND_RANK[trend] ?? -1) > (TREND_RANK[bestTrend || ''] ?? -1)) {
          bestTrend = trend
        }
      }
      interests[themeName] = bestTier
      trends[themeName] = bestTrend
    }
    return NextResponse.json({ interests, trends })
  } catch (err: any) {
    console.error({ at: 'search-interest', msg: "DataForSEO error", err: err?.message })
    return NextResponse.json({ error: 'Failed to fetch search volume', detail: err?.message }, { status: 502 })
  }
}
