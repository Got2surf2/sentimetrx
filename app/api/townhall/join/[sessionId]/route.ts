import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/townhall/join/:sessionId — check session status (public, no auth)
export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createServiceRoleClient()

  const { data: session, error } = await supabase
    .from('townhall_sessions')
    .select('id, name, status, config')
    .eq('id', params.sessionId)
    .single()

  if (error || !session) {
    return NextResponse.json({ found: false }, { status: 404 })
  }

  const config = session.config as any
  return NextResponse.json({
    found: true,
    name: session.name,
    status: session.status,
    display: config?.display || {},
    closing_message: config?.session_end?.closing_message || null,
  })
}

// POST /api/townhall/join/:sessionId — participant joins, gets welcome + opening question
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createServiceRoleClient()

  const { data: session, error } = await supabase
    .from('townhall_sessions')
    .select('id, status, config')
    .eq('id', params.sessionId)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  if (session.status !== 'active') {
    return NextResponse.json({
      error: 'Session is not active',
      status: session.status,
    }, { status: 400 })
  }

  const config = session.config as any
  const participantId = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

  const welcome = config?.display?.welcome_message || 'Welcome! Share your thoughts anonymously.'
  const openingQuestion = config?.opening_question || 'What\'s on your mind?'
  const botMessage = welcome + '\n\n' + openingQuestion

  await supabase.from('townhall_turns').insert({
    session_id: session.id,
    participant_id: participantId,
    turn_number: 1,
    bot_message: botMessage,
    user_message: null,
    theme_id: null,
    source: 'guide',
    skipped: false,
  })

  return NextResponse.json({
    participant_id: participantId,
    bot_message: botMessage,
    theme_id: null,
    source: 'opening',
    is_final: false,
    turn_number: 1,
  })
}
