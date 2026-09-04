// tests/unit/anaSegment.test.ts
// Ana-composed subgroup scoping (lib/anaSegment) behind the query tools'
// `where` parameter. Pins: the canonical-filter equivalence (whereToFilters
// matches applyFilters semantics — blanks excluded from subgroups), input
// validation, and the resolver's narrowing strategy against a PostgREST-
// faithful fake (containment ids for categoricals, chunked data fetch for
// ranges over the narrowed set, both string and numeric storage shapes).

import { describe, it, expect } from 'vitest'
import { whereToFilters, validateWhere, resolveWhereRowIds, describeWhere, matchStoredValues } from '@/lib/anaSegment'
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

// Faithful emulation of sql/200 segment_match_ids over the in-memory store —
// text equality for values, drf-style numeric guard for ranges, AND across
// conditions. Existing scenarios must produce IDENTICAL results through this
// path as through the JS fallback.
function numericOk(t: unknown): boolean {
  return t != null && /^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$/.test(String(t).trim())
}
function segMatch(data: Record<string, unknown>, conds: { field: string; values?: string[]; min?: number; max?: number }[]): boolean {
  return conds.every(c => {
    const raw = data[c.field]
    if (c.values) return raw != null && c.values.includes(String(raw))
    if (!numericOk(raw)) return false
    const v = parseFloat(String(raw))
    if (c.min != null && v < c.min) return false
    if (c.max != null && v > c.max) return false
    return true
  })
}
function segmentMatchIdsRpc(rows: Row[], args: Record<string, unknown>) {
  const after = Number(args.p_after_row_index ?? -1)
  const limit = Number(args.p_limit ?? 20000)
  const page = rows.map((r, i) => ({ ...r, row_index: i })).filter(r => r.row_index > after).slice(0, limit)
  const ids = page.filter(r => segMatch(r.data, args.p_conds as never)).map(r => r.id).sort((a, b) => a - b)
  return { n_scanned: page.length, last_row_index: page.length ? page[page.length - 1].row_index : null, ids }
}


// Emulate PostgREST's aliased jsonb arrow-select ('"f0":data->"Age"') — the
// resolver pulls only the range fields since 2026-09-04.
function projectRows(rows: Row[], sel: string | null): Record<string, unknown>[] {
  if (!sel || !sel.includes('data->')) return rows as unknown as Record<string, unknown>[]
  const aliases = [...sel.matchAll(/"(f\d+)":data->"([^"]+)"/g)]
  return rows.map(r => {
    const o: Record<string, unknown> = { id: r.id }
    for (const m of aliases) o[m[1]] = r.data[m[2]]
    return o
  })
}


type Row = { id: number; data: Record<string, unknown> }

