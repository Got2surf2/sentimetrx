// app/api/bots/[id]/conversations/route.ts
// GET — list conversation sessions for a bot. Authenticated.
// Org scope: same-org users go through RLS as usual; admins of an admin
// org can read across orgs (Phase E parity — they can see other-org bot
// cards, so they need to see their conversations too).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { isPhase3ReadSafe } from '@/lib/phase3Read'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  // Verify bot exists + access check
  const { data: bot } = await service.from('agents').select('id, org_id, config').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Whether this agent is configured to ask for the respondent's name.
  // When it isn't, respondents stay Anonymous — we must NOT derive a name
  // from their message content (e.g. a short first reply that happens to
  // look like a name). Mirrors components/ui/ChatBot.tsx: off only when
  // the string is explicitly 'false'.
  const askNameOn = (bot.config as any)?.askName !== 'false'

  // Use service role for reads — RLS would otherwise block admin cross-org.
  // READ_PHASE3 selects the new substrate (conversations + conversation_turns)
  // vs the legacy bot_conversation_turns. Downstream aggregation is identical;
  // the new path projects session_id back into the row via the conversations
  // join so the in-JS grouping code below doesn't need to branch.
  let turns: any[]
  if (isPhase3ReadSafe()) {
    const { data, error } = await service
      .from('conversation_turns')
      .select('turn_number, role, content, content_flags, source, created_at, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    turns = (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id,
      turn_number: r.turn_number,
      role: r.role,
      content: r.content,
      content_flags: r.content_flags,
      source: r.source,
      created_at: r.created_at,
    }))
  } else {
    const { data, error } = await service
      .from('bot_conversation_turns')
      .select('session_id, turn_number, role, content, content_flags, source, created_at')
      .eq('bot_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    turns = data || []
  }

  // Get personas + extracted names for this bot's sessions. Name comes
  // from lib/nameExtractor.ts (sql/085) — populated post-response when
  // not already captured. Primary source for user_name; regex
  // heuristics on turn content stay as fallback for sessions that
  // pre-date the name extractor.
  const { data: personas } = await service
    .from('agent_session_personas')
    .select('session_id, persona, name')
    .eq('bot_id', params.id)

  const personaMap: Record<string, any> = {}
  const nameMap: Record<string, string> = {}
  for (const p of (personas || [])) {
    personaMap[p.session_id] = p.persona
    if ((p as any).name) nameMap[p.session_id] = (p as any).name
  }

  // Group by session_id
  interface SessionSummary {
    session_id: string; first_message: string; turn_count: number
    started_at: string; last_at: string; user_name: string
    flags: string[]; has_deflection: boolean; persona: any | null
  }
  const sessions: Record<string, SessionSummary> = {}
  for (const t of (turns || [])) {
    if (!sessions[t.session_id]) {
      sessions[t.session_id] = {
        session_id: t.session_id, first_message: '', turn_count: 0,
        started_at: t.created_at, last_at: t.created_at,
        // Primary source: agent_session_personas.name (from extractor).
        // Heuristic regex below populates as fallback if name was never
        // captured (older sessions, or extractor couldn't find a name).
        // Both are suppressed when the agent doesn't ask for a name.
        user_name: askNameOn ? (nameMap[t.session_id] || '') : '',
        flags: [], has_deflection: false, persona: personaMap[t.session_id] || null,
      }
    }
    const s = sessions[t.session_id]
    s.turn_count++
    if (t.created_at < s.started_at) s.started_at = t.created_at
    if (t.created_at > s.last_at) s.last_at = t.created_at
    // Capture first user message
    if (t.role === 'user' && !s.first_message) s.first_message = t.content.slice(0, 120)
    // Detect name from multiple sources — only when the agent asks for one.
    if (askNameOn && !s.user_name) {
      // "My name is X" pattern
      if (t.role === 'user' && /^my name is /i.test(t.content)) {
        s.user_name = t.content.replace(/^my name is /i, '').replace(/[.!].*/, '').trim()
      }
      // Short first user message (just a name)
      else if (t.role === 'user' && t.turn_number <= 1 && t.content.trim().split(/\s+/).length <= 3 && /^[A-Z]/.test(t.content.trim())) {
        s.user_name = t.content.trim()
      }
      // Extract from bot greeting: "Hey Sanjay!" or "Hi Sanjay," etc.
      else if (t.role === 'assistant' && t.source === 'greeting') {
        var greetMatch = t.content.match(/^(?:Hey|Hi|Hello|Welcome)\s+([A-Z][a-z]+)[!,.\s]/i)
        if (greetMatch) s.user_name = greetMatch[1]
      }
    }
    // Aggregate content flags
    if (Array.isArray(t.content_flags)) {
      for (var f of t.content_flags) { if (!s.flags.includes(f)) s.flags.push(f) }
    }
    if (t.source === 'deflect') s.has_deflection = true
  }

  // Sort by most recent first
  const list = Object.values(sessions).sort((a, b) => b.started_at > a.started_at ? 1 : -1)

  return NextResponse.json({ sessions: list })
}
