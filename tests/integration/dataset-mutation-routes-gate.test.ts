// tests/integration/dataset-mutation-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the high-blast-radius dataset lifecycle
// mutation routes (delete dataset, wipe/re-import rows, trim rows, overwrite
// analysis state):
//   - datasets/[datasetId]               GET / PATCH / DELETE
//   - datasets/[datasetId]/state         GET / PUT / PATCH
//   - datasets/[datasetId]/trim          POST
//   - datasets/[datasetId]/sync          POST  (?full=true wipes + re-imports)
//   - datasets/[datasetId]/refresh-schema POST
//
// All verified correctly gated — no fixes in this batch. Each resolves the
// caller's org (via getOrgAndCheck / getCallerOrgContext / users lookup) and
// refuses a cross-org dataset before any service-role write. DELETE is also
// per-creator. The mock records .eq() so org-paired lookups assert the
// .eq('org_id', callerOrg) pairing is present.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,
  eqCalls: {} as Record<string, [string, any][]>,
}
function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
  ctx.eqCalls = {}
}

function builder(table: string): any {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'lt', 'update', 'delete', 'insert']) b[m] = () => b
  b.eq = (col: string, val: any) => { ctx.eqCalls[table].push([col, val]); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/orgTransfer', () => ({
  checkTransferTarget: async () => ({ ok: true }),
  recordOrgTransfer: async () => {},
  recordAdminCrossOrgAction: async () => {},
}))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: async () => ({}) }))
vi.mock('@/lib/collectionRecompute', () => ({ recomputeParentCollections: async () => 0 }))

import * as dataset from '@/app/api/datasets/[datasetId]/route'
import * as state from '@/app/api/datasets/[datasetId]/state/route'
import * as trim from '@/app/api/datasets/[datasetId]/trim/route'
import * as sync from '@/app/api/datasets/[datasetId]/sync/route'
import * as refresh from '@/app/api/datasets/[datasetId]/refresh-schema/route'

const props = { params: Promise.resolve({ datasetId: 'd_1' }) } as any
const req = (method = 'POST', body: any = {}, url = 'http://t/x') =>
  new Request(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any

// users-row shapes (top-level route uses features+is_admin_org; sync uses is_admin_org)
const analyze = (org: string | null, isAdmin = false) =>
  ({ data: { org_id: org, organizations: { features: { analyze: true }, is_admin_org: isAdmin } }, error: null })
const noAnalyze = (org: string) =>
  ({ data: { org_id: org, organizations: { features: {}, is_admin_org: false } }, error: null })
const adminOrg = (org: string | null, isAdmin = false) =>
  ({ data: { org_id: org, organizations: { is_admin_org: isAdmin } }, error: null })

beforeEach(reset)

// ── datasets/[datasetId] — GET / PATCH / DELETE ────────────────────────────
describe('datasets/[datasetId] — GET / PATCH / DELETE', () => {
  it('401 unauthenticated (all verbs)', async () => {
    expect((await dataset.GET(req('GET'), props)).status).toBe(401)
    expect((await dataset.PATCH(req('PATCH', { name: 'x' }), props)).status).toBe(401)
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(401)
  })

  it('401 when the org lacks the analyze feature', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = noAnalyze('orgA')
    expect((await dataset.PATCH(req('PATCH', { name: 'x' }), props)).status).toBe(401)
  })

  it('GET 404 + org-paired lookup when cross-org / missing', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA')
    ctx.results['datasets'] = { data: null, error: { message: 'no rows' } }
    expect((await dataset.GET(req('GET'), props)).status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })

  it('PATCH 403 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA', false)
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await dataset.PATCH(req('PATCH', { name: 'x' }), props)).status).toBe(403)
  })

  it('PATCH platform admin may edit a cross-org dataset', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['users'] = analyze('orgA', true)
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await dataset.PATCH(req('PATCH', { name: 'x' }), props)).status).not.toBe(403)
  })

  it('DELETE 404 when the dataset is missing', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(404)
  })

  it('DELETE 404 when a non-admin targets another org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA', false)
    ctx.results['datasets'] = { data: { org_id: 'orgB', created_by: 'u1', source: 'upload' }, error: null }
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(404)
  })

  it('DELETE 403 when a same-org caller is not the creator (normal dataset)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA', created_by: 'someone-else', source: 'upload' }, error: null }
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(403)
  })

  it('DELETE collection skips the creator-only gate (shared grouping)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = analyze('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA', created_by: 'someone-else', source: 'collection' }, error: null }
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(200)
  })

  // The reported bug: an admin-org user created a collection whose members live
  // in a client org, so the collection is in that org — delete must honor isAdmin
  // (symmetry with the create route), not silently 404.
  it('DELETE admin may delete a cross-org collection', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['users'] = analyze('orgA', true)
    ctx.results['datasets'] = { data: { org_id: 'orgB', created_by: 'u1', source: 'collection' }, error: null }
    expect((await dataset.DELETE(req('DELETE'), props)).status).toBe(200)
  })
})

// ── datasets/[datasetId]/state — GET / PUT / PATCH ─────────────────────────
describe('datasets/[datasetId]/state — GET / PUT / PATCH', () => {
  it('401 when caller has no org', async () => {
    ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
    expect((await state.GET(req('GET'), props)).status).toBe(401)
    expect((await state.PUT(req('PUT', {}), props)).status).toBe(401)
    expect((await state.PATCH(req('PATCH', {}), props)).status).toBe(401)
  })

  it('PUT 404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await state.PUT(req('PUT', { theme_model: {} }), props)).status).toBe(404)
  })

  it('PATCH 404 cross-org', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await state.PATCH(req('PATCH', { theme_model: {} }), props)).status).toBe(404)
  })

  it('PATCH 400 (no valid fields) when same-org but body has nothing allowed', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null }
    expect((await state.PATCH(req('PATCH', { hacker: 1 }), props)).status).toBe(400)
  })

  it('PATCH 200 when same-org with an allowed field', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null }
    expect((await state.PATCH(req('PATCH', { theme_model: { themes: [] } }), props)).status).toBe(200)
  })
})

// ── datasets/[datasetId]/trim — POST ───────────────────────────────────────
describe('datasets/[datasetId]/trim — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await trim.POST(req('POST', {}), props)).status).toBe(401)
  })

  it('403 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = { userId: 'u1', orgId: null, isAdmin: false }
    expect((await trim.POST(req('POST', {}), props)).status).toBe(403)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB', row_count: 5 }, error: null }
    expect((await trim.POST(req('POST', { date_field: 'd', before_date: '2020-01-01' }), props)).status).toBe(404)
  })
})

// ── datasets/[datasetId]/sync — POST (?full wipes + re-imports) ─────────────
describe('datasets/[datasetId]/sync — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await sync.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = adminOrg('orgA', false)
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'study', study_id: 's1' }, error: null }
    expect((await sync.POST(req('POST'), props)).status).toBe(404)
  })
})

// ── datasets/[datasetId]/refresh-schema — POST ─────────────────────────────
describe('datasets/[datasetId]/refresh-schema — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await refresh.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'study', name: 'D' }, error: null }
    expect((await refresh.POST(req('POST'), props)).status).toBe(404)
  })
})
