// app/api/cron/agent-recrawl/route.ts
// AGENT_TIERS Phase 2 P2e — weekly KB re-crawl for Super Agents.
//
// Walks every Super Agent's training_urls, re-fetches each page, and re-embeds
// ONLY the pages whose extracted text changed since the last stored content
// hash (sql/177 agent_kb_page_hashes). Unchanged pages cost one cheap fetch and
// nothing else. Super-tier ONLY (owner 2026-07-14, AGENT_TIERS §7 #4): auto
// re-crawl is a paid differentiator; standard agents stay manual-refresh.
//
// D16c cron-sweep shape: bounded per-run work (agents + urls caps + a wall-clock
// deadline under maxDuration), oldest-agent-first so any overflow is picked up
// next week. Fail-soft per agent — one bad agent never blocks the rest.
//
// vercel.json: { "path": "/api/cron/agent-recrawl", "schedule": "0 7 * * 1" }
// (Mondays 07:00 UTC — off-peak, alongside the other weekly maintenance crons).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { normalizeCapability } from '@/lib/agentCapability'
import { recrawlAgentPages, type RecrawlResult } from '@/lib/botKnowledge/recrawl'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Well above the current super-agent count; oldest-first means overflow rides
// to next week. Fetches (not embeds) dominate per-run time, so bound them too.
const MAX_AGENTS_PER_RUN = 25
const MAX_URLS_PER_AGENT = 60
const TIME_BUDGET_MS = 260000 // leave headroom under the 300s function cap

type AgentRow = {
  id: string; org_id: string; subject: string | null
  opponents: Array<string | { name?: string }> | null
  capability: string | null; capability_config: Record<string, unknown> | null
  training_urls: string[] | null
}

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  // Super agents only. Oldest-first for fairness under the per-run cap.
  const { data: agents, error } = await service
    .from('agents')
    .select('id, org_id, subject, opponents, capability, capability_config, training_urls')
    .eq('capability', 'super')
    .order('created_at', { ascending: true })
    .limit(MAX_AGENTS_PER_RUN)

  if (error) return serverError(error, 'cron.agentRecrawl.listAgents')

  const eligible = (agents || []).filter(
    (a: AgentRow) => normalizeCapability(a.capability) === 'super' && Array.isArray(a.training_urls) && a.training_urls.length > 0,
  ) as AgentRow[]

  if (eligible.length === 0) {
    return NextResponse.json({ ok: true, agents_processed: 0, message: 'No super agents with training URLs' })
  }

  const deadline = Date.now() + TIME_BUDGET_MS
  const results: Array<{ agent: string; result: RecrawlResult | null; error: string | null }> = []

  for (const agent of eligible) {
    if (Date.now() > deadline) break
    try {
      const result = await recrawlAgentPages(service, agent, agent.training_urls || [], {
        maxUrls: MAX_URLS_PER_AGENT,
        deadline,
      })
      results.push({ agent: agent.id, result, error: null })
    } catch (err: unknown) {
      console.error({ at: 'cron/agent-recrawl', msg: 'agent failed', agent: agent.id, err })
      results.push({ agent: agent.id, result: null, error: err instanceof Error ? err.message : 'recrawl failed' })
    }
  }

  const rolled = results.reduce(
    (s, r) => {
      if (r.result) {
        s.pages_fetched += r.result.fetched
        s.pages_updated += r.result.updated
        s.pages_new += r.result.added
        s.pages_unchanged += r.result.unchanged
        s.chunks_added += r.result.chunksAdded
      }
      return s
    },
    { pages_fetched: 0, pages_updated: 0, pages_new: 0, pages_unchanged: 0, chunks_added: 0 },
  )

  return NextResponse.json({
    ok: true,
    agents_processed: results.length,
    ...rolled,
    results,
  })
}
