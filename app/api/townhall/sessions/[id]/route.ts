import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/townhall/sessions/:id — get session with themes + stats
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  const { data: session, error } = await db
    .from('townhall_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Fetch themes
  const { data: themes } = await db
    .from('townhall_themes')
    .select('*')
    .eq('session_id', params.id)
    .order('sort_order', { ascending: true })

  // Fetch turn stats
  const { data: turns } = await db
    .from('townhall_turns')
    .select('participant_id, skipped, user_message, theme_id, source')
    .eq('session_id', params.id)

  const allTurns = turns || []
  const participants = new Set(allTurns.map(t => t.participant_id))
  const answered = allTurns.filter(t => !t.skipped && t.user_message)
  const avgWords = answered.length > 0
    ? Math.round(answered.reduce((sum, t) => sum + (t.user_message?.split(/\s+/).length || 0), 0) / answered.length)
    : 0

  const stats = {
    joined: participants.size,
    total_turns: allTurns.length,
    answered: answered.length,
    skipped: allTurns.filter(t => t.skipped).length,
    skip_rate: allTurns.length > 0 ? Math.round((allTurns.filter(t => t.skipped).length / allTurns.length) * 100) : 0,
    avg_words: avgWords,
    avg_turns: participants.size > 0 ? +(allTurns.length / participants.size).toFixed(1) : 0,
  }

  return NextResponse.json({ session, themes: themes || [], stats })
}

// PATCH /api/townhall/sessions/:id — update session config or status
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Handle restart: reset to setup, clear all turns and themes
  if (body.restart) {
    await db.from('townhall_turns').delete().eq('session_id', params.id)
    await db.from('townhall_themes').delete().eq('session_id', params.id)
    const { data, error } = await db
      .from('townhall_sessions')
      .update({ status: 'setup', started_at: null, ended_at: null, response_counter: 0 })
      .eq('id', params.id)
      .select('id, status, started_at, ended_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Only allow updating specific fields
  const allowed = ['name', 'config', 'discussion_guide', 'status']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Handle status transitions
  if (updates.status === 'active') {
    updates.started_at = new Date().toISOString()
  } else if (updates.status === 'ended') {
    updates.ended_at = new Date().toISOString()
  }

  const { data, error } = await db
    .from('townhall_sessions')
    .update(updates)
    .eq('id', params.id)
    .select('id, status, started_at, ended_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // When starting a session, seed the discussion guide topics into townhall_themes
  if (updates.status === 'active') {
    const { data: session } = await db
      .from('townhall_sessions')
      .select('discussion_guide, config')
      .eq('id', params.id)
      .single()

    if (session?.discussion_guide && Array.isArray(session.discussion_guide)) {
      const guideThemes = session.discussion_guide.map((topic: any, idx: number) => ({
        session_id: params.id,
        label: topic.label,
        description: topic.description || null,
        question: topic.opening_question,
        follow_up_angles: topic.follow_up_angles || [],
        state: 'active',
        source: 'guide',
        response_target: topic.response_target || session.config?.engine?.default_response_target || 30,
        sort_order: idx,
      }))

      if (guideThemes.length > 0) {
        await db.from('townhall_themes').insert(guideThemes)
      }
    }
  }

  return NextResponse.json(data)
}
