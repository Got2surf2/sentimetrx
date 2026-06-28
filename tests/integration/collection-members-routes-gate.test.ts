// tests/integration/collection-members-routes-gate.test.ts
//
// Org-scoping gate for POST /api/collections/[id]/members (add datasets to an
// existing collection). It inserts collection_members + recomputes schema/row
// count with the service-role client, so a missing org check would be a
// cross-tenant write. The handler must:
//   - 401 when the caller has no org
//   - 400 when the members array is empty
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
vi.mock('@/lib/collectionSchema', () => ({ buildMergedCollectionSchema: async () => ({ fields: [] }) }))

import * as members from '@/app/api/collections/[id]/members/route'

const props = { params: Promise.resolve({ id: 'd_collection' }) } as any
const req = (body: any = {}) =>
  new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }) as any
const validBody = { members: [{ dataset_id: 'd_new', label: 'New' }] }

beforeEach(reset)

describe('collections/[id]/members — POST', () => {
  it('401 when caller has no org', async () => {
    ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
    expect((await members.POST(req(validBody), props)).status).toBe(401)
  })

  it('400 when the members array is empty', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    expect((await members.POST(req({ members: [] }), props)).status).toBe(400)
  })

  it('404 cross-org (non-admin targeting another org’s collection)', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['collections'] = { data: { id: 'c1', dataset_id: 'd_collection', org_id: 'orgB' }, error: null }
    expect((await members.POST(req(validBody), props)).status).toBe(404)
  })

  it('404 when the collection does not exist', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['collections'] = { data: null, error: null }
    expect((await members.POST(req(validBody), props)).status).toBe(404)
  })
})
