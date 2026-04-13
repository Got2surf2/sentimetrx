import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'

// GET /api/townhall/sessions — list sessions for current user's org
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('townhall_sessions')
    .select('id, name, status, config, discussion_guide, response_counter, started_at, ended_at, created_at, created_by')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get participant + turn counts per session
  const sessionIds = (data || []).map(s => s.id)
  let stats: Record<string, { participants: number; turns: number }> = {}
  if (sessionIds.length > 0) {
    const { data: turnData } = await supabase
      .from('townhall_turns')
      .select('session_id, participant_id')
      .in('session_id', sessionIds)

    for (const sid of sessionIds) {
      const sessionTurns = (turnData || []).filter(t => t.session_id === sid)
      const uniqueParticipants = new Set(sessionTurns.map(t => t.participant_id))
      stats[sid] = { participants: uniqueParticipants.size, turns: sessionTurns.length }
    }
  }

  const enriched = (data || []).map(s => ({
    ...s,
    participants: stats[s.id]?.participants || 0,
    turns: stats[s.id]?.turns || 0,
  }))

  return NextResponse.json(enriched)
}

// POST /api/townhall/sessions — create a new session
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('client_id, org_id')
    .eq('id', user.id)
    .single()

  let body: { name: string; config: TownHallConfig; discussion_guide: TownHallGuideTopic[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, config, discussion_guide } = body
  if (!name || !config || !discussion_guide) {
    return NextResponse.json({ error: 'Missing required fields: name, config, discussion_guide' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('townhall_sessions')
    .insert({
      org_id: userData?.org_id || userData?.client_id || '',
      created_by: user.id,
      name,
      config,
      discussion_guide,
      status: 'setup',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
