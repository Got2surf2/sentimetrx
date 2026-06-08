// tests/integration/entity-enrichment-routes-gate.test.ts
//
// Phase 1 — org-scoping gates for the dataset entity-catalog + enrichment
// routes:
//   - entities                 GET / POST            (catalog list / manual add)
//   - entities/[slug]          PATCH / DELETE        (edit / hard-delete entry)
//   - entities/reset-discovered POST                 (wipe discovered rows)
//   - discover-entities        POST                  (Haiku NER → catalog)
//   - auto-setup               POST                  (overwrite schema from study)
//   - compute                  POST                  (recompute analytics)
//   - merge-themes             POST                  (auth-only AI helper)
//   - expand-keywords          POST                  (auth-only AI helper)
//
// All verified correctly gated — no fixes in this batch. The data-mutating
// routes resolve the caller org and refuse a cross-org dataset (paired
// id+org_id on the service-role lookup, or a JS org check) before any write.
// merge-themes / expand-keywords read no tenant rows (inputs come from the
// body; the dataset existence check is RLS-bound) — auth-only. The mock
// records .eq() so POST asserts the .eq('org_id', callerOrg) pairing.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  authUser: null as any,
  callerCtx: { userId: null, orgId: null, isAdmin: false } as any,
  scope: { found: true, scopeType: 'dataset', scopeId: 'd_1', memberDatasetIds: ['d_1'] } as any,
  results: {} as Record<string, any>,
  eqCalls: {} as Record<string, [string, any][]>,
}
function reset() {
  ctx.authUser = null
  ctx.callerCtx = { userId: null, orgId: null, isAdmin: false }
  ctx.scope = { found: true, scopeType: 'dataset', scopeId: 'd_1', memberDatasetIds: ['d_1'] }
  ctx.results = {}
  ctx.eqCalls = {}
}

