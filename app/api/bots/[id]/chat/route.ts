// app/api/bots/[id]/chat/route.ts
// POST — public chat endpoint for a custom agent.
// Thin wrapper: rate-limit + parse + load agent → handleChatTurn → return.
// All chat logic lives in lib/chatCore.ts so the PulseIQ townhall route can
// share the same handler (Phase 4 of the agents/PulseIQ convergence).

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { handleChatTurn } from '@/lib/chatCore'

export const dynamic = 'force-dynamic'

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

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit('bot_chat:' + ip, 30, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors })

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: cors })
  }
  if (!body?.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400, headers: cors })
  }

  const service = createServiceRoleClient()
  const { data: agent, error } = await service
    .from('agents')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !agent) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404, headers: cors })
  }
  if (agent.status !== 'active') {
    return NextResponse.json({ error: 'This bot is not currently active' }, { status: 403, headers: cors })
  }

  const result = await handleChatTurn({ agent, service, ip }, body)
  return NextResponse.json(result, { headers: cors })
}
