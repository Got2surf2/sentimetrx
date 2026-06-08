// tests/integration/core-entity-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the core-entity mutation routes:
//   - studies/[id]                 PATCH / DELETE  (per-user created_by gate)
//   - collections/[id]             GET / DELETE     (org-paired dataset lookup)
//   - campaigns/[id]/clone         POST             (org gate + admin bypass)
//   - campaigns/[id]/respondents   GET / POST / DELETE (org gate)
//   - settings/team                PATCH / DELETE   (same-org + owner role)
//   - townhall/sessions            POST             (creates in caller's org)
//   - townhall/themes/custom       POST             (REGRESSION for the cross-org
//        write hole fixed 2026-06-08 — was a bare-id insert into any org's hall)
//
// studies/[id] is intentionally gated on per-user `created_by` (only the
// creator or a platform admin may edit/delete), confirmed with the owner — so
// its tests assert the created_by contract, not org scoping.
//
// The mock records .eq() calls so org-paired lookups assert the
// .eq('org_id', callerOrg) pairing is present (a dropped org filter that
// silently no-ops is a leak), and records .insert() payloads so create routes
// assert the row lands in the caller's org.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  results: {} as Record<string, any>,
  usersById: {} as Record<string, any>,
  eqCalls: {} as Record<string, [string, any][]>,
  insertCalls: {} as Record<string, any[]>,
}
function reset() {
  ctx.authUser = null
  ctx.results = {}
  ctx.usersById = {}
  ctx.eqCalls = {}
  ctx.insertCalls = {}
}

function builder(table: string): any {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  ctx.insertCalls[table] = ctx.insertCalls[table] || []
  let lastId: any = undefined
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'update', 'delete']) b[m] = () => b
  b.eq = (col: string, val: any) => { ctx.eqCalls[table].push([col, val]); if (col === 'id') lastId = val; return b }
  b.insert = (payload: any) => { ctx.insertCalls[table].push(payload); return b }
  b.single = async () => {
    if (table === 'users' && lastId !== undefined && (lastId in ctx.usersById)) return ctx.usersById[lastId]
    return ctx.results[table] ?? { data: null, error: null }
  }
  b.maybeSingle = async () => {
    if (table === 'users' && lastId !== undefined && (lastId in ctx.usersById)) return ctx.usersById[lastId]
    return ctx.results[table] ?? { data: null, error: null }
  }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/orgTransfer', () => ({
  checkTransferTarget: async () => ({ ok: true }),
  recordOrgTransfer: async () => {},
}))
vi.mock('@/lib/userEvents', () => ({
  recordUserEvent: async () => {},
  eventContextFromRequest: () => ({ ip: null, userAgent: null }),
}))
vi.mock('@/lib/orgValidate', () => ({ validateOrgFilter: (v: any) => v }))
vi.mock('@/lib/townHallAdapter', () => ({ listTownHallsAsLegacy: async () => [] }))

import * as study from '@/app/api/studies/[id]/route'
import * as collection from '@/app/api/collections/[id]/route'
import * as clone from '@/app/api/campaigns/[id]/clone/route'
import * as respondents from '@/app/api/campaigns/[id]/respondents/route'
import * as team from '@/app/api/settings/team/route'
import * as sessions from '@/app/api/townhall/sessions/route'
import * as customTheme from '@/app/api/townhall/themes/custom/route'

const studyProps = { params: Promise.resolve({ id: 'st_1' }) } as any
const dsProps = { params: Promise.resolve({ id: 'ds_1' }) } as any
const campProps = { params: Promise.resolve({ id: 'c_1' }) } as any

