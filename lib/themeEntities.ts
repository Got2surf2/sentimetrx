// lib/themeEntities.ts
// Theme × entity cross-tab: for the rows that match each theme, tally which
// catalog entities are mentioned. Powers the "Items mentioned" rows on both the
// Theme Clouds (WordCloud) and the Theme Cards (TextMineModule) — one shared
// implementation so the two views never diverge.
//
// Single pass over rows: match entities with one combined regex, match themes
// against per-theme keyword regexes precompiled once via buildKwRegex (NOT
// commentMatchesTheme per row — it rebuilds regexes each call), and credit each
// matched entity to every theme the row matches. Results are keyed by a stable
// theme key (id → name → index) so callers can look up regardless of ordering.

import { Theme, getRowText, buildKwRegex } from './themeUtils'
import { expandEntityTerms } from './entityVariants'

export interface ThemeEntity { slug: string; canonical: string; category: string; count: number }
export interface ThemeEntityInput { slug: string; canonical: string; category: string; aliases?: string[] }

export function themeKey(t: Theme, i: number): string {
  return String(t.id || t.name || i)
}

export function computeThemeEntities(
  themes: Theme[],
  rows: Record<string, unknown>[],
  fields: string[],
  entities: ThemeEntityInput[],
  minCount: number = 2,
): Record<string, ThemeEntity[]> {
  const result: Record<string, ThemeEntity[]> = {}
  if (!entities || !entities.length || !themes.length || !fields.length || !rows.length) return result

  const meta: Record<string, { canonical: string; category: string }> = {}
  const termToSlugs: Record<string, string[]> = {}
  for (const e of entities) {
    meta[e.slug] = { canonical: e.canonical, category: e.category }
    for (const t of expandEntityTerms([e.canonical].concat(e.aliases || []))) {
      const key = t.toLowerCase()
      if (!termToSlugs[key]) termToSlugs[key] = []
      if (termToSlugs[key].indexOf(e.slug) === -1) termToSlugs[key].push(e.slug)
    }
  }
  const allTerms = Object.keys(termToSlugs).sort(function(a, b) { return b.length - a.length })
  if (!allTerms.length) return result
  const entityRe = new RegExp('\\b(' + allTerms.map(function(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }).join('|') + ')\\b', 'gi')

  const themeRegexes = themes.map(function(t) { return (t.keywords || []).map(buildKwRegex) })

  const counts: Record<number, Record<string, number>> = {}
  for (const row of rows) {
    const text = getRowText(row, fields).toLowerCase()
    if (!text) continue
    entityRe.lastIndex = 0
    const slugs = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = entityRe.exec(text)) !== null) {
      const list = termToSlugs[m[0].toLowerCase()] || []
      for (const s of list) slugs.add(s)
    }
    if (slugs.size === 0) continue
    for (let idx = 0; idx < themeRegexes.length; idx++) {
      const res = themeRegexes[idx]
      if (!res.length) continue
      let matched = false
      for (let k = 0; k < res.length; k++) { if (res[k].test(text)) { matched = true; break } }
      if (!matched) continue
      if (!counts[idx]) counts[idx] = {}
      slugs.forEach(function(s) { counts[idx][s] = (counts[idx][s] || 0) + 1 })
    }
  }

  Object.keys(counts).forEach(function(k) {
    const idx = Number(k)
    const arr = Object.keys(counts[idx])
      .map(function(s) { return { slug: s, canonical: meta[s].canonical, category: meta[s].category, count: counts[idx][s] } })
      .filter(function(e) { return e.count >= minCount })
      .sort(function(a, b) { return b.count - a.count })
    if (arr.length) result[themeKey(themes[idx], idx)] = arr
  })
  return result
}
