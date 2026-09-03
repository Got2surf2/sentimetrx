// tests/unit/anaSegment.test.ts
// Ana-composed subgroup scoping (lib/anaSegment) behind the query tools'
// `where` parameter. Pins: the canonical-filter equivalence (whereToFilters
// matches applyFilters semantics — blanks excluded from subgroups), input
// validation, and the resolver's narrowing strategy against a PostgREST-
// faithful fake (containment ids for categoricals, chunked data fetch for
// ranges over the narrowed set, both string and numeric storage shapes).

import { describe, it, expect } from 'vitest'
import { whereToFilters, validateWhere, resolveWhereRowIds, describeWhere } from '@/lib/anaSegment'
import { applyFilters } from '@/lib/filterUtils'

describe('whereToFilters', () => {
  it('categorical values become an include allowlist that EXCLUDES blanks', () => {
    const f = whereToFilters([{ field: 'race', values: ['Black'] }])
    const rows = [{ race: 'Black' }, { race: 'White' }, { race: '' }, {}]
    expect(applyFilters(rows, f)).toEqual([{ race: 'Black' }])
  })

  it('min/max become a numeric range with blanks and non-numerics excluded', () => {
    const f = whereToFilters([{ field: 'age', max: 29 }])
    const rows = [{ age: 22 }, { age: '25' }, { age: 30 }, { age: 'n/a' }, {}]
    expect(applyFilters(rows, f)).toEqual([{ age: 22 }, { age: '25' }])
  })

  it('conditions AND together', () => {
    const f = whereToFilters([{ field: 'gender', values: ['Male'] }, { field: 'age', min: 18, max: 29 }])
    const rows = [
      { gender: 'Male', age: 25 }, { gender: 'Male', age: 40 },
      { gender: 'Female', age: 25 }, { gender: 'Male' },
    ]
    expect(applyFilters(rows, f)).toEqual([{ gender: 'Male', age: 25 }])
  })
})

describe('validateWhere', () => {
  it('rejects empty, condition-less, and oversized inputs', () => {
    expect(validateWhere([])).toHaveProperty('error')
    expect(validateWhere([{ field: 'x' }])).toHaveProperty('error')
    expect(validateWhere(Array.from({ length: 7 }, () => ({ field: 'a', values: ['1'] })))).toHaveProperty('error')
  })

  it('passes well-formed conditions through', () => {
    const v = validateWhere([{ field: 'age', max: 29 }, { field: 'race', values: ['Black'] }])
    expect(Array.isArray(v)).toBe(true)
  })
})

// ── PostgREST-faithful fake over an in-memory row store ─────────────────────

type Row = { id: number; data: Record<string, unknown> }

function fakeService(rows: Row[]) {
  function builder() {
    const state = { contains: null as Record<string, unknown> | null, ids: null as number[] | null, range: null as [number, number] | null }
    const match = () => {
      let out = rows
      if (state.contains) {
        const [k, v] = Object.entries(state.contains)[0]
        out = out.filter(r => r.data[k] === v)   // jsonb containment is type-exact
      }
      if (state.ids) out = out.filter(r => state.ids!.includes(r.id))
      out = [...out].sort((a, b) => a.id - b.id)
      if (state.range) out = out.slice(state.range[0], state.range[1] + 1)
      return out
    }
    const chain = {
      select: () => chain,
      eq: () => chain,
      contains: (_c: string, v: Record<string, unknown>) => { state.contains = v; return chain },
      in: (_c: string, ids: number[]) => { state.ids = ids; return Promise.resolve({ data: match(), error: null }) },
      order: () => chain,
      range: (a: number, b: number) => { state.range = [a, b]; return Promise.resolve({ data: match(), error: null }) },
    }
    return chain
  }
  return { from: () => builder() }
}

const ROWS: Row[] = [
  { id: 1, data: { race: 'Black', gender: 'Male', age: 24, comment: 'jobs' } },
  { id: 2, data: { race: 'Black', gender: 'Male', age: 55, comment: 'health care' } },
  { id: 3, data: { race: 'Black', gender: 'Female', age: 22, comment: 'schools' } },
  { id: 4, data: { race: 'White', gender: 'Male', age: 25, comment: 'taxes' } },
  { id: 5, data: { race: 'Black', gender: 'Male', age: '27', comment: 'housing' } }, // age stored as TEXT
  { id: 6, data: { race: 'Black', gender: 'Male' } },                                // no age → excluded from a range
]

describe('resolveWhereRowIds', () => {
  it('resolves a compound demographic subgroup (cat ∩ cat ∩ range)', async () => {
    const r = await resolveWhereRowIds(fakeService(ROWS), {
      datasetId: 'd1', rowCount: ROWS.length,
      where: [{ field: 'race', values: ['Black'] }, { field: 'gender', values: ['Male'] }, { field: 'age', max: 29 }],
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.ids).toEqual([1, 5]) // 24 and '27'; 55 too old, blank age excluded
    expect(r.sampled).toBe(false)
  })

  it('matches numerically-stored values for a text condition (tries both shapes)', async () => {
    const rows: Row[] = [{ id: 1, data: { stars: 5 } }, { id: 2, data: { stars: '5' } }, { id: 3, data: { stars: 4 } }]
    const r = await resolveWhereRowIds(fakeService(rows), { datasetId: 'd1', rowCount: 3, where: [{ field: 'stars', values: ['5'] }] })
    if ('error' in r) throw new Error(r.error)
    expect(r.ids).toEqual([1, 2])
  })

  it('range-only conditions walk the dataset', async () => {
    const r = await resolveWhereRowIds(fakeService(ROWS), { datasetId: 'd1', rowCount: ROWS.length, where: [{ field: 'age', min: 50 }] })
    if ('error' in r) throw new Error(r.error)
    expect(r.ids).toEqual([2])
  })

  it('an unmatched categorical value returns a check-the-values error', async () => {
    const r = await resolveWhereRowIds(fakeService(ROWS), { datasetId: 'd1', rowCount: ROWS.length, where: [{ field: 'race', values: ['African American'] }] })
    expect(r).toHaveProperty('error')
    expect(String((r as { error: string }).error)).toContain('field_counts')
  })

  it('describeWhere renders a human label', () => {
    expect(describeWhere([{ field: 'age', max: 29 }, { field: 'race', values: ['Black'] }]))
      .toBe('age ≤ 29 AND race ∈ [Black]')
  })
})
