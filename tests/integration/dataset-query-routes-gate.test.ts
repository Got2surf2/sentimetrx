// tests/integration/dataset-query-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the dataset "query POST" routes. These read
// tenant rows from a request body (chart aggregates, comment filters, theme
// counts, regressions, signal stats), so a missing org filter is a cross-org
// READ leak:
//   - aggregate           POST            (chart RPCs)
//   - rows                GET/POST/DELETE (row fetch / append / rollback)
//   - comments            POST            (unified comment filter)
//   - taxonomy            GET/POST        (dimension rollup / classify)
//   - export/html/share   POST            (signed-URL share)
//   - theme-counts        POST   <-- FIXED 2026-06-08 (was a cross-org leak)
//   - theme-impact        POST   <-- FIXED 2026-06-08 (was missing the gate)
//   - signal-stats-batch  POST   <-- FIXED 2026-06-08 (ids now org-filtered)
//   - signal-stats        GET    <-- FIXED 2026-07-02 (single-dataset variant
//                                    of the batch route; authed but never org-
//                                    checked before the service-role read)
//
// theme-counts / theme-impact / signal-stats-batch authenticated the caller
// but never checked their org before the service-role read. Now each resolves
// the caller org and gates the dataset (admin-org bypass preserved); signal-
// stats-batch filters the requested ids to those the caller's org owns.

import { describe, it, expect, beforeEach, vi } from 'vitest'

type QueryResult = { data: unknown; error: unknown }
type CallerCtx = { userId: string | null; orgId: string | null; isAdmin: boolean }

const ctx = {
  authUser: null as { id: string } | null,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as CallerCtx,
  results: {} as Record<string, QueryResult>,
  eqCalls: {} as Record<string, [string, unknown][]>,
}
function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
  ctx.eqCalls = {}
}

interface MockBuilder {
  [method: string]: unknown
  eq(col: string, val: unknown): MockBuilder
  single(): Promise<QueryResult>
  maybeSingle(): Promise<QueryResult>
  then(
    res: (value: QueryResult) => unknown,
    rej: (reason: unknown) => unknown,
  ): Promise<unknown>
}

function builder(table: string): MockBuilder {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b = {} as MockBuilder
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'lt', 'gte', 'not', 'update', 'delete', 'insert']) b[m] = () => b
  b.eq = (col: string, val: unknown) => { ctx.eqCalls[table].push([col, val]); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res, rej) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/commentFilter', () => ({ getRowsByFilters: async () => ({ rows: [], total: 0 }) }))
vi.mock('@/lib/taxonomyRollup', () => ({ computeTaxonomyRollup: async () => ({ axes: [], subs: [], alerts: [] }) }))
vi.mock('@/lib/taxonomyClassify', () => ({ classifyDatasetKeyword: async () => ({ classified: 0, total: 0, nextOffset: 0, reachedEnd: true }), classifyPendingRows: async () => ({ classified: 0, hasMore: false }) }))
vi.mock('@/lib/dimensionFields', () => ({ taxonomyFieldKey: (f: string[]) => (f.length ? f.join('|') : '') }))
vi.mock('@/lib/signalStats', () => ({ computeSignalStats: async () => ({ n: 1 }) }))

import * as aggregate from '@/app/api/datasets/[datasetId]/aggregate/route'
import * as rows from '@/app/api/datasets/[datasetId]/rows/route'
import * as comments from '@/app/api/datasets/[datasetId]/comments/route'
import * as taxonomy from '@/app/api/datasets/[datasetId]/taxonomy/route'
import * as share from '@/app/api/datasets/[datasetId]/export/html/share/route'
import * as themeCounts from '@/app/api/datasets/[datasetId]/theme-counts/route'
import * as themeImpact from '@/app/api/datasets/[datasetId]/theme-impact/route'
import * as signalBatch from '@/app/api/datasets/signal-stats-batch/route'
import * as signalStats from '@/app/api/datasets/[datasetId]/signal-stats/route'

const props = { params: Promise.resolve({ datasetId: 'd_1' }) }
const req = (method = 'POST', body: unknown = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) })

const caller = (orgId: string | null, isAdmin = false) => ({ userId: orgId ? 'u1' : null, orgId, isAdmin })

beforeEach(reset)

// ── aggregate — POST ───────────────────────────────────────────────────────
describe('datasets/[datasetId]/aggregate — POST', () => {
  it('401 when caller has no org', async () => {
    expect((await aggregate.POST(req('POST', { op: 'field_counts', field: 'x' }), props)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await aggregate.POST(req('POST', { op: 'field_counts', field: 'x' }), props)).status).toBe(404)
  })
})

