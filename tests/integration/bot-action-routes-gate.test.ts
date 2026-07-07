// tests/integration/bot-action-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the agent (bot) action + study routes not
// covered by bot-routes-gate.test.ts:
//   - bots                              POST          (create — own org)
//   - bots/import                       POST          (create — own org)
//   - bots/[id]/analyze                 POST          (sync conversations→dataset)
//   - bots/[id]/entities/extract        POST          (KB entity extraction)
//   - bots/[id]/entities/[entityId]     PATCH/DELETE  (edit / hard-delete entry)
//   - bots/[id]/questions/[questionId]  PATCH         (triage logged question)
//   - bots/[id]/conversations/[sessionId]/review POST (review decision)
//   - bots/[id]/study/pdf               POST          (Agent Study PDF)
//   - bots/[id]/study/pptx              POST          (Agent Study PPTX)
//   - ask-ana                           POST          (AI Q&A over a dataset)
//
// All verified correctly gated — no fixes. The [id] routes resolve the caller
// org and gate the agent's org_id before any service-role read/write; create
// routes write into the caller's own org; ask-ana gates the body datasetId.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type AuthUser = { id: string } | null
type CallerCtx = { userId: string | null; orgId: string | null; isAdmin: boolean }
type MockResult = { data: unknown; error: unknown }

const ctx = {
  authUser: null as AuthUser,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as CallerCtx,
  userContext: null as Record<string, unknown> | null,
  results: {} as Record<string, MockResult>,
}
function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.userContext = null
  ctx.results = {}
}

function builder(table: string) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit', 'neq', 'range', 'gt', 'lte', 'like', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: (v: MockResult) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/userContext', () => ({ getUserContext: async () => ctx.userContext }))
vi.mock('@/lib/userEvents', () => ({ recordUserEvent: async () => {}, eventContextFromRequest: () => ({ ip: null, userAgent: null }) }))
vi.mock('@/lib/botEntityExtraction', () => ({ extractBotEntities: async () => ({ added: 0, total: 0, costCents: 0, durationMs: 0 }) }))
vi.mock('@/lib/entityMentionDetector', () => ({ invalidateEntityCache: () => {} }))
vi.mock('@/lib/agentStudy', () => ({ getAgentStudy: async () => null }))
vi.mock('@/lib/agentStudyHtml', () => ({ renderAgentStudyHtml: () => '<html></html>' }))
vi.mock('@/lib/pptx/agentStudyDeck', () => ({ buildStudyDeck: () => ({}) }))
vi.mock('@/lib/pptx/slideRenderer', () => ({ renderDeck: async () => Buffer.from('') }))
vi.mock('@/lib/entityFilter', () => ({ getEntitiesWithCounts: async () => ({ entities: [] }) }))

import * as botsList from '@/app/api/bots/route'
import * as botsImport from '@/app/api/bots/import/route'
import * as analyze from '@/app/api/bots/[id]/analyze/route'
import * as entityExtract from '@/app/api/bots/[id]/entities/extract/route'
import * as entityRow from '@/app/api/bots/[id]/entities/[entityId]/route'
import * as question from '@/app/api/bots/[id]/questions/[questionId]/route'
import * as review from '@/app/api/bots/[id]/conversations/[sessionId]/review/route'
import * as studyPdf from '@/app/api/bots/[id]/study/pdf/route'
import * as studyPptx from '@/app/api/bots/[id]/study/pptx/route'
import * as askAna from '@/app/api/ask-ana/route'

const idProps = { params: Promise.resolve({ id: 'b_1' }) }
const entityProps = { params: Promise.resolve({ id: 'b_1', entityId: 'e_1' }) }
const questionProps = { params: Promise.resolve({ id: 'b_1', questionId: 'q_1' }) }
const reviewProps = { params: Promise.resolve({ id: 'b_1', sessionId: 's_1' }) }
const req = (method = 'POST', body: unknown = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as unknown as NextRequest

const caller = (orgId: string | null, isAdmin = false) => ({ userId: orgId ? 'u1' : null, orgId, isAdmin })

beforeEach(reset)

// ── create routes — own org ────────────────────────────────────────────────
describe('bots — POST (create) / import', () => {
  it('bots POST 401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }            // bots/route uses a local getUserContext (getAuthUser + users)
    ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await botsList.POST(req('POST', { name: 'A' }))).status).toBe(401)
  })

  it('a caller with an org is allowed past the auth gate (own-org create)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA', organizations: { is_admin_org: false } }, error: null }
    ctx.results['agents'] = { data: { id: 'b_new' }, error: null }
    // 400 (body validation) is acceptable — the point is it's NOT a 401 auth reject.
    expect((await botsList.POST(req('POST', { name: 'A' }))).status).not.toBe(401)
  })

  it('bots/import 401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await botsImport.POST(req('POST', { bot: { name: 'A' } }))).status).toBe(401)
  })
})

// ── [id] action routes — gate on the agent's org ───────────────────────────
const idRoutes: { name: string; call: (r: unknown) => Promise<Response>; method?: string }[] = [
  { name: 'analyze POST', call: () => analyze.POST(req('POST'), idProps) },
  { name: 'entities/extract POST', call: () => entityExtract.POST(req('POST'), idProps) },
  { name: 'entities/[entityId] PATCH', call: () => entityRow.PATCH(req('PATCH', { hidden: true }), entityProps) },
  { name: 'entities/[entityId] DELETE', call: () => entityRow.DELETE(req('DELETE'), entityProps) },
  { name: 'questions/[questionId] PATCH', call: () => question.PATCH(req('PATCH', { status: 'answered' }), questionProps) },
  { name: 'conversations/[sessionId]/review POST', call: () => review.POST(req('POST', { action: 'approve' }), reviewProps) },
  { name: 'study/pdf POST', call: () => studyPdf.POST(req('POST'), idProps) },
  { name: 'study/pptx POST', call: () => studyPptx.POST(req('POST'), idProps) },
]

describe.each(idRoutes)('bots/[id] $name', ({ call }) => {
  it('401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }            // analyze also calls getAuthUser
    ctx.callerCtx = caller(null)
    expect((await call(null)).status).toBe(401)
  })

  it('404 when the bot belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['agents'] = { data: { id: 'b_1', org_id: 'orgB', name: 'B' }, error: null }
    expect((await call(null)).status).toBe(404)
  })
})

// ── ask-ana — gate on the body datasetId ───────────────────────────────────
describe('ask-ana — POST', () => {
  it('401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller(null)
    expect((await askAna.POST(req('POST', { datasetId: 'd_1', question: 'q' }))).status).toBe(401)
  })

  it('403 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { id: 'd_1', name: 'D', source: 'survey', row_count: 1, org_id: 'orgB' }, error: null }
    expect((await askAna.POST(req('POST', { datasetId: 'd_1', question: 'q' }))).status).toBe(403)
  })
})
