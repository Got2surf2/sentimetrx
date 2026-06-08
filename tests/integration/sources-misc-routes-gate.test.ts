// tests/integration/sources-misc-routes-gate.test.ts
//
// Phase 1 — org-scoping / permission gates for the remaining "sources + misc
// tenant" routes:
//   - review-sources                         POST           (create — own org)
//   - review-sources/[sourceId]/locations    PATCH          (org-paired)
//   - review-sources/[sourceId]/user-locations POST         (org-paired + role)
//   - reddit-sources                         POST           (create — own org)
//   - social/auto-config                     PATCH          (own org features)
//   - social/export-dataset                  POST           (own org)
//   - collections                            POST           (create — own org)
//   - datasets                               POST           (create — own org)
//   - studies/[id]/analyze                   POST           (study org gate)
//   - studies/[id]/responses                 GET / DELETE   (RLS study gate)
//   - settings/team/disable                  PATCH          (same-org + owner)
//   - org/logo                               POST           (own org or admin)
//   - invite                                 POST           (owner of org)
//   - invite/[id]                            DELETE         (owner of invite org)
//   - invite/[id]/resend                     POST           (owner of invite org)
//   - favorites                              POST           (org-paired resource)
//   - share                                  POST           (gateShareTarget)
//
// All verified correctly gated — no fixes. Each validates the id/org_id taken
// from input against the caller's org (and role where required) before any
// service-role write.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  results: {} as Record<string, any>,
  usersById: {} as Record<string, any>,
}
function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.results = {}
  ctx.usersById = {}
}

function builder(table: string): any {
  let lastId: any
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'gt', 'gte', 'lte', 'or', 'like', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
  b.eq = (col: string, val: any) => { if (col === 'id') lastId = val; return b }
  b.single = async () => (table === 'users' && lastId != null && lastId in ctx.usersById) ? ctx.usersById[lastId] : (ctx.results[table] ?? { data: null, error: null })
  b.maybeSingle = b.single
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({
  from: (t: string) => builder(t),
  auth: { getUser: async () => ({ data: { user: ctx.authUser }, error: null }) },
  storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) },
  rpc: async () => ({ data: null, error: null }),
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: async () => ({ ok: true, allowed: true }) }))
vi.mock('@/lib/userEvents', () => ({ recordUserEvent: async () => {}, eventContextFromRequest: () => ({ ip: null, userAgent: null }) }))

import * as reviewSources from '@/app/api/review-sources/route'
import * as rsLocations from '@/app/api/review-sources/[sourceId]/locations/route'
import * as rsUserLocations from '@/app/api/review-sources/[sourceId]/user-locations/route'
import * as redditSources from '@/app/api/reddit-sources/route'
import * as autoConfig from '@/app/api/social/auto-config/route'
import * as exportDataset from '@/app/api/social/export-dataset/route'
import * as collections from '@/app/api/collections/route'
import * as datasets from '@/app/api/datasets/route'
import * as studyAnalyze from '@/app/api/studies/[id]/analyze/route'
import * as studyResponses from '@/app/api/studies/[id]/responses/route'
import * as teamDisable from '@/app/api/settings/team/disable/route'
import * as orgLogo from '@/app/api/org/logo/route'
import * as invite from '@/app/api/invite/route'
import * as inviteId from '@/app/api/invite/[id]/route'
import * as inviteResend from '@/app/api/invite/[id]/resend/route'
import * as favorites from '@/app/api/favorites/route'
import * as share from '@/app/api/share/route'

