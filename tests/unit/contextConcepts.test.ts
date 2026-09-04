// tests/unit/contextConcepts.test.ts
// The Context tab's "Related concepts" layer (lib/contextConcepts): concepts
// are computed over the TARGET'S comment subset only, dimension tags are READ
// from the per-row _tx verdicts (never recomputed), the 3-comment floor
// filters anecdotes, and the theme modal's own theme never lists itself.

import { describe, it, expect } from 'vitest'
import { relatedConcepts, dimensionChipsFromCounts } from '@/lib/contextConcepts'
import type { Theme } from '@/lib/themeUtils'

function theme(name: string, keywords: string[]): Theme {
  return { id: name, name, description: '', keywords, sentiment: 'negative', count: 0, percentage: 0, relatedThemes: [] }
}

const tx = (subs: string[]) => ({ f: { comment: { a: { emotion: subs } } } })

const ROWS: Record<string, unknown>[] = [
  { comment: 'The server was slow and the food arrived cold', _tx: tx(['disappointment']) },
  { comment: 'Slow service again, our server forgot the drinks', _tx: tx(['disappointment']) },
  { comment: 'Server took forever, never going back', _tx: tx(['churn intent']) },
  { comment: 'Our server was slow but friendly', _tx: tx(['disappointment']) },
  { comment: 'Great patio, lovely evening', _tx: tx(['blame']) },   // no target term
  { comment: 'The steak was cooked perfectly' },                      // no target, no _tx
]

const THEMES = [
  theme('Slow Service', ['slow', 'forever']),
  theme('Food Quality', ['cold', 'steak']),
]

describe('relatedConcepts', () => {
  it('computes concepts over the target subset only', () => {
    const r = relatedConcepts({ rows: ROWS, fields: 'comment', targets: ['server'], themes: THEMES })
    expect(r.matchedRows).toBe(4)
    // 'Slow Service' matches all 4 server comments; 'Food Quality' only 1 (< floor).
    expect(r.themes).toEqual([{ label: 'Slow Service', count: 4 }])
  })

  it('never computes dimensions client-side — reports the subset row ids for the server fetch', () => {
    // The rows route strips data._tx from every client row, so a client-side
    // read can never populate (the original version of this test fed rows
    // WITH _tx — an input that cannot occur in the app — which is exactly how
    // the dead code passed review). Dimensions arrive via ContextCloud's
    // server tax_counts scoped to subsetRowIds.
    const rows = ROWS.map((r, i) => ({ ...r, _rowId: 100 + i }))
    const r = relatedConcepts({ rows, fields: 'comment', targets: ['server'] })
    expect(r.dimensions).toEqual([])
    expect(r.subsetRowIds).toEqual([100, 101, 102, 103]) // the 4 'server' rows
  })

  it('dimensionChipsFromCounts applies the 3-count floor, cap, and axis labels', () => {
    const chips = dimensionChipsFromCounts([
      { axis: 'emotion', counts: { disappointment: 5, 'churn intent': 2 } },
      { axis: 'touchpoint', counts: { 'wait time': 3 } },
    ])
    expect(chips).toEqual([
      { label: 'Disappointment', count: 5, detail: 'Emotion Language' },
      { label: 'Wait Time', count: 3, detail: 'Touchpoint' },
    ])
  })

  it('matches catalog entities over the subset text only', () => {
    const rows = ROWS.map((r, i) => ({ ...r, comment: r.comment + (i < 3 ? ' at Madden Cafe' : '') }))
    const r = relatedConcepts({ rows, fields: 'comment', targets: ['server'], entities: [{ canonical: 'Madden Cafe' }, { canonical: 'Patio' }] })
    expect(r.entities).toEqual([{ label: 'Madden Cafe', count: 3 }])
  })

  it('the theme modal excludes the theme being viewed from its own concepts', () => {
    const r = relatedConcepts({ rows: ROWS, fields: 'comment', targets: ['server'], themes: THEMES, excludeThemeName: 'Slow Service' })
    expect(r.themes).toEqual([])
  })

  it('empty targets or rows yield the empty shape', () => {
    expect(relatedConcepts({ rows: [], fields: 'comment', targets: ['x'] }).matchedRows).toBe(0)
    expect(relatedConcepts({ rows: ROWS, fields: 'comment', targets: [] }).matchedRows).toBe(0)
  })
})
