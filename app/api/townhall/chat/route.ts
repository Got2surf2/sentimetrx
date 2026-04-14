import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isInputSafe, isOutputClean, cleanAiOutput } from '@/lib/guardrails'

export const dynamic = 'force-dynamic'

interface ChatRequest {
  session_id: string
  participant_id: string
  message: string
  turn_number: number
  theme_id: string | null
  skipped?: boolean
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

  const supabase = createServiceRoleClient()

  // Fetch session
  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, status, config, response_counter')
    .eq('id', session_id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const config = session.config as any

  // If session ended, return closing message
  if (session.status === 'ended') {
    return NextResponse.json({
      bot_message: config?.session_end?.closing_message || 'This session has ended. Thank you for participating.',
      is_final: true, theme_id: null, source: null, turn_number: turn_number + 1,
    })
  }

  // Input guardrail: check for harmful content before processing
  if (message && !skipped && !isInputSafe(message, 1200)) {
    // Store the turn but don't send to AI — redirect warmly
    await supabase.from('townhall_turns')
      .update({ user_message: '[filtered]', skipped: true })
      .eq('session_id', session_id).eq('participant_id', participant_id).eq('turn_number', turn_number)

    const redirectMsg = 'I appreciate you sharing — let\'s keep the conversation focused on the topic. What else is on your mind?'
    const nextTurn = turn_number + 1
    await supabase.from('townhall_turns').insert({
      session_id, participant_id, turn_number: nextTurn, bot_message: redirectMsg,
      user_message: null, theme_id, source: 'clarifier', skipped: false,
    })
    return NextResponse.json({ bot_message: redirectMsg, theme_id, source: 'clarifier', is_final: false, turn_number: nextTurn })
  }

  // Update the current turn with the user's response
  if (message || skipped) {
    await supabase
      .from('townhall_turns')
      .update({ user_message: skipped ? null : message, skipped: !!skipped })
      .eq('session_id', session_id)
      .eq('participant_id', participant_id)
      .eq('turn_number', turn_number)

    // Increment response_count on the theme if answered (not skipped) and theme exists
    if (theme_id && !skipped) {
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
    await supabase
      .from('townhall_sessions')
      .update({ response_counter: (session.response_counter || 0) + 1 })
      .eq('id', session_id)
  }

  // Check turn cap
  const maxTurns = config?.engine?.max_turns_per_participant || 8
  if (turn_number >= maxTurns) {
    return wrapUp(config)
  }

  // Get this participant's conversation history
  const { data: history } = await supabase
    .from('townhall_turns')
    .select('bot_message, user_message, theme_id, source, turn_number')
    .eq('session_id', session_id)
    .eq('participant_id', participant_id)
    .order('turn_number', { ascending: true })

  const turns = history || []

  // Fetch all active themes
  const { data: activeThemes } = await supabase
    .from('townhall_themes')
    .select('id, label, description, question, follow_up_angles, source, response_count, response_target')
    .eq('session_id', session_id)
    .eq('state', 'active')
    .order('response_count', { ascending: true })

  const allTopics = activeThemes || []

  // ── DETERMINE WHAT TO DO NEXT ──────────────────────────────────────────

  const isOpeningResponse = turn_number === 1 && !theme_id
  const discussedThemeIds = new Set(turns.map(t => t.theme_id).filter(Boolean))

  // Check if we should clarify (short answer on current topic)
  const currentTopicTurns = theme_id ? turns.filter(t => t.theme_id === theme_id).length : 0
  const shouldClarify = !isOpeningResponse && !skipped && message && message.split(/\s+/).length < 12 && currentTopicTurns <= 1

  let botMessage: string
  let resolvedThemeId: string | null = null
  let aiSource: string = 'guide'

  if (isOpeningResponse && message && !skipped) {
    // ── OPENING RESPONSE: Match to best topic ────────────────────────────
    const matchResult = await matchResponseToTopic(config, message, allTopics)
    resolvedThemeId = matchResult.themeId
    aiSource = resolvedThemeId ? 'guide' : 'clarifier'
    botMessage = matchResult.followUp

  } else if (shouldClarify) {
    // ── CLARIFIER: Short answer, dig deeper on same topic ────────────────
    resolvedThemeId = theme_id
    aiSource = 'clarifier'
    botMessage = await generateClarifier(config, message, turns)

  } else {
    // ── NEXT TOPIC: Move to an unvisited topic ───────────────────────────
    const available = allTopics.filter(
      t => t.response_count < t.response_target && !discussedThemeIds.has(t.id)
    )

    if (available.length === 0) {
      return wrapUp(config)
    }

    // Pick the topic with fewest responses (even coverage)
    const nextTopic = available[0]
    resolvedThemeId = nextTopic.id
    aiSource = nextTopic.source === 'guide' ? 'guide' : nextTopic.source === 'custom' ? 'custom' : 'detected_theme'
    botMessage = await generateTransition(config, message, turns, nextTopic)
  }

  const nextTurnNumber = turn_number + 1

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

// ── HELPERS ────────────────────────────────────────────────────────────────

function wrapUp(config: any) {
  return NextResponse.json({
    bot_message: config?.display?.thank_you_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
    is_final: true, theme_id: null, source: null, turn_number: 999,
  })
}

async function callClaude(system: string, user: string, timeoutMs = 3000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)
    if (!response.ok) throw new Error('API error: ' + response.status)

    const data = await response.json()
    return cleanAiOutput(data.content?.[0]?.text?.trim() || '')
  } catch {
    clearTimeout(timeout)
    return ''
  }
}

function buildConversationContext(turns: any[]): string {
  return turns
    .filter(t => t.user_message)
    .map(t => `Bot: ${t.bot_message}\nParticipant: ${t.user_message}`)
    .join('\n\n')
}

function baseSystemPrompt(config: any): string {
  const orgName = config?.context?.org_name || 'the organization'
  const eventDesc = config?.context?.event_description || ''
  const tone = config?.context?.tone || 'warm and conversational'
  const sensitive = config?.context?.sensitive_topics?.join(', ') || 'none'

  return `You are an AI moderator facilitating a town hall discussion on behalf of ${orgName}.
${eventDesc ? `\nEVENT: ${eventDesc}` : ''}

TONE: ${tone}

RULES:
- Be warm, conversational, and brief — maximum 40 words
- Never sound robotic or like a survey form
- Never mention AI, algorithms, or that you are a bot
- NEVER ask about: ${sensitive}
- Just output the message text — no reasoning, labels, quotes, or JSON`
}

// ── Match opening response to best guide topic ───────────────────────────

async function matchResponseToTopic(
  config: any,
  response: string,
  topics: { id: string; label: string; description: string | null; question: string; follow_up_angles: string[] }[]
): Promise<{ themeId: string | null; followUp: string }> {
  if (topics.length === 0) {
    return { themeId: null, followUp: 'Could you tell me more about that?' }
  }

  const topicList = topics.map((t, i) => `${i + 1}. "${t.label}" — ${t.description || t.question}`).join('\n')

  const system = baseSystemPrompt(config) + `

DISCUSSION TOPICS:
${topicList}

Your job: Read the participant's opening response. Determine which topic it most closely relates to. Then ask a warm, natural follow-up question that digs deeper into what they said — guided by that topic's focus area.

Return ONLY a JSON object (no other text):
{"topic_number": <1-based index of best matching topic, or 0 if none match>, "follow_up": "<your follow-up question>"}`

  const user = `The participant was asked a broad opening question and responded:\n\n"${response}"\n\nMatch to a topic and follow up.`

  const raw = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000)

