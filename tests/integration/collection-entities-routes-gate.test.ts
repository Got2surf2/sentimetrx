// tests/integration/collection-entities-routes-gate.test.ts
//
// Org-scoping gates for the brand-glossary editor routes (Phase 5). These mutate
// a brand collection's entity_catalog with the service-role client, so a missing
// org check would be a cross-tenant write. Each handler must:
//   - 401 when the caller has no org
//   - 404 when a non-admin targets a collection in another org
// (route-handler org filters aren't covered by the RLS/egress suites — CLAUDE.md.)

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,
}
function reset() {
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
}

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'not', 'update', 'delete', 'insert', 'eq']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t), rpc: async () => ({ data: null, error: null }) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => null,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))

import * as list from '@/app/api/collections/[id]/entities/route'
import * as one from '@/app/api/collections/[id]/entities/[entityId]/route'
import * as refresh from '@/app/api/collections/[id]/entities/refresh/route'

const listProps = { params: Promise.resolve({ id: 'c_1' }) } as any
const oneProps = { params: Promise.resolve({ id: 'c_1', entityId: 'e_1' }) } as any
const req = (method = 'POST', body: any = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any
const caller = (orgId: string | null, isAdmin = false) => ({ userId: orgId ? 'u1' : null, orgId, isAdmin })

beforeEach(reset)

describe('collections/[id]/entities — GET / POST', () => {
  it('401 when caller has no org', async () => {
    expect((await list.GET(req('GET'), listProps)).status).toBe(401)
    expect((await list.POST(req('POST', { canonical: 'X' }), listProps)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['collections'] = { data: { id: 'c_1', org_id: 'orgB', kind: 'brand' }, error: null }
    expect((await list.GET(req('GET'), listProps)).status).toBe(404)
    expect((await list.POST(req('POST', { canonical: 'X' }), listProps)).status).toBe(404)
  })
})

describe('collections/[id]/entities/[entityId] — PATCH / DELETE', () => {
  it('401 when caller has no org', async () => {
    expect((await one.PATCH(req('PATCH', { hidden: true }), oneProps)).status).toBe(401)
    expect((await one.DELETE(req('DELETE'), oneProps)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['collections'] = { data: { id: 'c_1', org_id: 'orgB' }, error: null }
    expect((await one.PATCH(req('PATCH', { hidden: true }), oneProps)).status).toBe(404)
    expect((await one.DELETE(req('DELETE'), oneProps)).status).toBe(404)
  })
})

describe('collections/[id]/entities/refresh — POST', () => {
  it('401 when caller has no org', async () => {
    expect((await refresh.POST(req('POST'), listProps)).status).toBe(401)
  })
  it('404 cross-org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['collections'] = { data: { id: 'c_1', org_id: 'orgB', slug: 'nowocats', kind: 'brand' }, error: null }
    expect((await refresh.POST(req('POST'), listProps)).status).toBe(404)
  })
})
