// lib/themeUtils.ts
// Client-safe pure utilities for theme matching, counting, and text utilities.
// No server-only imports. Safe to use in browser components.

import { isSubstantiveText } from './datasetUtils'
import { expandLemma } from './lemmas'
import { POSITIVE_WORDS as POS_WORDS, NEGATIVE_WORDS as NEG_WORDS, NEGATORS } from './sentimentLexicon'
import { taxonomyFieldKey } from './dimensionFields'

/**
 * Score a block of text for sentiment using the lexicon.
 * Handles negation: "not good" = negative, "don't like" stays negative.
 * Looks back up to 3 words for a negator.
 */
export function lexiconScore(text: string): { pos: number; neg: number } {
  const words = text.toLowerCase().replace(/[^a-z'\s]/g, '').split(/\s+/)
  var pos = 0, neg = 0
  for (var i = 0; i < words.length; i++) {
    const isPos = POS_WORDS.has(words[i])
    const isNeg = NEG_WORDS.has(words[i])
    if (!isPos && !isNeg) continue

    // Check up to 3 preceding words for a negator
    var negated = false
    for (var j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(words[j])) { negated = true; break }
    }

    if (isPos) { negated ? neg++ : pos++ }
    if (isNeg) { negated ? pos++ : neg++ }
  }
  return { pos, neg }
}

/**
 * Classify sentiment from aggregate positive/negative counts.
 * "mixed" when both sides have meaningful presence.
 * Requires minResponses (default 5) scored words before classifying — returns 'neutral' if below threshold.
 */
export function classifySentiment(pos: number, neg: number, minResponses = 5): 'positive' | 'negative' | 'mixed' | 'neutral' | 'insufficient' {
  const total = pos + neg
  if (total < minResponses) return 'insufficient'
  const posRatio = pos / total
  if (posRatio >= 0.7) return 'positive'
  if (posRatio <= 0.3) return 'negative'
  return 'mixed'
}

export type SearchInterestTier = 'high' | 'moderate' | 'low' | null
export type SearchTrend = 'up' | 'down' | 'steady' | null

export interface Theme {
  id: string
  name: string
  description: string
  keywords: string[]
  sentiment: string
  count: number             // unique rows matched ("records")
  snippetCount?: number     // total keyword-match occurrences across matched rows
                            // ("signals" / "snippets"): a row mentioning a theme
                            // keyword 3 times contributes 3 to this count.
  percentage: number
  ciLow?: number
  ciHigh?: number
  relatedThemes: string[]
  avgRating?: number       // avg of rating field for matching rows
  ratingDelta?: number     // avgRating - overallAvg
  ratingCount?: number     // rows that matched AND had a valid rating
  topBoxPct?: number       // % of rated rows in top box (above midpoint)
  midBoxPct?: number       // % of rated rows in mid box (at midpoint)
  bottomBoxPct?: number    // % of rated rows in bottom box (below midpoint)
  keywordRatings?: Record<string, { avg: number; count: number; delta: number }>
  searchInterest?: SearchInterestTier  // Google search volume tier (Reddit/Substack only)
  searchTrend?: SearchTrend            // Google search trend direction (Reddit/Substack only)
}

export interface ThemeModel {
  themes: Theme[]
  summary: string
  fieldName: string
  fieldNames?: string[]
  themeSource?: string | null
  themeLibName?: string | null
  samplingInfo?: { sampled: number; total: number } | null
  // Per-field theme sets (2026-07-11): one persistent model per open-ended
  // selection, keyed by themeFieldKey(). The top level stays the ACTIVE
  // selection's model — every consumer that reads `.themes` keeps working
  // unchanged. Entries never nest (no `fields` inside an entry). Maintained
  // centrally by the dataset state route via mergeThemeModelWrite().
  fields?: Record<string, ThemeModel>
}

// Canonical key for the open-ended selection a theme set was mined from —
// same convention as taxonomyFieldKey (lib/dimensionFields): a single field
// is its own name; multiple selected fields sort + ' + '-join, so the same
// set maps to the same key regardless of selection order.
export function themeFieldKey(fields: string[]): string {
  return taxonomyFieldKey(fields)
}

// The key of the selection a model's top level is bound to ('' when the
// model carries no field binding — e.g. a pre-mining empty model).
export function themeModelKey(tm: Pick<ThemeModel, 'fieldName' | 'fieldNames'> | null | undefined): string {
  if (!tm) return ''
  const flds = tm.fieldNames && tm.fieldNames.length ? tm.fieldNames : (tm.fieldName ? [tm.fieldName] : [])
  return themeFieldKey(flds)
}

// A model with its per-field map removed — the shape stored as a map entry.
export function stripFieldEntries(tm: ThemeModel): ThemeModel {
  const { fields: _fields, ...rest } = tm
  return rest
}

// All per-field sets a stored blob holds, legacy-wrapping the top level: a
// pre-map blob is one entry keyed by its own fieldName(s). The top level wins
// over a map entry for the same key — it's the latest save of that set.
export function themeFieldEntries(tm: ThemeModel | null | undefined): Record<string, ThemeModel> {
  if (!tm) return {}
  const entries: Record<string, ThemeModel> = {}
  const map = tm.fields || {}
  for (const k of Object.keys(map)) {
    if (map[k] && Array.isArray(map[k].themes)) entries[k] = stripFieldEntries(map[k])
  }
  const key = themeModelKey(tm)
  if (key && Array.isArray(tm.themes) && tm.themes.length > 0) entries[key] = stripFieldEntries(tm)
  return entries
}

// The stored theme set that BELONGS to a field selection: the top level when
// it's bound to that selection (freshest save), else that selection's map
// entry, else null (never mined for it — callers fall back to the active set,
// which for Charts/Stats is the pre-map behavior of matching the active
// themes against the chosen source field). Shared by ChartsModule /
// StatsModule / AskAnaPanel / the ask-ana route so "which themes go with this
// question?" resolves identically everywhere.
export function themeSetForField(
  tm: ThemeModel | null | undefined,
  fields: string[],
): ThemeModel | null {
  if (!tm) return null
  const key = themeFieldKey(fields)
  if (!key) return null
  if (themeModelKey(tm) === key) return stripFieldEntries(tm)
  return themeFieldEntries(tm)[key] || null
}

// Merge a theme-model write with what's already stored so saving one field's
// set never clobbers another field's. The top level stays the incoming
// (active) model; the map accumulates every set seen on either side.
export function mergeThemeModelWrite(incoming: ThemeModel, existing: ThemeModel | null | undefined): ThemeModel {
  const entries = { ...themeFieldEntries(existing), ...themeFieldEntries(incoming) }
  if (Object.keys(entries).length === 0) return stripFieldEntries(incoming)
  return { ...stripFieldEntries(incoming), fields: entries }
}

// One theme set per stored field selection, for exports/reports: the active
// (top-level) set first, then every other per-field set in map order. A
// keyless legacy blob yields no entries — exporters keep reading its top
// level directly, so keyless models are exactly as exportable as before.
export interface ThemeFieldSet { key: string; fields: string[]; model: ThemeModel }
export function themeSetsForExport(tm: ThemeModel | null | undefined): ThemeFieldSet[] {
  const entries = themeFieldEntries(tm)
  const activeKey = themeModelKey(tm)
  const ordered = [
    ...(activeKey && entries[activeKey] ? [activeKey] : []),
    ...Object.keys(entries).filter(function(k) { return k !== activeKey }),
  ]
  return ordered.map(function(k) {
    const m = entries[k]
    const flds = m.fieldNames && m.fieldNames.length ? m.fieldNames : (m.fieldName ? [m.fieldName] : [])
    return { key: k, fields: flds, model: m }
  })
}

export interface TextSegment {
  text: string
  matched: boolean
}

// Regex-special escape for a single token.
function escToken(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lemma alternation for ONE word: expands irregular forms then builds an
// alternation, each with stem-suffix \w*. "run" → run\w*|ran\w*|running\w*.
// Plain array dedup (no Set) for client bundle compatibility.
function wordAlternation(w: string): string {
  const forms = expandLemma(w)
  const seen: Record<string, boolean> = {}
  const alts: string[] = []
  for (let i = 0; i < forms.length; i++) {
    const alt = escToken(forms[i]) + '\\w*'
    if (!seen[alt]) { seen[alt] = true; alts.push(alt) }
  }
  const escOrig = escToken(w) + '\\w*'
  if (!seen[escOrig]) alts.push(escOrig)
  return alts.length === 1 ? alts[0] : '(?:' + alts.join('|') + ')'
}

// Canonical keyword → regex fragment. This is the ONE pattern definition for
// theme-keyword matching: buildKwRegex wraps it for JS matching, and the
// server counting paths pass the same fragments to the SQL RPCs
// (count_theme_matches / theme_dimension_counts / cooccurrence matrix /
// sampled_signal_counts), so client recounts and DB counts agree.
// POSIX-safe by construction — only (?:), |, \w, \W, {m,n} — because Postgres
// ARE has no lookarounds; each consumer adds its own word-start anchor
// ((?<![a-z]) in JS, \m or (?:^|\W) in SQL, unchanged).
//
// Single word → lemma alternation with stem suffix (behavior unchanged).
// Multi-word → each word in ORDER with up to 4 intervening words: "slow
// service" now also matches "slow table service", "food disappointing"
// matches "food was very disappointing". The old exact-adjacency phrase
// match left 63 of 105 AI-mined keywords matching ≤1 comment (Carrabba's
// GSS Liked-Least, 3K verbatims, 2026-07-13).
export function kwPatternFragment(kw: string): string {
  const words = kw.trim().split(/\s+/)
  if (words.length <= 1) return wordAlternation(kw.trim())
  return words.map(wordAlternation).join('(?:\\W+\\w+){0,4}\\W+')
}

// Lemma-aware keyword regex: expands irregular forms then builds alternation.
// "run" → matches run|runs|ran|running|runner|runners (via lemma) plus stem-suffix via \w*
// "good" → matches good|better|best plus stem-suffix
export function buildKwRegex(kw: string): RegExp {
  return new RegExp('(?<![a-z])(?:' + kwPatternFragment(kw) + ')', 'i')
}

export function commentMatchesTheme(text: string, theme: Theme): boolean {
  if (!theme || !theme.keywords || !theme.keywords.length) return false
  const t = text.toLowerCase()
  return theme.keywords.some(function(kw) {
    return buildKwRegex(kw).test(t)
  })
}

// Wilson score interval — lower and upper bounds at 95% confidence
function wilsonCI(count: number, total: number): { ciLow: number; ciHigh: number } {
  if (total === 0) return { ciLow: 0, ciHigh: 0 }
  const z = 1.96
  const p = count / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const center = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  const lo = Math.max(0, (center - spread) / denom)
  const hi = Math.min(1, (center + spread) / denom)
  return { ciLow: Math.round(lo * 100), ciHigh: Math.round(hi * 100) }
}

export function recountThemes(
  themes: Theme[],
  rows: Record<string, unknown>[],
  field: string | string[],
  ratingField?: string | null
): Theme[] {
  const fields = Array.isArray(field) ? field : [field]
  // SUBSTANTIVE, not merely non-empty (2026-08-18). Every theme number on the
  // TextMine card is a share of the substantive comment base — the denominator
  // is `filteredRows.filter(r => fields.some(f => isSubstantiveText(r[f])))`,
  // and the server's per-theme counts come from `theme_counts_substantive`
  // (sql/181) over that same base. Counting matches here over all NON-EMPTY
  // text put the numerator and denominator in different populations: a theme
  // could be credited with hits inside comments the base excludes. On Darden's
  // Food Quality that read 1,962 client-side against a server figure of 1,817,
  // and the client recount always won because it runs once the rows land.
  //
  // The test is per FIELD, matching the stored SQL map (`substantive ? fld`,
  // any field) — NOT isSubstantiveText over the joined text, which would let
  // two short answers add up to a passing word count.
  const nonEmpty = rows.filter(function(r) {
    return fields.some(function(f) {
      return isSubstantiveText(String(r[f] || ''))
    })
  })
  // Pre-compile keyword regexes for all themes to avoid rebuilding per row.
  // Two flavors:
  //   themeRegexes  — non-global, used with .test() to detect any-match (counts
  //                   rows = records).
  //   themeRegexesG — global, used with .match() to count keyword occurrences
  //                   per matched row (= snippets). Built once, reused per row.
  const themeRegexes: Map<string, RegExp[]> = new Map()
  const themeRegexesG: Map<string, RegExp[]> = new Map()
  for (const t of themes) {
    if (t.keywords && t.keywords.length) {
      const baseRegexes = t.keywords.map(buildKwRegex)
      themeRegexes.set(t.id, baseRegexes)
      themeRegexesG.set(t.id, baseRegexes.map(function(re) {
        return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
      }))
    }
  }

  // Overall avg rating — the baseline each theme's rating delta compares against.
  // Averaged over ALL rated rows (not just the text-bearing `nonEmpty` set), so
  // the baseline matches the all-reviews headline rating users see (and Google).
  // A theme's own avgRating stays theme-scoped (text-bearing matches only), so a
  // theme can read below this baseline — that's the real "comment-leavers rate
  // lower" signal, not a bug.
  let overallAvg = 0
  if (ratingField) {
    let sum = 0, cnt = 0
    for (const r of rows) {
      const v = parseFloat(String(r[ratingField] ?? ''))
      if (!isNaN(v)) { sum += v; cnt++ }
    }
    if (cnt > 0) overallAvg = sum / cnt
  }

  return themes.map(function(t) {
    const regexes = themeRegexes.get(t.id)
    const regexesG = themeRegexesG.get(t.id)
    if (!regexes || !regexes.length) {
      const ci = wilsonCI(0, nonEmpty.length)
      return { ...t, count: 0, snippetCount: 0, percentage: 0, ciLow: ci.ciLow, ciHigh: ci.ciHigh }
    }
    var count = 0, snippetCount = 0, totalPos = 0, totalNeg = 0
    var ratingSum = 0, ratingCnt = 0
    var ratingValues: number[] = []
    // Per-keyword rating accumulators
    var kwRatingSums: Record<string, number> = {}
    var kwRatingCnts: Record<string, number> = {}
    if (ratingField && t.keywords) {
      for (var ki = 0; ki < t.keywords.length; ki++) { kwRatingSums[t.keywords[ki]] = 0; kwRatingCnts[t.keywords[ki]] = 0 }
    }
    nonEmpty.forEach(function(r) {
      const text = fields.map(function(f) { return String(r[f] || '') }).join(' ')
      const lower = text.toLowerCase()
      if (regexes.some(function(re) { return re.test(lower) })) {
        count++
        // Snippets: count every keyword-regex hit in this row's text, not
        // just whether the row matched at all. A row mentioning "slow" 3
        // times contributes 3 to snippetCount but 1 to count.
        if (regexesG) {
          for (var gi = 0; gi < regexesG.length; gi++) {
            const m = lower.match(regexesG[gi])
            if (m) snippetCount += m.length
          }
        }
        var score = lexiconScore(text)
        totalPos += score.pos
        totalNeg += score.neg
        if (ratingField) {
          const rv = parseFloat(String(r[ratingField] ?? ''))
          if (!isNaN(rv)) {
            ratingSum += rv; ratingCnt++; ratingValues.push(rv)
            // Track which keywords matched this row
            for (var ki = 0; ki < regexes.length; ki++) {
              if (regexes[ki].test(lower)) { kwRatingSums[t.keywords[ki]] += rv; kwRatingCnts[t.keywords[ki]]++ }
            }
          }
        }
      }
    })
    const pct = nonEmpty.length > 0 ? Math.round(count / nonEmpty.length * 100) : 0
    const ci = wilsonCI(count, nonEmpty.length)
    // Compute sentiment from lexicon — always update (overrides stale AI values on recount)
    const sentiment = count > 0 ? classifySentiment(totalPos, totalNeg) : (t.sentiment || 'neutral')
    const ratingInfo: Partial<Theme> = {}
    if (ratingField && ratingCnt > 0) {
      ratingInfo.avgRating = Math.round(ratingSum / ratingCnt * 100) / 100
      ratingInfo.ratingDelta = Math.round((ratingInfo.avgRating - overallAvg) * 100) / 100
      ratingInfo.ratingCount = ratingCnt
      // Per-keyword avg ratings
      var kwRatings: Record<string, { avg: number; count: number; delta: number }> = {}
      for (var ki = 0; ki < (t.keywords || []).length; ki++) {
        var kw = t.keywords[ki]
        if (kwRatingCnts[kw] > 0) {
          var kwAvg = Math.round(kwRatingSums[kw] / kwRatingCnts[kw] * 100) / 100
          kwRatings[kw] = { avg: kwAvg, count: kwRatingCnts[kw], delta: Math.round((kwAvg - overallAvg) * 100) / 100 }
        }
      }
      if (Object.keys(kwRatings).length > 0) ratingInfo.keywordRatings = kwRatings
      // Top/Bottom box: detect scale from values, split at midpoint
      if (ratingValues.length > 0) {
        var rMin = Math.min(...ratingValues), rMax = Math.max(...ratingValues)
        var mid = (rMin + rMax) / 2
        var topCnt = 0, botCnt = 0, midCnt = 0
        for (var ri = 0; ri < ratingValues.length; ri++) {
          if (ratingValues[ri] > mid) topCnt++
          else if (ratingValues[ri] < mid) botCnt++
          else midCnt++
        }
        ratingInfo.topBoxPct = Math.round(topCnt / ratingValues.length * 100)
        ratingInfo.bottomBoxPct = Math.round(botCnt / ratingValues.length * 100)
        ratingInfo.midBoxPct = 100 - ratingInfo.topBoxPct - ratingInfo.bottomBoxPct
      }
    }
    return { ...t, count, snippetCount, percentage: pct, ciLow: ci.ciLow, ciHigh: ci.ciHigh, sentiment, ...ratingInfo }
  })
}

export function sampleSize95(n: number): number {
  const Z = 1.96, p = 0.5, e = 0.05
  const n0 = (Z * Z * p * (1 - p)) / (e * e)
  return n <= n0 ? n : Math.ceil(n0 * n / (n0 + n - 1))
}

export function evenSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, function(_, i) {
    return arr[Math.floor(i * step)]
  })
}

