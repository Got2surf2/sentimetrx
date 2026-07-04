// Regression tests for the restore-fidelity rework (2026-07-04) — the three
// bug classes the first full DR drill surfaced in lib/orgRestore:
//   1. FK ordering (incl. the datasets↔collections CIRCULAR dependency that
//      only retry rounds can resolve),
//   2. referential debt (rows whose parents exist nowhere in the target must
//      be skipped and counted — not poison their whole all-or-nothing batch),
//   3. silent loss (the restore must verify itself and never report success
//      for rows that did not land — whatever the mechanism).
//
// The fake target DB here enforces FK and unique rules the way PostgREST
// does: a violating batch fails ATOMICALLY with code 23503/23505.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { restoreOrgSnapshot, restoreOrgSnapshotFromSource } from '@/lib/orgRestore'
import { TABLE_SPECS, type OrgSnapshot } from '@/lib/orgSnapshot'
import type { SnapshotSource } from '@/lib/orgSnapshotV2'

const ORG = '22222222-2222-2222-2222-222222222222'

type Row = Record<string, unknown>
interface FkRule { table: string; col: string; ref: string }
interface UniqueRule { table: string; name: string; key: (r: Row) => string | null }

interface TriggerApi { tbl: (t: string) => Row[]; genId: () => string; set: (t: string, rows: Row[]) => void }

function fkDb(opts: {
  fks?: FkRule[]
  uniques?: UniqueRule[]
  // Simulate cascade loss: these ids silently disappear from the table
  // right after landing (like ON DELETE CASCADE firing later would).
  vanishAfterWrite?: Record<string, string[]>
  // Tables whose DELETE always errors (pre-delete failure path).
  deleteErrors?: string[]
  seed?: Record<string, Row[]>
  // Simulate a BEFORE trigger: may mutate the incoming row and write side
  // rows into other tables (set_brand_collection_id-style).
  beforeWrite?: (table: string, row: Row, old: Row | null, api: TriggerApi) => void
} = {}) {
  const store = new Map<string, Row[]>()
  for (const [t, rows] of Object.entries(opts.seed || {})) store.set(t, rows.map(r => ({ ...r })))
  const tbl = (t: string) => { if (!store.has(t)) store.set(t, []); return store.get(t)! }
  let idSeq = 1
  const api: TriggerApi = { tbl, genId: () => 'gen-' + idSeq++, set: (t, rows) => { store.set(t, rows) } }

  function violation(table: string, rows: Row[]): { code: string; message: string } | null {
    for (const fk of (opts.fks || []).filter(f => f.table === table)) {
      for (const r of rows) {
        const v = r[fk.col]
        if (v != null && !tbl(fk.ref).some(x => x.id === v)) {
          return { code: '23503', message: `insert or update on table "${table}" violates foreign key constraint "${table}_${fk.col}_fkey"` }
        }
      }
    }
    for (const u of (opts.uniques || []).filter(x => x.table === table)) {
      const seen = new Map<string, unknown>()
      for (const ex of tbl(table)) { const k = u.key(ex); if (k != null) seen.set(k, ex.id) }
      for (const r of rows) {
        const k = u.key(r)
        if (k != null && seen.has(k) && seen.get(k) !== r.id) {
          return { code: '23505', message: `duplicate key value violates unique constraint "${u.name}"` }
        }
        if (k != null) seen.set(k, r.id)
      }
    }
    return null
  }

  function land(table: string, rows: Row[], op: 'upsert' | 'insert'): Row[] {
    const landed: Row[] = []
    for (const r of rows) {
      const row = 'id' in r ? { ...r } : { ...r, id: 'gen-' + idSeq++ }
      const arr = tbl(table)
      const existing = op === 'upsert' ? arr.find(x => x.id === row.id) ?? null : null
      opts.beforeWrite?.(table, row, existing, api)
      const target = tbl(table) // beforeWrite may have replaced the array via api.set
      if (op === 'upsert') {
        const i = target.findIndex(x => x.id === row.id)
        if (i >= 0) target[i] = row; else target.push(row)
      } else {
        target.push(row)
      }
      landed.push(row)
    }
    const vanish = opts.vanishAfterWrite?.[table]
    if (vanish) store.set(table, tbl(table).filter(x => !vanish.includes(x.id as string)))
    return landed
  }

  const db = {
    from(table: string) {
      return {
        upsert(rows: Row[], _o?: unknown) {
          return {
            select: (_c: string) => {
              const err = violation(table, rows)
              if (err) return Promise.resolve({ data: null, error: err })
              const landed = land(table, rows, 'upsert')
              return Promise.resolve({ data: landed.map(r => ({ id: r.id })), error: null })
            },
          }
        },
        insert(rows: Row[]) {
          return {
            select: (c: string) => {
              const err = violation(table, rows)
              if (err) return Promise.resolve({ data: null, error: err })
              const landed = land(table, rows, 'insert')
              return Promise.resolve({ data: landed.map(r => ({ [c]: r[c] })), error: null })
            },
          }
        },
        delete() {
          return {
            in(col: string, vals: unknown[]) {
              if (opts.deleteErrors?.includes(table)) return Promise.resolve({ error: { message: 'delete refused (test)' } })
              store.set(table, tbl(table).filter(r => !vals.includes(r[col])))
              return Promise.resolve({ error: null })
            },
          }
        },
        select(_col: string, o?: { count?: string; head?: boolean }) {
          return {
            in(c: string, vals: unknown[]) {
              const rows = tbl(table).filter(r => vals.includes(r[c]))
              if (o?.head) return Promise.resolve({ count: rows.length, error: null })
              return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null })
            },
            eq(c: string, v: unknown) {
              const rows = tbl(table).filter(r => r[c] === v)
              if (o?.head) return Promise.resolve({ count: rows.length, error: null })
              return {
                order: (_oc: string, _oo?: unknown) => ({
                  range: (from: number, to: number) =>
                    Promise.resolve({ data: rows.slice(from, to + 1).map(r => ({ id: r.id, org_id: r.org_id })), error: null }),
                }),
              }
            },
          }
        },
      }
    },
    _tbl: tbl,
  }
  return { db: db as unknown as SupabaseClient, tbl }
}

