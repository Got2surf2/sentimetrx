// Tests for snapshot v2 (lib/orgSnapshotV2 + lib/orgRestore streaming core +
// lib/backupS3 grouping). The load-bearing semantics: a table of any size
// round-trips through gzipped NDJSON parts with NO caps, the manifest is the
// commit marker (manifest-less days are hidden from listings), and the
// streaming restore preserves v1 behavior — identity tables delete each
// parent exactly once before its first insert, replace mode deletes live
// rows absent from the snapshot.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LocalDirSnapshotStore } from '@/lib/snapshotStore'
import { dumpOrgSnapshotV2, openSnapshot, materializeSnapshot, snapshotSourceFromV1 } from '@/lib/orgSnapshotV2'
import { restoreOrgSnapshotFromSource } from '@/lib/orgRestore'
import { groupSnapshotObjects } from '@/lib/backupS3'
import type { OrgSnapshot } from '@/lib/orgSnapshot'

const ORG = '11111111-1111-1111-1111-111111111111'

// --- fake SOURCE db: serves .range() pages over in-memory tables ------------

function sourceDb(tables: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const db = {
    from(table: string) {
      const rows = tables[table] || []
      const state = { filters: [] as ((r: Record<string, unknown>) => boolean)[], range: null as [number, number] | null, single: false }
      const exec = () => {
        let out = rows.filter(r => state.filters.every(f => f(r)))
        if (state.range) out = out.slice(state.range[0], state.range[1] + 1)
        return state.single
          ? Promise.resolve({ data: out[0] ?? null, error: out[0] ? null : { message: 'not found' } })
          : Promise.resolve({ data: out, error: null })
      }
      const chain = {
        select(_c: string) { return chain },
        eq(col: string, v: unknown) { state.filters.push(r => r[col] === v); return chain },
        in(col: string, vs: unknown[]) { state.filters.push(r => vs.includes(r[col])); return chain },
        order(_c: string, _o?: unknown) { return chain },
        range(from: number, to: number) { state.range = [from, to]; return chain },
        single() { state.single = true; return exec() },
        then<T>(resolve: (r: { data: unknown; error: unknown }) => T, reject?: (e: unknown) => T) { return exec().then(resolve, reject) },
      }
      return chain
    },
  }
  return db as unknown as SupabaseClient
}

// --- fixture: an org with a >2-page table and a parent_via/pageOrder table ---

// row 42 carries U+2028/U+2029 — real review text contains them, and they
// must not split an NDJSON line (readline would; our reader must not)
const BIG = Array.from({ length: 2500 }, (_, i) => ({
  id: 'conv-' + String(i).padStart(5, '0'), org_id: ORG,
  text: i === 42 ? 'line one\u2028line two\u2029end' : 'row ' + i,
}))
const DATASETS = [{ id: 'ds-1', org_id: ORG, name: 'D1' }, { id: 'ds-2', org_id: ORG, name: 'D2' }]
const FLAT = [
  ...Array.from({ length: 1200 }, (_, i) => ({ id: 9000 + i, dataset_id: 'ds-1', row_index: i, data: { v: i } })),
  ...Array.from({ length: 30 }, (_, i) => ({ id: 20000 + i, dataset_id: 'ds-2', row_index: i, data: { v: 'b' + i } })),
]

const FIXTURE: Record<string, Record<string, unknown>[]> = {
  organizations: [{ id: ORG, name: 'Test Org' }],
  users: [{ id: 'u-1', org_id: ORG, email: 'a@b.c' }],
  conversations: BIG,
  datasets: DATASETS,
  dataset_rows_flat: FLAT,
}

