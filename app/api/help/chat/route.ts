// app/api/help/chat/route.ts
// POST — authenticated chat endpoint for the in-product Help assistant (Sherpa, 🧭).
//
// Deliberately SEPARATE from /api/bots/[id]/chat: that route is public + CORS-*
// (it serves embeddable respondent widgets) and carries a security note against
// cookie auth. The Help widget is the opposite — signed-in only, same-origin,
// never world-callable — so it gets its own authed route. It reuses the exact
// chatCore engine: load the single platform Help agent, layer per-request page
// context onto its grounding prompt, then handleChatTurn. See docs/HELP_AGENT.md.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { checkRateLimit } from '@/lib/rateLimit'
import { handleChatTurn, type ChatAgent } from '@/lib/chatCore'
import { HELP_AGENT_SLUG, formatHelpPageContext, scrubHelpReply, type HelpPageContext } from '@/lib/helpAgent'
import { logError } from '@/lib/log'

// Feature-integrity scrub on the authoritative reply — strips any fabricated
// link/email before it reaches the user (defense-in-depth over the grounding
// prompt). Mutates result.reply in place; the streaming client reconciles its
// streamed text to this final value, so the scrubbed version wins.
function scrubResult(result: Record<string, unknown>): Record<string, unknown> {
  if (typeof result?.reply === 'string') {
    const { text, flagged } = scrubHelpReply(result.reply)
    if (flagged) void logError('help.chat.scrub', new Error('stripped fabricated link/email from Help reply'))
    result.reply = text
  }
  return result
}

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const AGENT_COLUMNS = 'id, org_id, name, status, config, system_prompt, knowledge_base, personality, guardrails, opponents, contrast_mode, subject, negative_content_mode, sensitive_topics, focus_topics, deflection_enabled, deflection_message, ask_profile, profile_question, intents, demographic_inference, focuses, probe_focus_enabled, research_probes, capability, capability_config, training_urls'

// The Help agent is a single fixed row; cache it across requests (its content
// only changes on a re-seed + redeploy). The per-request page context is layered
// onto a shallow clone, never the cached object.
let cachedAgent: ChatAgent | null = null
async function loadHelpAgent(service: ReturnType<typeof createServiceRoleClient>): Promise<ChatAgent | null> {
  if (cachedAgent) return cachedAgent
  const { data, error } = await service.from('agents').select(AGENT_COLUMNS).eq('slug', HELP_AGENT_SLUG).maybeSingle()
  if (error) { void logError('help.chat.loadAgent', error); return null }
  if (!data) return null
  cachedAgent = data as unknown as ChatAgent
  return cachedAgent
}

export async function POST(req: NextRequest) {
  // Auth — signed-in users only (this is why the route can't reuse the public
  // bots chat route).
  const supabase = await createClient()
  const { userId } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Two-tier: per-user is the real budget; per-IP is a shared-NAT backstop.
  const perUser = await checkRateLimit('help_chat:user:' + userId, 30, 60000)
  if (perUser.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const perIp = await checkRateLimit('help_chat:ip:' + ip, 90, 60000)
  if (perIp.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: { messages?: unknown[]; pageContext?: HelpPageContext } & Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const base = await loadHelpAgent(service)
  if (!base) {
    void logError('help.chat', new Error('Help agent not seeded (slug ' + HELP_AGENT_SLUG + ')'))
    return NextResponse.json({ error: 'Help is unavailable right now.' }, { status: 503 })
  }

  // Layer per-request page context onto the grounding prompt (never mutate the
  // cached agent). formatHelpPageContext returns '' when there's nothing to add.
  const contextBlock = formatHelpPageContext(body.pageContext)
  const agent: ChatAgent = contextBlock
    ? { ...base, system_prompt: (base.system_prompt || '') + contextBlock }
    : base

  if (body.stream !== true) {
    const result = await handleChatTurn({ agent, service, ip }, body)
    return NextResponse.json(scrubResult(result))
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
        const result = await handleChatTurn({ agent, service, ip, emit: send }, body)
        send({ type: 'done', result: scrubResult(result) })
      } catch (e) {
        void logError('help.chat.stream', e)
        send({ type: 'error', error: 'chat failed' })
      }
      if (!closed) { try { controller.close() } catch { /* already closed */ } }
    },
  })
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
