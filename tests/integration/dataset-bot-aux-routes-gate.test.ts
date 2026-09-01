// tests/integration/dataset-bot-aux-routes-gate.test.ts
//
// Org-scoping gates for the dataset/agent auxiliary routes that had NO route
// tests (W36 Tests progression — route-handler org filters are not covered by
// RLS tests, so each service-role read needs its own gate coverage):
//   - datasets/[id]/search          GET   (text search + AI expansion)
//   - datasets/[id]/filter-options  GET   (sql/194 cached options)
//   - datasets/[id]/taxonomy/rows   GET   (dimension drill-down rows)
//   - bots/[id]/crawl-job           POST  (KB crawl orchestration)
//   - bots/[id]/batches             GET/POST (question batches)
//   - bots/[id]/workbook            GET   (xlsx export)
//   - bots/[id]/probes              GET   (research probe readout)
//
// Same pattern as dataset-query-routes-gate.test.ts: assert only the security
// gate (401 / cross-org 404-or-403 / admin bypass) plus one cheap post-gate
// status that proves the gate was passed, with Supabase + heavy libs mocked.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

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
  then(res: (value: QueryResult) => unknown, rej: (reason: unknown) => unknown): Promise<unknown>
}

function builder(table: string): MockBuilder {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b = {} as MockBuilder
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'lt', 'gte', 'not', 'or', 'ilike', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
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
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '' }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: async () => {} }))
vi.mock('@/lib/auditLog', () => ({ logBotChange: async () => {} }))
vi.mock('@/lib/agentStudy', () => ({ runConcurrent: async () => [], getAgentStudy: async () => null }))
vi.mock('@/lib/agentDraft', () => ({ draftAnswerFromKB: async () => null }))
vi.mock('@/lib/agentExport', () => ({
  loadExportTurns: async () => [],
  turnsSheet: () => ({ name: 'Turns', rows: [] }),
  pairsSheet: () => ({ name: 'Pairs', rows: [] }),
  redactPII: (s: string) => s,
}))
vi.mock('@/lib/styledWorkbook', () => ({ buildStyledWorkbook: async () => Buffer.alloc(0) }))
vi.mock('@/lib/botKnowledge/ingest', () => ({ ingestKnowledgeText: async () => ({ chunks: 0 }) }))
vi.mock('@/lib/townHallAdapter', () => ({ fetchAllRows: async () => [] }))

import * as search from '@/app/api/datasets/[datasetId]/search/route'
import * as filterOptions from '@/app/api/datasets/[datasetId]/filter-options/route'
import * as taxonomyRows from '@/app/api/datasets/[datasetId]/taxonomy/rows/route'
import * as crawlJob from '@/app/api/bots/[id]/crawl-job/route'
import * as batches from '@/app/api/bots/[id]/batches/route'
import * as workbook from '@/app/api/bots/[id]/workbook/route'
import * as probes from '@/app/api/bots/[id]/probes/route'

const dsProps = { params: Promise.resolve({ datasetId: 'd_1' }) }
const botProps = { params: Promise.resolve({ id: 'b_1' }) }
const nreq = (url = 'http://t/x', method = 'GET', body?: unknown) =>
  new NextRequest(url, { method, body: body === undefined ? undefined : JSON.stringify(body) })

const caller = (orgId: string | null, isAdmin = false): CallerCtx => ({ userId: orgId ? 'u1' : null, orgId, isAdmin })
const sameOrgUser = { org_id: 'orgA', organizations: { is_admin_org: false } }
const adminUser = { org_id: 'orgZ', organizations: { is_admin_org: true } }

beforeEach(reset)

// ── datasets/[id]/search — GET ─────────────────────────────────────────────
describe('datasets/[datasetId]/search — GET', () => {
  it('401 unauthenticated', async () => {
    expect((await search.GET(nreq(), dsProps)).status).toBe(401)
  })

  it('404 when the dataset does not exist', async () => {
    ctx.callerCtx = caller('orgA')
    expect((await search.GET(nreq(), dsProps)).status).toBe(404)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'upload' }, error: null }
    expect((await search.GET(nreq(), dsProps)).status).toBe(404)
  })

  it('passes the gate same-org (400 for the missing q, not 404)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA', source: 'upload' }, error: null }
    expect((await search.GET(nreq(), dsProps)).status).toBe(400)
  })

  it('admin bypasses the org check (cross-org dataset reaches the 400)', async () => {
    ctx.callerCtx = caller('orgZ', true)
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'upload' }, error: null }
    expect((await search.GET(nreq(), dsProps)).status).toBe(400)
  })
})

