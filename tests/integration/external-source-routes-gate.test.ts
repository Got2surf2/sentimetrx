// tests/integration/external-source-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the external-ingest source routes + the
// social alert/DM-template rule routes:
//   - substack-sources                    POST  (create dataset in caller org)
//   - substack-sources/download-comments  POST  (org-paired dataset lookup)
//   - substack-sources/fetch-posts        POST  (auth-only, no tenant write)
//   - regulations-sources                 POST  (create dataset in caller org)
//   - regulations-sources/download-comments POST (cross-org JS gate → 404)
//   - regulations-sources/search          POST  (auth-only, no tenant write)
//   - social/alerts                       GET/POST/PATCH/DELETE (org-scoped)
//   - social/dm-templates                 GET/POST              (org-scoped)
//
// All verified correctly gated — no fixes in this batch. The mock records
// .eq()/.insert() so org-paired lookups assert the .eq('org_id', callerOrg)
// pairing and create routes assert the row lands in the caller org.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  results: {} as Record<string, any>,
  eqCalls: {} as Record<string, [string, any][]>,
  insertCalls: {} as Record<string, any[]>,
}
function reset() { ctx.authUser = null; ctx.results = {}; ctx.eqCalls = {}; ctx.insertCalls = {} }

function builder(table: string): any {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  ctx.insertCalls[table] = ctx.insertCalls[table] || []
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'update', 'delete']) b[m] = () => b
  b.eq = (col: string, val: any) => { ctx.eqCalls[table].push([col, val]); return b }
  b.insert = (payload: any) => { ctx.insertCalls[table].push(payload); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (t: string) => builder(t) }),
  createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/substack', () => ({
  fetchPostComments: async () => [],
  commentToRow: () => ({}),
  resolveBaseUrl: (u: string) => u,
  fetchPublication: async () => ({}),
  fetchPosts: async () => [],
}))
vi.mock('@/lib/regulations', () => ({
  listComments: async () => ({ data: [], totalElements: 0, lastPage: true, usedSearch: false }),
  fetchCommentsBatch: async () => [],
  commentToRow: () => ({}),
  searchDockets: async () => ({ data: [], totalElements: 0 }),
}))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: async () => ({}) }))

import * as substackCreate from '@/app/api/substack-sources/route'
import * as substackDownload from '@/app/api/substack-sources/download-comments/route'
import * as substackFetch from '@/app/api/substack-sources/fetch-posts/route'
import * as regsCreate from '@/app/api/regulations-sources/route'
import * as regsDownload from '@/app/api/regulations-sources/download-comments/route'
import * as regsSearch from '@/app/api/regulations-sources/search/route'
import * as alerts from '@/app/api/social/alerts/route'
import * as dmTemplates from '@/app/api/social/dm-templates/route'

const req = (method = 'POST', body: any = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any

const withAnalyze = (org: string | null) =>
  ({ data: { org_id: org, organizations: { features: { analyze: true } } }, error: null })
const orgOnly = (org: string | null) => ({ data: { org_id: org }, error: null })
const withAdmin = (org: string | null, isAdmin = false) =>
  ({ data: { org_id: org, organizations: { is_admin_org: isAdmin } }, error: null })

beforeEach(reset)

// ── substack-sources — POST (create dataset in caller org) ─────────────────
describe('substack-sources — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await substackCreate.POST(req('POST', { publication_url: 'x' }))).status).toBe(401)
  })

  it('403 when the org lacks the analyze feature', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = { data: { org_id: 'orgA', organizations: { features: {} } }, error: null }
    expect((await substackCreate.POST(req('POST', { publication_url: 'x' }))).status).toBe(403)
  })

  it('403 when the analyze-enabled caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAnalyze(null)
    expect((await substackCreate.POST(req('POST', { publication_url: 'x' }))).status).toBe(403)
  })

  it('creates the dataset in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAnalyze('orgA')
    ctx.results['datasets'] = { data: { id: 'ds1' }, error: null }
    const r = await substackCreate.POST(req('POST', { publication_url: 'https://x.substack.com' }))
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['datasets'][0].org_id).toBe('orgA')
    expect(ctx.insertCalls['datasets'][0].created_by).toBe('u1')
  })
})

// ── substack-sources/download-comments — POST (org-paired lookup) ──────────
describe('substack-sources/download-comments — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await substackDownload.POST(req('POST', { dataset_id: 'd1', base_url: 'x', post_id: 'p1' }))).status).toBe(401)
  })

  it('403 when the caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly(null)
    expect((await substackDownload.POST(req('POST', { dataset_id: 'd1', base_url: 'x', post_id: 'p1' }))).status).toBe(403)
  })

  it('404 + org-paired lookup when the dataset is cross-org / missing', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    const r = await substackDownload.POST(req('POST', { dataset_id: 'd1', base_url: 'x', post_id: 'p1' }))
    expect(r.status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['id', 'd1'])
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── substack-sources/fetch-posts — POST (auth-only, no tenant write) ───────
describe('substack-sources/fetch-posts — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await substackFetch.POST(req('POST', { url: 'x' }))).status).toBe(401)
  })
})

