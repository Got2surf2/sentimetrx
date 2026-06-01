// tests/integration/export-org-gate.test.ts
//
// Cross-org gate on the service-role export routes. These fetch a tenant
// resource (dataset / town hall) by id via the service role (which bypasses
// RLS), so each must verify caller ownership — otherwise any authed user can
// export another org's data by guessing the id. Regression for the W22 audit
// sweep that found this whole class unguarded (only html/share was gated).
//
// We assert the security-critical branch: a non-admin caller in orgA gets 404
// when the resource belongs to orgB.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  caller: { userId: 'u1', orgId: 'orgA', isAdmin: false } as any,
  rowOrg: 'orgB',          // the resource's owning org (cross-tenant by default)
}

vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.caller }))

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string): any => {
    const row =
      table === 'datasets'
        ? { id: 'ds_1', name: 'X', source: 'reddit', row_count: 1, org_id: ctx.rowOrg, studies: null }
        : table === 'townhall_sessions' || table === 'town_halls'
          ? { id: 's_1', name: 'X', status: 'complete', config: {}, started_at: null, ended_at: null, org_id: ctx.rowOrg }
          : { id: 'x', org_id: ctx.rowOrg }
    const b: any = {}
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'limit']) b[m] = () => b
    b.single = async () => ({ data: row, error: null })
    b.maybeSingle = async () => ({ data: row, error: null })
    b.then = (res: any, rej: any) => Promise.resolve({ data: [row], error: null, count: 1 }).then(res, rej)
    return b
  }
  return {
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, from: () => builder('users') }),
    createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
    getAuthUser: async () => ({ id: 'u1' }),
  }
})

// Heavy export deps — never actually render.
vi.mock('@/lib/ai', () => ({ callAI: vi.fn(async () => ({ text: '{}', usage: {} })) }))

import * as signals from '@/app/api/datasets/[datasetId]/export/signals-pptx/route'
import * as htmlExport from '@/app/api/datasets/[datasetId]/export/html/route'
import * as pptxExport from '@/app/api/datasets/[datasetId]/export/pptx/route'
import * as thPptx from '@/app/api/townhall/sessions/[id]/export/pptx/route'
import * as thCsv from '@/app/api/townhall/sessions/[id]/export/route'

beforeEach(() => {
  ctx.caller = { userId: 'u1', orgId: 'orgA', isAdmin: false }
  ctx.rowOrg = 'orgB'
})

function post(body: unknown, url = 'http://t/x') {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) })
}

describe('export routes — cross-org gate (non-admin in orgA, resource in orgB → 404)', () => {
  it('datasets signals-pptx export', async () => {
    const res = await signals.POST(post({}), { params: { datasetId: 'ds_1' } } as any)
    expect(res.status).toBe(404)
  })

  it('datasets html export', async () => {
    const res = await htmlExport.POST(post({ fields: ['q1'] }), { params: { datasetId: 'ds_1' } } as any)
    expect(res.status).toBe(404)
  })

  it('datasets pptx export', async () => {
    const res = await pptxExport.POST(post({ fields: ['q1'] }), { params: { datasetId: 'ds_1' } } as any)
    expect(res.status).toBe(404)
  })

  it('townhall pptx export', async () => {
    const res = await thPptx.POST(post({}) as any, { params: { id: 's_1' } } as any)
    expect(res.status).toBe(404)
  })

  it('townhall csv export', async () => {
    const res = await thCsv.GET(new (await import('next/server')).NextRequest('http://t/x?format=csv'), { params: { id: 's_1' } } as any)
    expect(res.status).toBe(404)
  })

  it('same-org caller is NOT blocked by the gate (orgA owns it)', async () => {
    ctx.rowOrg = 'orgA'
    // signals-pptx proceeds past the gate; next branch is the reddit/substack
    // source check (our mock dataset.source='reddit' passes) so it does NOT 404
    // on the org gate. We only assert it's not the gate's 404.
    const res = await signals.POST(post({}), { params: { datasetId: 'ds_1' } } as any)
    expect(res.status).not.toBe(404)
  })
})
