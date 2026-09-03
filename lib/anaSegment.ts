// lib/anaSegment.ts
// Ana-composed subgroup scoping (owner-hit 2026-09-04: "what issues do young
// black men identify" — Ana had no way to scope a query or a comment read to
// age ∧ race ∧ gender herself; she could only crosstab two fields or offer a
// set_view). The query tools now take a `where` array; this module resolves
// it to flat row ids server-side using the SAME canonical filter semantics as
// the app (lib/filterUtils.applyFilters), so Ana's subgroup and a user who
// sets the equivalent UI filters see identical row sets.
//
// Resolution strategy (wire-cost aware — never pull 50K full data blobs when
// a containment query can do the narrowing in the database):
//   - categorical conditions → paged id-only `.contains('data', {field: value})`
//     queries (union across a condition's values — trying both string and
//     numeric storage — intersect across conditions);
//   - numeric range conditions → fetch `data` only for the already-narrowed
//     ids (chunked) and filter in Node via applyFilters;
//   - range-only (no categorical narrowing) → walk id+data pages up to the
//     app's 50K analysis cap (sampled beyond it, and the result says so).
// Blank values are always EXCLUDED from a subgroup (a row with no age is not
// "young").

import { applyFilters, type Filters } from './filterUtils'

export interface WhereCondition {
  field: string
  /** Categorical include list — exact values as field_counts reports them. */
  values?: string[]
  /** Numeric range bounds (either or both). */
  min?: number
  max?: number
}

export interface WhereResolution {
  ids: number[]
  /** Rows examined for range-only scans (caps the honesty note). */
  sampled: boolean
  /** Human description for the tool result's scope note. */
  label: string
}

const RANGE_SENTINEL = 1e15
const SCAN_CAP = 50_000        // matches the app's client-side analysis cap
const NARROWED_RANGE_CAP = 60_000

export function describeWhere(where: WhereCondition[]): string {
  return where.map(w => {
    if (w.values?.length) return w.field + ' ∈ [' + w.values.join(', ') + ']'
    const lo = w.min != null ? w.min : null
    const hi = w.max != null ? w.max : null
    if (lo != null && hi != null) return lo + ' ≤ ' + w.field + ' ≤ ' + hi
    if (hi != null) return w.field + ' ≤ ' + hi
    return w.field + ' ≥ ' + lo
  }).join(' AND ')
}

/** The canonical Filters equivalent of a where array (unit-tested contract). */
export function whereToFilters(where: WhereCondition[]): Filters {
  const out: Filters = {}
  for (const w of where) {
    if (!w?.field) continue
    if (w.values?.length) {
      out[w.field] = { type: 'cat', mode: 'include', values: new Set(w.values.map(String)), excludeBlanks: true }
    } else if (w.min != null || w.max != null) {
      out[w.field] = {
        type: 'range',
        values: [w.min != null ? w.min : -RANGE_SENTINEL, w.max != null ? w.max : RANGE_SENTINEL],
        includeBlanks: false,
      }
    }
  }
  return out
}

export function validateWhere(where: unknown): WhereCondition[] | { error: string } {
  if (!Array.isArray(where) || where.length === 0) return { error: 'where must be a non-empty array of conditions' }
  if (where.length > 6) return { error: 'at most 6 where conditions' }
  const out: WhereCondition[] = []
  for (const raw of where) {
    const w = raw as WhereCondition
    if (!w || typeof w.field !== 'string' || !w.field.trim()) return { error: 'every where condition needs a field key' }
    const hasValues = Array.isArray(w.values) && w.values.length > 0
    const hasRange = typeof w.min === 'number' || typeof w.max === 'number'
    if (!hasValues && !hasRange) return { error: 'condition on "' + w.field + '" needs values[] or min/max' }
    out.push({
      field: w.field.trim(),
      values: hasValues ? w.values!.map(String).slice(0, 25) : undefined,
      min: typeof w.min === 'number' ? w.min : undefined,
      max: typeof w.max === 'number' ? w.max : undefined,
    })
  }
  return out
}