const req = (method = 'POST', body: any = {}, url = 'http://t/x') =>
  new Request(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any
const srcP = { params: Promise.resolve({ sourceId: 's_1' }) } as any
const idP = { params: Promise.resolve({ id: 'x_1' }) } as any

function authAs(orgId: string | null, opts: { role?: string; isAdmin?: boolean; analyze?: boolean } = {}) {
  const { role = 'owner', isAdmin = false, analyze = true } = opts
  ctx.authUser = { id: 'u1', email: 'u1@x' }
  ctx.results['users'] = { data: { org_id: orgId, role, organizations: { is_admin_org: isAdmin, features: { analyze } } }, error: null }
  ctx.callerCtx = { userId: 'u1', orgId, isAdmin }
}

beforeEach(reset)

// ── create routes — own org (401 / 403-no-org boundary) ────────────────────
describe('create routes — auth gate', () => {
  it('review-sources POST 401 unauthenticated', async () => {
    expect((await reviewSources.POST(req('POST', {}))).status).toBe(401)
  })
  it('reddit-sources POST 401 unauthenticated', async () => {
    expect((await redditSources.POST(req('POST', {}))).status).toBe(401)
  })
  it('collections POST 403 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }; ctx.callerCtx = { userId: 'u1', orgId: null, isAdmin: false }
    expect((await collections.POST(req('POST', {}))).status).toBe(403)
  })
  it('datasets POST 401/403 unauthenticated', async () => {
    expect([401, 403]).toContain((await datasets.POST(req('POST', {}))).status)
  })
  it('social/auto-config PATCH 401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }; ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await autoConfig.PATCH(req('PATCH', {}))).status).toBe(401)
  })
  it('social/export-dataset POST 401 when caller has no org', async () => {
    ctx.authUser = { id: 'u1' }; ctx.results['users'] = { data: { org_id: null }, error: null }
    expect((await exportDataset.POST(req('POST', {}))).status).toBe(401)
  })
})

// ── review-sources sub-routes — org-paired source ──────────────────────────
describe('review-sources/[sourceId] sub-routes', () => {
  it('locations PATCH 401 unauthenticated', async () => {
    expect((await rsLocations.PATCH(req('PATCH', {}), srcP)).status).toBe(401)
  })
  it('locations PATCH 404 cross-org (source not in caller org)', async () => {
    authAs('orgA')
    ctx.results['review_sources'] = { data: null, error: null }
    expect((await rsLocations.PATCH(req('PATCH', { locations: [] }), srcP)).status).toBe(404)
  })
  it('user-locations POST 403 when caller lacks owner/admin role', async () => {
    authAs('orgA', { role: 'member' })
    expect((await rsUserLocations.POST(req('POST', {}), srcP)).status).toBe(403)
  })
  it('user-locations POST 404 cross-org', async () => {
    authAs('orgA', { role: 'owner' })
    ctx.results['review_sources'] = { data: null, error: null }
    expect((await rsUserLocations.POST(req('POST', { locations: [] }), srcP)).status).toBe(404)
  })
})

// ── studies/[id] — analyze + responses ─────────────────────────────────────
describe('studies/[id] — analyze / responses', () => {
  it('analyze POST 401 unauthenticated', async () => {
    expect((await studyAnalyze.POST(req('POST'), idP)).status).toBe(401)
  })
  it('analyze POST 404 cross-org', async () => {
    authAs('orgA')
    ctx.results['studies'] = { data: { id: 'x_1', org_id: 'orgB', source: 'study' }, error: null }
    expect((await studyAnalyze.POST(req('POST'), idP)).status).toBe(404)
  })
  it('responses GET 401 unauthenticated', async () => {
    expect((await studyResponses.GET(req('GET'), idP)).status).toBe(401)
  })
  it('responses GET 404 when the study is not visible (RLS)', async () => {
    authAs('orgA')
    ctx.results['studies'] = { data: null, error: null }     // RLS hides cross-org study
    expect((await studyResponses.GET(req('GET'), idP)).status).toBe(404)
  })
  it('responses DELETE 404 when the study is not visible', async () => {
    authAs('orgA')
    ctx.results['studies'] = { data: null, error: null }
    expect((await studyResponses.DELETE(req('DELETE', { ids: ['r1'] }), idP)).status).toBe(404)
  })
})