// Clause boundary characters — used to expand keyword highlights to the surrounding phrase
const CLAUSE_BREAKS = /[,.;:!?\-—–\n]/

/**
 * Expand a keyword match span to the nearest clause boundaries.
 * Given "The food was great, but we had to wait over 30 minutes for our table, which was bad"
 * with keyword "wait" matching at position 38-42, this expands to
 * "but we had to wait over 30 minutes for our table" (the clause between the commas).
 */
function expandToClause(text: string, matchStart: number, matchEnd: number): { start: number; end: number } {
  // Expand left to nearest clause break (or start of text)
  let left = matchStart
  while (left > 0 && !CLAUSE_BREAKS.test(text[left - 1])) left--
  // Skip whitespace after the break
  while (left < matchStart && text[left] === ' ') left++

  // Expand right to nearest clause break (or end of text)
  let right = matchEnd
  while (right < text.length && !CLAUSE_BREAKS.test(text[right])) right++

  return { start: left, end: right }
}

// Returns text split into matched/unmatched keyword segments for highlighting.
// Highlights expand to the containing clause boundary for contextual phrases.
export function highlightKeywords(text: string, keywords: string[]): TextSegment[] {
  if (!keywords || !keywords.length) return [{ text, matched: false }]
  // Pre-compile all keyword regexes with global flag for full-text scanning
  const compiledRegexes: RegExp[] = []
  for (let ki = 0; ki < keywords.length; ki++) {
    if (keywords[ki]) {
      const base = buildKwRegex(keywords[ki])
      // Rebuild with 'gi' flag for exec() scanning
      compiledRegexes.push(new RegExp(base.source, 'gi'))
    }
  }
  if (!compiledRegexes.length) return [{ text, matched: false }]

  // Find all keyword matches and expand each to clause boundaries
  type Span = { start: number; end: number }
  const spans: Span[] = []
  for (let ki = 0; ki < compiledRegexes.length; ki++) {
    const re = compiledRegexes[ki]
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      spans.push(expandToClause(text, m.index, m.index + m[0].length))
    }
  }
  if (!spans.length) return [{ text, matched: false }]

  // Sort by start position, merge overlapping spans
  spans.sort(function(a, b) { return a.start - b.start })
  const merged: Span[] = [spans[0]]
  for (let i = 1; i < spans.length; i++) {
    const last = merged[merged.length - 1]
    if (spans[i].start <= last.end) {
      if (spans[i].end > last.end) last.end = spans[i].end
    } else {
      merged.push(spans[i])
    }
  }

  // Build segments from merged spans
  const parts: TextSegment[] = []
  let pos = 0
  for (let i = 0; i < merged.length; i++) {
    if (merged[i].start > pos) {
      parts.push({ text: text.slice(pos, merged[i].start), matched: false })
    }
    parts.push({ text: text.slice(merged[i].start, merged[i].end), matched: true })
    pos = merged[i].end
  }
  if (pos < text.length) {
    parts.push({ text: text.slice(pos), matched: false })
  }
  return parts
}

