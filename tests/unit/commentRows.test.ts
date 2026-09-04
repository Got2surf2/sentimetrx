// lib/commentRows — the client-side row source behind the unified Comments
// panel's themes-only / show-all modes (CommentsPanel retirement, 2026-09-04).
// Pins: matching runs through commentMatchesTheme (the canonical matcher —
// NEVER the FTS route, whose different predicate would move drill counts),
// show-all = ANY theme, non-empty denominator, _rowId passthrough with index
// fallback, and the server panel's row shape.
import { describe, it, expect } from 'vitest'
import { buildClientCommentRows } from '@/lib/commentRows'
import { commentMatchesTheme, type Theme } from '@/lib/themeUtils'

const theme = (id: string, keywords: string[]): Theme => ({
  id, name: id, description: '', keywords, sentiment: 'mixed', count: 0, percentage: 0, relatedThemes: [],
})

const SERVICE = theme('service', ['rude', 'slow service'])
const FOOD = theme('food', ['overcooked', 'bland'])

const ROWS: Record<string, unknown>[] = [
  { comment: 'The server was rude to us', _rowId: 101 },          // service
  { comment: 'Steak was overcooked and bland', _rowId: 102 },     // food
  { comment: 'Great evening overall' },                           // no theme, no _rowId
  { comment: '', other: 'x' },                                    // empty text → excluded from denominator
  { comment: 'rude staff AND overcooked pasta', _rowId: 105 },    // both
]

describe('buildClientCommentRows', () => {
  it('selected themes: rows matching ANY selected theme, in the server panel row shape', () => {
    const r = buildClientCommentRows({ rows: ROWS, fields: ['comment'], allThemes: [SERVICE, FOOD], selectedThemes: [SERVICE], datasetId: 'ds-1' })
    expect(r.rows.map(x => x.id)).toEqual([101, 105])
    expect(r.rows[0]).toEqual({ id: 101, dataset_id: 'ds-1', row_index: 0, data: ROWS[0] })
    expect(r.nonEmpty).toBe(4)
  })

  it('show-all (no selection): rows matching ANY theme at all — CommentsPanel semantics', () => {
    const r = buildClientCommentRows({ rows: ROWS, fields: ['comment'], allThemes: [SERVICE, FOOD], selectedThemes: [], datasetId: 'ds-1' })
    expect(r.rows.map(x => x.id)).toEqual([101, 102, 105])
  })

  it('empty-text rows are excluded from the non-empty denominator', () => {
    const r = buildClientCommentRows({ rows: ROWS, fields: ['comment'], allThemes: [SERVICE], selectedThemes: [], datasetId: 'ds-1' })
    expect(r.nonEmpty).toBe(4)
  })

  it('a row without _rowId falls back to its index as id', () => {
    const r = buildClientCommentRows({ rows: ROWS, fields: ['comment'], allThemes: [theme('all', ['evening'])], selectedThemes: [], datasetId: 'ds-1' })
    expect(r.rows).toEqual([{ id: 2, dataset_id: 'ds-1', row_index: 2, data: ROWS[2] }])
  })

  it('membership agrees with commentMatchesTheme row-for-row (the reconciliation contract)', () => {
    const r = buildClientCommentRows({ rows: ROWS, fields: ['comment'], allThemes: [SERVICE, FOOD], selectedThemes: [FOOD], datasetId: 'ds-1' })
    const expected = ROWS
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => String(row.comment || '').trim().length > 0 && commentMatchesTheme(String(row.comment || ''), FOOD))
      .map(({ i }) => i)
    expect(r.rows.map(x => x.row_index)).toEqual(expected)
  })

  it('multi-field rows: text joins the given fields; any carrying text counts as non-empty', () => {
    const rows = [{ a: 'rude', b: '' }, { a: '', b: 'bland dish' }, { a: '', b: '' }]
    const r = buildClientCommentRows({ rows, fields: ['a', 'b'], allThemes: [SERVICE, FOOD], selectedThemes: [], datasetId: 'd' })
    expect(r.nonEmpty).toBe(2)
    expect(r.rows.map(x => x.row_index)).toEqual([0, 1])
  })
})