  try {
    // Try to parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const topicIdx = (parsed.topic_number || 0) - 1
      const followUp = parsed.follow_up || ''

      if (topicIdx >= 0 && topicIdx < topics.length && followUp) {
        return { themeId: topics[topicIdx].id, followUp: cleanAiOutput(followUp) }
      }
      if (followUp) {
        // No match but AI generated a follow-up anyway — use it without a theme
        return { themeId: null, followUp: cleanAiOutput(followUp) }
      }
    }
  } catch {
    // JSON parse failed — try to use raw text as follow-up
    if (raw && raw.length > 10 && !raw.startsWith('{')) {
      return { themeId: topics[0].id, followUp: raw }
    }
  }

  // Fallback: ask a generic follow-up
  return { themeId: null, followUp: 'That\'s interesting — could you tell me more about what you mean by that?' }
}

// ── Generate clarifier for short responses ───────────────────────────────

async function generateClarifier(config: any, message: string, turns: any[]): Promise<string> {
  const system = baseSystemPrompt(config) + `\n\n${buildConversationContext(turns) ? `CONVERSATION SO FAR:\n${buildConversationContext(turns)}` : ''}`

  const user = `The participant just said: "${message}"\n\nThis was a short response. Ask a warm, natural follow-up to draw out more detail. Maximum 30 words. Just the question.`

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000)
  return (result && isOutputClean(result)) ? result : 'Could you tell me a bit more about that?'
}

// ── Generate natural transition to next topic ────────────────────────────

async function generateTransition(
  config: any,
  lastMessage: string | undefined,
  turns: any[],
  nextTopic: { label: string; description?: string | null; question: string; follow_up_angles?: string[] }
): Promise<string> {
  const convo = buildConversationContext(turns)

  const system = baseSystemPrompt(config) + `\n\n${convo ? `CONVERSATION SO FAR:\n${convo}` : ''}`

  const user = `The participant has finished discussing the previous topic. Now transition naturally to a new topic: "${nextTopic.label}"

The question to work in: "${nextTopic.question}"
${nextTopic.follow_up_angles?.length ? 'Angles to consider: ' + nextTopic.follow_up_angles.join(', ') : ''}

Acknowledge what they've shared so far, then smoothly shift to the new topic. Maximum 40 words. Just the message.`

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000)
  return (result && isOutputClean(result)) ? result : ('Let me ask you about something else — ' + nextTopic.question)
}
