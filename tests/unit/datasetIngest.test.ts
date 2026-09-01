// lib/datasetIngest — the server-side upload worker (2026-09-02). Driven with
// a stateful fake service client + Storage; the REAL lib/csv parser,
// autoDetectSchema, and stampRowSubstantive run, so the test pins parity with
// what the legacy client-side flow produced: same parsed rows (RFC4180 quotes
// included), same column filtering, same schema labels from aliases, and
// contiguous row_index. Plus the contracts that make it safe: pause at the
// deadline + resume without duplicates (trusting max(row_index) over the
// checkpoint), and error marking on a broken file.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: vi.fn(async () => ({ totalRows: 3, fieldSummaries: {}, computedAt: 'now' })) }))
vi.mock('@/lib/datasetAnalytics', () => ({ mergeDatasetAnalytics: vi.fn(async () => {}) }))

import { runIngest, parseAndFilter, UPLOAD_BUCKET } from '@/lib/datasetIngest'
import { computeAnalyticsSQL } from '@/lib/analyticsCompute'
import type { SupabaseClient } from '@supabase/supabase-js'

const CSV = 'Name,Comment,Secret\nAda,"Loved the ""fast"" service",x1\nBo,"Fine, mostly",x2\nCy,Great,x3\n'

interface FakeDb {
  ingest: Record<string, unknown> | null
  schemaWrites: Record<string, unknown>[]
  flatRows: { dataset_id: string; row_index: number; data: Record<string, unknown> }[]
  datasetUpdates: Record<string, unknown>[]
  removed: string[]
  files: Record<string, string>
  failInsertOnce?: boolean
}

function makeService(db: FakeDb): SupabaseClient {
  const svc = {
    rpc: (fn: string, args: { p_patch?: { ingest?: Record<string, unknown> } }) => {
      if (fn !== 'merge_dataset_analytics') throw new Error('unexpected rpc ' + fn)
      db.ingest = { ...(db.ingest || {}), ...(args.p_patch?.ingest || {}) }
      return Promise.resolve({ data: null, error: null })
    },
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => {
          if (bucket !== UPLOAD_BUCKET) return Promise.resolve({ data: null, error: { message: 'wrong bucket' } })
          const f = db.files[path]
          return f == null
            ? Promise.resolve({ data: null, error: { message: 'Object not found' } })
            : Promise.resolve({ data: new Blob([f]), error: null })
        },
        remove: (paths: string[]) => { db.removed.push(...paths); return Promise.resolve({ data: null, error: null }) },
      }),
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['select', 'eq', 'order', 'limit']) b[m] = chain
      b.maybeSingle = async () => {
        if (table === 'dataset_state') return { data: { ing: db.ingest }, error: null }
        return { data: null, error: null }
      }
      b.single = async () => {
        if (table === 'dataset_state') return { data: { schema_config: (db.schemaWrites[db.schemaWrites.length - 1] as { schema_config?: unknown })?.schema_config || { fields: [{ field: 'Name' }] } }, error: null }
        return { data: null, error: null }
      }
      b.update = (payload: Record<string, unknown>) => {
        if (table === 'dataset_state') db.schemaWrites.push(payload)
        if (table === 'datasets') db.datasetUpdates.push(payload)
        return chain()
      }
      b.insert = (rows: FakeDb['flatRows']) => {
        if (db.failInsertOnce) { db.failInsertOnce = false; return Promise.resolve({ error: { message: 'boom' } }) }
        db.flatRows.push(...rows)
        return Promise.resolve({ error: null })
      }
      // The max(row_index) probe awaits the chain itself.
      ;(b as { then?: unknown }).then = (resolve: (v: unknown) => void) => {
        const rows = db.flatRows.filter(r => true).sort((a, z) => z.row_index - a.row_index)
        resolve({ data: rows.length ? [{ row_index: rows[0].row_index }] : [], error: null })
      }
      return b
    },
  }
  return svc as unknown as SupabaseClient
}

function seed(overrides: Partial<Record<string, unknown>> = {}): FakeDb {
  const db: FakeDb = {
    ingest: {
      status: 'running', rowsDone: 0, rowsTotal: 3,
      path: 'org1/file.csv', filename: 'file.csv', format: 'csv',
      includedCols: ['Name', 'Comment'], fieldAliases: { Comment: 'Guest comment' },
      startedAt: 'x', heartbeatAt: new Date().toISOString(),
      ...overrides,
    },
    schemaWrites: [], flatRows: [], datasetUpdates: [], removed: [],
    files: { 'org1/file.csv': CSV },
  }
  return db
}

