// app/api/bots/[id]/ui-hints/route.ts
//
// POST — extract zero or one UiHint from a (user, assistant) turn pair.
// Public, unauthenticated, CORS-open (same posture as the chat route) —
// the canvas shell calls this immediately after a chat response lands.
//
// Why a sibling endpoint and not inline emission from /chat?
//   See docs/MCO_AGENT.md § 15. Short version: zero conflict with Phase 4
//   convergence (chat route stays untouched), chat latency unchanged (the
//   prose answer doesn't wait on a second LLM call), and the optional
//   inline fold-in is easy if we ever want to single-trip the response.
//
// Cost: extractor runs on `tier: 'fast'` (Haiku 4.5 / 4o-mini) — roughly
// $0.0003-0.0006 per turn. Usage is logged via the standard usage system
// with resource_type 'bot' so cost-per-conversation rolls up correctly.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { callAI } from '@/lib/ai'
import { extractUiHints, type ExtractorContext, type UiHint } from '@/lib/uiHints'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

// CORS — same wildcard posture as /api/bots/[id]/chat. Tightening would
// also require tightening the chat route; see SECURITY NOTE there.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  // Same per-IP rate limit budget as the chat route (30/min). The two
  // endpoints share an IP-bucket prefix so a runaway client doesn't get
  // double the budget by alternating between them.
  const rl = await checkRateLimit('bot_chat:' + ip, 30, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }

  const userMessage = typeof body?.userMessage === 'string' ? body.userMessage : ''
  const assistantMessage = typeof body?.assistantMessage === 'string' ? body.assistantMessage : ''
  if (!userMessage.trim() || !assistantMessage.trim()) {
    // Empty pair → no hint. Return 200 with an empty array (the canvas
    // shell handles the empty case by leaving the existing card in place).
    return NextResponse.json({ ui_hints: [], next_chips: [], revert_canvas: false }, { headers: cors })
  }

  // Optional context block — the canvas shell sends what it has on screen
  // so the extractor can keep restaurants/parking scoped to the active
  // terminal and decide when to revert the canvas. Sanitize aggressively
  // (untrusted from a public endpoint).
  const rawCtx = body?.context
  let extractorContext: ExtractorContext | undefined
  if (rawCtx && typeof rawCtx === 'object') {
    const ctx: ExtractorContext = {}
    if (rawCtx.activeTerminal === 'A' || rawCtx.activeTerminal === 'B' || rawCtx.activeTerminal === 'C') {
      ctx.activeTerminal = rawCtx.activeTerminal
    }
    const allowedTypes: UiHint['type'][] = ['terminal_map', 'parking', 'restaurants', 'shops', 'link_card', 'security_wait', 'welcome']
    if (typeof rawCtx.lastCanvasType === 'string' && allowedTypes.includes(rawCtx.lastCanvasType)) {
      ctx.lastCanvasType = rawCtx.lastCanvasType
    }
    if (ctx.activeTerminal || ctx.lastCanvasType) extractorContext = ctx
  }

  const service = createServiceRoleClient()
  const { data: agent, error } = await service
    .from('agents')
    .select('id, org_id, status')
    .eq('id', params.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404, headers: cors })
  }
  if (agent.status !== 'active') {
    return NextResponse.json({ error: 'This bot is not currently active' }, { status: 403, headers: cors })
  }

  const { hints, next_chips, revert_canvas } = await extractUiHints({
    userMessage,
    assistantMessage,
    context: extractorContext,
    classifier: async (system, userInput) => {
      const res = await callAI({
        tier: 'fast',
        system,
        messages: [{ role: 'user', content: userInput }],
        maxTokens: 380,
        timeoutMs: 6000,
        usage: {
          org_id: agent.org_id,
          resource_type: 'bot',
          resource_id: agent.id,
          event_type: 'ui_hint_extract',
        },
      })
      return res.text || ''
    },
  })

  return NextResponse.json({ ui_hints: hints, next_chips, revert_canvas }, { headers: cors })
}
