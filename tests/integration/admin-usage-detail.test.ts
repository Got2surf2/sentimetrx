import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireAdminMock = vi.fn()
vi.mock('@/lib/auth/requireAdmin', () => ({
  requireAdmin: () => requireAdminMock(),
}))

// Per-test override hooks for the supabase service-role client.
let usageLogsRows: any[] = []
let agentLookup: { name?: string; slug?: string } | null = null
let orgLookup: { name?: string } | null = null

function makeServiceMock() {
  return {
    from(table: string) {
      // usage_logs branch — builder chain returning the prepared rows.
      if (table === 'usage_logs') {
        const builder: any = {
          _filters: {} as Record<string, unknown>,
          select() { return builder },
          eq(col: string, val: unknown) { builder._filters[col] = val; return builder },
          gte() { return builder },
          lt() { return builder },
          order() { return builder },
          limit() { return Promise.resolve({ data: usageLogsRows, error: null }) },
          then(resolve: (v: any) => any) { return resolve({ data: usageLogsRows, error: null }) },
        }
        return builder
      }
      // agents / studies / datasets / townhall_sessions lookups — single-row .maybeSingle
      if (table === 'agents') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: agentLookup, error: null }) }) }),
        }
      }
      if (table === 'organizations') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: orgLookup, error: null }) }) }),
        }
      }
      // Default for studies / datasets / townhall_sessions — no-op.
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => makeServiceMock(),
}))

// estimateCost is deterministic in the real lib; we re-export a passthrough
// stub so tests don't depend on the live pricing table.
vi.mock('@/lib/usageLog', () => ({
  estimateCost: (_model: string, inTok: number, outTok: number, cacheRead = 0) =>
    inTok * 0.000001 + outTok * 0.000005 + cacheRead * 0.0000001,
}))

async function loadGet() {
  return (await import('@/app/api/admin/usage/[type]/[id]/route')).GET
}

function buildReq(query: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/usage/bot/agent_abc')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('GET /api/admin/usage/[type]/[id] — admin gate', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    usageLogsRows = []
    agentLookup = null
    orgLookup = null
  })

  it('returns the gate response for anonymous callers (no admin)', async () => {
    requireAdminMock.mockResolvedValue(new NextResponse('Not Found', { status: 404 }))
    const GET = await loadGet()
    const res = await GET(buildReq(), { params: Promise.resolve({ type: 'bot', id: 'agent_abc' }) })
    expect(res.status).toBe(404)
  })

  it('rejects unknown resource_type with 400', async () => {
    requireAdminMock.mockResolvedValue(undefined)
    const GET = await loadGet()
    const res = await GET(buildReq(), { params: Promise.resolve({ type: 'not-a-thing', id: 'x' }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/Invalid resource_type/)
  })

  it('accepts the documented resource_type union', async () => {
    requireAdminMock.mockResolvedValue(undefined)
    const GET = await loadGet()
    for (const type of ['bot', 'townhall', 'social', 'dataset', 'study', 'system']) {
      const res = await GET(buildReq(), { params: Promise.resolve({ type, id: 'x_1' }) })
      expect(res.status).toBe(200)
    }
  })
})

describe('GET /api/admin/usage/[type]/[id] — aggregation smoke', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
    requireAdminMock.mockResolvedValue(undefined)
    agentLookup = { name: 'Sarina', slug: 'sarina' }
    orgLookup = { name: 'Datanautix' }
  })

  it('rolls up totals, by_event, by_model, daily_trend', async () => {
    usageLogsRows = [
      { org_id: 'org_1', event_type: 'chat',   model: 'claude-haiku',  tier: 'fast',     input_tokens: 100, output_tokens: 50,  cache_read_tokens: 0,  cache_creation_tokens: 0, created_at: '2026-05-20T10:00:00Z' },
      { org_id: 'org_1', event_type: 'chat',   model: 'claude-haiku',  tier: 'fast',     input_tokens: 200, output_tokens: 80,  cache_read_tokens: 0,  cache_creation_tokens: 0, created_at: '2026-05-20T12:00:00Z' },
      { org_id: 'org_1', event_type: 'summarize', model: 'claude-sonnet', tier: 'balanced', input_tokens: 500, output_tokens: 300, cache_read_tokens: 100, cache_creation_tokens: 0, created_at: '2026-05-21T09:00:00Z' },
    ]
    const GET = await loadGet()
    const res = await GET(buildReq(), { params: Promise.resolve({ type: 'bot', id: 'agent_abc' }) })
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.resource).toEqual({
      type: 'bot',
      id: 'agent_abc',
      name: 'Sarina',
      href: '/bots/agent_abc',
    })
    expect(body.org).toEqual({ id: 'org_1', name: 'Datanautix' })
    expect(body.totals.calls).toBe(3)
    expect(body.totals.input_tokens).toBe(800)
    expect(body.totals.output_tokens).toBe(430)

    // by_event: chat (2 calls), summarize (1)
    expect(body.by_event.chat.calls).toBe(2)
    expect(body.by_event.summarize.calls).toBe(1)
    expect(body.by_event.chat.input).toBe(300)

    // by_model: haiku (2), sonnet (1)
    expect(body.by_model['claude-haiku'].calls).toBe(2)
    expect(body.by_model['claude-sonnet'].calls).toBe(1)

    // daily_trend: two days, sorted ascending
    expect(body.daily_trend.map((d: any) => d.date)).toEqual(['2026-05-20', '2026-05-21'])
    expect(body.daily_trend[0].calls).toBe(2)
    expect(body.daily_trend[1].calls).toBe(1)
  })

  it('handles zero usage rows gracefully', async () => {
    usageLogsRows = []
    const GET = await loadGet()
    const res = await GET(buildReq(), { params: Promise.resolve({ type: 'bot', id: 'agent_abc' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals).toEqual({ calls: 0, input_tokens: 0, output_tokens: 0, cost: 0 })
    expect(body.by_event).toEqual({})
    expect(body.by_model).toEqual({})
    expect(body.daily_trend).toEqual([])
    expect(body.org).toBe(null)
  })

  it('honors a from/to date range when both query params look valid', async () => {
    usageLogsRows = []
    const GET = await loadGet()
    const res = await GET(buildReq({ from: '2026-05-01', to: '2026-05-15' }), {
      params: Promise.resolve({ type: 'bot', id: 'agent_abc' }),
    })
    const body = await res.json()
    expect(body.period.days).toBe(15)
    expect(body.period.since).toBe('2026-05-01T00:00:00.000Z')
    expect(body.period.until).toBe('2026-05-16T00:00:00.000Z')
  })

  it('falls back to a `days` window when from is missing or malformed', async () => {
    usageLogsRows = []
    const GET = await loadGet()
    const res = await GET(buildReq({ days: '7' }), { params: Promise.resolve({ type: 'bot', id: 'agent_abc' }) })
    const body = await res.json()
    expect(body.period.days).toBe(7)
    expect(body.period.until).toBe(null)
  })

  it('falls back to the id prefix when no resource name resolves', async () => {
    agentLookup = null
    usageLogsRows = []
    const GET = await loadGet()
    const res = await GET(buildReq(), { params: Promise.resolve({ type: 'bot', id: 'agent_abcdef_long' }) })
    const body = await res.json()
    expect(body.resource.name).toBe('agent_ab') // first 8 chars
    expect(body.resource.href).toBe(null)
  })
})
