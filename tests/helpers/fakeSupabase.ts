// tests/helpers/fakeSupabase.ts — an in-memory stand-in for the supabase-js
// service-role client that HONORS the query chain instead of resolving canned
// rows: eq/neq/in/gte/gt/lte/lt/is filters (dotted paths for embedded joins),
// order, range, limit, single/maybeSingle, `{ count: 'exact', head: true }`,
// and insert/update/upsert/delete that mutate the table and are recorded.
//
// Why: the permissive Proxy fake in chatCoreTurn.test.ts is right for a module
// whose queries are incidental. For loaders and routes whose query SHAPES are
// the behavior (which rows a `.eq('org_id')` excludes, what a head-count
// returns, how a collection fans out), a fake that ignores filters proves
// nothing. This one lets a test seed tables and assert on outcomes.
//
// Not a vitest test file (lives outside tests/unit + tests/integration).

export type Row = Record<string, unknown>
export interface Filter { op: string; col: string; val: unknown }
export interface Write { table: string; op: 'insert' | 'update' | 'upsert' | 'delete'; payload: unknown; filters: Filter[] }
export interface RpcCall { name: string; params: Record<string, unknown> }
export interface FakeError { message: string; code?: string; details?: string; hint?: string }

export interface FakeServiceOptions {
  tables?: Record<string, Row[]>
  /** Override the number a `{ count: 'exact', head: true }` select returns for a
   *  table (a fixed number, or a function of the applied filters) — lets a test
   *  claim "this dataset has 60,000 rows" without seeding 60,000 rows. */
  counts?: Record<string, number | ((filters: Filter[]) => number)>
  /** Force `{ data: null, error }` for every query against a table. */
  errors?: Record<string, FakeError>
  /** Handler for `.rpc(name, params)`; default resolves `{ data: [], error: null }`. */
  rpc?: (name: string, params: Record<string, unknown>) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>
  /** Column defaults applied to every inserted/upserted row of a table — the
   *  stand-in for DB-generated columns (`token`, `id`, `created_at`) that a
   *  route reads back through `.insert().select().single()`. */
  defaults?: Record<string, (row: Row, index: number) => Row>
}

