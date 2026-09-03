// lib/contextConcepts.ts
// The Context tab's "Related concepts" layer (owner ask, 2026-09-02): instead
// of only raw co-occurring WORDS, map the term's comment set onto the
// structures the platform has already computed — themes (keyword models),
// dimensions (the per-row `_tx` verdicts embedded at classify time), and the
// entity catalog. Everything here runs over the TARGET'S comment subset only
// — the corpus is never re-tokenized (the Context-view perf rule), and the
// per-row dimension tags are read, never recomputed.
//
// Counts are whole-comment counts over that subset with a floor of 3 (the
// same spirit as the collocation G² frequency floor: a concept present in 1-2
// comments is an anecdote, not context). Chips are informational — they carry
// no drill, so the chip-count == drill-count invariant cannot be violated.

import { commentMatchesTheme, getRowText, type Theme } from './themeUtils'
import { expandEntityTerms } from './entityVariants'
import { DIM_AXIS_LABEL, dimSubLabel } from './dimensionFields'
import type { Axis } from './taxonomyVocabulary'

const CONCEPT_FLOOR = 3
const MAX_PER_KIND = 6

export interface ConceptChip {
  label: string
  count: number
  /** Secondary line for the tooltip (e.g. the dimension axis). */
  detail?: string
}

export interface RelatedConcepts {
  matchedRows: number
  themes: ConceptChip[]
  dimensions: ConceptChip[]
  entities: ConceptChip[]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Same canonical word-boundary term match as lib/collocations.targetRegexes,
// so the concept section's base set is exactly the comments the cloud's
// footer reports ("Based on N comments mentioning X").
function termRegexes(terms: string[]): RegExp[] {
  const out: RegExp[] = []
  for (const t of terms) {
    const trimmed = String(t || '').trim()
    if (trimmed) out.push(new RegExp('\\b' + escapeRe(trimmed) + '\\b', 'i'))
  }
  return out
}

interface TxField { a?: Record<string, string[]> }
interface TxBlob { f?: Record<string, TxField> }

export function relatedConcepts(opts: {
  rows: Record<string, unknown>[]
  fields: string | string[]
  targets: string[]
  themes?: Theme[] | null
  /** In the theme modal, the theme being viewed — excluded from its own concepts. */
  excludeThemeName?: string
  entities?: { canonical: string; aliases?: string[] }[] | null
}): RelatedConcepts {
  const fieldArr = Array.isArray(opts.fields) ? opts.fields : [opts.fields]
  const regexes = termRegexes(opts.targets)
  const empty: RelatedConcepts = { matchedRows: 0, themes: [], dimensions: [], entities: [] }
  if (!regexes.length || !opts.rows.length) return empty

  // The target's comment set: rows where any field mentions any target term.
  const subset: { row: Record<string, unknown>; text: string }[] = []
  for (const row of opts.rows) {
    let hit = false
    for (const field of fieldArr) {
      const text = String(row[field] ?? '')
      if (!text) continue
      if (regexes.some(re => re.test(text))) { hit = true; break }
    }
    if (hit) subset.push({ row, text: getRowText(row, fieldArr) })
  }
  if (!subset.length) return empty

  // Themes — whole-comment membership via the product's own matcher.
  const themeChips: ConceptChip[] = []
  const exclude = (opts.excludeThemeName || '').toLowerCase()
  for (const t of opts.themes || []) {
    if (!t?.name || t.name.toLowerCase() === exclude) continue
    let n = 0
    for (const s of subset) if (commentMatchesTheme(s.text, t)) n++
    if (n >= CONCEPT_FLOOR) themeChips.push({ label: t.name, count: n })
  }

  // Dimensions — read the per-row verdicts stamped at classify time. A row
  // counts once per (axis, sub) no matter how many fields carried the tag.
  const dimCounts = new Map<string, number>()
  for (const s of subset) {
    const tx = (s.row as { _tx?: TxBlob })._tx
    if (!tx?.f) continue
    const seen = new Set<string>()
    for (const field of fieldArr) {
      const axes = tx.f[field]?.a
      if (!axes) continue
      for (const axis of Object.keys(axes)) {
        // '|' separator - sub names can contain spaces ("churn intent").
        for (const sub of axes[axis] || []) seen.add(axis + '|' + sub)
      }
    }
    seen.forEach(k => dimCounts.set(k, (dimCounts.get(k) || 0) + 1))
  }
  const dimChips: ConceptChip[] = []
  dimCounts.forEach((n, k) => {
    if (n < CONCEPT_FLOOR) return
    const sep = k.indexOf('|')
    const axis = k.slice(0, sep), sub = k.slice(sep + 1)
    dimChips.push({ label: dimSubLabel(sub), count: n, detail: DIM_AXIS_LABEL[axis as Axis] || axis })
  })

  // Entities — catalog terms matched over the subset's text only.
  const entityChips: ConceptChip[] = []
  for (const e of opts.entities || []) {
    if (!e?.canonical) continue
    const res = termRegexes(expandEntityTerms([e.canonical, ...(e.aliases || [])]))
    if (!res.length) continue
    let n = 0
    for (const s of subset) if (res.some(re => re.test(s.text))) n++
    if (n >= CONCEPT_FLOOR) entityChips.push({ label: e.canonical, count: n })
  }

  const byCount = (a: ConceptChip, b: ConceptChip) => b.count - a.count || a.label.localeCompare(b.label)
  return {
    matchedRows: subset.length,
    themes: themeChips.sort(byCount).slice(0, MAX_PER_KIND),
    dimensions: dimChips.sort(byCount).slice(0, MAX_PER_KIND),
    entities: entityChips.sort(byCount).slice(0, MAX_PER_KIND),
  }
}
