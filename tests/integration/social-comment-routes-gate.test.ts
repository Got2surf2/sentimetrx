// tests/integration/social-comment-routes-gate.test.ts
//
// Phase 1 (mutating tenant routes) org-scoping gates for the social-comment
// action routes — delete / hide / reply / ai-reply / dm / bulk. These POST to
// external platforms (delete/hide a comment, send a reply or DM) on behalf of
// an org's connected social account, so a cross-org leak here lets one tenant
// act on another tenant's social presence.
//
// Beyond the usual 401/404 assertions, the mock RECORDS every .eq(col, val)
// call, so each test asserts the comment lookup is actually paired with
// .eq('org_id', callerOrg) — i.e. it catches a dropped org filter (the exact
// class behind every past CRITICAL finding), not just a simulated null result.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type QueryResult = { data: unknown; error: unknown }

const ctx = {
  authUser: null as { id: string } | null,
  results: {} as Record<string, QueryResult>,      // single()/then() result by table
  eqCalls: {} as Record<string, [string, unknown][]>, // recorded .eq(col, val) by table
}

function reset() {
  ctx.authUser = null
  ctx.results = {}
  ctx.eqCalls = {}
}

interface MockBuilder {
  select: () => MockBuilder
  order: () => MockBuilder
  in: () => MockBuilder
  limit: () => MockBuilder
  neq: () => MockBuilder
  update: () => MockBuilder
  delete: () => MockBuilder
  insert: () => MockBuilder
  eq: (col: string, val: unknown) => MockBuilder
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>
}

function builder(table: string): MockBuilder {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b = {} as unknown as MockBuilder
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'update', 'delete', 'insert'] as const) (b as unknown as Record<string, () => MockBuilder>)[m] = () => b
  b.eq = (col: string, val: unknown) => { ctx.eqCalls[table].push([col, val]); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res, rej) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: 'reply' }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: async () => {} }))

import * as del from '@/app/api/social/comments/[id]/delete/route'
import * as hide from '@/app/api/social/comments/[id]/hide/route'
import * as reply from '@/app/api/social/comments/[id]/reply/route'
import * as aiReply from '@/app/api/social/comments/[id]/ai-reply/route'
import * as dm from '@/app/api/social/comments/[id]/dm/route'
import * as bulk from '@/app/api/social/comments/bulk/route'

const idProps: { params: Promise<{ id: string }> } = { params: Promise.resolve({ id: 'cm_1' }) }
const post = (body: unknown = {}) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest

// Each entry: a label, the handler, and a request body valid enough to reach
// the comment lookup (some routes validate the body first).
const idRoutes = [
  { name: 'delete', POST: del.POST, body: {} },
  { name: 'hide', POST: hide.POST, body: {} },
  { name: 'reply', POST: reply.POST, body: { message: 'hi' } },
  { name: 'ai-reply', POST: aiReply.POST, body: {} },
  { name: 'dm', POST: dm.POST, body: { message: 'hi' } },
]

beforeEach(reset)

describe.each(idRoutes)('POST /api/social/comments/[id]/$name', ({ POST, body }) => {
  it('401 unauthenticated', async () => {
    expect((await POST(post(body), idProps)).status).toBe(401)
  })

  it('401 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await POST(post(body), idProps)).status).toBe(401)
  })

  it('404 + org-paired lookup when the comment is cross-org / missing', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA' }, error: null }
    ctx.results['social_comments'] = { data: null, error: null } // org-scoped query found nothing
    expect((await POST(post(body), idProps)).status).toBe(404)
    // The invariant: the lookup must be scoped by BOTH id and the caller's org.
    expect(ctx.eqCalls['social_comments']).toContainEqual(['id', 'cm_1'])
    expect(ctx.eqCalls['social_comments']).toContainEqual(['org_id', 'orgA'])
  })
})

describe('POST /api/social/comments/bulk', () => {
  it('401 unauthenticated', async () => {
    expect((await bulk.POST(post({ action: 'hide', commentIds: ['cm_1'] }))).status).toBe(401)
  })

  it('404 + org-paired query when no comments match in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA' }, error: null }
    // default then() result = empty array → "No matching comments"
    const res = await bulk.POST(post({ action: 'hide', commentIds: ['cm_1', 'cm_2'] }))
    expect(res.status).toBe(404)
    expect(ctx.eqCalls['social_comments']).toContainEqual(['org_id', 'orgA'])
  })

  it('400 on an invalid action', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA' }, error: null }
    expect((await bulk.POST(post({ action: 'nuke', commentIds: ['cm_1'] }))).status).toBe(400)
  })
})
