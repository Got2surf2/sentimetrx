// app/api/bots/[id]/impression/route.ts
// Public widget-open beacon. Fired fire-and-forget from the embedded agent
// widget on mount (components/ui/ChatBot.tsx). This is the ONLY source of true
// invocation counts: conversation turns are written only after the user's
// first message (lib/chatCore.ts), so opens that never become conversations
// are otherwise invisible. Powers the open->engaged response rate on the agent
// card + Agent Study report.
//
// Public + wildcard-CORS like /chat (CSRF-bypassed in proxy.ts). Rate-limited
// per bot+IP. Writes service-role; never reads back any tenant data.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params

  // Beacon always 204s — never leak whether the bot exists, never fail the
  // widget. Rate-limit to keep the table from being spammed from one origin.
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const { limited } = await checkRateLimit('impression:' + botId + ':' + ip, 30, 60000)
  if (limited) return new NextResponse(null, { status: 204, headers: CORS })

  let body: any = {}
  try { body = await req.json() } catch { /* empty/invalid body is fine */ }

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', botId).single()
  if (bot && bot.org_id) {
    const str = (v: any) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null)
    await service.from('agent_impressions').insert({
      org_id: bot.org_id,
      bot_id: bot.id,
      visitor_id: str(body.visitor_id),
      source: str(body.source),
      medium: str(body.medium),
      campaign: str(body.campaign),
    })
  }
  return new NextResponse(null, { status: 204, headers: CORS })
}
