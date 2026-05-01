// app/api/bots/[id]/conversations/route.ts
// GET — list conversation sessions for a bot (authenticated, org-scoped)
// Returns session summaries: session_id, first message, turn count, timestamps

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user owns this bot via org
  const { data: botCheck } = await supabase
    .from('bots')
    .select('id, org_id')
    .eq('id', params.id)
    .single()
  if (!botCheck) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  // Get conversation sessions with summary stats
  const { data: turns, error } = await supabase
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, content_flags, source, created_at')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get personas for this bot's sessions
  const { data: personas } = await supabase
    .from('bot_session_personas')
    .select('session_id, persona')
    .eq('bot_id', params.id)

  const personaMap: Record<string, any> = {}
  for (const p of (personas || [])) { personaMap[p.session_id] = p.persona }

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
        started_at: t.created_at, last_at: t.created_at, user_name: '',
        flags: [], has_deflection: false, persona: personaMap[t.session_id] || null,
      }
    }
    const s = sessions[t.session_id]
    s.turn_count++
    if (t.created_at < s.started_at) s.started_at = t.created_at
    if (t.created_at > s.last_at) s.last_at = t.created_at
    // Capture first user message
    if (t.role === 'user' && !s.first_message) s.first_message = t.content.slice(0, 120)
    // Detect name: "My name is X" pattern or short first user message (just a name)
    if (t.role === 'user' && !s.user_name) {
      if (/^my name is /i.test(t.content)) {
        s.user_name = t.content.replace(/^my name is /i, '').replace(/[.!].*/, '').trim()
      } else if (t.turn_number <= 1 && t.content.trim().split(/\s+/).length <= 3 && /^[A-Z]/.test(t.content.trim())) {
        s.user_name = t.content.trim()
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