let dir: string
let store: LocalDirSnapshotStore

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'snapv2-'))
  store = new LocalDirSnapshotStore(dir)
})
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe('dumpOrgSnapshotV2 → openSnapshot round trip', () => {
  it('streams uncapped NDJSON parts and a manifest commit marker', async () => {
    const { manifestKey, meta } = await dumpOrgSnapshotV2(sourceDb(FIXTURE), ORG, store)

    expect(manifestKey.endsWith('v2/manifest.json')).toBe(true)
    expect(meta.snapshot_version).toBe(2)
    expect(meta.org_name).toBe('Test Org')
    expect(meta.table_row_counts.conversations).toBe(2500)  // > PostgREST page, > old habit of caps
    expect(meta.table_row_counts.dataset_rows_flat).toBe(1230)
    expect(meta.fetch_errors).toEqual({})
    expect(meta.tables.find(t => t.name === 'conversations')?.key).toContain('tables/conversations.ndjson.gz')

    const source = await openSnapshot(store, manifestKey)
    expect(source.version).toBe(2)
    expect(source.orgId).toBe(ORG)
    expect(source.rowCount('conversations')).toBe(2500)

    let n = 0
    let first: Record<string, unknown> | null = null
    for await (const batch of source.readTable('conversations')) {
      expect(batch.length).toBeLessThanOrEqual(500)
      if (!first) first = batch[0]
      n += batch.length
    }
    expect(n).toBe(2500)
    expect(first).toEqual({ id: 'conv-00000', org_id: ORG, text: 'row 0' })

    // the U+2028/U+2029 row round-trips intact
    const all: Record<string, unknown>[] = []
    for await (const b of source.readTable('conversations')) all.push(...b)
    expect(all[42].text).toBe('line one\u2028line two\u2029end')

    // materialize rebuilds the v1 in-memory shape (clone workflow)
    const snap = await materializeSnapshot(source)
    expect(snap.meta.snapshot_version).toBe(1)
    expect(snap.tables.dataset_rows_flat.length).toBe(1230)
    expect((snap.tables.dataset_rows_flat[0] as { dataset_id: string }).dataset_id).toBe('ds-1')
  })

  it('empty tables are omitted from tableNames but keys still exist in meta', async () => {
    const { manifestKey, meta } = await dumpOrgSnapshotV2(sourceDb(FIXTURE), ORG, store, { prefix: 'org-snapshots/' + ORG + '/alt/v2/' })
    const source = await openSnapshot(store, manifestKey)
    expect(source.tableNames).not.toContain('campaigns')       // no rows in fixture
    expect(meta.table_row_counts.campaigns).toBe(0)
  })
})

describe('snapshotSourceFromV1', () => {
  it('serves the in-memory shape in ≤500-row batches', async () => {
    const snap: OrgSnapshot = {
      meta: { snapshot_version: 1, org_id: ORG, org_name: 'X', taken_at: 't', table_row_counts: {}, truncated_tables: [], fetch_errors: {} },
      tables: { conversations: BIG.slice(0, 1100) },
    }
    const source = snapshotSourceFromV1(snap)
    const sizes: number[] = []
    for await (const b of source.readTable('conversations')) sizes.push(b.length)
    expect(sizes).toEqual([500, 500, 100])
  })
})

// --- fake TARGET db: stateful store, records upserts / inserts / deletes ----
// Stores landed rows so the restore's post-write verification pass (which
// re-queries the target for the rows it claims to have landed) sees them.