beforeEach(() => { vi.clearAllMocks() })

describe('parseAndFilter', () => {
  it('parses RFC4180 CSV (interior quotes intact) and filters to the selected columns', () => {
    const rows = parseAndFilter(CSV, 'csv', ['Name', 'Comment'])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ Name: 'Ada', Comment: 'Loved the "fast" service' })
    expect(rows[1].Comment).toBe('Fine, mostly')
    expect(Object.keys(rows[0])).not.toContain('Secret')
  })

  it('parses a JSON array file', () => {
    const rows = parseAndFilter('[{"a":1,"b":2}]', 'json', ['a'])
    expect(rows).toEqual([{ a: 1 }])
  })
})

describe('runIngest', () => {
  it('happy path: schema with aliases, contiguous stamped rows, row_count, done, file removed', async () => {
    const db = seed()
    const status = await runIngest(makeService(db), 'd1', 'u1')
    expect(status).toBe('done')
    // Rows: filtered columns only, contiguous row_index, stamped.
    expect(db.flatRows).toHaveLength(3)
    expect(db.flatRows.map(r => r.row_index)).toEqual([0, 1, 2])
    expect(db.flatRows[0].data).toMatchObject({ Name: 'Ada', Comment: 'Loved the "fast" service' })
    expect(db.flatRows[0].data.Secret).toBeUndefined()
    // Schema written once with the alias applied.
    const schema = db.schemaWrites[0].schema_config as { fields: { field: string; label?: string }[] }
    expect(schema.fields.find(f => f.field === 'Comment')?.label).toBe('Guest comment')
    // Exact row_count finalized; compute ran; state done; file cleaned up.
    expect(db.datasetUpdates.some(u => u.row_count === 3)).toBe(true)
    expect(vi.mocked(computeAnalyticsSQL)).toHaveBeenCalledTimes(1)
    expect(db.ingest?.status).toBe('done')
    expect(db.removed).toEqual(['org1/file.csv'])
  })

  it('pauses at the deadline and resumes without duplicating rows', async () => {
    const db = seed()
    // Deadline already expired → first loop iteration pauses before inserting.
    expect(await runIngest(makeService(db), 'd1', 'u1', -1)).toBe('paused')
    expect(db.ingest?.status).toBe('paused')
    expect(db.flatRows).toHaveLength(0)
    // Continue with a normal budget → completes; indexes stay contiguous.
    expect(await runIngest(makeService(db), 'd1', 'u1')).toBe('done')
    expect(db.flatRows.map(r => r.row_index)).toEqual([0, 1, 2])
  })

  it('a resume trusts max(row_index) over a stale checkpoint — no duplicate rows', async () => {
    const db = seed({ rowsDone: 0 }) // checkpoint says nothing written…
    // …but a previous worker actually inserted the first row before dying.
    db.flatRows.push({ dataset_id: 'd1', row_index: 0, data: { Name: 'Ada', Comment: 'Loved the "fast" service' } })
    expect(await runIngest(makeService(db), 'd1', 'u1')).toBe('done')
    expect(db.flatRows).toHaveLength(3)
    expect(new Set(db.flatRows.map(r => r.row_index)).size).toBe(3)
    // Schema must NOT have been re-written (not a first run).
    expect(db.schemaWrites.filter(w => 'schema_config' in w)).toHaveLength(0)
  })

  it('marks error when the file is missing and keeps it for retry', async () => {
    const db = seed({ path: 'org1/gone.csv' })
    expect(await runIngest(makeService(db), 'd1', 'u1')).toBe('error')
    expect(db.ingest?.status).toBe('error')
    expect(String(db.ingest?.error)).toContain('could not read')
    expect(db.removed).toHaveLength(0)
  })

  it('marks error when an insert fails for real (post-retry)', async () => {
    const db = seed()
    db.failInsertOnce = true
    expect(await runIngest(makeService(db), 'd1', 'u1')).toBe('error')
    expect(db.ingest?.status).toBe('error')
    expect(String(db.ingest?.error)).toContain('row insert failed')
  })
})
