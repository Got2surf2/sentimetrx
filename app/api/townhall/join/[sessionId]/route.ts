import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST /api/townhall/join/:sessionId — participant joins, gets welcome + first question
export async function POST(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createClient()

  // Fetch session
  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, status, config, discussion_guide')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (session.status !== 'active') {
    return NextResponse.json({ error: 'Session is not active', status: session.status }, { status: 400 })
  }

  // Generate anonymous participant ID
  const participantId = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

  // Fetch active themes to pick starting topic
  const { data: themes } = await supabase
    .from('townhall_themes')
    .select('id, label, question, response_count, response_target, sort_order, source')
    .eq('session_id', session.id)
    .eq('state', 'active')
    .order('sort_order', { ascending: true })

  const activeThemes = (themes || []).filter(t => t.response_count < t.response_target)

  if (activeThemes.length === 0) {
    // No active topics — session might be winding down
    const config = session.config as any
    return NextResponse.json({
      participant_id: participantId,
      bot_message: config?.display?.thank_you_message || 'Thank you for your interest! This session has concluded.',
      is_final: true,
      theme_id: null,
      source: null,
    })
  }

  // Pick starting topic based on assignment mode
  const config = session.config as any
  const mode = config?.engine?.topic_assignment || 'round_robin'
  let topic: typeof activeThemes[0]

  if (mode === 'random') {
    topic = activeThemes[Math.floor(Math.random() * activeThemes.length)]
  } else {
    // Round robin: pick the topic with fewest responses
    topic = activeThemes.reduce((min, t) => t.response_count < min.response_count ? t : min, activeThemes[0])
  }

  const welcome = config?.display?.welcome_message || 'Welcome! Share your thoughts anonymously.'
  const botMessage = welcome + '\n\n' + topic.question

  // Store the first turn (bot message, awaiting user response)
  await supabase.from('townhall_turns').insert({
    session_id: session.id,
    participant_id: participantId,
    turn_number: 1,
    bot_message: botMessage,
    user_message: null,
    theme_id: topic.id,
    source: topic.source === 'guide' ? 'guide' : topic.source === 'custom' ? 'custom' : 'detected_theme',
    skipped: false,
  })

  return NextResponse.json({
    participant_id: participantId,
    bot_message: botMessage,
    theme_id: topic.id,
    source: topic.source,
    is_final: false,
    turn_number: 1,
  })
}
