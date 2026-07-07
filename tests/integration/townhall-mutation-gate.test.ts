// tests/integration/townhall-mutation-gate.test.ts
//
// Phase 1 — regression tests for two cross-org write holes found + fixed
// 2026-06-08:
//   - POST /api/townhall/themes/[id]            (CRITICAL: moderate any org's
//     town-hall topics by id with no caller-org check)
//   - POST /api/townhall/sessions/[id]/duplicate (MEDIUM: duplicate any org's
//     session by id with no caller-org check)
//
// Both now gate to the owning org or a platform admin. These tests assert the
// secure contract: cross-org non-admin → 404, admin bypass allowed.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

type QueryResult = { data: unknown; error: unknown }

const ctx = {
  authUser: null as { id: string } | null,
  results: {} as Record<string, QueryResult>,
}
function reset() { ctx.authUser = null; ctx.results = {} }

const chainMethods = ['select', 'eq', 'order', 'in', 'limit', 'neq', 'update', 'delete', 'insert', 'not', 'lt', 'gt', 'gte', 'lte'] as const
type Chain = { [K in typeof chainMethods[number]]: () => Chain } & {
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej: (e: unknown) => unknown) => Promise<unknown>
}

function builder(table: string): Chain {
  const b = {} as Chain
  for (const m of chainMethods) b[m] = () => b
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

import * as themes from '@/app/api/townhall/themes/[id]/route'
import * as duplicate from '@/app/api/townhall/sessions/[id]/duplicate/route'
import * as round from '@/app/api/townhall/sessions/[id]/round/route'
import * as resume from '@/app/api/townhall/resume/[sessionId]/route'

const idProps = { params: Promise.resolve({ id: 'x_1' }) }
const post = (body: Record<string, unknown> = {}) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest

const nonAdmin = (org: string) => ({ data: { org_id: org, organizations: { is_admin_org: false } }, error: null })
const admin = { data: { org_id: 'orgZ', organizations: { is_admin_org: true } }, error: null }

beforeEach(reset)

describe('POST /api/townhall/themes/[id] — caller-org gate', () => {
  const approve = () => themes.POST(post({ action: 'approve' }), idProps)

  it('401 unauthenticated', async () => {
    expect((await approve()).status).toBe(401)
  })

  it('401 when the user has no org and is not an admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await approve()).status).toBe(401)
  })

  it('404 cross-org for a non-admin (new-substrate topic in another org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgB' }, error: null }
    expect((await approve()).status).toBe(404)
  })

  it('404 when the topic does not exist (legacy townhall_themes fallback retired in tranche 2)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_topics'] = { data: null, error: null }
    expect((await approve()).status).toBe(404)
  })

  it('allows the owning org (non-admin, same org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgA' }, error: null }
    expect((await approve()).status).toBe(200)
  })

  it('allows a platform admin to bypass the org check', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = admin
    ctx.results['pulseiq_topics'] = { data: { id: 'x_1', town_hall_id: 'th1', org_id: 'orgB' }, error: null }
    expect((await approve()).status).toBe(200)
  })
})

describe('POST /api/townhall/sessions/[id]/duplicate — caller-org gate', () => {
  const dup = () => duplicate.POST(post(), idProps)

  it('401 unauthenticated', async () => {
    expect((await dup()).status).toBe(401)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_sessions'] = { data: { name: 'S', cohort_config: {}, discussion_guide: null, org_id: 'orgB', bot_id: 'a0' }, error: null }
    expect((await dup()).status).toBe(404)
  })

  it('duplicates for the owning org (201)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_sessions'] = { data: { name: 'S', cohort_config: {}, discussion_guide: null, org_id: 'orgA', bot_id: 'a0' }, error: null }
    ctx.results['agents'] = { data: { id: 'a1' }, error: null }
    expect((await dup()).status).toBe(201)
  })

  it('allows a platform admin to bypass the org check (201)', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = admin
    ctx.results['pulseiq_sessions'] = { data: { name: 'S', cohort_config: {}, discussion_guide: null, org_id: 'orgB', bot_id: 'a0' }, error: null }
    ctx.results['agents'] = { data: { id: 'a1' }, error: null }
    expect((await dup()).status).toBe(201)
  })
})

// Round-based pacing: POST /api/townhall/sessions/[id]/round advances the room
// to round N. Same org-gate contract as the other mutating routes.
describe('POST /api/townhall/sessions/[id]/round — caller-org gate', () => {
  const start = (body: Record<string, unknown> = { round: 2 }) => round.POST(post(body), idProps)

  it('401 unauthenticated', async () => {
    expect((await start()).status).toBe(401)
  })

  it('401 when the user has no org and is not an admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null, organizations: { is_admin_org: false } }, error: null }
    expect((await start()).status).toBe(401)
  })

  it('400 on an invalid round number', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    expect((await start({ round: 0 })).status).toBe(400)
  })

  it('404 cross-org for a non-admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_sessions'] = { data: { org_id: 'orgB' }, error: null }
    expect((await start()).status).toBe(404)
  })

  it('advances for the owning org (200)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = nonAdmin('orgA')
    ctx.results['pulseiq_sessions'] = { data: { org_id: 'orgA' }, error: null }
    expect((await start()).status).toBe(200)
  })

  it('allows a platform admin to bypass the org check (200)', async () => {
    ctx.authUser = { id: 'admin' }
    ctx.results['users'] = admin
    ctx.results['pulseiq_sessions'] = { data: { org_id: 'orgB' }, error: null }
    expect((await start()).status).toBe(200)
  })
})

// Participant-facing resume probe (public, scoped by session+participant ids
// like /chat — no user-auth/org gate). Just assert the basic guard contract.
describe('POST /api/townhall/resume/[sessionId] — guards', () => {
  const sidProps = { params: Promise.resolve({ sessionId: 'sess1' }) }

  it('400 when participant_id is missing', async () => {
    const res = await resume.POST(post({}), sidProps)
    expect(res.status).toBe(400)
  })

  it('404 when the session does not exist', async () => {
    const res = await resume.POST(post({ participant_id: 'p1' }), sidProps)
    expect(res.status).toBe(404)
  })

  it('holds when the session is not live', async () => {
    ctx.results['pulseiq_sessions'] = { data: { id: 'sess1', org_id: 'orgA', bot_id: 'bot1', slug: 'sess1', status: 'paused', cohort_config: {} }, error: null }
    const res = await resume.POST(post({ participant_id: 'p1' }), sidProps)
    expect(res.status).toBe(200)
    expect((await res.json()).holding).toBe(true)
  })
})
