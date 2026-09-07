// lib/collectionRecompute.ts runs on the service-role client (RLS bypassed), so
// the CLAUDE.md invariant — every id lookup pairs with org_id — has to be
// enforced in code. These tests pin the pairing on the REAL query chains the
// helpers build: a wrong-org collection is "not found" before any per-dataset
// row is read or written, and the writes that do happen carry org_id.
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/signalStats', () => ({ invalidateSignalStats: async () => {} }))
vi.mock('@/lib/collectionSchema', () => ({ buildMergedCollectionSchema: async () => ({ fields: [{ key: 'f' }] }) }))
vi.mock('@/lib/analyticsCompute', () => ({
  createAnalyticsAccumulator: () => ({
    pushRows: () => {},
    finalize: () => ({ totalRows: 0, computedAt: 'now', fieldSummaries: {} }),
  }),
}))

type Filter = { op: string; args: unknown[] }
type Call = { table: string; mode: 'select' | 'update'; filters: Filter[]; payload?: unknown }

// Recording fake: every chain resolves canned per-table rows, and every call's
// .eq/.in filters are captured so the tests can assert on org_id pairing.
function makeService(tables: Record<string, unknown[]>, calls: Call[]) {
  function chain(call: Call): unknown {
    const rows = () => {
      const all = tables[call.table] || []
      // Honour org_id filters so a wrong-org lookup really returns nothing.
      const org = call.filters.find(f => f.op === 'eq' && f.args[0] === 'org_id')
      return org ? all.filter(r => (r as { org_id?: string }).org_id === org.args[1]) : all
    }
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: call.mode === 'update' ? null : rows(), error: null })
          return p.then.bind(p)
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => ({ data: rows()[0] ?? null, error: null })
        }
        if (prop === 'update') {
          return (payload: unknown) => {
            const upd: Call = { table: call.table, mode: 'update', filters: [], payload }
            calls.push(upd)
            return chain(upd)
          }
        }
        return (...args: unknown[]) => {
          if (prop === 'eq' || prop === 'in') call.filters.push({ op: String(prop), args })
          return chain(call)
        }
      },
    })
    return proxy
  }
  return {
    from: (table: string) => {
      const call: Call = { table, mode: 'select', filters: [] }
      calls.push(call)
      return chain(call)
    },
  }
}

const ORG = 'org-a'
const COLLECTION_DS = 'ds-collection'
const MEMBER_DS = 'ds-member'

function seed() {
  return {
    collections: [{ id: 'col-1', dataset_id: COLLECTION_DS, org_id: ORG }],
    dataset_state: [{ schema_config: { fields: [{ key: 'f' }] } }],
    collection_members: [{ collection_id: 'col-1', dataset_id: MEMBER_DS, label: 'M' }],
    dataset_rows_flat: [],
    datasets: [],
  }
}

const hasOrgEq = (c: Call) => c.filters.some(f => f.op === 'eq' && f.args[0] === 'org_id' && f.args[1] === ORG)

describe('collectionRecompute — org_id pairing on the service-role client', () => {
  it('recomputeCollectionAnalytics: wrong org → null, and nothing is read or written past the gate', async () => {
    const calls: Call[] = []
    const svc = makeService(seed(), calls)
    const { recomputeCollectionAnalytics } = await import('@/lib/collectionRecompute')

    const res = await recomputeCollectionAnalytics(svc as never, COLLECTION_DS, 'org-b')

    expect(res).toBeNull()
    expect(calls.map(c => c.table)).toEqual(['collections'])
    expect(calls.filter(c => c.mode === 'update')).toHaveLength(0)
  })

  it('recomputeCollectionAnalytics: right org → the collections lookup and the datasets update both carry org_id', async () => {
    const calls: Call[] = []
    const svc = makeService(seed(), calls)
    const { recomputeCollectionAnalytics } = await import('@/lib/collectionRecompute')

    const res = await recomputeCollectionAnalytics(svc as never, COLLECTION_DS, ORG, 'user-1')

    expect(res).not.toBeNull()
    const lookup = calls.find(c => c.table === 'collections' && c.mode === 'select')!
    expect(hasOrgEq(lookup)).toBe(true)
    const dsUpdate = calls.find(c => c.table === 'datasets' && c.mode === 'update')!
    expect(dsUpdate.filters).toEqual(expect.arrayContaining([
      { op: 'eq', args: ['id', COLLECTION_DS] },
      { op: 'eq', args: ['org_id', ORG] },
    ]))
    expect(dsUpdate.payload).toMatchObject({ row_count: 0 })
  })

  it('refreshCollection: wrong org → null before the schema is rebuilt or persisted', async () => {
    const calls: Call[] = []
    const svc = makeService(seed(), calls)
    const { refreshCollection } = await import('@/lib/collectionRecompute')

    const res = await refreshCollection(svc as never, COLLECTION_DS, 'org-b', 'user-1')

    expect(res).toBeNull()
    expect(calls.filter(c => c.mode === 'update')).toHaveLength(0)
  })

  it('recomputeParentCollections: parents are resolved with org_id and a wrong org recomputes nothing', async () => {
    const calls: Call[] = []
    const svc = makeService(seed(), calls)
    const { recomputeParentCollections } = await import('@/lib/collectionRecompute')

    expect(await recomputeParentCollections(svc as never, MEMBER_DS, 'org-b')).toBe(0)
    const parents = calls.find(c => c.table === 'collections')!
    expect(parents.filters.some(f => f.op === 'eq' && f.args[0] === 'org_id' && f.args[1] === 'org-b')).toBe(true)
    expect(calls.filter(c => c.mode === 'update')).toHaveLength(0)

    calls.length = 0
    expect(await recomputeParentCollections(svc as never, MEMBER_DS, ORG)).toBe(1)
    expect(calls.some(c => c.table === 'datasets' && c.mode === 'update' && hasOrgEq(c))).toBe(true)
  })
})
