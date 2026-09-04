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
  /** Filled ASYNC by ContextCloud from server tax_counts — client rows never carry _tx. */
  dimensions: ConceptChip[]
  entities: ConceptChip[]
  /** Flat _rowId set of the target's comment subset — the scope for the server fetch. */
  subsetRowIds: number[]
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
  const empty: RelatedConcepts = { matchedRows: 0, themes: [], dimensions: [], entities: [], subsetRowIds: [] }
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

  // Dimensions are NOT computable from these rows: the rows route strips the
  // data._tx block from every client row (rows/route.ts projectRow), so the
  // original client-side read here was dead code that could never populate —
  // found by the 2026-09-04 never-assume sweep. The chips are now fetched
  // SERVER-side (ContextCloud → aggregate tax_counts scoped to the subset's
  // row ids, the same engine every other dimension surface uses); this pass
  // only reports which rows form the subset.
  const subsetRowIds: number[] = []
  for (const s of subset) {
    const rid = (s.row as { _rowId?: unknown })._rowId
    if (typeof rid === 'number' && Number.isFinite(rid)) subsetRowIds.push(rid)
  }

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
    dimensions: [], // fetched server-side by ContextCloud (see note above)
    entities: entityChips.sort(byCount).slice(0, MAX_PER_KIND),
    subsetRowIds,
  }
}

// Build dimension chips from the aggregate tax_counts responses ContextCloud
// fetches per axis — same floor and cap as the synchronous chip kinds.
export function dimensionChipsFromCounts(
  perAxis: { axis: string; counts: Record<string, number> }[],
): ConceptChip[] {
  const chips: ConceptChip[] = []
  for (const a of perAxis) {
    for (const [sub, n] of Object.entries(a.counts || {})) {
      if (n < CONCEPT_FLOOR) continue
      chips.push({ label: dimSubLabel(sub), count: n, detail: DIM_AXIS_LABEL[a.axis as Axis] || a.axis })
    }
  }
  return chips
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label))
    .slice(0, MAX_PER_KIND)
}
