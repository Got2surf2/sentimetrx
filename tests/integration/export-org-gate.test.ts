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
  recStatus: 'complete',   // recordings.status for the export-route happy path
  recOwner: 'u1',          // recordings.created_by — share/send are org-wide now (creator no longer matters)
}

vi.mock('@/lib/auth/orgAccess', () => ({ getCallerOrgContext: async () => ctx.caller }))

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string): any => {
    const row =
      table === 'datasets'
        ? { id: 'ds_1', name: 'X', source: 'reddit', row_count: 1, org_id: ctx.rowOrg, studies: null }
        : table === 'townhall_sessions' || table === 'town_halls'
          ? { id: 's_1', name: 'X', status: 'complete', config: {}, started_at: null, ended_at: null, org_id: ctx.rowOrg }
          : table === 'recordings'
            ? { id: 'rec_1', name: 'X', meeting_date: null, location: null, status: ctx.recStatus, analysis_summary: null, org_id: ctx.rowOrg, created_by: ctx.recOwner, share_token: null, share_enabled: false }
            : { id: 'x', org_id: ctx.rowOrg }
    const b: any = {}
    for (const m of ['select', 'eq', 'order', 'range', 'in', 'limit', 'update']) b[m] = () => b
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
vi.mock('@/lib/pptx/recordingDeck', () => ({ buildRecordingDeck: vi.fn(async () => new Uint8Array([1, 2, 3])) }))
vi.mock('@/lib/auth/logDeckDownload', () => ({ logDeckDownload: vi.fn(async () => {}) }))

import * as signals from '@/app/api/datasets/[datasetId]/export/signals-pptx/route'
import * as htmlExport from '@/app/api/datasets/[datasetId]/export/html/route'
import * as pptxExport from '@/app/api/datasets/[datasetId]/export/pptx/route'
import * as thPptx from '@/app/api/townhall/sessions/[id]/export/pptx/route'
import * as thCsv from '@/app/api/townhall/sessions/[id]/export/route'
import * as recPptx from '@/app/api/recordings/[id]/export/pptx/route'
import * as recShare from '@/app/api/recordings/[id]/share/route'

beforeEach(() => {
  ctx.caller = { userId: 'u1', orgId: 'orgA', isAdmin: false }
  ctx.rowOrg = 'orgB'
  ctx.recStatus = 'complete'
  ctx.recOwner = 'u1'
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

  it('recording pptx export', async () => {
    const res = await recPptx.POST(post({}), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(404)
  })

  it('recording share enable (cross-org → 404, never publishes another org\'s report)', async () => {
    const res = await recShare.POST(post({ enabled: true }), { params: Promise.resolve({ id: 'rec_1' }) } as any)
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

describe('recording pptx export — status + content-type', () => {
  it('same-org owner of a complete recording → 200 + pptx content-type', async () => {
    ctx.rowOrg = 'orgA'
    ctx.recStatus = 'complete'
    const res = await recPptx.POST(post({}), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('presentationml.presentation')
  })

  it('409 when analysis is not finished (status != complete)', async () => {
    ctx.rowOrg = 'orgA'
    ctx.recStatus = 'transcribed'
    const res = await recPptx.POST(post({}), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(409)
  })

  it('401 when unauthenticated', async () => {
    ctx.caller = { userId: null, orgId: null, isAdmin: false }
    const res = await recPptx.POST(post({}), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(401)
  })
})

describe('recording public-share toggle — org-member + status gates', () => {
  it('same-org non-creator CAN enable sharing — org-wide, not owner-gated', async () => {
    ctx.rowOrg = 'orgA'
    ctx.recOwner = 'someone_else'   // caller u1 is in the org but didn't create it
    const res = await recShare.POST(post({ enabled: true }), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(200)
  })

  it('a member cannot enable sharing until analysis is complete (409)', async () => {
    ctx.rowOrg = 'orgA'
    ctx.recStatus = 'transcribed'
    const res = await recShare.POST(post({ enabled: true }), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(409)
  })

  it('owner of a complete recording enables sharing → ok + token + /th path', async () => {
    ctx.rowOrg = 'orgA'
    const res = await recShare.POST(post({ enabled: true }), { params: Promise.resolve({ id: 'rec_1' }) } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(typeof body.token).toBe('string')
    expect(body.path).toMatch(/^\/th\//)
  })
})