// Sentiment display helpers
export function sentColor(s: string): string {
  const map: Record<string, string> = {
    positive: '#16a34a',
    negative: '#dc2626',
    mixed: '#d97706',
    neutral: '#6b7280',
  }
  return map[s] || '#6b7280'
}

export function sentBg(s: string): string {
  const map: Record<string, string> = {
    positive: '#f0fdf4',
    negative: '#fef2f2',
    mixed: '#fffbeb',
    neutral: '#f9fafb',
  }
  return map[s] || '#f9fafb'
}

// Rating-based color ramp: red → amber → green (0–1 normalized)
export function ratingColor(pct: number): string {
  if (pct <= 0.5) {
    var r = 220, g = Math.round(80 + pct * 2 * 120)
    return 'rgb(' + r + ',' + g + ',40)'
  }
  var r2 = Math.round(220 - (pct - 0.5) * 2 * 180), g2 = Math.round(160 + (pct - 0.5) * 2 * 40)
  return 'rgb(' + r2 + ',' + g2 + ',40)'
}

export function ratingBg(pct: number): string {
  return ratingColor(pct) + '15'
}

// Ana THEME_PALETTE -- 20 unique colors for theme cards (no repeats up to 20 themes)
export const THEME_PALETTE = [
  { bg: '#fff0e6', border: '#e8622a', text: '#b84a18', light: '#ffe4d0' },
  { bg: '#eff6ff', border: '#2563eb', text: '#1d4ed8', light: '#dbeafe' },
  { bg: '#f0fdf4', border: '#16a34a', text: '#15803d', light: '#bbf7d0' },
  { bg: '#f5f3ff', border: '#7c3aed', text: '#6d28d9', light: '#ddd6fe' },
  { bg: '#fff7ed', border: '#ea580c', text: '#c2410c', light: '#fed7aa' },
  { bg: '#fdf4ff', border: '#a21caf', text: '#86198f', light: '#f5d0fe' },
  { bg: '#f0fdfa', border: '#0d9488', text: '#0f766e', light: '#99f6e4' },
  { bg: '#fefce8', border: '#ca8a04', text: '#a16207', light: '#fef08a' },
  // Extended: 8 more unique hues
  { bg: '#fdf2f8', border: '#db2777', text: '#be185d', light: '#fbcfe8' },
  { bg: '#ecfeff', border: '#0891b2', text: '#0e7490', light: '#a5f3fc' },
  { bg: '#fef2f2', border: '#dc2626', text: '#b91c1c', light: '#fecaca' },
  { bg: '#f0f9ff', border: '#0284c7', text: '#075985', light: '#bae6fd' },
  { bg: '#ecfdf5', border: '#059669', text: '#047857', light: '#a7f3d0' },
  { bg: '#fffbeb', border: '#d97706', text: '#92400e', light: '#fde68a' },
  { bg: '#f5f3ff', border: '#6366f1', text: '#4338ca', light: '#c7d2fe' },
  { bg: '#fff1f2', border: '#e11d48', text: '#be123c', light: '#fecdd3' },
  { bg: '#f0fdfa', border: '#14b8a6', text: '#0d9488', light: '#5eead4' },
  { bg: '#faf5ff', border: '#9333ea', text: '#7e22ce', light: '#d8b4fe' },
  { bg: '#f7fee7', border: '#65a30d', text: '#4d7c0f', light: '#bef264' },
  { bg: '#fff7ed', border: '#f97316', text: '#c2410c', light: '#fdba74' },
]

export function getThemeColor(idx: number) {
  return THEME_PALETTE[idx % THEME_PALETTE.length]
}

// Row text helpers
export function getRowText(row: Record<string, unknown>, fields: string[]): string {
  return fields.map(function(f) { return String(row[f] || '') }).join(' ').trim()
}