function getPath(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Row)[k] : undefined), row)
}
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}
function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a), nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}
function matches(row: Row, f: Filter): boolean {
  const v = getPath(row, f.col)
  switch (f.op) {
    case 'eq': return same(v, f.val)
    case 'neq': return !same(v, f.val)
    case 'in': return Array.isArray(f.val) && f.val.some(x => same(v, x))
    case 'gte': return v != null && cmp(v, f.val) >= 0
    case 'gt': return v != null && cmp(v, f.val) > 0
    case 'lte': return v != null && cmp(v, f.val) <= 0
    case 'lt': return v != null && cmp(v, f.val) < 0
    case 'is': return f.val === null ? v == null : same(v, f.val)
    case 'like': case 'ilike': {
      const re = new RegExp('^' + String(f.val).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', f.op === 'ilike' ? 'i' : '')
      return typeof v === 'string' && re.test(v)
    }
    default: return true
  }
}

type Mode = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

export class FakeQuery implements PromiseLike<{ data: unknown; error: FakeError | null; count: number | null }> {
  private mode: Mode = 'select'
  private filters: Filter[] = []
  private orderBy: { col: string; asc: boolean }[] = []
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private limitN: number | null = null
  private head = false
  private wantCount = false
  private singleMode: 'single' | 'maybeSingle' | null = null
  private payload: unknown = undefined
  private onConflict: string | null = null
  private returning = false

  constructor(private readonly db: FakeService, private readonly table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode !== 'select') this.returning = true
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.head = true
    return this
  }
  insert(p: unknown) { this.mode = 'insert'; this.payload = p; return this }
  update(p: unknown) { this.mode = 'update'; this.payload = p; return this }
  upsert(p: unknown, opts?: { onConflict?: string }) { this.mode = 'upsert'; this.payload = p; this.onConflict = opts?.onConflict || null; return this }
  delete() { this.mode = 'delete'; return this }

  eq(col: string, val: unknown) { this.filters.push({ op: 'eq', col, val }); return this }
  neq(col: string, val: unknown) { this.filters.push({ op: 'neq', col, val }); return this }
  in(col: string, val: unknown[]) { this.filters.push({ op: 'in', col, val }); return this }
  gte(col: string, val: unknown) { this.filters.push({ op: 'gte', col, val }); return this }
  gt(col: string, val: unknown) { this.filters.push({ op: 'gt', col, val }); return this }
  lte(col: string, val: unknown) { this.filters.push({ op: 'lte', col, val }); return this }
  lt(col: string, val: unknown) { this.filters.push({ op: 'lt', col, val }); return this }
  is(col: string, val: unknown) { this.filters.push({ op: 'is', col, val }); return this }
  like(col: string, val: unknown) { this.filters.push({ op: 'like', col, val }); return this }
  ilike(col: string, val: unknown) { this.filters.push({ op: 'ilike', col, val }); return this }
  not(col: string, op: string, val: unknown) { this.filters.push({ op: op === 'is' ? 'neq' : 'neq', col, val }); return this }
  or() { return this }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this }
  range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this }
  limit(n: number) { this.limitN = n; return this }
  single() { this.singleMode = 'single'; return this }
  maybeSingle() { this.singleMode = 'maybeSingle'; return this }

  private rows(): Row[] {
    let rows = (this.db.tables[this.table] || []).filter(r => this.filters.every(f => matches(r, f)))
    for (const o of [...this.orderBy].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(getPath(a, o.col), getPath(b, o.col)))
    if (this.rangeFrom != null) rows = rows.slice(this.rangeFrom, (this.rangeTo ?? rows.length - 1) + 1)
    if (this.limitN != null) rows = rows.slice(0, this.limitN)
    return rows
  }

  private execute(): { data: unknown; error: FakeError | null; count: number | null } {
    const forced = this.db.errors[this.table]
    if (forced) return { data: null, error: forced, count: null }
    const tables = this.db.tables
    if (this.mode === 'select') {
      const rows = this.rows()
      let count: number | null = null
      if (this.wantCount) {
        const ov = this.db.counts[this.table]
        count = typeof ov === 'function' ? ov(this.filters) : typeof ov === 'number' ? ov : rows.length
      }
      if (this.head) return { data: null, error: null, count }
      if (this.singleMode === 'single') {
        if (rows.length === 0) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count }
        return { data: rows[0], error: null, count }
      }
      if (this.singleMode === 'maybeSingle') return { data: rows[0] ?? null, error: null, count }
      return { data: rows.map(r => ({ ...r })), error: null, count }
    }
    this.db.writes.push({ table: this.table, op: this.mode as Write['op'], payload: this.payload, filters: [...this.filters] })
    tables[this.table] = tables[this.table] || []
    const raw = Array.isArray(this.payload) ? (this.payload as Row[]) : this.payload ? [this.payload as Row] : []
    const list = (this.mode === 'insert' || this.mode === 'upsert') ? raw.map(r => this.db.withDefaults(this.table, r)) : raw
    if (this.mode === 'insert') tables[this.table].push(...list.map(r => ({ ...r })))
    if (this.mode === 'upsert') {
      const keys = (this.onConflict || 'id').split(',').map(s => s.trim())
      for (const r of list) {
        const idx = tables[this.table].findIndex(x => keys.every(k => same(x[k], r[k])))
        if (idx >= 0) tables[this.table][idx] = { ...tables[this.table][idx], ...r }
        else tables[this.table].push({ ...r })
      }
    }
    if (this.mode === 'update') {
      for (const r of tables[this.table]) if (this.filters.every(f => matches(r, f))) Object.assign(r, this.payload as Row)
    }
    if (this.mode === 'delete') tables[this.table] = tables[this.table].filter(r => !this.filters.every(f => matches(r, f)))
    const data = this.returning ? (this.singleMode ? list[0] ?? null : list) : null
    return { data, error: null, count: null }
  }

  then<R1 = unknown, R2 = never>(
    onfulfilled?: ((v: { data: unknown; error: FakeError | null; count: number | null }) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }
}

export class FakeService {
  tables: Record<string, Row[]>
  counts: NonNullable<FakeServiceOptions['counts']>
  errors: NonNullable<FakeServiceOptions['errors']>
  defaults: NonNullable<FakeServiceOptions['defaults']>
  writes: Write[] = []
  private inserted = 0
  rpcCalls: RpcCall[] = []
  private rpcHandler: FakeServiceOptions['rpc']

  constructor(opts: FakeServiceOptions = {}) {
    // Deep-ish copy so a test's fixture constant is never mutated by writes.
    this.tables = Object.fromEntries(Object.entries(opts.tables || {}).map(([k, v]) => [k, v.map(r => ({ ...r }))]))
    this.counts = opts.counts || {}
    this.errors = opts.errors || {}
    this.defaults = opts.defaults || {}
    this.rpcHandler = opts.rpc
  }
  /** Apply the table's insert defaults (DB-generated columns) under the row's own values. */
  withDefaults(table: string, row: Row): Row {
    const d = this.defaults[table]
    return d ? { ...d(row, this.inserted++), ...row } : row
  }
  from(table: string) { return new FakeQuery(this, table) }
  async rpc(name: string, params: Record<string, unknown> = {}) {
    this.rpcCalls.push({ name, params })
    return this.rpcHandler ? this.rpcHandler(name, params) : { data: [], error: null }
  }
  /** Writes against one table, oldest first. */
  writesTo(table: string) { return this.writes.filter(w => w.table === table) }
}

export function makeFakeService(opts: FakeServiceOptions = {}) { return new FakeService(opts) }
