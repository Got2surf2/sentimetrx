// lib/commentRows.ts
// Client-side comment-row builder for the unified Comments panel's themes-only
// and show-all modes (CommentsPanel retirement, 2026-09-04). Matching runs
// through commentMatchesTheme — the SAME canonical matcher whose patterns the
// theme cards' server counts splice (count_theme_matches ⋅ kwPatternFragment) —
// so the drill list reconciles with the cards by construction. The unified
// /comments route was deliberately NOT used here: its theme predicate is FTS
// (buildThemeQuery), a different matcher, and it ignores the user's active
// filters — both would silently move drill counts.

import { buildKwRegex, getRowText, type Theme } from './themeUtils'

/** The server panel's row shape, so FilteredCommentsPanel takes either source. */
export interface ClientCommentRow {
  id: number
  dataset_id: string
  row_index: number
  data: Record<string, unknown>
}

export function buildClientCommentRows(opts: {
  /** The user's FILTERED client rows (active filters already applied). */
  rows: Record<string, unknown>[]
  /** Active text fields — a row is non-empty when any carries text. */
  fields: string[]
  allThemes: Theme[]
  /** Empty → show-all mode: rows matching ANY theme (CommentsPanel semantics). */
  selectedThemes: Theme[]
  datasetId: string
}): { rows: ClientCommentRow[]; nonEmpty: number } {
  const active = opts.selectedThemes.length > 0 ? opts.selectedThemes : opts.allThemes
  // Compile each theme's keyword regexes ONCE — commentMatchesTheme rebuilds
  // the lemma-expanded RegExp per keyword per call, which at 50K rows × 7
  // themes froze the tab for tens of seconds. Same patterns (buildKwRegex),
  // same lowercased text, so membership is unchanged — only compile count.
  const compiled = active
    .map(t => (t.keywords || []).filter(Boolean).map(buildKwRegex))
    .filter(res => res.length > 0)
  const out: ClientCommentRow[] = []
  let nonEmpty = 0
  for (let i = 0; i < opts.rows.length; i++) {
    const r = opts.rows[i]
    const text = getRowText(r, opts.fields)
    if (!text) continue
    nonEmpty++
    const lower = text.toLowerCase()
    if (!compiled.some(res => res.some(re => re.test(lower)))) continue
    const rid = (r as { _rowId?: unknown })._rowId
    out.push({ id: typeof rid === 'number' ? rid : i, dataset_id: opts.datasetId, row_index: i, data: r })
  }
  return { rows: out, nonEmpty }
}