// ── regulations-sources — POST (create dataset in caller org) ──────────────
describe('regulations-sources — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await regsCreate.POST(req('POST', { dataset_name: 'D', docket_id: 'k1' }))).status).toBe(401)
  })

  it('403 when the caller has no org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly(null)
    expect((await regsCreate.POST(req('POST', { dataset_name: 'D', docket_id: 'k1' }))).status).toBe(403)
  })

  it('creates the dataset in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    ctx.results['datasets'] = { data: { id: 'ds1' }, error: null }
    const r = await regsCreate.POST(req('POST', { dataset_name: 'D', docket_id: 'k1' }))
    expect(r.status).toBe(200)
    expect(ctx.insertCalls['datasets'][0].org_id).toBe('orgA')
    expect(ctx.insertCalls['datasets'][0].created_by).toBe('u1')
  })
})

// ── regulations-sources/download-comments — POST (cross-org JS gate) ───────
describe('regulations-sources/download-comments — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await regsDownload.POST(req('POST', { dataset_id: 'd1', docket_id: 'k1' }))).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', false)
    ctx.results['datasets'] = { data: { org_id: 'orgB' }, error: null }
    expect((await regsDownload.POST(req('POST', { dataset_id: 'd1', docket_id: 'k1' }))).status).toBe(404)
  })

  it('platform admin may finalize a cross-org dataset (bypass)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = withAdmin('orgA', true)
    ctx.results['datasets'] = { data: { org_id: 'orgB', description: null }, error: null }
    ctx.results['dataset_state'] = { data: { schema_config: { fields: [] } }, error: null }
    const r = await regsDownload.POST(req('POST', { dataset_id: 'd1', docket_id: 'k1', finalize: true }))
    expect(r.status).not.toBe(404)
  })
})

// ── regulations-sources/search — POST (auth-only) ──────────────────────────
describe('regulations-sources/search — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await regsSearch.POST(req('POST', { query: 'water' }))).status).toBe(401)
  })
})

// ── social/alerts — GET/POST/PATCH/DELETE (org-scoped) ─────────────────────
describe('social/alerts — rule CRUD', () => {
  it('401 when the caller has no org (all verbs)', async () => {
    expect((await alerts.GET()).status).toBe(401)
    expect((await alerts.POST(req('POST', { rule_type: 'keyword' }))).status).toBe(401)
    expect((await alerts.PATCH(req('PATCH', { id: 'r1', enabled: false }))).status).toBe(401)
    expect((await alerts.DELETE(req('DELETE', { id: 'r1' }))).status).toBe(401)
  })

  it('GET filters rules by the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    await alerts.GET()
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['org_id', 'orgA'])
  })

  it('POST creates the rule in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    ctx.results['social_alert_rules'] = { data: { id: 'r1' }, error: null }
    const r = await alerts.POST(req('POST', { rule_type: 'keyword', config: {} }))
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['social_alert_rules'][0].org_id).toBe('orgA')
  })

  it('PATCH pairs the update with the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    await alerts.PATCH(req('PATCH', { id: 'r1', enabled: false }))
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['id', 'r1'])
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['org_id', 'orgA'])
  })

  it('PATCH rejects an org_id-only body (field whitelist blocks org escape)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    const r = await alerts.PATCH(req('PATCH', { id: 'r1', org_id: 'evil' }))
    expect(r.status).toBe(400)
  })

  it('DELETE pairs the delete with the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    await alerts.DELETE(req('DELETE', { id: 'r1' }))
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['id', 'r1'])
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── social/dm-templates — GET/POST (org-scoped) ────────────────────────────
describe('social/dm-templates — GET / POST', () => {
  it('401 when the caller has no org', async () => {
    expect((await dmTemplates.GET()).status).toBe(401)
    expect((await dmTemplates.POST(req('POST', { intent: 'x', message: 'y' }))).status).toBe(401)
  })

  it('GET filters templates by the caller org and rule_type', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    await dmTemplates.GET()
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['org_id', 'orgA'])
    expect(ctx.eqCalls['social_alert_rules']).toContainEqual(['rule_type', 'dm_template'])
  })

  it('POST creates the template in the caller org', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = orgOnly('orgA')
    ctx.results['social_alert_rules'] = { data: { id: 't1' }, error: null }
    const r = await dmTemplates.POST(req('POST', { intent: 'thanks', message: 'hi' }))
    expect(r.status).toBe(201)
    expect(ctx.insertCalls['social_alert_rules'][0].org_id).toBe('orgA')
    expect(ctx.insertCalls['social_alert_rules'][0].rule_type).toBe('dm_template')
  })
})
