// tests/integration/bot-routes-gate.test.ts
//
// Org-scoping gate coverage for the agent (bot) API routes. Every one fetches
// the agent row with the SERVICE-ROLE client by `id` and must then pair it with
// the caller's org (per the CLAUDE.md multi-tenancy invariant — a bare id
// lookup is a cross-tenant leak). We assert only the security gate: 401 with no
// auth/org, 404-or-403 cross-org for non-admins, and admin bypass. The Supabase
// boundary, getCallerOrgContext, and heavy AI libs are mocked.
//
// Two auth shapes are exercised:
//   A. getCallerOrgContext()  → entities, questions
//   B. getAuthUser() + users  → bots/[id], conversations, knowledge

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,   // single()/maybeSingle() result by table
}

function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
}

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'limit', 'neq', 'update', 'delete', 'insert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: ctx.authUser } }) },
    from: (t: string) => builder(t),
  }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))

vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))

// Heavy libs imported at module load by knowledge/conversations — no-op them so
// importing the route never spins up an AI/embeddings client.
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '' }) }))
vi.mock('@/lib/embeddings', () => ({ generateEmbeddings: async () => [] }))
vi.mock('@/lib/usageLog', () => ({ logUsage: async () => {} }))
vi.mock('@/lib/auditLog', () => ({ logBotChange: async () => {} }))

import * as botMain from '@/app/api/bots/[id]/route'
import * as botEntities from '@/app/api/bots/[id]/entities/route'
import * as botQuestions from '@/app/api/bots/[id]/questions/route'
import * as botConversations from '@/app/api/bots/[id]/conversations/route'
import * as botKnowledge from '@/app/api/bots/[id]/knowledge/route'

const props = { params: Promise.resolve({ id: 'b_1' }) } as any
const reqGet = () => new Request('http://t/x') as any
const reqPost = () => new Request('http://t/x', { method: 'POST', body: '{}' }) as any

const sameOrgUser = { org_id: 'orgA', organizations: { is_admin_org: false } }
const adminUser = { org_id: 'orgZ', organizations: { is_admin_org: true } }

beforeEach(reset)

describe('bots/[id] — GET/PATCH/DELETE (getAuthUser + users)', () => {
  it('401 unauthenticated', async () => {
    expect((await botMain.GET(reqGet(), props)).status).toBe(401)
    expect((await botMain.PATCH(reqPost(), props)).status).toBe(401)
    expect((await botMain.DELETE(reqGet(), props)).status).toBe(401)
  })

  it('401 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await botMain.GET(reqGet(), props)).status).toBe(401)
  })

  it('404 cross-org for a non-admin (agent in another org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botMain.GET(reqGet(), props)).status).toBe(404)
  })

  it('404 cross-org PATCH for a non-admin (guards the snapshot read, no spurious success/audit)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botMain.PATCH(reqPost(), props)).status).toBe(404)
  })

  it('404 cross-org DELETE for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botMain.DELETE(reqGet(), props)).status).toBe(404)
  })

  it('admin bypasses the org check (cross-org agent still resolves)', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = { data: adminUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botMain.GET(reqGet(), props)).status).toBe(200)
  })
})

describe('bots/[id]/entities — GET/POST (getCallerOrgContext)', () => {
  it('401 unauthenticated', async () => {
    expect((await botEntities.GET(reqGet(), props)).status).toBe(401)
    expect((await botEntities.POST(reqPost(), props)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botEntities.GET(reqGet(), props)).status).toBe(404)
  })

  it('404 when the agent does not exist', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['agents'] = { data: null, error: null }
    expect((await botEntities.GET(reqGet(), props)).status).toBe(404)
  })
})

describe('bots/[id]/questions — GET (getCallerOrgContext)', () => {
  it('401 unauthenticated', async () => {
    expect((await botQuestions.GET(reqGet(), props)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.callerCtx = { userId: 'u1', orgId: 'orgA', isAdmin: false }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botQuestions.GET(reqGet(), props)).status).toBe(404)
  })
})

describe('bots/[id]/conversations — GET (getAuthUser + users)', () => {
  it('401 unauthenticated', async () => {
    expect((await botConversations.GET(reqGet(), props)).status).toBe(401)
  })

  it('403 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB', config: {} }, error: null }
    expect((await botConversations.GET(reqGet(), props)).status).toBe(403)
  })
})

describe('bots/[id]/knowledge — GET (getAuthUser + users)', () => {
  it('401 unauthenticated', async () => {
    expect((await botKnowledge.GET(reqGet(), props)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await botKnowledge.GET(reqGet(), props)).status).toBe(404)
  })
})
