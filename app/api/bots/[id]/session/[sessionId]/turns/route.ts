// app/api/bots/[id]/session/[sessionId]/turns/route.ts
// GET — public endpoint to rehydrate a respondent's conversation history.
// Used by components/ui/ChatBot.tsx on mount when a stored session_id is
// found in localStorage — lets respondents resume after a refresh / tab
// close / connectivity drop.
//
// SECURITY NOTE: this route is intentionally unauthenticated, like the
// chat endpoint. Access control is the session_id itself — generated
// client-side as `bs_${ts36}_${rand36(6)}` (~30 bits of randomness;
// unguessable in practice). The same person on the same browser is the
// intended consumer; anyone with the link could theoretically replay it.
// The session_id is bot-scoped (stored in localStorage keyed by botId).
// Returns role/content/turn_number only — no flags, sentiment, or debug.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; sessionId: string }> }

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = await checkRateLimit('bot_session_turns:' + ip, 30, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: cors })

  if (!params.id || !params.sessionId) {
    return NextResponse.json({ error: 'bot id and session id required' }, { status: 400, headers: cors })
  }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(params.sessionId)) {
    return NextResponse.json({ error: 'invalid session id' }, { status: 400, headers: cors })
  }

  const service = createServiceRoleClient()

  // Confirm the agent exists + is active. Same gate as the chat endpoint
  // so a draft / paused agent can't be queried by URL guess.
  const { data: agent, error: agentErr } = await service
    .from('agents')
    .select('id, status')
    .eq('id', params.id)
    .single()
  if (agentErr || !agent) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404, headers: cors })
  }
  if (agent.status !== 'active') {
    return NextResponse.json({ error: 'This bot is not currently active' }, { status: 403, headers: cors })
  }

  const { data: turns, error: turnsErr } = await service
    .from('bot_conversation_turns')
    .select('turn_number, role, content')
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)
    .order('turn_number', { ascending: true })
    .limit(200)

  if (turnsErr) {
    return NextResponse.json({ error: turnsErr.message }, { status: 500, headers: cors })
  }

  return NextResponse.json({ turns: turns || [] }, { headers: cors })
}