// ── datasets/[id]/filter-options — GET ─────────────────────────────────────
describe('datasets/[datasetId]/filter-options — GET', () => {
  it('401 unauthenticated', async () => {
    expect((await filterOptions.GET(nreq(), dsProps)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB', last_synced_at: null }, error: null }
    expect((await filterOptions.GET(nreq(), dsProps)).status).toBe(404)
  })

  it('passes the gate same-org (404 "No schema" — a post-gate condition)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA', last_synced_at: null }, error: null }
    const res = await filterOptions.GET(nreq(), dsProps)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('No schema')
  })
})

// ── datasets/[id]/taxonomy/rows — GET ──────────────────────────────────────
describe('datasets/[datasetId]/taxonomy/rows — GET', () => {
  it('401 unauthenticated', async () => {
    expect((await taxonomyRows.GET(nreq(), dsProps)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await taxonomyRows.GET(nreq(), dsProps)).status).toBe(404)
  })

  it('passes the gate same-org (400 for the missing axis, not 404)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgA' }, error: null }
    expect((await taxonomyRows.GET(nreq(), dsProps)).status).toBe(400)
  })
})

// ── bots/[id]/crawl-job — POST ─────────────────────────────────────────────
describe('bots/[id]/crawl-job — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await crawlJob.POST(nreq('http://t/x', 'POST', {}), botProps)).status).toBe(401)
  })

  it('401 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await crawlJob.POST(nreq('http://t/x', 'POST', {}), botProps)).status).toBe(401)
  })

  it('404 cross-org for a non-admin (service-role agent read must stay org-paired)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await crawlJob.POST(nreq('http://t/x', 'POST', { action: 'start' }), botProps)).status).toBe(404)
  })

  it('passes the gate same-org (400 unknown action, not 404)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgA' }, error: null }
    expect((await crawlJob.POST(nreq('http://t/x', 'POST', { action: 'nope' }), botProps)).status).toBe(400)
  })
})

// ── bots/[id]/batches — GET / POST ─────────────────────────────────────────
describe('bots/[id]/batches — GET / POST', () => {
  it('401 unauthenticated', async () => {
    expect((await batches.GET(nreq(), botProps)).status).toBe(401)
    expect((await batches.POST(nreq('http://t/x', 'POST', {}), botProps)).status).toBe(401)
  })

  it('404 cross-org for a non-admin (both verbs)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB' }, error: null }
    expect((await batches.GET(nreq(), botProps)).status).toBe(404)
    expect((await batches.POST(nreq('http://t/x', 'POST', {}), botProps)).status).toBe(404)
  })

  it('404 when the agent does not exist', async () => {
    ctx.callerCtx = caller('orgA')
    expect((await batches.GET(nreq(), botProps)).status).toBe(404)
  })

  it('lists same-org batches with the service read paired to the agent org', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgA' }, error: null }
    const res = await batches.GET(nreq(), botProps)
    expect(res.status).toBe(200)
    // The question_batches service-role read must carry the org pair, not a bare bot_id
    expect(ctx.eqCalls['question_batches']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── bots/[id]/workbook — GET ───────────────────────────────────────────────
describe('bots/[id]/workbook — GET', () => {
  it('401 unauthenticated', async () => {
    expect((await workbook.GET(nreq(), botProps)).status).toBe(401)
  })

  it('403 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', name: 'Ana', org_id: 'orgB' }, error: null }
    expect((await workbook.GET(nreq(), botProps)).status).toBe(403)
  })

  it('admin bypasses the org check (reaches the no-conversations 404, not 403)', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = { data: adminUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', name: 'Ana', org_id: 'orgB' }, error: null }
    const res = await workbook.GET(nreq(), botProps)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('No conversations to export')
  })
})

// ── bots/[id]/probes — GET ─────────────────────────────────────────────────
describe('bots/[id]/probes — GET', () => {
  it('401 unauthenticated', async () => {
    expect((await probes.GET(nreq(), botProps)).status).toBe(401)
  })

  it('401 when the user has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await probes.GET(nreq(), botProps)).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB', name: 'Ana', research_probes: [] }, error: null }
    expect((await probes.GET(nreq(), botProps)).status).toBe(404)
  })

  it('200 same-org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: sameOrgUser, error: null }
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgA', name: 'Ana', research_probes: [] }, error: null }
    expect((await probes.GET(nreq(), botProps)).status).toBe(200)
  })
})