function targetDb(opts: { liveIds?: Record<string, string[]> } = {}) {
  const ops: { table: string; op: string; payload: unknown }[] = []
  const store = new Map<string, Record<string, unknown>[]>()
  const tbl = (t: string) => { if (!store.has(t)) store.set(t, []); return store.get(t)! }
  let idSeq = 1
  const db = {
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[], _o: unknown) {
          ops.push({ table, op: 'upsert', payload: rows })
          return {
            select: (_c: string) => {
              const arr = tbl(table)
              for (const r of rows) {
                const i = arr.findIndex(x => x.id === r.id)
                if (i >= 0) arr[i] = { ...r }; else arr.push({ ...r })
              }
              return Promise.resolve({ data: rows.map(r => ({ id: r.id })), error: null })
            },
          }
        },
        insert(rows: Record<string, unknown>[]) {
          ops.push({ table, op: 'insert', payload: rows })
          return {
            select: (c: string) => {
              const arr = tbl(table)
              const landed: Record<string, unknown>[] = rows.map(r => ('id' in r ? { ...r } : { ...r, id: 'gen-' + idSeq++ }))
              arr.push(...landed)
              return Promise.resolve({ data: landed.map(r => ({ [c]: r[c] })), error: null })
            },
          }
        },
        delete() {
          return {
            in(col: string, vals: unknown[]) {
              ops.push({ table, op: 'delete', payload: { col, vals } })
              store.set(table, tbl(table).filter(r => !vals.includes(r[col])))
              return Promise.resolve({ error: null })
            },
          }
        },
        select(col: string, o?: { count?: string; head?: boolean }) {
          return {
            in(c: string, vals: unknown[]) {
              const rows = tbl(table).filter(r => vals.includes(r[c]))
              if (o?.head) return Promise.resolve({ count: rows.length, error: null })
              return Promise.resolve({ data: rows.map(r => ({ id: r.id, [col]: r[col] })), error: null })
            },
            eq(_col: string, _v: unknown) {
              const ids = opts.liveIds?.[table] || []
              return Promise.resolve({ data: ids.map(id => ({ id, org_id: ORG })), error: null })
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, ops, store }
}

describe('restoreOrgSnapshotFromSource', () => {
  it('identity tables: each parent deleted exactly once, ids stripped on insert', async () => {
    const { manifestKey } = await dumpOrgSnapshotV2(sourceDb(FIXTURE), ORG, store, { prefix: 'org-snapshots/' + ORG + '/r1/v2/' })
    const source = await openSnapshot(store, manifestKey)
    const { db, ops } = targetDb()

    const { totals } = await restoreOrgSnapshotFromSource(db, source, { tables: ['dataset_rows_flat'] })
    expect(totals.errors).toBe(0)
    expect(totals.upserted).toBe(1230)

    const deletes = ops.filter(o => o.table === 'dataset_rows_flat' && o.op === 'delete')
    const deletedParents = deletes.flatMap(d => (d.payload as { vals: unknown[] }).vals)
    expect(deletedParents.sort()).toEqual(['ds-1', 'ds-2'])    // once per parent, despite 3 batches
    const inserts = ops.filter(o => o.table === 'dataset_rows_flat' && o.op === 'insert')
    const insertedRows = inserts.flatMap(i => i.payload as Record<string, unknown>[])
    expect(insertedRows.length).toBe(1230)
    expect(insertedRows.every(r => !('id' in r))).toBe(true)
    // parent ds-1's delete happens before its first insert
    const firstDeleteIdx = ops.findIndex(o => o.op === 'delete')
    const firstInsertIdx = ops.findIndex(o => o.op === 'insert')
    expect(firstDeleteIdx).toBeLessThan(firstInsertIdx)
  })

  it('replace mode deletes live rows whose ids are not in the snapshot', async () => {
    const { manifestKey } = await dumpOrgSnapshotV2(sourceDb(FIXTURE), ORG, store, { prefix: 'org-snapshots/' + ORG + '/r2/v2/' })
    const source = await openSnapshot(store, manifestKey)
    const { db, ops } = targetDb({ liveIds: { conversations: ['conv-00001', 'zombie-1', 'zombie-2'] } })

    const { totals } = await restoreOrgSnapshotFromSource(db, source, { mode: 'replace', tables: ['conversations'] })
    expect(totals.upserted).toBe(2500)
    const del = ops.find(o => o.table === 'conversations' && o.op === 'delete')
    expect((del?.payload as { vals: unknown[] }).vals).toEqual(['zombie-1', 'zombie-2'])
    expect(totals.deleted).toBe(2)
  })

  it('composite-PK batches are reported, not inserted', async () => {
    const snap: OrgSnapshot = {
      meta: { snapshot_version: 1, org_id: ORG, org_name: null, taken_at: 't', table_row_counts: {}, truncated_tables: [], fetch_errors: {} },
      tables: { weird_join_table: [{ a: 1, b: 2 }] },
    }
    const { db, ops } = targetDb()
    const { reports } = await restoreOrgSnapshotFromSource(db, snapshotSourceFromV1(snap), {})
    expect(reports[0].errors).toBe(1)
    expect(reports[0].first_error).toContain('missing id')
    expect(ops.filter(o => o.op !== 'delete').length).toBe(0)
  })
})

describe('groupSnapshotObjects', () => {
  it('collapses v2 days to their manifest with aggregate size; hides manifest-less days; keeps v1', () => {
    const base = 'org-snapshots/' + ORG + '/2026/07/'
    const items = groupSnapshotObjects([
      { key: base + '01/snapshot.json.gz', last_modified: '2026-07-01T04:00:00Z', size_bytes: 1000 },
      { key: base + '02/v2/tables/users.ndjson.gz', last_modified: '2026-07-02T04:00:00Z', size_bytes: 300 },
      { key: base + '02/v2/tables/conversations.ndjson.gz', last_modified: '2026-07-02T04:00:01Z', size_bytes: 700 },
      { key: base + '02/v2/manifest.json', last_modified: '2026-07-02T04:00:02Z', size_bytes: 50 },
      { key: base + '03/v2/tables/users.ndjson.gz', last_modified: '2026-07-03T04:00:00Z', size_bytes: 400 }, // died mid-dump
    ])
    expect(items.map(i => [i.snapshot_version, i.size_bytes])).toEqual([[2, 1050], [1, 1000]])
    expect(items[0].key).toBe(base + '02/v2/manifest.json')
  })
})
