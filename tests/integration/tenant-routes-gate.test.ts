// tests/integration/tenant-routes-gate.test.ts
//
// Gate coverage for a batch of tenant-scoped routes beyond recordings/exports:
// campaign send, social comment handle, dataset rows. Each must reject
// unauthenticated callers and 404 cross-org access. Supabase boundary +
// getCallerOrgContext + heavy libs mocked; we assert the security gate only.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  userRow: null as any,       // createClient users lookup (org_id + organizations)
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any, // getCallerOrgContext
  results: {} as Record<string, any>,   // service/session single() results by table
}

function reset() {
  ctx.authUser = null
  ctx.userRow = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
}

function builder(table: string): any {
  const b: any = {}
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'limit', 'neq']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: ctx.authUser } }) },
    from: (t: string) => {
      if (t === 'users') { const b = builder('users'); b.single = async () => ({ data: ctx.userRow, error: null }); return b }
      return builder(t)
    },
  }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))

vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/email/provider', () => ({
  getEmailProvider: () => ({}), getSMSProvider: () => ({}),
  interpolateTemplate: (s: string) => s, buildSurveyUrl: () => '#', buildSMSBody: () => '',
}))

import * as campaignSend from '@/app/api/campaigns/[id]/send/route'
import * as commentHandle from '@/app/api/social/comments/[id]/handle/route'
import * as datasetRows from '@/app/api/datasets/[datasetId]/route'

const post = () => new Request('http://t/x', { method: 'POST', body: '{}' })

beforeEach(reset)

describe('POST /api/campaigns/[id]/send', () => {
  const p = { params: { id: 'c_1' } } as any
  it('401 unauthenticated', async () => {
    expect((await campaignSend.POST(post() as any, p)).status).toBe(401)
  })
  it('401 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }; ctx.userRow = { org_id: null, organizations: { is_admin_org: false } }
    expect((await campaignSend.POST(post() as any, p)).status).toBe(401)
  })
  it('404 cross-org (campaign in another org)', async () => {
    ctx.authUser = { id: 'u1' }; ctx.userRow = { org_id: 'orgA', organizations: { is_admin_org: false } }
    ctx.results['campaigns'] = { data: { id: 'c_1', org_id: 'orgB', status: 'draft', studies: {} }, error: null }
    expect((await campaignSend.POST(post() as any, p)).status).toBe(404)
  })
})

describe('POST /api/social/comments/[id]/handle', () => {
  const p = { params: { id: 'cm_1' } } as any
  it('401 when unauthenticated / no org', async () => {
    expect((await commentHandle.POST(post() as any, p)).status).toBe(401)
  })
  it('404 when the comment is missing or cross-org', async () => {
    ctx.authUser = { id: 'u1' }; ctx.userRow = { org_id: 'orgA' }
    ctx.results['social_comments'] = { data: null, error: null }  // org-scoped query found nothing
    expect((await commentHandle.POST(post() as any, p)).status).toBe(404)
  })
})

describe('GET /api/datasets/[datasetId] (PATCH-guard sibling — GET path)', () => {
  // The GET handler resolves org via getOrgAndCheck and pairs id+org_id.
  const p = { params: { datasetId: 'ds_1' } } as any
  const get = () => datasetRows.GET(new Request('http://t/x') as any, p)
  it('401 when caller has no org', async () => {
    ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
    expect((await get()).status).toBe(401)
  })
})