function builder(table: string): any {
  ctx.eqCalls[table] = ctx.eqCalls[table] || []
  const b: any = {}
  for (const m of ['select', 'order', 'in', 'limit', 'neq', 'range', 'lt', 'update', 'delete', 'insert', 'upsert']) b[m] = () => b
  b.eq = (col: string, val: any) => { ctx.eqCalls[table].push([col, val]); return b }
  b.single = async () => ctx.results[table] ?? { data: null, error: null }
  b.maybeSingle = async () => ctx.results[table] ?? { data: null, error: null }
  b.then = (res: any, rej: any) => Promise.resolve(ctx.results[table] ?? { data: [], error: null }).then(res, rej)
  return b
}
const client = () => ({ from: (t: string) => builder(t) })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => client(),
  createServiceRoleClient: () => client(),
  getAuthUser: async () => ctx.authUser,
}))
vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.callerCtx }))
vi.mock('@/lib/entityFilter', () => ({
  getEntitiesWithCounts: async () => ({ entities: [], categories: [], total_distinct: 0 }),
  resolveEntityScope: async () => ctx.scope,
  slugify: (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
}))
vi.mock('@/lib/entityDiscovery', () => ({ discoverEntities: async () => ({ scope_type: 'dataset', sample_size: 0, entities_after: 0, entities_new: 0, cost_est_cents: 0 }) }))
vi.mock('@/lib/userEvents', () => ({ recordUserEvent: async () => {}, eventContextFromRequest: () => ({ ip: null, userAgent: null }) }))
vi.mock('@/lib/ai', () => ({ callAI: async () => ({ text: '[]', usage: {} }) }))
vi.mock('@/lib/usageLog', () => ({ logUsage: () => {} }))
vi.mock('@/lib/analyticsCompute', () => ({ computeAnalyticsSQL: async () => ({ totalRows: 0, computedAt: 'x', fieldSummaries: {} }) }))
vi.mock('@/lib/collectionRecompute', () => ({ recomputeCollectionAnalytics: async () => null, recomputeParentCollections: async () => 0 }))
vi.mock('@/lib/brandRules', () => ({ rebuildBrandSchema: async () => {}, discoverBrandEntitiesIfNeeded: async () => {} }))

import * as entities from '@/app/api/datasets/[datasetId]/entities/route'
import * as entitySlug from '@/app/api/datasets/[datasetId]/entities/[slug]/route'
import * as resetDiscovered from '@/app/api/datasets/[datasetId]/entities/reset-discovered/route'
import * as discover from '@/app/api/datasets/[datasetId]/discover-entities/route'
import * as autoSetup from '@/app/api/datasets/[datasetId]/auto-setup/route'
import * as compute from '@/app/api/datasets/[datasetId]/compute/route'
import * as mergeThemes from '@/app/api/datasets/[datasetId]/merge-themes/route'
import * as expandKeywords from '@/app/api/datasets/[datasetId]/expand-keywords/route'

const props = { params: Promise.resolve({ datasetId: 'd_1' }) } as any
const slugProps = { params: Promise.resolve({ datasetId: 'd_1', slug: 'filet' }) } as any
const req = (method = 'POST', body: any = {}) =>
  new Request('http://t/x', { method, body: method === 'GET' ? undefined : JSON.stringify(body) }) as any

const caller = (orgId: string | null, isAdmin = false) => ({ userId: orgId ? 'u1' : null, orgId, isAdmin })
const adminOrg = (org: string | null, isAdmin = false) =>
  ({ data: { org_id: org, organizations: { is_admin_org: isAdmin } }, error: null })

beforeEach(reset)

// ── entities — GET / POST ──────────────────────────────────────────────────
describe('datasets/[datasetId]/entities — GET / POST', () => {
  it('401 when caller has no org', async () => {
    expect((await entities.GET(req('GET'), props)).status).toBe(401)
    expect((await entities.POST(req('POST', { canonical: 'Filet' }), props)).status).toBe(401)
  })

  it('GET 404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { id: 'd_1', org_id: 'orgB' }, error: null }
    expect((await entities.GET(req('GET'), props)).status).toBe(404)
  })

  it('POST 404 + org-paired lookup when cross-org / missing', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    const r = await entities.POST(req('POST', { canonical: 'Filet' }), props)
    expect(r.status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['id', 'd_1'])
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── entities/[slug] — PATCH / DELETE ───────────────────────────────────────
describe('datasets/[datasetId]/entities/[slug] — PATCH / DELETE', () => {
  it('401 when caller has no org', async () => {
    expect((await entitySlug.PATCH(req('PATCH', { hidden: true }), slugProps))!.status).toBe(401)
    expect((await entitySlug.DELETE(req('DELETE'), slugProps))!.status).toBe(401)
  })

  it('PATCH 404 + org-paired lookup when cross-org / missing', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    const r = await entitySlug.PATCH(req('PATCH', { hidden: true }), slugProps)
    expect(r!.status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })

  it('DELETE 404 + org-paired lookup when cross-org / missing', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    const r = await entitySlug.DELETE(req('DELETE'), slugProps)
    expect(r!.status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── entities/reset-discovered — POST ───────────────────────────────────────
describe('datasets/[datasetId]/entities/reset-discovered — POST', () => {
  it('401 when caller has no org', async () => {
    expect((await resetDiscovered.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 + org-paired lookup when cross-org / missing', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: null, error: null }
    const r = await resetDiscovered.POST(req('POST'), props)
    expect(r.status).toBe(404)
    expect(ctx.eqCalls['datasets']).toContainEqual(['org_id', 'orgA'])
  })
})

// ── discover-entities — POST ───────────────────────────────────────────────
describe('datasets/[datasetId]/discover-entities — POST', () => {
  it('401 when caller has no org', async () => {
    expect((await discover.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { id: 'd_1', name: 'D', org_id: 'orgB' }, error: null }
    expect((await discover.POST(req('POST'), props)).status).toBe(404)
  })
})

// ── auto-setup — POST ──────────────────────────────────────────────────────
describe('datasets/[datasetId]/auto-setup — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await autoSetup.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['users'] = adminOrg('orgA', false)
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'study', study_id: 's1' }, error: null }
    expect((await autoSetup.POST(req('POST'), props)).status).toBe(404)
  })
})

// ── compute — POST ─────────────────────────────────────────────────────────
describe('datasets/[datasetId]/compute — POST', () => {
  it('401 unauthenticated', async () => {
    expect((await compute.POST(req('POST'), props)).status).toBe(401)
  })

  it('404 when the dataset belongs to another org (non-admin)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.callerCtx = caller('orgA')
    ctx.results['datasets'] = { data: { org_id: 'orgB', source: 'study' }, error: null }
    expect((await compute.POST(req('POST'), props)).status).toBe(404)
  })
})

// ── merge-themes / expand-keywords — auth-only AI helpers ──────────────────
describe('AI helper routes — auth-only', () => {
  it('merge-themes 401 unauthenticated', async () => {
    expect((await mergeThemes.POST(req('POST', { apiKey: 'k', memberThemes: [] }), props)).status).toBe(401)
  })

  it('merge-themes 404 when the dataset is not visible (RLS existence check)', async () => {
    ctx.authUser = { id: 'u1' }
    ctx.results['datasets'] = { data: null, error: null }
    expect((await mergeThemes.POST(req('POST', { apiKey: 'k', memberThemes: [] }), props)).status).toBe(404)
  })

  it('expand-keywords 401 unauthenticated', async () => {
    expect((await expandKeywords.POST(req('POST', { apiKey: 'k', themeName: 't', keywords: ['a'] }), props)).status).toBe(401)
  })
})