function snap(tables: Record<string, Row[]>): OrgSnapshot {
  return {
    meta: { snapshot_version: 1, org_id: ORG, org_name: 'T', taken_at: 't', table_row_counts: {}, truncated_tables: [], fetch_errors: {} },
    tables,
  }
}

// Real FK rules for the tables these tests use (mirrors docs/db/schema.sql).
const REAL_FKS: FkRule[] = [
  { table: 'collections', col: 'dataset_id', ref: 'datasets' },
  { table: 'datasets', col: 'brand_collection_id', ref: 'collections' },
  { table: 'collection_members', col: 'collection_id', ref: 'collections' },
  { table: 'collection_members', col: 'dataset_id', ref: 'datasets' },
  { table: 'campaign_schedules', col: 'email_id', ref: 'campaign_emails' },
  { table: 'dataset_rows_flat', col: 'dataset_id', ref: 'datasets' },
]

describe('TABLE_SPECS restore order', () => {
  it('campaign_emails precedes campaign_schedules (schedules.email_id FKs emails)', () => {
    const idx = (n: string) => TABLE_SPECS.findIndex(s => s.name === n)
    expect(idx('campaign_emails')).toBeGreaterThan(-1)
    expect(idx('campaign_emails')).toBeLessThan(idx('campaign_schedules'))
    expect(idx('campaign_schedules')).toBeLessThan(idx('campaign_send_log'))
  })
})

