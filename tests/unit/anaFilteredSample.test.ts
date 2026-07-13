// loadAnaSample filtered-sampling rework (sql/167) — paging/denominator logic
// with a mocked service client. SQL↔JS matcher parity is covered by the
// env-gated harness scripts/_verify_ana_filters.mts against the real TEST DB
// (6 filter shapes, exact counts); these tests pin the Node-side behavior:
// early-stop estimates above the cap, count-to-end exactness under it, the
// canonical applyFilters on the small path (cat exclude-mode + daterange were
// silently mishandled pre-167), and the legacy fallback when the RPC is absent.
import { describe, it, expect, vi } from 'vitest'
import { loadAnaSample } from '@/lib/anaReportContext'
import type { SerializedFilters } from '@/lib/filterUtils'

vi.mock('@/lib/log', () => ({ logError: vi.fn(async () => undefined) }))

type RpcImpl = (name: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }

// Thenable PostgREST-builder stand-in: every method chains, awaiting resolves.
function chainResolving(result: { data: unknown; error: null }) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'order', 'range', 'limit', 'single', 'not', 'neq', 'in']) chain[m] = self
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

function mockService(rpcImpl: RpcImpl, flatRows: Record<string, unknown>[] = []) {
  return {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => rpcImpl(name, args)),
    from: vi.fn(() => chainResolving({ data: flatRows.map(r => ({ data: r })), error: null })),
  } as unknown as Parameters<typeof loadAnaSample>[0]['service']
}

const ds = (rowCount: number) => ({ id: 'd-1', name: 'T', source: 'upload', row_count: rowCount })
const catFL: SerializedFilters = { State: { type: 'cat', mode: 'include', values: ['FL'], excludeBlanks: false } }

describe('loadAnaSample — filter-aware sampled fetch (sql/167 path)', () => {
  it('above the cap: stops when the budget fills and returns a flagged estimate', async () => {
    const pages: Record<string, unknown>[] = [{
      n_scanned: 5000, n_matched: 1000,
      rows: Array.from({ length: 600 }, (_, i) => ({ State: 'FL', i })),
      last_hash: 5000, last_id: 5000,
    }]
    let calls = 0
    const service = mockService((name) => {
      if (name !== 'sampled_filtered_rows') throw new Error('unexpected rpc ' + name)
      return { data: pages[Math.min(calls++, pages.length - 1)], error: null }
    })
    const out = await loadAnaSample({ service, dataset: ds(200000), sampleSize: 200, filters: catFL })
    expect(calls).toBe(1)                          // budget (600) filled on page 1 → no more scanning
    expect(out.rows).toHaveLength(200)
    expect(out.totalFiltered).toBe(40000)          // 1000/5000 × 200000
    expect(out.totalFilteredIsEstimate).toBe(true)
    expect(out.sampled).toBe(true)
  })

  it('at/below the cap: keeps counting past the budget for an EXACT denominator', async () => {
    const pages = [
      { n_scanned: 5000, n_matched: 4000, rows: Array.from({ length: 600 }, () => ({ State: 'FL' })), last_hash: 1, last_id: 1 },
      { n_scanned: 5000, n_matched: 4000, rows: [], last_hash: 2, last_id: 2 },
      { n_scanned: 2000, n_matched: 1600, rows: [], last_hash: 3, last_id: 3 },  // short page = end
    ]
    let calls = 0
    const service = mockService(() => ({ data: pages[calls++], error: null }))
    const out = await loadAnaSample({ service, dataset: ds(12000), sampleSize: 200, filters: catFL })
    expect(calls).toBe(3)                          // scanned to the end despite a full budget
    expect(out.totalFiltered).toBe(9600)           // exact sum, not scaled
    expect(out.totalFilteredIsEstimate).toBe(false)
  })

  it('small path applies CANONICAL filters: cat exclude-mode + daterange are honored', async () => {
    const rows = [
      { State: 'TX', when: '2026-03-01', v: 1 },   // dropped: excluded state
      { State: 'FL', when: '2020-01-01', v: 2 },   // dropped: outside daterange
      { State: 'FL', when: '2026-03-15', v: 3 },   // kept
      { State: '',   when: '2026-04-01', v: 4 },   // kept: blanks pass (excludeBlanks false)
    ]
    const service = mockService(() => ({ data: null, error: { message: 'no rpc on small path' } }), rows)
    const filters: SerializedFilters = {
      State: { type: 'cat', mode: 'exclude', values: ['TX'], excludeBlanks: false },
      when:  { type: 'daterange', values: [Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31)], includeBlanks: false },
    }
    const out = await loadAnaSample({ service, dataset: ds(4), sampleSize: 200, filters })
    expect(out.rows.map(r => r.v).sort()).toEqual([3, 4])
    expect(out.totalFiltered).toBe(2)
    expect(out.totalFilteredIsEstimate).toBe(false)
  })

  it('falls back to the legacy fetch + Node filter when the RPC is unavailable (deploy order)', async () => {
    const legacyRows = [{ State: 'FL' }, { State: 'TX' }, { State: 'FL' }]
    const service = {
      rpc: vi.fn(async (name: string) => name === 'sampled_filtered_rows'
        ? { data: null, error: { message: 'function does not exist [PGRST202]' } }
        : { data: legacyRows.map(r => ({ data: r })), error: null }),  // sample_row_pairs
      from: vi.fn(() => chainResolving({ data: [], error: null })),
    } as unknown as Parameters<typeof loadAnaSample>[0]['service']
    const out = await loadAnaSample({ service, dataset: ds(100000), sampleSize: 200, filters: catFL })
    expect(out.rows.every(r => r.State === 'FL')).toBe(true)
    expect(out.rows).toHaveLength(2)
    expect(out.totalFilteredIsEstimate).toBe(true) // fallback can't see the population
  })

  it('no filters: totalFiltered equals the dataset total, unflagged', async () => {
    const service = mockService(() => ({
      data: { n_scanned: 5000, n_matched: 5000, rows: Array.from({ length: 600 }, () => ({ a: 1 })), last_hash: 1, last_id: 1 },
      error: null,
    }))
    const out = await loadAnaSample({ service, dataset: ds(200000), sampleSize: 200 })
    expect(out.totalFiltered).toBe(200000)
    expect(out.totalFilteredIsEstimate).toBe(false)
  })
})