function fakeService(rows: Row[], opts?: { noSegmentFn?: boolean }) {
  const rpc = (_name: string, args: Record<string, unknown>) => {
    if (_name === 'segment_match_ids') {
      if (opts?.noSegmentFn) return Promise.resolve({ data: null, error: { message: 'function public.segment_match_ids does not exist', code: 'PGRST202' } })
      return Promise.resolve({ data: segmentMatchIdsRpc(rows, args), error: null })
    }
    const field = String(args.p_field_key)
    const counts = new Map<string, number>()
    rows.forEach(r => { const v = r.data[field]; if (v != null && String(v).trim() !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1) })
    return Promise.resolve({ data: [...counts.entries()].map(([value, count]) => ({ value, count })), error: null })
  }
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
    let sel: string | null = null
    const chain = {
      select: (s: string) => { sel = s; return chain },
      eq: () => chain,
      contains: (_c: string, v: Record<string, unknown>) => { state.contains = v; return chain },
      in: (_c: string, ids: number[]) => { state.ids = ids; return Promise.resolve({ data: projectRows(match(), sel), error: null }) },
      order: () => chain,
      range: (a: number, b: number) => { state.range = [a, b]; return Promise.resolve({ data: projectRows(match(), sel), error: null }) },
    }
    return chain
  }
  return { from: () => builder(), rpc }
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

  it('a value with NO lexical match errors WITH the stored values listed (Ana bridges synonyms and retries)', async () => {
    const r = await resolveWhereRowIds(fakeService(ROWS), { datasetId: 'd1', rowCount: ROWS.length, where: [{ field: 'race', values: ['African American'] }] })
    expect(r).toHaveProperty('error')
    const msg = String((r as { error: string }).error)
    expect(msg).toContain('Black')   // the actual values are in the error
    expect(msg).toContain('White')
  })

  it('fuzzy: case-insensitive and partial labels resolve to stored values, recorded as mappings', async () => {
    const rows: Row[] = [
      { id: 1, data: { race: 'Black or African American' } },
      { id: 2, data: { race: 'White' } },
      { id: 3, data: { race: 'Black or African American' } },
    ]
    const r = await resolveWhereRowIds(fakeService(rows), { datasetId: 'd1', rowCount: 3, where: [{ field: 'race', values: ['black'] }] })
    if ('error' in r) throw new Error(r.error)
    expect(r.ids).toEqual([1, 3])
    expect(r.mappings).toEqual([{ requested: 'black', matched: ['Black or African American'] }])
    expect(r.label).toContain('Black or African American')   // the label reports what ran
  })

  it('fuzzy: an exact match records no mapping', async () => {
    const r = await resolveWhereRowIds(fakeService(ROWS), { datasetId: 'd1', rowCount: ROWS.length, where: [{ field: 'race', values: ['Black'] }] })
    if ('error' in r) throw new Error(r.error)
    expect(r.mappings).toEqual([])
  })

  it('describeWhere renders a human label', () => {
    expect(describeWhere([{ field: 'age', max: 29 }, { field: 'race', values: ['Black'] }]))
      .toBe('age ≤ 29 AND race ∈ [Black]')
  })
})

describe('matchStoredValues', () => {
  it('prefers exact, then case-insensitive, then normalized substring either way', () => {
    const stored = ['Black or African American', 'White', 'black']
    expect(matchStoredValues('black', stored)).toEqual(['black'])                       // ci-exact beats substring
    expect(matchStoredValues('Black', stored)).toEqual(['black'])                       // ci
    expect(matchStoredValues('African American', stored)).toEqual(['Black or African American'])
    expect(matchStoredValues('Hispanic', stored)).toEqual([])
  })
})

// ── Collection scope (2026-09-04) ───────────────────────────────────────────
// A collection holds no rows under its own id — resolveWhereRowIds takes the
// member ids as `scope` and every per-dataset query must walk them.
function fakeScopedService(byDataset: Record<string, Row[]>) {
  const rpc = (_name: string, args: Record<string, unknown>) => {
    const rows = byDataset[String(args.p_dataset_id)] || []
    if (_name === 'segment_match_ids') return Promise.resolve({ data: segmentMatchIdsRpc(rows, args), error: null })
    const field = String(args.p_field_key)
    const counts = new Map<string, number>()
    rows.forEach(r => { const v = r.data[field]; if (v != null && String(v).trim() !== '') counts.set(String(v), (counts.get(String(v)) || 0) + 1) })
    return Promise.resolve({ data: [...counts.entries()].map(([value, count]) => ({ value, count })), error: null })
  }
  function builder() {
    const state = { dsId: null as string | null, contains: null as Record<string, unknown> | null, ids: null as number[] | null, range: null as [number, number] | null }
    const match = () => {
      let out = state.dsId ? (byDataset[state.dsId] || []) : []
      if (state.contains) {
        const [k, v] = Object.entries(state.contains)[0]
        out = out.filter(r => r.data[k] === v)
      }
      if (state.ids) out = out.filter(r => state.ids!.includes(r.id))
      out = [...out].sort((a, b) => a.id - b.id)
      if (state.range) out = out.slice(state.range[0], state.range[1] + 1)
      return out
    }
    let sel: string | null = null
    const chain = {
      select: (s: string) => { sel = s; return chain },
      eq: (_c: string, v: unknown) => { state.dsId = String(v); return chain },
      contains: (_c: string, v: Record<string, unknown>) => { state.contains = v; return chain },
      in: (_c: string, ids: number[]) => { state.ids = ids; return Promise.resolve({ data: projectRows(match(), sel), error: null }) },
      order: () => chain,
      range: (a: number, b: number) => { state.range = [a, b]; return Promise.resolve({ data: projectRows(match(), sel), error: null }) },
    }
    return chain
  }
  return { from: () => builder(), rpc }
}