describe('referential debt (bug class 2)', () => {
  it('skips only the debt rows — good rows in the same batch still land', async () => {
    // 5 of 17 collections reference datasets that exist nowhere (org-transfer
    // leftovers). All 17 arrive in ONE all-or-nothing batch.
    const datasets = [{ id: 'd-1', org_id: ORG }, { id: 'd-2', org_id: ORG }]
    const collections = Array.from({ length: 17 }, (_, i) => ({
      id: 'c-' + i, org_id: ORG,
      dataset_id: i < 5 ? 'other-org-ds-' + i : (i % 2 ? 'd-1' : 'd-2'),
    }))
    const { db, tbl } = fkDb({ fks: REAL_FKS })

    const res = await restoreOrgSnapshot(db, snap({ datasets, collections }))
    const c = res.reports.find(r => r.table === 'collections')!
    expect(c.upserted).toBe(12)
    expect(c.skipped_fk).toBe(5)
    expect(c.errors).toBe(0)
    expect(c.missing).toBe(0)
    expect(tbl('collections').length).toBe(12)
    expect(res.ok).toBe(true) // skips are reported, not fatal
    expect(res.totals.skipped_fk).toBe(5)
  })

  it('children of skipped parents are themselves skipped and counted', async () => {
    const datasets = [{ id: 'd-1', org_id: ORG }]
    const collections = [{ id: 'c-ok', org_id: ORG, dataset_id: 'd-1' }, { id: 'c-debt', org_id: ORG, dataset_id: 'gone' }]
    const collection_members = [
      { id: 'm-1', collection_id: 'c-ok', dataset_id: 'd-1' },
      { id: 'm-2', collection_id: 'c-debt', dataset_id: 'd-1' },
    ]
    const { db } = fkDb({ fks: REAL_FKS })
    const res = await restoreOrgSnapshot(db, snap({ datasets, collections, collection_members }))
    const m = res.reports.find(r => r.table === 'collection_members')!
    expect(m.upserted).toBe(1)
    expect(m.skipped_fk).toBe(1)
    expect(res.totals.missing).toBe(0)
  })
})

describe('circular FK dependencies (bug class 1)', () => {
  it('datasets↔collections circle resolves via retry rounds', async () => {
    // d-brand references c-1 (restores AFTER datasets); c-1 references d-2.
    // No static order can land d-brand in round 1 — the retry must.
    const datasets = [
      { id: 'd-2', org_id: ORG, brand_collection_id: null },
      { id: 'd-brand', org_id: ORG, brand_collection_id: 'c-1' },
    ]
    const collections = [{ id: 'c-1', org_id: ORG, dataset_id: 'd-2' }]
    const { db, tbl } = fkDb({ fks: REAL_FKS })

    const res = await restoreOrgSnapshot(db, snap({ datasets, collections }))
    expect(res.ok).toBe(true)
    expect(res.totals.skipped_fk).toBe(0)
    expect(tbl('datasets').length).toBe(2)
    expect(tbl('collections').length).toBe(1)
    const d = res.reports.find(r => r.table === 'datasets')!
    expect(d.upserted).toBe(2)
    expect(d.missing).toBe(0)
  })
})

describe('unique-index collisions', () => {
  it('a brand-slug collision with a different-id live row is skipped_conflict, not batch death', async () => {
    // Re-restore over an existing org whose brand collection has a different
    // id but the same (org_id, slug) — the collections_brand_slug_uniq case.
    const seed = { collections: [{ id: 'c-live', org_id: ORG, slug: 'acme', kind: 'brand' }] }
    const collections = [
      { id: 'c-new', org_id: ORG, slug: 'acme', kind: 'brand' },
      { id: 'c-other', org_id: ORG, slug: 'other', kind: 'brand' },
    ]
    const { db, tbl } = fkDb({
      seed,
      uniques: [{
        table: 'collections', name: 'collections_brand_slug_uniq',
        key: r => (r.kind === 'brand' ? `${r.org_id}/${r.slug}` : null),
      }],
    })
    const res = await restoreOrgSnapshot(db, snap({ collections }))
    const c = res.reports.find(r => r.table === 'collections')!
    expect(c.upserted).toBe(1)
    expect(c.skipped_conflict).toBe(1)
    expect(c.first_error).toContain('collections_brand_slug_uniq')
    expect(tbl('collections').map(r => r.id).sort()).toEqual(['c-live', 'c-other'])
    expect(res.totals.missing).toBe(0)
  })
})

