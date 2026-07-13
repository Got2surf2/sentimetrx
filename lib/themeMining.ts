// lib/themeMining.ts
// Corpus validation for AI-mined themes (server-side, used by mine-themes).
//
// WHY: the miner's AI reads a sample and estimates each theme's prevalence
// (e.g. "28% complain about food quality"), then invents keywords — but
// nothing ever checked whether those keywords actually MATCH the corpus.
// Measured on Carrabba's GSS "Liked Least" (2026-07-13): AI estimates
// 28/25/16/13/12% per theme, keyword scan credited 7/3/2/2/0.3% — a
// "Diffuse 12%" theme fit shipped silently, with 63 of 105 keywords
// matching ≤1 of 3,000 comments. These helpers scan the mining sample with
// the REAL matcher (buildKwRegex — the same patterns the UI and SQL counts
// use), flag themes whose scan coverage falls far short of the AI's own
// estimate, prune dead keywords, and restate count/percentage from the scan
// so the stored model describes what the product will actually display.

import { buildKwRegex } from './themeUtils'

export interface MinedTheme {
  id: string
  name: string
  description?: string
  keywords: string[]
  sentiment?: string
  count?: number
  percentage?: number
  relatedThemes?: string[]
}

export interface ThemeScan {
  /** Matched-comment count per theme, aligned to themes order. */
  perTheme: number[]
  /** Comments matching at least one theme. */
  union: number
  /** Comments matching NO theme (the refinement feedstock). */
  unmatched: string[]
  /** Per theme: keyword → matched-comment count (dead-keyword detection). */
  kwCounts: Record<string, number>[]
}

/** Scan texts with each theme's keywords using the real matcher. */
export function scanThemes(texts: string[], themes: MinedTheme[]): ThemeScan {
  const themeRegexes = themes.map(t =>
    (t.keywords || []).filter(Boolean).map(kw => ({ kw, re: buildKwRegex(kw) }))
  )
  const perTheme = themes.map(() => 0)
  const kwCounts: Record<string, number>[] = themes.map(t => {
    const m: Record<string, number> = {}
    for (const kw of t.keywords || []) m[kw] = 0
    return m
  })
  let union = 0
  const unmatched: string[] = []
  for (const text of texts) {
    const lower = text.toLowerCase()
    let any = false
    for (let ti = 0; ti < themes.length; ti++) {
      let hit = false
      for (const { kw, re } of themeRegexes[ti]) {
        if (re.test(lower)) { kwCounts[ti][kw]++; hit = true }
      }
      if (hit) { perTheme[ti]++; any = true }
    }
    if (any) union++
    else unmatched.push(text)
  }
  return { perTheme, union, unmatched, kwCounts }
}

/**
 * Drop keywords that matched nothing in the sample (the themes were mined
 * FROM this sample, so a zero-hit keyword is invented phrasing, not signal).
 * Always keeps the best `minKeep` keywords so a theme never ends up empty.
 */
export function pruneDeadKeywords(themes: MinedTheme[], scan: ThemeScan, minKeep = 3): MinedTheme[] {
  return themes.map((t, ti) => {
    const counts = scan.kwCounts[ti] || {}
    const kws = (t.keywords || []).filter(Boolean)
    const alive = kws.filter(kw => (counts[kw] || 0) > 0)
    if (alive.length >= minKeep) return { ...t, keywords: alive }
    const bySignal = [...kws].sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
    return { ...t, keywords: bySignal.slice(0, Math.max(minKeep, alive.length)) }
  })
}

export interface DeficientTheme {
  theme: MinedTheme
  scanPct: number
  estimatePct: number
}

/**
 * Themes whose measured sample coverage falls under 60% of the AI's own
 * prevalence estimate (estimates below 3% are noise — skip them).
 */
export function deficientThemes(themes: MinedTheme[], scan: ThemeScan, totalTexts: number): DeficientTheme[] {
  if (totalTexts === 0) return []
  const out: DeficientTheme[] = []
  for (let ti = 0; ti < themes.length; ti++) {
    const est = Number(themes[ti].percentage) || 0
    if (est < 3) continue
    const scanPct = (scan.perTheme[ti] / totalTexts) * 100
    if (scanPct < est * 0.6) out.push({ theme: themes[ti], scanPct, estimatePct: est })
  }
  return out
}

/** Merge AI-suggested additions into themes: dedup (case-insensitive), cap list size. */
export function mergeKeywordAdditions(
  themes: MinedTheme[],
  additions: { id: string; keywords: string[] }[],
  maxKeywords = 25,
): MinedTheme[] {
  const byId = new Map(additions.map(a => [a.id, a.keywords || []]))
  return themes.map(t => {
    const add = byId.get(t.id)
    if (!add || !add.length) return t
    const seen: Record<string, boolean> = {}
    const merged: string[] = []
    for (const kw of [...(t.keywords || []), ...add]) {
      const k = String(kw || '').trim()
      if (!k) continue
      const key = k.toLowerCase()
      if (!seen[key]) { seen[key] = true; merged.push(k) }
      if (merged.length >= maxKeywords) break
    }
    return { ...t, keywords: merged }
  })
}

/**
 * Restate each theme's count/percentage from the measured scan — one method
 * everywhere: the stored model now reports what keyword matching (the number
 * every UI surface displays) actually finds, not the AI's readership estimate.
 */
export function applyMeasuredCoverage(themes: MinedTheme[], scan: ThemeScan, totalTexts: number): MinedTheme[] {
  return themes.map((t, ti) => ({
    ...t,
    count: scan.perTheme[ti],
    percentage: totalTexts > 0 ? Math.round((scan.perTheme[ti] / totalTexts) * 1000) / 10 : 0,
  }))
}

/** The refinement user-message: deficient themes + unmatched sample verbatims. */
export function buildRefinePrompt(deficient: DeficientTheme[], unmatched: string[], maxTexts = 40): string {
  const themeLines = deficient.map(d =>
    `- ${d.theme.id} "${d.theme.name}": you estimated ${d.estimatePct}% but the current keywords match only ${d.scanPct.toFixed(1)}% of the sample. Current keywords: ${(d.theme.keywords || []).join(', ')}`
  ).join('\n')
  const textLines = unmatched.slice(0, maxTexts)
    .map((t, i) => `${i + 1}. ${t.slice(0, 200)}`)
    .join('\n')
  return (
    'Keyword matching (word-stem based; multi-word phrases match their words in order with a few words allowed in between) ' +
    'was run over the SAME responses you analyzed. These themes match far fewer responses than you estimated:\n' +
    themeLines +
    '\n\nBelow are responses that matched NO theme. For each theme above, add up to 10 keywords that LITERALLY appear in these responses — ' +
    'copy the respondents\' own words. Prefer single distinctive words (e.g. "overcooked", "pricey"); use a 2-3 word phrase only when a single word is too ambiguous. ' +
    'Only add keywords for the themes listed. Return ONLY raw JSON: {"additions":[{"id":"t1","keywords":["..."]}]}\n\n' +
    'Unmatched responses:\n' + textLines
  )
}
