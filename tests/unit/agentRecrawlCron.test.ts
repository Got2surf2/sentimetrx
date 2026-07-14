// AGENT_TIERS Phase 2 P2e — the weekly re-crawl cron (app/api/cron/agent-recrawl).
// Contract: fail-closed auth (checkCronAuth), SUPER-tier only, and only agents
// that actually have training_urls get swept. Per-agent recrawl work is mocked —
// this is selection + orchestration, no network or DB.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const SECRET = 'test-cron-secret-0123456789abcdef' // ≥16 chars for checkCronAuth

const recrawlMock = vi.fn(async (..._args: unknown[]) => ({ pages: [], fetched: 2, unchanged: 1, updated: 1, added: 0, unreachable: 0, chunksAdded: 4 }))
vi.mock('@/lib/botKnowledge/recrawl', () => ({
  recrawlAgentPages: (...args: unknown[]) => recrawlMock(...(args as [])),
}))

let agentRows: Array<{ id: string; capability: string; training_urls: string[] | null }> = []
function service() {
  return {
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.order = () => b
      b.limit = async () => ({
        data: agentRows.map((a) => ({
          id: a.id, org_id: 'o1', subject: null, opponents: null,
          capability: a.capability, capability_config: {}, training_urls: a.training_urls,
        })),
        error: null,
      })
      return b
    },
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => service() }))

import { GET } from '@/app/api/cron/agent-recrawl/route'

const authed = () => new NextRequest('https://x/api/cron/agent-recrawl', { headers: { authorization: `Bearer ${SECRET}` } })

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  recrawlMock.mockClear()
  agentRows = []
})

describe('agent-recrawl cron', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await GET(new NextRequest('https://x/api/cron/agent-recrawl'))
    expect(res.status).toBe(401)
    expect(recrawlMock).not.toHaveBeenCalled()
  })

  it('sweeps only super agents that have training URLs', async () => {
    agentRows = [
      { id: 'super-with-urls', capability: 'super', training_urls: ['https://a.org/x'] },
      { id: 'super-no-urls', capability: 'super', training_urls: [] },
      { id: 'standard-with-urls', capability: 'standard', training_urls: ['https://b.org/y'] },
    ]
    const res = await GET(authed())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.agents_processed).toBe(1)
    expect(recrawlMock).toHaveBeenCalledTimes(1)
    expect((recrawlMock.mock.calls[0][1] as { id: string }).id).toBe('super-with-urls')
  })

  it('no-ops cleanly when there are no eligible agents', async () => {
    agentRows = [{ id: 'standard', capability: 'standard', training_urls: ['https://b.org/y'] }]
    const res = await GET(authed())
    const body = await res.json()
    expect(body.agents_processed).toBe(0)
    expect(recrawlMock).not.toHaveBeenCalled()
  })
})
