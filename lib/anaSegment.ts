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
import { AGG_SAMPLE_CAP, sampledCountFieldValues } from './sampledAggregate'

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
  /** Fuzzy value resolutions (requested → stored), for the provenance trail —
   *  only values that did NOT match byte-for-byte are listed. */
  mappings: { requested: string; matched: string[] }[]
}

const RANGE_SENTINEL = 1e15
const SCAN_CAP = 50_000        // matches the app's client-side analysis cap
const NARROWED_RANGE_CAP = 150_000  // raised 2026-09-04: the chunked narrow below runs in parallel waves now, and a 64K-row party slice on ANES must range-filter, not refuse

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

// ── Fuzzy value resolution (owner ask 2026-09-04: "African American" should
// find the "Black" respondents). Two layers, split by what each can know:
//   1. LEXICAL (here, deterministic): case/whitespace-insensitive equality,
//      then normalized substring either way — "black" finds "Black or
//      African American", "African American" finds "Black/African American".
//   2. SEMANTIC (Ana's job): zero-overlap synonyms can't be bridged safely in
//      code, so an unmatched value returns the field's ACTUAL stored values
//      and Ana re-issues the call with the right ones in the same turn.

function normalizeValue(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Stored values that lexically match a requested value. */
export function matchStoredValues(requested: string, stored: string[]): string[] {
  const reqRaw = requested.trim()
  const exact = stored.filter(v => v === reqRaw)
  if (exact.length) return exact
  const ci = stored.filter(v => v.trim().toLowerCase() === reqRaw.toLowerCase())
  if (ci.length) return ci
  const reqNorm = normalizeValue(reqRaw)
  if (!reqNorm) return []
  return stored.filter(v => {
    const sv = normalizeValue(v)
    return sv.includes(reqNorm) || reqNorm.includes(sv)
  })
}

type Service = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
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

async function idsForCatValue(service: Service, scope: string[], field: string, value: string): Promise<Set<number> | { error: string }> {
  const out = new Set<number>()
  // Values arrive as text (field_counts reports them that way) but may be
  // STORED as numbers — containment is type-exact, so try both shapes.
  const shapes: unknown[] = [value]
  const asNum = Number(value)
  if (value.trim() !== '' && !isNaN(asNum)) shapes.push(asNum)
  // Pages are fired in concurrent WAVES (8 x 1000 rows), not one-by-one — a
  // 64K-row value used to cost 64 sequential round-trips (owner-hit
  // 2026-09-04: "Republicans" on ANES took minutes and then timed out).
  const WAVE = 8
  const page = (dsId: string, shape: unknown, from: number) => service.from('dataset_rows_flat')
    .select('id')
    .eq('dataset_id', dsId)
    .contains('data', { [field]: shape })
    .order('id', { ascending: true })
    .range(from, from + 999)
  for (const dsId of scope) {
    for (const shape of shapes) {
      let from = 0
      for (; from < 200_000;) {
        const wave = []
        for (let w = 0; w < WAVE && from < 200_000; w++, from += 1000) wave.push(page(dsId, shape, from))
        const results = await Promise.all(wave)
        let short = false
        for (const { data, error } of results) {
          if (error) return { error: 'segment scan failed on "' + field + '": ' + error.message }
          for (const r of data || []) out.add(r.id)
          if (!data || data.length < 1000) short = true
        }
        if (short) break
      }
    }
  }
  return out
}

// One-pass SQL matching (sql/200): page segment_match_ids over each scope
// member — the whole condition set evaluates INSIDE Postgres, so a 126K-row
// dataset resolves in a handful of ~0.5s pages instead of client-side id
// enumeration. Returns null when the function isn't deployed yet (PGRST202 —
// the caller falls back to the JS scan path; deploy-order safe).
async function sqlSegmentIds(
  svc: Service, scope: string[], conds: WhereCondition[],
): Promise<number[] | { error: string } | null> {
  const conj = conds.map(c => c.values?.length
    ? { field: c.field, values: c.values.map(String) }
    : { field: c.field, ...(c.min != null ? { min: c.min } : {}), ...(c.max != null ? { max: c.max } : {}) })
  const out: number[] = []
  const PAGE = 20000
  const MAX_PAGES = 100 // 2M-row backstop
  for (const dsId of scope) {
    let after = -1
    for (let g = 0; g < MAX_PAGES; g++) {
      const { data, error } = await svc.rpc('segment_match_ids', {
        p_dataset_id: dsId, p_conds: conj, p_after_row_index: after, p_limit: PAGE,
      })
      if (error) {
        if (error.code === 'PGRST202' || /function .*segment_match_ids/i.test(error.message)) return null
        return { error: 'segment match failed: ' + error.message }
      }
      const body = data as { n_scanned?: number; last_row_index?: number | null; ids?: number[] } | null
      for (const id of body?.ids || []) out.push(Number(id))
      const scanned = Number(body?.n_scanned || 0)
      if (scanned < PAGE || body?.last_row_index == null) break
      after = Number(body.last_row_index)
    }
  }
  return out.sort((a, b) => a - b)
}

export async function resolveWhereRowIds(
  service: unknown,
  opts: { datasetId: string; rowCount: number; where: WhereCondition[]; scope?: string[] },
): Promise<WhereResolution | { error: string }> {
  const svc = service as Service
  // A collection holds no rows under its own id — the caller passes the
  // member dataset ids as `scope` and every row-level query below walks them
  // (flat row ids are globally unique, so the merged id sets stay valid).
  const scope = opts.scope?.length ? opts.scope : [opts.datasetId]
  const catConds = opts.where.filter(w => w.values?.length)
  const rangeConds = opts.where.filter(w => !w.values?.length && (w.min != null || w.max != null))
  const mappings: { requested: string; matched: string[] }[] = []

  let ids: Set<number> | null = null

  for (const cond of catConds) {
    // Resolve requested values against the field's ACTUAL stored values —
    // case/whitespace-insensitive, partial labels match compound values. A
    // value with no lexical match fails WITH the stored values listed, so Ana
    // can bridge synonyms (African American ≈ Black) and retry immediately.
    const storedCounts = new Map<string, number>()
    for (const dsId of scope) {
      // Value DISCOVERY only needs the value list — above the cap the exact
      // RPC is an O(N) jsonb scan that statement-times-out at ANES scale
      // (measured 2026-09-04: 8.1s > timeout on 126K rows); the 50K sampled
      // twin answers in ~1s and a value too rare for a 50K sample to see is
      // also too rare to matter for lexical matching (the no-match error
      // still lists the values Ana can bridge from).
      let rows: { value: string; count: number }[] | null = null
      if (opts.rowCount > AGG_SAMPLE_CAP && scope.length === 1) {
        try {
          const s = await sampledCountFieldValues(svc as never, dsId, cond.field, 500, opts.rowCount, null)
          rows = s.rows
        } catch { /* fall through to exact */ }
      }
      if (!rows) {
        const { data: fc, error: fcErr } = await svc.rpc('count_field_values', {
          p_dataset_id: dsId, p_field_key: cond.field, p_limit: 500,
        })
        if (fcErr) return { error: 'could not read values of "' + cond.field + '": ' + fcErr.message }
        rows = (fc || []) as unknown as { value: string; count: number }[]
      }
      for (const r of rows) {
        const v = String(r.value)
        storedCounts.set(v, (storedCounts.get(v) || 0) + Number(r.count))
      }
    }
    const stored = [...storedCounts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
    const resolvedValues = new Set<string>()
    for (const v of cond.values!) {
      const hits = matchStoredValues(String(v), stored)
      if (hits.length === 0) {
        return {
          error: 'No stored value of "' + cond.field + '" matches "' + v + '". Actual values: '
            + stored.slice(0, 30).join(' | ') + (stored.length > 30 ? ' | …' : '')
            + '. Pick the semantically matching value(s) and call again.',
        }
      }
      hits.forEach(h => resolvedValues.add(h))
      if (hits.length !== 1 || hits[0] !== String(v)) {
        mappings.push({ requested: String(v), matched: hits })
      }
    }
    cond.values = [...resolvedValues]   // the label reports what actually ran
  }

  // FAST PATH (sql/200): the whole resolved condition set — categorical AND
  // range — evaluates inside Postgres in keyset pages. Falls through to the
  // JS scan path only when the function isn't deployed (PGRST202).
  const sqlIds = await sqlSegmentIds(svc, scope, opts.where)
  if (sqlIds && !Array.isArray(sqlIds)) return sqlIds // real error
  if (Array.isArray(sqlIds)) {
    const label0 = describeWhere(opts.where)
    if (sqlIds.length === 0) return { error: 'No rows match all conditions (' + label0 + ').' }
    return { ids: sqlIds, sampled: false, label: label0, mappings }
  }

  for (const cond of catConds) {
    const condSet = new Set<number>()
    for (const v of cond.values!) {
      const r = await idsForCatValue(svc, scope, cond.field, v)
      if ('error' in r) return r
      r.forEach(id => condSet.add(id))
    }
    if (condSet.size === 0) {
      return { error: 'No rows match ' + cond.field + ' ∈ [' + cond.values!.join(', ') + '].' }
    }
    if (ids === null) {
      ids = condSet
    } else {
      const prev: number[] = [...ids]
      ids = new Set(prev.filter(id => condSet.has(id)))
    }
    if (ids.size === 0) return { error: 'No rows match all conditions (' + describeWhere(opts.where) + ').' }
  }

  // Built AFTER categorical resolution — cond.values were rewritten to the
  // stored values that actually ran, so the label reports the real subgroup.
  const label = describeWhere(opts.where)

  if (rangeConds.length === 0) {
    return { ids: [...ids!].sort((a, b) => a - b), sampled: false, label, mappings }
  }

  const rangeFilters = whereToFilters(rangeConds)
  const matched: number[] = []
  let sampled = false

  // Range checks only need the range FIELDS — pulling the whole data blob for
  // a 64K-id narrow moved megabytes of unrelated survey columns per page
  // (measured 2026-09-04 on ANES: the blob pull dominated a 45s resolution).
  // Quoted arrow-select handles field names with spaces; aliases f0..fn keep
  // response keys unambiguous.
  const rangeFieldsSel = 'id, ' + rangeConds.map((c, i) => '"f' + i + '":data->"' + c.field.replace(/"/g, '') + '"').join(', ')
  const rowFromPartial = (r: Record<string, unknown>): Record<string, unknown> => {
    const o: Record<string, unknown> = {}
    rangeConds.forEach((c, i) => { o[c.field] = r['f' + i] })
    return o
  }

  if (ids !== null) {
    if (ids.size > NARROWED_RANGE_CAP) {
      return { error: 'The categorical part of this segment matches ' + ids.size.toLocaleString() + ' rows — too many to range-filter. Add a narrower categorical condition.' }
    }
    const all = [...ids]
    // Concurrent waves of 8 chunks x 500 ids — sequential chunks made a 60K
    // narrow take ~2 minutes on its own.
    const chunkJobs: (() => PromiseLike<{ data: { id: number; data: Record<string, unknown> }[] | null; error: { message: string } | null }>)[] = []
    for (let i = 0; i < all.length; i += 500) {
      const chunk = all.slice(i, i + 500)
      for (const dsId of scope) {
        chunkJobs.push(() => svc.from('dataset_rows_flat').select(rangeFieldsSel).eq('dataset_id', dsId).in('id', chunk) as never)
      }
    }
    for (let j = 0; j < chunkJobs.length; j += 8) {
      const results = await Promise.all(chunkJobs.slice(j, j + 8).map(fn => fn()))
      for (const { data, error } of results) {
        if (error) return { error: 'segment range scan failed: ' + error.message }
        for (const r of (data || []) as unknown as Record<string, unknown>[]) {
          if (applyFilters([rowFromPartial(r)], rangeFilters).length) matched.push(Number(r.id))
        }
      }
    }
  } else {
    // Range-only: walk the scope up to the app's analysis cap (the cap is a
    // shared budget across members, so a many-member collection still stops
    // at SCAN_CAP rows scanned in total).
    sampled = opts.rowCount > SCAN_CAP
    let scanned = 0
    for (const dsId of scope) {
      if (scanned >= SCAN_CAP) break
      for (let from = 0; scanned < SCAN_CAP; from += 1000) {
        const { data, error } = await (svc.from('dataset_rows_flat')
          .select(rangeFieldsSel)
          .eq('dataset_id', dsId)
          .order('id', { ascending: true })
          .range(from, from + 999) as never as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>)
        if (error) return { error: 'segment range scan failed: ' + error.message }
        for (const r of data || []) {
          if (applyFilters([rowFromPartial(r)], rangeFilters).length) matched.push(Number(r.id))
        }
        if (!data || data.length < 1000) { scanned += (data || []).length; break }
        scanned += data.length
      }
    }
  }

  if (matched.length === 0) return { error: 'No rows match all conditions (' + label + ').' }
  return { ids: matched.sort((a, b) => a - b), sampled, label, mappings }
}