describe('resolveWhereRowIds — collection scope', () => {
  const BY_DS: Record<string, Row[]> = {
    'm-1': [
      { id: 1, data: { race: 'Black', age: 24 } },
      { id: 2, data: { race: 'White', age: 30 } },
    ],
    'm-2': [
      { id: 10, data: { race: 'Black', age: 61 } },
      { id: 11, data: { race: 'Black', age: 19 } },
    ],
    // The collection's OWN id holds nothing — querying it is the bug.
    'coll-1': [],
  }

  it('categorical: unions matches from every member (querying only coll-1 would find zero)', async () => {
    const r = await resolveWhereRowIds(fakeScopedService(BY_DS), {
      datasetId: 'coll-1', rowCount: 4, scope: ['m-1', 'm-2'],
      where: [{ field: 'race', values: ['Black'] }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual([1, 10, 11])
  })

  it('value discovery merges stored values across members', async () => {
    // 'White' exists only in m-1 — a coll-1-only read would list nothing and
    // every requested value would "not match".
    const r = await resolveWhereRowIds(fakeScopedService(BY_DS), {
      datasetId: 'coll-1', rowCount: 4, scope: ['m-1', 'm-2'],
      where: [{ field: 'race', values: ['white'] }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual([2])
  })

  it('categorical + range narrows across members', async () => {
    const r = await resolveWhereRowIds(fakeScopedService(BY_DS), {
      datasetId: 'coll-1', rowCount: 4, scope: ['m-1', 'm-2'],
      where: [{ field: 'race', values: ['Black'] }, { field: 'age', min: 50 }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual([10])
  })

  it('range-only walks every member', async () => {
    const r = await resolveWhereRowIds(fakeScopedService(BY_DS), {
      datasetId: 'coll-1', rowCount: 4, scope: ['m-1', 'm-2'],
      where: [{ field: 'age', max: 25 }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual([1, 11])
  })

  it('no scope → single-dataset behavior unchanged', async () => {
    const r = await resolveWhereRowIds(fakeScopedService(BY_DS), {
      datasetId: 'm-1', rowCount: 2,
      where: [{ field: 'race', values: ['Black'] }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual([1])
  })
})

describe('sql/200 fast path + fallback', () => {
  it('an un-migrated DB (PGRST202) falls back to the JS scan path with identical results', async () => {
    const viaSql = await resolveWhereRowIds(fakeService(ROWS), {
      datasetId: 'd1', rowCount: ROWS.length,
      where: [{ field: 'race', values: ['Black'] }, { field: 'age', min: 25 }],
    })
    const viaJs = await resolveWhereRowIds(fakeService(ROWS, { noSegmentFn: true }), {
      datasetId: 'd1', rowCount: ROWS.length,
      where: [{ field: 'race', values: ['Black'] }, { field: 'age', min: 25 }],
    })
    expect(viaSql).not.toHaveProperty('error')
    expect(viaJs).not.toHaveProperty('error')
    if ('error' in viaSql || 'error' in viaJs) return
    expect(viaSql.ids).toEqual(viaJs.ids)
    expect(viaSql.sampled).toBe(false)
  })

  it('the SQL path pages by keyset (small page size still finds everything)', async () => {
    // 6 rows with a 20K page is one page; force multi-page via a tiny store walk
    const many: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, data: { g: i % 2 === 0 ? 'even' : 'odd', v: i } }))
    const r = await resolveWhereRowIds(fakeService(many), {
      datasetId: 'd1', rowCount: many.length,
      where: [{ field: 'g', values: ['even'] }, { field: 'v', min: 10 }],
    })
    expect(r).not.toHaveProperty('error')
    if ('error' in r) return
    expect(r.ids).toEqual(many.filter(x => x.data.g === 'even' && Number(x.data.v) >= 10).map(x => x.id))
  })
})
