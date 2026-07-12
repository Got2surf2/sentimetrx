// Trim route regressions (2026-07-12 first-open audit follow-up):
//  1. PostgREST caps ANY select at 1000 rows — the old single select silently
//     trimmed at most 1000 matching rows per click while reporting success.
//     The route must loop rounds until the cutoff is fully applied.
//  2. The post-trim analytics write must MERGE per-key (sql/145 doctrine),
//     never replace the blob — a full replace wiped signal_stats /
//     signal_stats_by_field / stored taxonomy rollups.
//  3. Comma-containing date field names silently match nothing in the raw
//     PostgREST filter (sql/161 class) → explicit 400 instead.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store = {
  rows: [] as { id: number; date: string }[],
  merges: [] as Record<string, unknown>[],
  stateUpdates: [] as Record<string, unknown>[],
  audits: [] as Record<string, unknown>[],
}

function service() {
  return {
    from(table: string) {
      if (table === 'datasets') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'd1', org_id: 'o1', row_count: store.rows.length } }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === 'dataset_state') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { schema_config: { fields: [{ field: 'x', type: 'categorical' }] } } }) }) }),
          update: (payload: Record<string, unknown>) => { store.stateUpdates.push(payload); return { eq: async () => ({ error: null }) } },
        }
      }
      // dataset_rows_flat
      const state = { isCount: false, ltDate: null as string | null, limit: 1000 }
      const b: Record<string, unknown> = {}
      const pass = () => b
      b.eq = pass
      b.order = pass
      b.lt = (_col: string, v: string) => { state.ltDate = v; return b }
      b.limit = (n: number) => { state.limit = n; return b }
      b.then = (res: (v: unknown) => unknown) => {
        if (state.isCount) return Promise.resolve({ count: store.rows.length, error: null }).then(res)
        const matching = store.rows.filter(r => state.ltDate == null || r.date < state.ltDate)
        // PostgREST-faithful: never more than 1000 rows per select
        const capped = matching.slice(0, Math.min(state.limit, 1000)).map(r => ({ id: r.id }))
        return Promise.resolve({ data: capped, error: null }).then(res)
      }
      return {
        select: (_sel?: string, opts?: { head?: boolean }) => { state.isCount = !!opts?.head; return b },
        delete: () => ({ in: async (_col: string, ids: number[]) => { store.rows = store.rows.filter(r => !ids.includes(r.id)); return { error: null } } }),
      }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
  createServiceRoleClient: () => service(),
  getAuthUser: async () => ({ id: 'u1', email: 't@example.com' }),
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ({ userId: 'u1', orgId: 'o1', isAdmin: false }) }))
vi.mock('@/lib/orgTransfer', () => ({ recordAdminCrossOrgAction: async (a: Record<string, unknown>) => { store.audits.push(a) } }))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: async () => ({ totalRows: 1, computedAt: 'now', fieldSummaries: {} }) }))
vi.mock('@/lib/datasetAnalytics', () => ({ mergeDatasetAnalytics: async (_s: unknown, _d: string, patch: Record<string, unknown>) => { store.merges.push(patch) } }))

import { POST } from '@/app/api/datasets/[datasetId]/trim/route'

const props = { params: Promise.resolve({ datasetId: 'd1' }) }
const req = (body: Record<string, unknown>) =>
  new Request('http://x/api/datasets/d1/trim', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  store.rows = []
  store.merges = []
  store.stateUpdates = []
  store.audits = []
})

describe('POST /trim', () => {
  it('deletes ALL matching rows across 1000-row rounds (not just the first 1000)', async () => {
    for (let i = 1; i <= 3000; i++) store.rows.push({ id: i, date: i <= 2500 ? '2020-01-01' : '2030-01-01' })

    const res = await POST(req({ date_field: 'when', before_date: '2025-01-01' }), props)
    const data = await res.json()

    expect(data.deleted).toBe(2500)
    expect(data.hasMore).toBe(false)
    expect(data.remaining).toBe(500)
    expect(store.rows).toHaveLength(500) // only post-cutoff rows survive
    expect(store.audits).toHaveLength(1)
    expect(store.audits[0].metadata).toMatchObject({ deleteCount: 2500 })
  })

  it('merges analytics per-key and never writes an analytics blob replace', async () => {
    store.rows.push({ id: 1, date: '2020-01-01' }, { id: 2, date: '2030-01-01' })

    await POST(req({ date_field: 'when', before_date: '2025-01-01' }), props)

    expect(store.merges).toHaveLength(1) // recompute went through mergeDatasetAnalytics
    expect(store.merges[0]).toHaveProperty('fieldSummaries')
    for (const u of store.stateUpdates) expect(u).not.toHaveProperty('analytics') // no blob replace
  })

  it('rejects comma-containing date field names instead of silently matching nothing', async () => {
    store.rows.push({ id: 1, date: '2020-01-01' })
    const res = await POST(req({ date_field: 'What, when?', before_date: '2025-01-01' }), props)
    expect(res.status).toBe(400)
    expect(store.rows).toHaveLength(1)
  })

  it('no matches → deleted 0, no audit entry, no analytics churn', async () => {
    store.rows.push({ id: 1, date: '2030-01-01' })
    const res = await POST(req({ date_field: 'when', before_date: '2025-01-01' }), props)
    const data = await res.json()
    expect(data).toMatchObject({ deleted: 0, hasMore: false })
    expect(store.audits).toHaveLength(0)
    expect(store.merges).toHaveLength(0)
  })
})
