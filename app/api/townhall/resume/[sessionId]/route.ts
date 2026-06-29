import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { pickNextTopic, type NextTopic } from '@/lib/pickNextTopic'

export const dynamic = 'force-dynamic'

// POST /api/townhall/resume/[sessionId] — round-based pacing resume probe.
//
// A held participant (round_hold) polls this. Once the moderator advances the
// room (activates the next round's themes), this serves that round's next
// question as a real bot turn so the participant continues. Returns
// { holding: true } while no new active topic is available for them yet.
//
// Deliberately isolated from the main chat handler (which serves every PulseIQ
// session): no AI, no clarifier/deflection/language logic — just the shared
// pickNextTopic selector over the participant's undiscussed active topics.
// Public/participant-facing like /api/townhall/chat (service-role internally;
// scoped by session + participant ids, not user auth).
export async function POST(req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params

  let body: { participant_id?: string; language?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const participant_id = body.participant_id
  if (!participant_id) return NextResponse.json({ error: 'Missing participant_id' }, { status: 400 })

  // Light throttle — the widget polls this every few seconds while held.
  const rl = await checkRateLimit('townhall-resume:p:' + participant_id, 30, 60000)
  if (rl.limited) return NextResponse.json({ holding: true })

  const db = createServiceRoleClient()

  // Resolve session by id or slug (mirrors the chat route).
  let session: any = null
  {
    const { data } = await db.from('townhall_sessions').select('id, status, config').eq('id', sessionId).maybeSingle()
    session = data
  }
  if (!session) {
    const { data } = await db.from('townhall_sessions').select('id, status, config').eq('slug', sessionId.toLowerCase()).maybeSingle()
    session = data
  }
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config = session.config as any
  if (session.status === 'ended') {
    return NextResponse.json({ holding: false, is_final: true, bot_message: config?.closing_message || 'This session has ended. Thank you for participating.' })
  }
  if (session.status !== 'active') return NextResponse.json({ holding: true })

  // Participant history → discussed topics + last turn number.
  const { data: history } = await db
    .from('townhall_turns')
    .select('theme_id, turn_number')
    .eq('session_id', session.id)
    .eq('participant_id', participant_id)
    .order('turn_number', { ascending: true })
  const turns = history || []
  const discussedThemeIds = new Set(turns.map(t => t.theme_id).filter(Boolean) as string[])
  const lastTurn = turns.reduce((m, t) => Math.max(m, t.turn_number || 0), 0)

  // Turn-budget guard — don't push more rounds past the participant cap.
  const maxTurns = config?.engine?.max_turns_per_participant || 20
  if (lastTurn >= maxTurns) {
    return NextResponse.json({ holding: false, is_final: true, bot_message: config?.closing_message || 'Thank you for sharing your thoughts. Your input is really valuable.' })
  }

  // Active themes + live response counts (mirrors the chat handler's load).
  const { data: activeThemes } = await db
    .from('townhall_themes')
    .select('id, label, description, question, follow_up_angles, keywords, source, response_target, round_number')
    .eq('session_id', session.id)
    .eq('state', 'active')
  const themeRound: Record<string, number | null> = {}
  for (const t of activeThemes || []) themeRound[t.id] = (t as any).round_number ?? null
  const { data: turnCounts } = await db
    .from('townhall_turns')
    .select('theme_id')
    .eq('session_id', session.id)
    .not('user_message', 'is', null)
    .eq('skipped', false)
  const liveCountMap: Record<string, number> = {}
  for (const t of turnCounts || []) { if (t.theme_id) liveCountMap[t.theme_id] = (liveCountMap[t.theme_id] || 0) + 1 }

  const pickerInput: NextTopic[] = (activeThemes || []).map(t => ({
    id: t.id,
    label: t.label,
    description: t.description,
    question: t.question,
    follow_up_angles: t.follow_up_angles,
    keywords: (t as any).keywords || [],
    source: t.source,
    response_target: t.response_target,
    response_count: liveCountMap[t.id] || 0,
  }))
  const pick = pickNextTopic(pickerInput, { discussedTopicIds: discussedThemeIds })

  // Nothing new active for this participant yet — keep holding.
  if (!pick.topic) return NextResponse.json({ holding: true })

  // Item-aware lead-in: this is the entry question of a freshly-served round,
  // so prefix the tasting item's name when we have one (deterministic — no AI
  // call, keeps the poll fast). Falls back to the question verbatim.
  const round = themeRound[pick.topic.id]
  const item = round != null ? (((config?.rounds || []).find((r: any) => r?.number === round)?.item_name) || '') : ''
  const botMessage = item ? 'Now for ' + item + ' — ' + pick.topic.question : pick.topic.question

  // Serve the round's question as a real bot turn so it's in the transcript and
  // the participant's next answer threads onto it normally.
  const nextTurn = lastTurn + 1
  const { error } = await db.from('townhall_turns').insert({
    session_id: session.id,
    participant_id,
    turn_number: nextTurn,
    bot_message: botMessage,
    user_message: null,
    user_message_en: null,
    language: body.language || 'en',
    theme_id: pick.topic.id,
    theme_label: pick.topic.label,
    source: 'guide',
    skipped: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    holding: false,
    bot_message: botMessage,
    theme_id: pick.topic.id,
    turn_number: nextTurn,
    source: 'guide',
  })
}
