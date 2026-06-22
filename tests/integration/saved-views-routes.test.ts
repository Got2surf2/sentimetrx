// tests/integration/saved-views-routes.test.ts
//
// Org-scoping gates + behavior for the saved-views routes:
//   datasets/[datasetId]/views          GET / POST
//   datasets/[datasetId]/views/[viewId] GET / PATCH / DELETE
//
// Mirrors dataset-mutation-routes-gate: each route resolves the caller's org,
// refuses a cross-org dataset before any service-role write, and pairs id+org_id
// on saved_views mutations. Also pins the saved-view contract: snapshot default
// TTL, snapshot content immutability, view/snapshot visibility, graceful 404.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,
  eqCalls: {} as Record<string, [string, any][]>,
  inserts: {} as Record<string, any>,
  updates: {} as Record<string, any>,
  deletes: {} as Record<string, boolean>,
}
function reset() {
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
  ctx.eqCalls = {}
  ctx.inserts = {}
  ctx.updates = {}
  ctx.deletes = {}
}

function builder(table: string): any {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'lt']) b[m] = () => b
  b.eq = (col: string, val: any) => { ctx.eqCalls[table].push([col, val]); return b }
  b.insert = (payload: any) => { ctx.inserts[table] = payload; return b }
  b.update = (payload: any) => { ctx.updates[table] = payload; return b }
  b.delete = () => { ctx.deletes[table] = true; return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => (ctx.callerCtx.userId ? { id: ctx.callerCtx.userId } : null),
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))

import * as list from '@/app/api/datasets/[datasetId]/views/route'
import * as one from '@/app/api/datasets/[datasetId]/views/[viewId]/route'

const listProps = { params: Promise.resolve({ datasetId: 'd_1' }) } as any
const oneProps = { params: Promise.resolve({ datasetId: 'd_1', viewId: 'v_1' }) } as any
const req = (method: string, body: any = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body) }) as any

const sameOrg = () => { ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }; ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null } }

beforeEach(reset)

describe('GET /views (list)', () => {
  it('401 when caller has no org', async () => {
    expect((await list.GET(req('GET'), listProps)).status).toBe(401)
  })
  it('404 when dataset belongs to another org (non-admin)', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await list.GET(req('GET'), listProps)).status).toBe(404)
  })
  it('200 same-org returns the visible rows', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: [{ id: 'v_1' }], error: null }
    const res = await list.GET(req('GET'), listProps)
    expect(res.status).toBe(200)
    expect((await res.json()).views).toEqual([{ id: 'v_1' }])
  })
})

describe('POST /views (create view / freeze snapshot)', () => {
  it('400 when name is missing', async () => {
    sameOrg()
    expect((await list.POST(req('POST', { kind: 'view' }), listProps)).status).toBe(400)
  })

  it('201 view: pairs dataset org_id + creator, defaults private', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_new' }, error: null }
    const res = await list.POST(req('POST', { name: 'Q2', filter_config: { filters: {} } }), listProps)
    expect(res.status).toBe(201)
    expect(ctx.inserts['saved_views']).toMatchObject({
      dataset_id: 'd_1', org_id: 'orgA', created_by: 'u1', kind: 'view', visibility: 'private',
    })
    expect(ctx.inserts['saved_views'].expires_at).toBeUndefined() // views never expire
  })

  it('201 view: visibility=org is honored', async () => {
    sameOrg()
    await list.POST(req('POST', { name: 'Shared', visibility: 'org' }), listProps)
    expect(ctx.inserts['saved_views'].visibility).toBe('org')
  })

  it('201 snapshot: applies the 30-day default retention clock', async () => {
    sameOrg()
    await list.POST(req('POST', { kind: 'snapshot', name: 'Frozen', frozen: { x: 1 } }), listProps)
    const row = ctx.inserts['saved_views']
    expect(row.kind).toBe('snapshot')
    expect(row.frozen).toEqual({ x: 1 })
    expect(typeof row.expires_at).toBe('string') // default TTL stamped
  })

  it('201 snapshot: expires_at:null = kept forever', async () => {
    sameOrg()
    await list.POST(req('POST', { kind: 'snapshot', name: 'Keep', expires_at: null }), listProps)
    expect(ctx.inserts['saved_views'].expires_at).toBeNull()
  })

  it('404 cross-org dataset', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await list.POST(req('POST', { name: 'x' }), listProps)).status).toBe(404)
  })
})

describe('GET /views/[viewId] (single — graceful 404)', () => {
  it('404 when the row is missing / not visible / deleted', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: null, error: null }
    expect((await one.GET(req('GET'), oneProps)).status).toBe(404)
  })
  it('200 when found', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'view' }, error: null }
    expect((await one.GET(req('GET'), oneProps)).status).toBe(200)
  })
})

describe('PATCH /views/[viewId]', () => {
  it('404 when the row does not exist', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: null, error: null }
    expect((await one.PATCH(req('PATCH', { name: 'x' }), oneProps)).status).toBe(404)
  })

  it('403 when a same-org caller is not the creator', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'view', created_by: 'someone-else' }, error: null }
    expect((await one.PATCH(req('PATCH', { name: 'x' }), oneProps)).status).toBe(403)
  })

  it('200 view rename, paired id+org_id on the update', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'view', created_by: 'u1' }, error: null }
    const res = await one.PATCH(req('PATCH', { name: ' Renamed ' }), oneProps)
    expect(res.status).toBe(200)
    expect(ctx.updates['saved_views']).toEqual({ name: 'Renamed' })
    expect(ctx.eqCalls['saved_views']).toContainEqual(['org_id', 'orgA'])
  })

  it('400 view with no valid fields', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'view', created_by: 'u1' }, error: null }
    expect((await one.PATCH(req('PATCH', { junk: 1 }), oneProps)).status).toBe(400)
  })

  it('400 snapshot: content edits are rejected (immutable)', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'snapshot', created_by: 'u1' }, error: null }
    expect((await one.PATCH(req('PATCH', { name: 'rename' }), oneProps)).status).toBe(400)
    expect((await one.PATCH(req('PATCH', { filter_config: {} }), oneProps)).status).toBe(400)
  })

  it('200 snapshot: keep (expires_at:null) is allowed', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'snapshot', created_by: 'u1' }, error: null }
    const res = await one.PATCH(req('PATCH', { expires_at: null }), oneProps)
    expect(res.status).toBe(200)
    expect(ctx.updates['saved_views']).toEqual({ expires_at: null })
  })

  it('400 snapshot: no expires_at provided = nothing to do', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', kind: 'snapshot', created_by: 'u1' }, error: null }
    expect((await one.PATCH(req('PATCH', {}), oneProps)).status).toBe(400)
  })
})

describe('DELETE /views/[viewId]', () => {
  it('404 when the row does not exist', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: null, error: null }
    expect((await one.DELETE(req('DELETE'), oneProps)).status).toBe(404)
  })
  it('403 when a same-org caller is not the creator', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', created_by: 'someone-else' }, error: null }
    expect((await one.DELETE(req('DELETE'), oneProps)).status).toBe(403)
  })
  it('200 creator delete, paired id+org_id', async () => {
    sameOrg()
    ctx.results['saved_views'] = { data: { id: 'v_1', created_by: 'u1' }, error: null }
    const res = await one.DELETE(req('DELETE'), oneProps)
    expect(res.status).toBe(200)
    expect(ctx.deletes['saved_views']).toBe(true)
    expect(ctx.eqCalls['saved_views']).toContainEqual(['org_id', 'orgA'])
  })
})