type Service = {
  from: (t: string) => {
    select: (s: string) => {
      eq: (c: string, v: unknown) => {
        contains: (c: string, v: unknown) => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => PromiseLike<{ data: { id: number }[] | null; error: { message: string } | null }> } }
        in: (c: string, v: number[]) => PromiseLike<{ data: { id: number; data: Record<string, unknown> }[] | null; error: { message: string } | null }>
        order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => PromiseLike<{ data: { id: number; data: Record<string, unknown> }[] | null; error: { message: string } | null }> }
      }
    }
  }
}

async function idsForCatValue(service: Service, datasetId: string, field: string, value: string): Promise<Set<number> | { error: string }> {
  const out = new Set<number>()
  // Values arrive as text (field_counts reports them that way) but may be
  // STORED as numbers — containment is type-exact, so try both shapes.
  const shapes: unknown[] = [value]
  const asNum = Number(value)
  if (value.trim() !== '' && !isNaN(asNum)) shapes.push(asNum)
  for (const shape of shapes) {
    for (let from = 0; from < 200_000; from += 1000) {
      const { data, error } = await service.from('dataset_rows_flat')
        .select('id')
        .eq('dataset_id', datasetId)
        .contains('data', { [field]: shape })
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) return { error: 'segment scan failed on "' + field + '": ' + error.message }
      for (const r of data || []) out.add(r.id)
      if (!data || data.length < 1000) break
    }
  }
  return out
}

export async function resolveWhereRowIds(
  service: unknown,
  opts: { datasetId: string; rowCount: number; where: WhereCondition[] },
): Promise<WhereResolution | { error: string }> {
  const svc = service as Service
  const catConds = opts.where.filter(w => w.values?.length)
  const rangeConds = opts.where.filter(w => !w.values?.length && (w.min != null || w.max != null))
  const label = describeWhere(opts.where)

  let ids: Set<number> | null = null

  for (const cond of catConds) {
    const condSet = new Set<number>()
    for (const v of cond.values!) {
      const r = await idsForCatValue(svc, opts.datasetId, cond.field, v)
      if ('error' in r) return r
      r.forEach(id => condSet.add(id))
    }
    if (condSet.size === 0) {
      return { error: 'No rows match ' + cond.field + ' ∈ [' + cond.values!.join(', ') + '] — check the exact values with a field_counts query first.' }
    }
    if (ids === null) {
      ids = condSet
    } else {
      const prev: number[] = [...ids]
      ids = new Set(prev.filter(id => condSet.has(id)))
    }
    if (ids.size === 0) return { error: 'No rows match all conditions (' + label + ').' }
  }

  if (rangeConds.length === 0) {
    return { ids: [...ids!].sort((a, b) => a - b), sampled: false, label }
  }

  const rangeFilters = whereToFilters(rangeConds)
  const matched: number[] = []
  let sampled = false

  if (ids !== null) {
    if (ids.size > NARROWED_RANGE_CAP) {
      return { error: 'The categorical part of this segment matches ' + ids.size.toLocaleString() + ' rows — too many to range-filter. Add a narrower categorical condition.' }
    }
    const all = [...ids]
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500)
      const { data, error } = await svc.from('dataset_rows_flat')
        .select('id, data')
        .eq('dataset_id', opts.datasetId)
        .in('id', chunk)
      if (error) return { error: 'segment range scan failed: ' + error.message }
      for (const r of data || []) {
        if (applyFilters([r.data], rangeFilters).length) matched.push(r.id)
      }
    }
  } else {
    // Range-only: walk the dataset up to the app's analysis cap.
    sampled = opts.rowCount > SCAN_CAP
    for (let from = 0; from < SCAN_CAP; from += 1000) {
      const { data, error } = await svc.from('dataset_rows_flat')
        .select('id, data')
        .eq('dataset_id', opts.datasetId)
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) return { error: 'segment range scan failed: ' + error.message }
      for (const r of (data || []) as { id: number; data: Record<string, unknown> }[]) {
        if (applyFilters([r.data], rangeFilters).length) matched.push(r.id)
      }
      if (!data || data.length < 1000) break
    }
  }

  if (matched.length === 0) return { error: 'No rows match all conditions (' + label + ').' }
  return { ids: matched.sort((a, b) => a - b), sampled, label }
}
