import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

interface ChatRequest {
  session_id: string
  participant_id: string
  message: string
  turn_number: number
  theme_id: string | null
  skipped?: boolean
}

// Input guardrails — same patterns as clarify
const SKIP_PATTERNS = [
  /\b(fuck|shit|cunt|bitch|asshole|bastard)\b/i,
  /\b(kill|murder|rape|bomb|attack|shoot)\b/i,
  /\b(nude|naked|sex|porn|dick|cock|pussy|tits)\b/i,
  /\b(n[i1]gg|sp[i1]c|ch[i1]nk|k[i1]ke|f[a4]gg)\w*/i,
  /https?:\/\//i,
  /.{1200,}/,
]

function isInputSafe(text: string): boolean {
  if (!text || text.trim().length < 1) return false
  return !SKIP_PATTERNS.some(p => p.test(text))
}

// POST /api/townhall/chat — participant sends a message, gets next bot message
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = checkRateLimit('townhall-chat:' + ip, 20, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  let body: ChatRequest
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, participant_id, message, turn_number, theme_id, skipped } = body

  if (!session_id || !participant_id) {
    return NextResponse.json({ error: 'Missing session_id or participant_id' }, { status: 400 })
  }

  const supabase = createClient()

  // Fetch session
  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, status, config')
    .eq('id', session_id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const config = session.config as any

  // If session ended, return closing message
  if (session.status === 'ended') {
    return NextResponse.json({
      bot_message: config?.session_end?.closing_message || 'This session has ended. Thank you for participating.',
      is_final: true,
      theme_id: null,
      source: null,
      turn_number: turn_number + 1,
    })
  }

  // Update the current turn with the user's response
  if (message || skipped) {
    await supabase
      .from('townhall_turns')
      .update({
        user_message: skipped ? null : message,
        skipped: !!skipped,
      })
      .eq('session_id', session_id)
      .eq('participant_id', participant_id)
      .eq('turn_number', turn_number)

    // Increment response_count on the theme if answered (not skipped)
    if (theme_id && !skipped) {
      // Increment and check if target reached
      const { data: theme } = await supabase
        .from('townhall_themes')
        .select('response_count, response_target')
        .eq('id', theme_id)
        .single()

      if (theme) {
        const newCount = (theme.response_count || 0) + 1
        const updates: Record<string, unknown> = { response_count: newCount }
        if (newCount >= theme.response_target) {
          updates.state = 'completed'
          updates.completed_at = new Date().toISOString()
        }
        await supabase.from('townhall_themes').update(updates).eq('id', theme_id)
      }
    }

    // Increment session response counter
    const { data: currentSession } = await supabase
      .from('townhall_sessions')
      .select('response_counter')
      .eq('id', session_id)
      .single()
    if (currentSession) {
      await supabase
        .from('townhall_sessions')
        .update({ response_counter: (currentSession.response_counter || 0) + 1 })
        .eq('id', session_id)
    }
  }

  // Check turn cap
  const maxTurns = config?.engine?.max_turns_per_participant || 8
  if (turn_number >= maxTurns) {
    return NextResponse.json({
      bot_message: config?.display?.thank_you_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
      is_final: true,
      theme_id: null,
      source: null,
      turn_number: turn_number + 1,
    })
  }

  // Get this participant's conversation history
  const { data: history } = await supabase
    .from('townhall_turns')
    .select('bot_message, user_message, theme_id, source, turn_number')
    .eq('session_id', session_id)
    .eq('participant_id', participant_id)
    .order('turn_number', { ascending: true })

  const turns = history || []
  const discussedThemeIds = new Set(turns.map(t => t.theme_id).filter(Boolean))

  // Find next topic
  const { data: activeThemes } = await supabase
    .from('townhall_themes')
    .select('id, label, description, question, follow_up_angles, source, response_count, response_target')
    .eq('session_id', session_id)
    .eq('state', 'active')
    .order('response_count', { ascending: true })

  const available = (activeThemes || []).filter(
    t => t.response_count < t.response_target && !discussedThemeIds.has(t.id)
  )

  if (available.length === 0) {
    // No more topics — wrap up
    return NextResponse.json({
      bot_message: config?.display?.thank_you_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
      is_final: true,
      theme_id: null,
      source: null,
      turn_number: turn_number + 1,
    })
  }

  // Pick next topic (lowest response count for even coverage)
  const nextTopic = available[0]

  // Build conversation context for Claude
  const conversationMessages = turns
    .filter(t => t.user_message)
    .map(t => `Bot: ${t.bot_message}\nParticipant: ${t.user_message}`)
    .join('\n\n')

  // Check if we should do a clarifier follow-up on the current topic first
  // (if the user just gave a short answer on their first response to a topic)
  const justAnsweredTopic = theme_id
  const currentTopicTurns = turns.filter(t => t.theme_id === justAnsweredTopic).length
  const shouldClarify = !skipped && message && message.split(/\s+/).length < 12 && currentTopicTurns <= 1

  let targetTopic = shouldClarify ? null : nextTopic
  let aiSource: string = shouldClarify ? 'clarifier' : (nextTopic.source === 'guide' ? 'guide' : nextTopic.source === 'custom' ? 'custom' : 'detected_theme')

  // Build the AI prompt
  const systemPrompt = buildSystemPrompt(config, conversationMessages, shouldClarify ? null : nextTopic, message)
  const userPrompt = shouldClarify
    ? `The participant just said: "${message}"\n\nThis was a short response. Ask a warm, natural follow-up to draw out more detail. Maximum 30 words. Just the question, nothing else.`
    : `The participant just finished discussing a topic. Now transition smoothly to the next topic: "${nextTopic.label}"\n\nThe question to work in naturally: "${nextTopic.question}"\n${nextTopic.follow_up_angles?.length ? 'Follow-up angles to consider: ' + nextTopic.follow_up_angles.join(', ') : ''}\n\nGenerate a warm, natural transition and question. Maximum 40 words. Just the message, nothing else.`

  let botMessage: string
  try {
    const timeoutMs = config?.engine?.ai_timeout_ms || 3000

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) throw new Error('API error: ' + response.status)

    const data = await response.json()
    botMessage = data.content?.[0]?.text?.trim() || ''

    // Clean up any leaked reasoning
    botMessage = botMessage
      .replace(/^(Got it|Sure|Okay|I see|Understood|Right|Interesting)[^.!?]*[.!?\-—:]\s*/gi, '')
      .replace(/^(Here'?s?\s+(my|a|the)\s+)[^.!?]*[.!?\-—:]\s*/gi, '')
      .replace(/^(The participant|They('ve| have| are))[^.!?]*[.!?\-—:]\s*/gi, '')
      .replace(/^[-—–]\s*/, '')
      .replace(/^["']|["']$/g, '')
      .trim()

    if (!botMessage || botMessage.length < 5) {
      botMessage = shouldClarify
        ? 'Could you tell me a bit more about that?'
        : nextTopic.question
    }
  } catch {
    // Fallback: use the topic's question directly
    botMessage = shouldClarify
      ? 'Could you tell me a bit more about that?'
      : 'Let me ask you about something else — ' + nextTopic.question
  }

  const nextTurnNumber = turn_number + 1
  const resolvedThemeId = shouldClarify ? justAnsweredTopic : nextTopic.id

  // Store the new turn
  await supabase.from('townhall_turns').insert({
    session_id,
    participant_id,
    turn_number: nextTurnNumber,
    bot_message: botMessage,
    user_message: null,
    theme_id: resolvedThemeId,
    source: aiSource,
    skipped: false,
  })

  return NextResponse.json({
    bot_message: botMessage,
    theme_id: resolvedThemeId,
    source: aiSource,
    is_final: false,
    turn_number: nextTurnNumber,
  })
}

function buildSystemPrompt(
  config: any,
  conversationHistory: string,
  nextTopic: { label: string; description?: string | null; question: string; follow_up_angles?: string[] } | null,
  lastMessage?: string
): string {
  const orgName = config?.context?.org_name || 'the organization'
  const eventDesc = config?.context?.event_description || ''
  const tone = config?.context?.tone || 'warm and conversational'
  const sensitive = config?.context?.sensitive_topics?.join(', ') || 'none'

  return `You are an AI moderator facilitating a town hall discussion on behalf of ${orgName}.
${eventDesc ? `\nEVENT: ${eventDesc}` : ''}

TONE: ${tone}

RULES:
- Be warm, conversational, and brief
- Never sound robotic or like a survey form
- Maximum 40 words per message
- Never mention AI, algorithms, or that you are a bot
- When transitioning between topics, do so naturally — acknowledge what they said, then shift
- NEVER ask about: ${sensitive}
- If the participant says something inappropriate, redirect warmly
- Just output the message — no reasoning, no labels, no quotes

${conversationHistory ? `CONVERSATION SO FAR:\n${conversationHistory}\n` : ''}
${nextTopic ? `\nNEXT TOPIC TO EXPLORE: "${nextTopic.label}" — ${nextTopic.description || ''}\nQuestion to ask: "${nextTopic.question}"` : ''}`
}