// ── rows — GET / POST / DELETE ─────────────────────────────────────────────
describe('datasets/[datasetId]/rows — GET / POST / DELETE', () => {
  it('401 when caller has no org (all verbs)', async () => {
    expect((await rows.GET(req('GET'), props)).status).toBe(401)
    expect((await rows.POST(req('POST', { rows: [{ a: 1 }] }), props)).status).toBe(401)
    expect((await rows.DELETE(req('DELETE', { batch_indexes: [0] }), props)).status).toBe(401)
  })
  it('404 cross-org (all verbs)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'survey' }, error: null }
    expect((await rows.GET(req('GET'), props)).status).toBe(404)
    expect((await rows.POST(req('POST', { rows: [{ a: 1 }] }), props)).status).toBe(404)
    expect((await rows.DELETE(req('DELETE', { batch_indexes: [0] }), props)).status).toBe(404)
  })
})

// ── comments — POST ────────────────────────────────────────────────────────
describe('datasets/[datasetId]/comments — POST', () => {
  it('401 when caller has no org', async () => {
    expect((await comments.POST(req('POST', {}), props)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { id: 'd_1', org_id: 'orgB' }, error: null }
    expect((await comments.POST(req('POST', {}), props)).status).toBe(404)
  })
})

// ── taxonomy — GET / POST ──────────────────────────────────────────────────
describe('datasets/[datasetId]/taxonomy — GET / POST', () => {
  it('401 unauthenticated', async () => {
    expect((await taxonomy.GET(req('GET'), props)).status).toBe(401)
    expect((await taxonomy.POST(req('POST', {}), props)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB', row_count: 10 }, error: null }
    expect((await taxonomy.GET(req('GET'), props)).status).toBe(404)
    expect((await taxonomy.POST(req('POST', {}), props)).status).toBe(404)
  })
})

// ── export/html/share — POST ───────────────────────────────────────────────
describe('datasets/[datasetId]/export/html/share — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await share.POST(req('POST', {}), props)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await share.POST(req('POST', {}), props)).status).toBe(404)
  })
})

// ── theme-counts — POST (REGRESSION: was a cross-org read leak) ─────────────
describe('datasets/[datasetId]/theme-counts — POST (cross-org fix)', () => {
  const goodBody = { themes: [{ id: 't', keywords: ['x'] }], fields: ['f'] }

  it('401 unauthenticated', async () => {
    expect((await themeCounts.POST(req('POST', goodBody), props)).status).toBe(401)
  })
  it('401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller(null)
    expect((await themeCounts.POST(req('POST', goodBody), props)).status).toBe(401)
  })
  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await themeCounts.POST(req('POST', goodBody), props)).status).toBe(404)
  })
  it('owning-org caller is allowed past the gate', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null }
    expect((await themeCounts.POST(req('POST', goodBody), props)).status).not.toBe(404)
  })
})

// ── theme-impact — POST (REGRESSION: was missing the gate) ─────────────────
describe('datasets/[datasetId]/theme-impact — POST (cross-org fix)', () => {
  const goodBody = { targetField: 'score', textFields: ['c'], themes: [{ id: 't', name: 'T', keywords: ['x'] }] }

  it('401 unauthenticated', async () => {
    expect((await themeImpact.POST(req('POST', goodBody), props)).status).toBe(401)
  })
  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await themeImpact.POST(req('POST', goodBody), props)).status).toBe(404)
  })
})

// ── signal-stats-batch — POST (REGRESSION: ids now org-filtered) ───────────
describe('datasets/signal-stats-batch — POST (cross-org fix)', () => {
  it('401 unauthenticated', async () => {
    expect((await signalBatch.POST(req('POST', { ids: ['d1'] }))).status).toBe(401)
  })

  it('cross-org ids are filtered out → empty stats', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: [], error: null }      // none owned by orgA
    const r = await signalBatch.POST(req('POST', { ids: ['d1', 'd2'] }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ stats: {} })
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })

  it('owned ids are included', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: [{ id: 'd1' }], error: null }
    const r = await signalBatch.POST(req('POST', { ids: ['d1', 'd2'] }))
    const body = await r.json()
    expect(Object.keys(body.stats)).toEqual(['d1'])
  })
})

// ── signal-stats — GET (REGRESSION: single-dataset variant lacked the gate) ─
describe('datasets/[datasetId]/signal-stats — GET (cross-org fix)', () => {
  it('401 unauthenticated', async () => {
    expect((await signalStats.GET(req('GET'), props)).status).toBe(401)
  })
  it('401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller(null)
    expect((await signalStats.GET(req('GET'), props)).status).toBe(401)
  })
  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await signalStats.GET(req('GET'), props)).status).toBe(404)
  })
  it('owning-org caller is allowed past the gate', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null }
    expect((await signalStats.GET(req('GET'), props)).status).not.toBe(404)
  })
})