// ── settings/team/disable — same-org + owner ───────────────────────────────
describe('settings/team/disable — PATCH', () => {
  it('401 unauthenticated', async () => {
    expect((await teamDisable.PATCH(req('PATCH', { user_id: 't', disabled: true }))).status).toBe(401)
  })
  it('403 when actor and target are in different orgs', async () => {
    ctx.authUser = { id: 'owner1' }
    ctx.usersById = {
      owner1: { data: { org_id: 'orgA', role: 'owner' }, error: null },
      tgt: { data: { org_id: 'orgB' }, error: null },
    }
    expect((await teamDisable.PATCH(req('PATCH', { user_id: 'tgt', disabled: true }))).status).toBe(403)
  })
  it('403 when same-org actor is not an owner', async () => {
    ctx.authUser = { id: 'mem1' }
    ctx.usersById = {
      mem1: { data: { org_id: 'orgA', role: 'member' }, error: null },
      tgt: { data: { org_id: 'orgA' }, error: null },
    }
    expect((await teamDisable.PATCH(req('PATCH', { user_id: 'tgt', disabled: true }))).status).toBe(403)
  })
})

// ── org/logo — own org or admin ────────────────────────────────────────────
describe('org/logo — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await orgLogo.POST(req('POST', {}))).status).toBe(401)
  })
  it('403 when targeting another org (non-admin, non-owner)', async () => {
    authAs('orgA', { isAdmin: false })
    const form = new FormData()
    form.set('file', new File(['x'], 'logo.png', { type: 'image/png' }))
    form.set('org_id', 'orgB')
    const r = await orgLogo.POST(new Request('http://t/x', { method: 'POST', body: form }) as any)
    expect(r.status).toBe(403)
  })
})

// ── invite routes — owner of the org ───────────────────────────────────────
describe('invite routes', () => {
  it('invite POST 401 unauthenticated', async () => {
    expect((await invite.POST(req('POST', { org_id: 'orgA', email: 'a@b.com' }))).status).toBe(401)
  })
  it('invite POST 403 when caller is not an owner of the target org', async () => {
    authAs('orgA', { role: 'member' })
    expect((await invite.POST(req('POST', { org_id: 'orgA', email: 'a@b.com', role: 'owner' }))).status).toBe(403)
  })
  it('invite POST 403 when targeting another org', async () => {
    authAs('orgA', { role: 'owner' })
    expect((await invite.POST(req('POST', { org_id: 'orgB', email: 'a@b.com', role: 'owner' }))).status).toBe(403)
  })
  it('invite/[id] DELETE 403 when not owner of the invite org', async () => {
    authAs('orgA', { role: 'member' })
    ctx.results['invites'] = { data: { id: 'x_1', org_id: 'orgA', used_at: null }, error: null }
    expect((await inviteId.DELETE(req('DELETE'), idP)).status).toBe(403)
  })
  it('invite/[id]/resend POST 403 when not owner of the invite org', async () => {
    authAs('orgA', { role: 'owner' })
    ctx.results['invites'] = { data: { id: 'x_1', token: 't', email: 'a@b.com', role: 'owner', org_id: 'orgB', expires_at: '2099-01-01T00:00:00Z', used_at: null }, error: null }
    expect((await inviteResend.POST(req('POST'), idP)).status).toBe(403)
  })
})

// ── favorites + share — org-paired resource ────────────────────────────────
describe('favorites / share', () => {
  it('favorites POST 401 unauthenticated', async () => {
    expect((await favorites.POST(req('POST', {}))).status).toBe(401)
  })
  it('favorites POST 404 when the resource is cross-org', async () => {
    authAs('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    const r = await favorites.POST(req('POST', { resource_type: 'dataset', resource_id: 'd1' }))
    expect([403, 404]).toContain(r.status)
  })
  it('share POST 403/404 when the target is cross-org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA', organizations: { is_admin_org: false } }, error: null }
    ctx.results['studies'] = { data: { org_id: 'orgB' }, error: null }   // gateShareTarget resolves study org
    const r = await share.POST(req('POST', { type: 'study', target_id: 't1' }))
    expect([401, 403, 404]).toContain(r.status)
  })
})
