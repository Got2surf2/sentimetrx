// lib/brandMatch.ts
// Scores how strongly each search result matches the brand the user typed.
// A brand search like "Chuy's" returns the real chain plus look-alikes
// ("Chuy's de Mexico" — a different business). This ranks the confident
// matches first so the wizard can pre-select only those. Pure + deterministic.

import type { DfsLocation } from './dataforseo'

export interface ScoredLocation extends DfsLocation {
  matchScore: number                  // 0-100
  matchStrength: 'strong' | 'weak'
}

const STRONG_THRESHOLD = 70
// A cluster only counts as "the brand" if its name is at least loosely
// related to what the user typed — guards against a search returning a
// large unrelated cluster and hijacking the ranking.
const CLUSTER_RELEVANCE_FLOOR = 0.3

// Structural words that carry no brand identity. Kept deliberately minimal —
// venue words (grill, kitchen, cafe) are often brand-defining, so they stay.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of'])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')          // drop apostrophes so "Chuy's" -> "chuys"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function brandTokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

// Dice coefficient over token sets: 2·|A∩B| / (|A|+|B|). Symmetric, so it
// rewards two names being "about the same thing" rather than one merely
// containing the other.
function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const aUniq = Array.from(new Set(a))
  const bUniq = Array.from(new Set(b))
  const bSet = new Set(bUniq)
  let intersection = 0
  for (const t of aUniq) if (bSet.has(t)) intersection++
  return (2 * intersection) / (aUniq.length + bUniq.length)
}

/**
 * Annotate each location with a 0-100 match score and a strong/weak tier,
 * sorted strongest-first. Two signals:
 *   1. Token similarity between the location name and the user's keyword.
 *   2. Chain consensus — the largest cluster of identically-named locations
 *      that is still relevant to the keyword is treated as "the brand", so a
 *      loose keyword ("Chuy's") still ranks the real chain ("Chuy's Tex-Mex")
 *      above look-alikes.
 */
export function scoreBrandMatch(keyword: string, locations: DfsLocation[]): ScoredLocation[] {
  const kwTokens = brandTokens(keyword)
  const kwNorm = kwTokens.join(' ')

  // Cluster by normalized name.
  const clusterCount = new Map<string, number>()
  const normByLoc: string[] = locations.map((loc) => {
    const nm = brandTokens(loc.name).join(' ')
    clusterCount.set(nm, (clusterCount.get(nm) || 0) + 1)
    return nm
  })

  // Dominant cluster: largest cluster (size >= 2) whose name is relevant to
  // the keyword. May be none — then we lean purely on keyword similarity.
  let dominantNm = ''
  let dominantSize = 0
  for (const [nm, count] of Array.from(clusterCount.entries())) {
    if (count < 2 || !nm) continue
    if (diceSimilarity(nm.split(' '), kwTokens) < CLUSTER_RELEVANCE_FLOOR) continue
    if (count > dominantSize) {
      dominantSize = count
      dominantNm = nm
    }
  }

  const scored: ScoredLocation[] = locations.map((loc, i) => {
    const nm = normByLoc[i]
    const nmTokens = nm ? nm.split(' ') : []
    let score: number

    if (nm && nm === kwNorm) {
      // Name is exactly what the user typed.
      score = 100
    } else if (dominantNm && nm === dominantNm) {
      // Part of the consensus chain, even if the keyword was loose.
      score = 90
    } else {
      // Token similarity to the keyword, with a small boost for being part
      // of any real multi-location cluster.
      const sim = diceSimilarity(nmTokens, kwTokens) * 100
      const clusterBoost = (clusterCount.get(nm) || 0) >= 2 ? 10 : 0
      score = Math.min(100, Math.round(sim) + clusterBoost)
    }

    return {
      ...loc,
      matchScore: score,
      matchStrength: score >= STRONG_THRESHOLD ? 'strong' : 'weak',
    }
  })

  scored.sort((a, b) => b.matchScore - a.matchScore || b.review_count - a.review_count)
  return scored
}