describe('trigger-minted phantoms (deferred columns)', () => {
  // Faithful simulation of set_brand_collection_id (BEFORE, migration 062)
  // + sync_brand_collection_members (AFTER): a dataset written with a
  // brand_tag find-or-creates the brand collection (phantom id if the
  // snapshot's row hasn't landed yet) and syncs a membership row.
  const brandTrigger = (table: string, row: Row, old: Row | null, api: TriggerApi) => {
    if (table !== 'datasets' || row.source === 'collection') return
    const newTag = String(row.brand_tag ?? '')
    const oldTag = String(old?.brand_tag ?? '')
    if (newTag === oldTag) return
    let collId: unknown = null
    if (newTag) {
      const slug = newTag.toLowerCase().replace(/\W+/g, '_')
      let coll = api.tbl('collections').find(c => c.org_id === row.org_id && c.kind === 'brand' && c.slug === slug)
      if (!coll) {
        const vds = { id: api.genId(), org_id: row.org_id, source: 'collection', name: newTag }
        api.tbl('datasets').push(vds)
        coll = { id: api.genId(), org_id: row.org_id, kind: 'brand', slug, dataset_id: vds.id }
        api.tbl('collections').push(coll)
      }
      collId = coll.id
    }
    const oldColl = old?.brand_collection_id ?? null
    row.brand_collection_id = collId
    if (oldColl !== collId) {
      if (oldColl != null) api.set('collection_members', api.tbl('collection_members').filter(m => !(m.collection_id === oldColl && m.dataset_id === row.id)))
      if (collId != null) api.tbl('collection_members').push({ id: api.genId(), collection_id: collId, dataset_id: row.id, label: row.name, sort_order: 0 })
    }
  }

  it('branded datasets restore without minting phantom brand collections (2026-07-04 live drill)', async () => {
    // Snapshot: a virtual dataset backing the brand collection, a branded
    // dataset pointing at it, the real collections row, its membership row.
    const datasets = [
      { id: 'vds-1', org_id: ORG, source: 'collection', name: 'Acme', brand_tag: null, brand_collection_id: null },
      { id: 'd-1', org_id: ORG, source: 'upload', name: 'Acme reviews', brand_tag: 'Acme', brand_collection_id: 'c-1' },
    ]
    const collections = [{ id: 'c-1', org_id: ORG, kind: 'brand', slug: 'acme', dataset_id: 'vds-1' }]
    const collection_members = [{ id: 'm-1', collection_id: 'c-1', dataset_id: 'd-1', label: 'Acme reviews', sort_order: 3 }]
    const { db, tbl } = fkDb({
      fks: REAL_FKS,
      beforeWrite: brandTrigger,
      uniques: [{
        table: 'collections', name: 'collections_brand_slug_uniq',
        key: r => (r.kind === 'brand' ? `${r.org_id}/${r.slug}` : null),
      }],
    })

    const res = await restoreOrgSnapshot(db, snap({ datasets, collections, collection_members }))

    // No phantom: exactly the snapshot's collection, under its ORIGINAL id.
    expect(tbl('collections').map(c => c.id)).toEqual(['c-1'])
    // The branded dataset points at the snapshot's collection.
    expect(tbl('datasets').find(d => d.id === 'd-1')!.brand_collection_id).toBe('c-1')
    expect(tbl('datasets').find(d => d.id === 'd-1')!.brand_tag).toBe('Acme')
    // No phantom virtual dataset was minted.
    expect(tbl('datasets').length).toBe(2)
    // Membership: exactly the snapshot's row — the trigger's minted twin
    // (same pair, generated id) was deduped away.
    const members = tbl('collection_members').filter(m => m.dataset_id === 'd-1')
    expect(members.length).toBe(1)
    expect(members[0].id).toBe('m-1')
    expect(members[0].sort_order).toBe(3)

    const c = res.reports.find(r => r.table === 'collections')!
    expect(c.skipped_conflict).toBe(0)
    expect(res.ok).toBe(true)
    expect(res.totals.missing).toBe(0)
  })
})

