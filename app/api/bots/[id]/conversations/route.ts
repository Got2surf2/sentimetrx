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
    .select('session_id, turn_number, role, content, created_at')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by session_id
  const sessions: Record<string, { session_id: string; first_message: string; turn_count: number; started_at: string; last_at: string }> = {}
  for (const t of (turns || [])) {
    if (!sessions[t.session_id]) {
      sessions[t.session_id] = { session_id: t.session_id, first_message: '', turn_count: 0, started_at: t.created_at, last_at: t.created_at }
    }
    const s = sessions[t.session_id]
    s.turn_count++
    if (t.created_at < s.started_at) s.started_at = t.created_at
    if (t.created_at > s.last_at) s.last_at = t.created_at
    // Capture first user message
    if (t.role === 'user' && !s.first_message) s.first_message = t.content.slice(0, 120)
  }

  // Sort by most recent first
  const list = Object.values(sessions).sort((a, b) => b.started_at > a.started_at ? 1 : -1)

  return NextResponse.json({ sessions: list })
}