const req = (method = 'POST', body: any = {}, url = 'http://t/x') =>
  new Request(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any

const withAdmin = (org: string | null, isAdmin = false) =>
  ({ data: { org_id: org, organizations: { is_admin_org: isAdmin } }, error: null })

beforeEach(reset)

// ── studies/[id] — per-user created_by gate (NOT org) ──────────────────────
describe('studies/[id] — PATCH / DELETE (per-user created_by)', () => {
  it('401 unauthenticated', async () => {
    expect((await study.PATCH(req('PATCH', { name: 'x' }), studyProps)).status).toBe(401)
    expect((await study.DELETE(req('DELETE'), studyProps)).status).toBe(401)
  })

  it('403 PATCH when caller is not the creator and not admin', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['studies'] = { data: { status: 'active', created_by: 'someone-else' }, error: null }
    expect((await study.PATCH(req('PATCH', { name: 'x' }), studyProps)).status).toBe(403)
  })

  it('403 DELETE when caller is not the creator and not admin', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['studies'] = { data: { id: 'st_1', name: 'S', created_by: 'someone-else', status: 'active' }, error: null }
    ctx.results['users'] = withAdmin('orgA', false)
    expect((await study.DELETE(req('DELETE'), studyProps)).status).toBe(403)
  })

  it('creator may DELETE their own study', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['studies'] = { data: { id: 'st_1', name: 'S', created_by: 'u1', status: 'active' }, error: null }
    ctx.results['users'] = withAdmin('orgA', false)
    expect((await study.DELETE(req('DELETE'), studyProps)).status).toBe(200)
  })

  it('platform admin may PATCH a study they did not create', async () => {
    ctx.authUser = { id: 'u1', email: 'u1@x' }
    ctx.results['users'] = withAdmin('orgA', true)
    ctx.results['studies'] = {
      data: { id: 'st_1', guid: 'g', slug: null, status: 'active', visibility: 'public', org_id: 'orgB', created_by: 'other' },
      error: null,
    }
    expect((await study.PATCH(req('PATCH', { name: 'x' }), studyProps)).status).not.toBe(403)
  })
})

// ── collections/[id] — org-paired dataset lookup ───────────────────────────
describe('collections/[id] — GET / DELETE (org-paired)', () => {
  it('401 unauthenticated', async () => {
    expect((await collection.GET(req('GET'), dsProps)).status).toBe(401)
  })

  it('403 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await collection.GET(req('GET'), dsProps)).status).toBe(403)
  })

  it('404 + org-paired lookup when the collection is cross-org / missing (GET)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA' }, error: null }
    ctx.results['collections'] = { data: null, error: null }
    expect((await collection.GET(req('GET'), dsProps)).status).toBe(404)
    expect(ctx.eqCalls['collections']).toContainEqual(['dataset_id', 'ds_1'])
    expect(ctx.eqCalls['collections']).toContainEqual(['org_id', 'orgA'])
  })

  it('404 + org-paired lookup when the collection is cross-org / missing (DELETE)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA' }, error: null }
    ctx.results['collections'] = { data: null, error: null }
    const r = await collection.DELETE(req('DELETE', {}, 'http://t/x?member=ds_2'), dsProps)
    expect(r.status).toBe(404)
    expect(ctx.eqCalls['collections']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── campaigns/[id]/clone — org gate + admin bypass ─────────────────────────
describe('campaigns/[id]/clone — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await clone.POST(req('POST'), campProps)).status).toBe(401)
  })

  it('401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin(null, false)
    expect((await clone.POST(req('POST'), campProps)).status).toBe(401)
  })

  it('404 when the campaign belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['campaigns'] = { data: { id: 'c_1', org_id: 'orgB', name: 'C' }, error: null }
    expect((await clone.POST(req('POST'), campProps)).status).toBe(404)
  })

  it('platform admin may clone a cross-org campaign (clone stays in source org)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', true)
    ctx.results['campaigns'] = { data: { id: 'c_1', org_id: 'orgB', name: 'C' }, error: null }
    const r = await clone.POST(req('POST'), campProps)
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['campaigns'][0].org_id).toBe('orgB')
  })
})

// ── campaigns/[id]/respondents — org gate ──────────────────────────────────
describe('campaigns/[id]/respondents — GET / POST / DELETE', () => {
  it('401 unauthenticated (all verbs)', async () => {
    expect((await respondents.GET(req('GET'), campProps)).status).toBe(401)
    expect((await respondents.POST(req('POST', { respondents: [] }), campProps)).status).toBe(401)
    expect((await respondents.DELETE(req('DELETE', { respondent_ids: ['r1'] }), campProps)).status).toBe(401)
  })

  it('404 cross-org on GET', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['campaigns'] = { data: { org_id: 'orgB' }, error: null }
    expect((await respondents.GET(req('GET'), campProps)).status).toBe(404)
  })

  it('404 cross-org on POST', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['campaigns'] = { data: { id: 'c_1', org_id: 'orgB' }, error: null }
    expect((await respondents.POST(req('POST', { respondents: [{ email: 'a@b.com' }] }), campProps)).status).toBe(404)
  })

  it('404 cross-org on DELETE', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['campaigns'] = { data: { org_id: 'orgB' }, error: null }
    expect((await respondents.DELETE(req('DELETE', { respondent_ids: ['r1'] }), campProps)).status).toBe(404)
  })
})