describe('silent loss (bug class 3)', () => {
  it('verification catches rows that vanished after a claimed-successful write', async () => {
    const datasets = [{ id: 'd-1', org_id: ORG }]
    const collections = Array.from({ length: 17 }, (_, i) => ({ id: 'c-' + i, org_id: ORG, dataset_id: 'd-1' }))
    const { db } = fkDb({
      fks: REAL_FKS,
      vanishAfterWrite: { collections: ['c-3', 'c-7', 'c-9', 'c-11', 'c-15'] },
    })
    const res = await restoreOrgSnapshot(db, snap({ datasets, collections }))
    const c = res.reports.find(r => r.table === 'collections')!
    expect(c.upserted).toBe(17) // the write itself claimed success…
    expect(c.missing).toBe(5) // …but verification refuses to
    expect(res.ok).toBe(false)
    expect(res.totals.missing).toBe(5)
  })

  it('identity tables verify per-parent counts', async () => {
    const datasets = [{ id: 'd-1', org_id: ORG }]
    const flat = Array.from({ length: 30 }, (_, i) => ({ id: 900 + i, dataset_id: 'd-1', row_index: i }))
    const { db, tbl } = fkDb({ fks: REAL_FKS })
    // sanity: rows land, ids are generated (stripId), verification is clean
    const res = await restoreOrgSnapshot(db, snap({ datasets, dataset_rows_flat: flat }))
    const f = res.reports.find(r => r.table === 'dataset_rows_flat')!
    expect(f.upserted).toBe(30)
    expect(f.missing).toBe(0)
    expect(tbl('dataset_rows_flat').every(r => String(r.id).startsWith('gen-'))).toBe(true)
    expect(res.ok).toBe(true)
  })

  it('a stream that under-delivers vs the manifest count is an error, not success', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: 'r-' + i, org_id: ORG }))
    const source: SnapshotSource = {
      version: 2, orgId: ORG, orgName: 'T', takenAt: 't',
      tableNames: ['conversations'],
      rowCount: () => 10, // manifest promises 10…
      fetchErrors: {},
      readTable: async function* () { yield rows }, // …stream delivers 8
    }
    const { db } = fkDb({})
    const res = await restoreOrgSnapshotFromSource(db, source)
    const c = res.reports.find(r => r.table === 'conversations')!
    expect(c.upserted).toBe(8)
    expect(c.errors).toBe(2)
    expect(c.first_error).toContain('under-delivered')
    expect(res.ok).toBe(false)
  })

  it('a failed pre-delete counts the batch as errors and does not insert on top', async () => {
    const datasets = [{ id: 'd-1', org_id: ORG }]
    const flat = Array.from({ length: 10 }, (_, i) => ({ id: 900 + i, dataset_id: 'd-1', row_index: i }))
    const { db, tbl } = fkDb({ fks: REAL_FKS, deleteErrors: ['dataset_rows_flat'] })
    const res = await restoreOrgSnapshot(db, snap({ datasets, dataset_rows_flat: flat }))
    const f = res.reports.find(r => r.table === 'dataset_rows_flat')!
    expect(f.errors).toBe(10)
    expect(f.upserted).toBe(0)
    expect(f.first_error).toContain('pre-delete')
    expect(tbl('dataset_rows_flat').length).toBe(0)
    expect(res.ok).toBe(false)
  })
})
