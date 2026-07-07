// tests/integration/data-source-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the data-source mutation routes (paid /
// external pulls + connection deletes):
//   - review-sources/[sourceId]            DELETE / PATCH
//   - review-sources/[sourceId]/sync       POST
//   - reddit-sources/[sourceId]/sync       POST
//   - reddit-sources/[sourceId]/download-thread POST
//   - social/connections/[id]              DELETE
//
// All resolve the caller's org and pair the source/connection lookup with it.
// The mock records .eq() calls so the connection DELETE asserts the
// .eq('org_id', callerOrg) pairing is present (a no-op cross-org delete that
// silently dropped the org filter would be a leak).

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type QueryResult = { data: unknown; error: unknown }

interface MockBuilder {
  select(): MockBuilder
  order(): MockBuilder
  in(): MockBuilder
  limit(): MockBuilder
  neq(): MockBuilder
  update(): MockBuilder
  delete(): MockBuilder
  insert(): MockBuilder
  eq(col: string, val: unknown): MockBuilder
  single(): Promise<QueryResult>
  maybeSingle(): Promise<QueryResult>
  then(res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown): Promise<unknown>
}

const ctx = {
  authUser: null as { id: string } | null,
  results: {} as Record<string, QueryResult>,
  eqCalls: {} as Record<string, [string, unknown][]>,
}
function reset() { ctx.authUser = null; ctx.results = {}; ctx.eqCalls = {} }

function builder(table: string): MockBuilder {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b = {} as MockBuilder
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'update', 'delete', 'insert'] as const) b[m] = () => b
  b.eq = (col: string, val: unknown) => { ctx.eqCalls[table].push([col, val]); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/reviewSync', () => ({ syncReviewSource: async () => ({}) }))
vi.mock('@/lib/reddit', () => ({ fetchThreadComments: async () => [], commentToRow: () => ({}) }))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: async () => ({}) }))

import * as reviewSource from '@/app/api/review-sources/[sourceId]/route'
import * as reviewSync from '@/app/api/review-sources/[sourceId]/sync/route'
import * as redditSync from '@/app/api/reddit-sources/[sourceId]/sync/route'
import * as redditDownload from '@/app/api/reddit-sources/[sourceId]/download-thread/route'
import * as connection from '@/app/api/social/connections/[id]/route'

const srcProps = { params: Promise.resolve({ sourceId: 's_1' }) }
const idProps = { params: Promise.resolve({ id: 'c_1' }) }
const req = (method = 'POST', body: unknown = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as unknown as NextRequest

// users-row shapes
const orgOnly = (org: string) => ({ data: { org_id: org }, error: null })
const withAnalyze = (org: string) => ({ data: { org_id: org, organizations: { features: { analyze: true } } }, error: null })

beforeEach(reset)

describe('review-sources/[sourceId] — DELETE / PATCH (analyze-gated)', () => {
  it('401 unauthenticated', async () => {
    expect((await reviewSource.DELETE(req('DELETE'), srcProps)).status).toBe(401)
    expect((await reviewSource.PATCH(req('PATCH'), srcProps)).status).toBe(401)
  })

  it('403 when the org lacks the analyze feature', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA', organizations: { features: {} } }, error: null }
    expect((await reviewSource.DELETE(req('DELETE'), srcProps)).status).toBe(403)
  })

  it('404 cross-org (source resolved with id+org_id finds nothing)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAnalyze('orgA')
    ctx.results['review_sources'] = { data: null, error: null }
    expect((await reviewSource.DELETE(req('DELETE'), srcProps)).status).toBe(404)
    expect(ctx.eqCalls['review_sources']).toContainEqual(['org_id', 'orgA'])
  })
})

// The three POST pull routes share the same gate shape (org_id-only user row).
const pullRoutes = [
  { name: 'review-sources/sync', POST: reviewSync.POST, table: 'review_sources' },
  { name: 'reddit-sources/sync', POST: redditSync.POST, table: 'reddit_sources' },
  { name: 'reddit-sources/download-thread', POST: redditDownload.POST, table: 'reddit_sources' },
]

describe.each(pullRoutes)('$name — POST', ({ POST, table }) => {
  it('401 unauthenticated', async () => {
    expect((await POST(req(), srcProps)).status).toBe(401)
  })

  it('403 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await POST(req(), srcProps)).status).toBe(403)
  })

  it('404 + org-paired lookup when the source is cross-org / missing', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    ctx.results[table] = { data: null, error: null }
    expect((await POST(req(), srcProps)).status).toBe(404)
    expect(ctx.eqCalls[table]).toContainEqual(['org_id', 'orgA'])
  })
})

describe('social/connections/[id] — DELETE', () => {
  it('401 when the caller has no org', async () => {
    expect((await connection.DELETE(req('DELETE'), idProps)).status).toBe(401)
  })

  it('pairs the delete with the caller org (no cross-org delete)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    await connection.DELETE(req('DELETE'), idProps)
    expect(ctx.eqCalls['social_connections']).toContainEqual(['id', 'c_1'])
    expect(ctx.eqCalls['social_connections']).toContainEqual(['org_id', 'orgA'])
  })
})
