// app/api/bots/[id]/chat/route.ts
// POST — public chat endpoint for a custom agent.
// Thin wrapper: rate-limit + parse + load agent → handleChatTurn → return.
// All chat logic lives in lib/chatCore.ts so the PulseIQ townhall route can
// share the same handler (Phase 4 of the agents/PulseIQ convergence).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { handleChatTurn } from '@/lib/chatCore'
import { assertSuperTurnAllowed } from '@/lib/featureFlags'

export const dynamic = 'force-dynamic'
// Phase 3 — super-agent turns can run a bounded tool loop (up to 3 tool
// rounds + a forced final call, each a streaming Opus call); the default
// serverless budget is not guaranteed to cover the worst case.
export const maxDuration = 120

interface Params { params: Promise<{ id: string }> }

// CORS headers for cross-origin embedding.
//
// SECURITY NOTE: this route is intentionally unauthenticated and the
// wildcard origin is required so customer sites can embed it. If anyone
// adds session-cookie auth here in the future, the wildcard must be
// replaced with an explicit allowlist (or removed entirely) — sending
// `Access-Control-Allow-Origin: *` alongside `credentials: 'include'`
// would let any site trigger requests as the logged-in user. The CSRF
// proxy also exempts this path; tightening cookie auth means
// removing the bypass in proxy.ts.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

// Per-agent embed allowlist (opt-in via config.allowedOrigins). When an agent
// sets a non-empty list, browser requests carrying an Origin that isn't the
// app itself, an allowed domain, or a subdomain of one are rejected — this
// stops other sites from embedding the widget and burning the customer's API
// budget. Requests with no Origin (same-origin page loads, server-to-server,
// curl) are allowed through and left to the rate limiter; this is an
// embedding control, not headless-bot detection. Empty/unset list = wildcard
// (unchanged behavior for every other agent).
const SELF_HOSTS = new Set(['sentimetrx.ai', 'www.sentimetrx.ai', 'localhost', '127.0.0.1'])
function hostOf(originOrDomain: string): string {
  try { return new URL(originOrDomain).hostname.toLowerCase() } catch { return originOrDomain.toLowerCase().replace(/^.*:\/\//, '').replace(/\/.*$/, '') }
}
function originAllowed(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) return true
  if (!allowedOrigins || allowedOrigins.length === 0) return true
  const h = hostOf(origin)
  if (!h) return false
  if (SELF_HOSTS.has(h)) return true
  return allowedOrigins.some(a => { const ah = hostOf(a); return !!ah && (h === ah || h.endsWith('.' + ah)) })
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit('bot_chat:' + ip, 30, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors })

  let body: { messages?: unknown[] } & Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400, headers: cors })
  }

  const service = createServiceRoleClient()
  // Explicit column list — select('*') dragged unused heavy columns (faq,
  // facts, review/audit timestamps) over the wire on every message. This is
  // the exact set this route + lib/chatCore.handleChatTurn read;
  // knowledge_base stays (RAG fallback context injection). training_urls
  // came back in Phase 3: its hosts are the fetch_page tool's allowlist.
  const { data: agent, error } = await service
    .from('agents')
    .select('id, org_id, name, status, config, system_prompt, knowledge_base, personality, guardrails, opponents, contrast_mode, subject, negative_content_mode, sensitive_topics, focus_topics, deflection_enabled, deflection_message, ask_profile, profile_question, intents, demographic_inference, focuses, probe_focus_enabled, research_probes, capability, capability_config, training_urls')
    .eq('id', params.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404, headers: cors })
  }
  if (agent.status !== 'active') {
    return NextResponse.json({ error: 'This bot is not currently active' }, { status: 403, headers: cors })
  }

  const allowedOrigins: string[] = Array.isArray(agent.config?.allowedOrigins) ? agent.config.allowedOrigins : []
  if (!originAllowed(req.headers.get('origin') || '', allowedOrigins)) {
    return NextResponse.json({ error: 'This agent is not authorized for this site.' }, { status: 403, headers: cors })
  }

  // AGENT_TIERS Phase 1 — super-turn abuse backstop. Unlimited by default;
  // only an org that has an explicit monthly ceiling configured can be blocked.
  if (agent.capability === 'super' && agent.org_id) {
    const gate = await assertSuperTurnAllowed(agent.org_id)
    if (!gate.allowed) {
      return NextResponse.json({ error: 'This Super Agent has reached its monthly usage limit. Please try again next month or contact the site owner.' }, { status: 429, headers: cors })
    }
  }

  // Phase 3 — streaming transport (client opt-in via body.stream). The wire
  // format is SSE: `data: {type:'delta',text}` chunks and `data:
  // {type:'tool',name,label}` status lines while the turn runs, then `data:
  // {type:'done',result}` carrying the SAME object the JSON path returns
  // (clients reconcile their streamed text to result.reply — the
  // post-generation guardrail scrub may have rewritten it) before the
  // stream closes. Clients that don't opt in get the legacy JSON response.
  if (body.stream !== true) {
    const result = await handleChatTurn({ agent, service, ip }, body)
    return NextResponse.json(result, { headers: cors })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (obj: unknown) => {
        if (closed) return
        try { controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n')) } catch { closed = true }
      }
      try {
        // emit failures must never abort the turn — if the client
        // disconnects mid-stream, handleChatTurn still finishes so turn
        // storage and usage logging land (`send` swallows after close).
        const result = await handleChatTurn({ agent, service, ip, emit: send }, body)
        send({ type: 'done', result })
      } catch (e) {
        console.error({ at: 'bot-chat', msg: 'stream turn failed', err: (e as Error)?.message })
        send({ type: 'error', error: 'chat failed' })
      }
      if (!closed) { try { controller.close() } catch { /* already closed */ } }
    },
  })
  return new NextResponse(stream, {
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