// ── settings/team — same-org + owner role ──────────────────────────────────
describe('settings/team — PATCH / DELETE', () => {
  it('401 unauthenticated', async () => {
    expect((await team.PATCH(req('PATCH', { user_id: 't', role: 'admin' }))).status).toBe(401)
    expect((await team.DELETE(req('DELETE', { user_id: 't' }))).status).toBe(401)
  })

  it('403 PATCH when actor and target are in different orgs', async () => {
    ctx.authUser = { id: 'owner1' }
    ctx.usersById = {
      owner1: { data: { org_id: 'orgA', role: 'owner' }, error: null },
      tgt: { data: { org_id: 'orgB' }, error: null },
    }
    expect((await team.PATCH(req('PATCH', { user_id: 'tgt', role: 'admin' }))).status).toBe(403)
  })

  it('403 PATCH when same-org actor is not an owner', async () => {
    ctx.authUser = { id: 'mem1' }
    ctx.usersById = {
      mem1: { data: { org_id: 'orgA', role: 'member' }, error: null },
      tgt: { data: { org_id: 'orgA' }, error: null },
    }
    expect((await team.PATCH(req('PATCH', { user_id: 'tgt', role: 'admin' }))).status).toBe(403)
  })

  it('owner may change a same-org member role', async () => {
    ctx.authUser = { id: 'owner1' }
    ctx.usersById = {
      owner1: { data: { org_id: 'orgA', role: 'owner' }, error: null },
      tgt: { data: { org_id: 'orgA' }, error: null },
    }
    expect((await team.PATCH(req('PATCH', { user_id: 'tgt', role: 'admin' }))).status).toBe(200)
  })

  it('403 DELETE across orgs', async () => {
    ctx.authUser = { id: 'owner1' }
    ctx.usersById = {
      owner1: { data: { org_id: 'orgA', role: 'owner' }, error: null },
      tgt: { data: { org_id: 'orgB' }, error: null },
    }
    expect((await team.DELETE(req('DELETE', { user_id: 'tgt' }))).status).toBe(403)
  })
})

// ── townhall/sessions — POST creates in caller's own org ───────────────────
describe('townhall/sessions — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await sessions.POST(req('POST'))).status).toBe(401)
  })

  it('creates the session in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA', client_id: null }, error: null }
    ctx.results['townhall_sessions'] = { data: { id: 's1', slug: null }, error: null }
    const body = { name: 'Q3 Town Hall', config: {}, discussion_guide: [] }
    const r = await sessions.POST(req('POST', body))
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['townhall_sessions'][0].org_id).toBe('orgA')
    expect(ctx.insertCalls['townhall_sessions'][0].created_by).toBe('u1')
  })
})

// ── townhall/themes/custom — REGRESSION: cross-org write hole (2026-06-08) ──
describe('townhall/themes/custom — POST (cross-org write fix)', () => {
  it('401 unauthenticated', async () => {
    expect((await customTheme.POST(req('POST', { session_id: 'h1', label: 'L', question: 'Q' }))).status).toBe(401)
  })

  it('401 when caller has no org and is not admin', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin(null, false)
    expect((await customTheme.POST(req('POST', { session_id: 'h1', label: 'L', question: 'Q' }))).status).toBe(401)
  })

  it('404 when the town_halls hall belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['town_halls'] = { data: { id: 'h1', org_id: 'orgB' }, error: null }
    expect((await customTheme.POST(req('POST', { session_id: 'h1', label: 'L', question: 'Q' }))).status).toBe(404)
  })

  it('404 when the legacy session belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['town_halls'] = { data: null, error: null }
    ctx.results['townhall_sessions'] = { data: { org_id: 'orgB' }, error: null }
    expect((await customTheme.POST(req('POST', { session_id: 's1', label: 'L', question: 'Q' }))).status).toBe(404)
  })

  it('owning-org caller may push a custom topic (new substrate)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['town_halls'] = { data: { id: 'h1', org_id: 'orgA' }, error: null }
    ctx.results['town_hall_topics'] = { data: { id: 't1' }, error: null }
    const r = await customTheme.POST(req('POST', { session_id: 'h1', label: 'L', question: 'Q' }))
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['town_hall_topics'][0].org_id).toBe('orgA')
  })

  it('platform admin may push into another org (bypass)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', true)
    ctx.results['town_halls'] = { data: { id: 'h1', org_id: 'orgB' }, error: null }
    ctx.results['town_hall_topics'] = { data: { id: 't1' }, error: null }
    expect((await customTheme.POST(req('POST', { session_id: 'h1', label: 'L', question: 'Q' }))).status).toBe(201)
  })
})
