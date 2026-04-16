import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isOutputClean, cleanAiOutput } from '@/lib/guardrails'
import { checkMessage } from '@/lib/contentGuard'
import { callAI } from '@/lib/ai'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'

export const dynamic = 'force-dynamic'

interface ChatRequest {
  session_id: string
  participant_id: string
  message: string
  turn_number: number
  theme_id: string | null
  skipped?: boolean
  language?: string
  debug?: boolean   // client-side debug flag (validated via password)
}

// POST /api/townhall/chat — participant sends a message, gets next bot message
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const rl = checkRateLimit('townhall-chat:' + ip, 20, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  let body: ChatRequest
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, participant_id, message, turn_number, theme_id, skipped, language } = body

  if (!session_id || !participant_id) {
    return NextResponse.json({ error: 'Missing session_id or participant_id' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  // Fetch session (by UUID or slug)
  let session: any = null
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)
  if (isUUID) {
    const { data } = await supabase.from('townhall_sessions').select('id, status, config, response_counter, started_at').eq('id', session_id).single()
    session = data
  }
  if (!session) {
    const { data } = await supabase.from('townhall_sessions').select('id, status, config, response_counter, started_at').eq('slug', session_id.toLowerCase()).single()
    session = data
  }
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const config = session.config as any

  // Auto-end check: timed mode (duration exceeded) or inactivity mode (no recent turns)
  if (session.status === 'active' && config?.session_end?.mode !== 'manual') {
    let shouldEnd = false
    if (config.session_end.mode === 'timed' && session.started_at) {
      const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 60000
      if (elapsed >= (config.session_end.duration_minutes || 90)) shouldEnd = true
    }
    if (config.session_end.mode === 'inactivity') {
      const { data: lastTurn } = await supabase
        .from('townhall_turns')
        .select('created_at')
        .eq('session_id', session.id)
        .not('user_message', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (lastTurn) {
        const idle = (Date.now() - new Date(lastTurn.created_at).getTime()) / 60000
        if (idle >= (config.session_end.inactivity_timeout_minutes || 30)) shouldEnd = true
      }
    }
    if (shouldEnd) {
      await supabase.from('townhall_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', session.id)
      session.status = 'ended'
    }
  }

  // If session ended or paused, return appropriate message
  if (session.status === 'ended') {
    return NextResponse.json({
      bot_message: config?.closing_message || config?.session_end?.closing_message || 'This session has ended. Thank you for participating.',
      is_final: true, theme_id: null, source: null, turn_number: turn_number + 1,
    })
  }
  if (session.status === 'paused') {
    return NextResponse.json({
      bot_message: 'This session is currently paused. Please check back shortly.',
      is_final: false, theme_id: null, source: null, turn_number: turn_number, paused: true,
    })
  }

  // Debug mode toggle via #debug <session-id> — not a turn, re-send previous bot message
  if (message && !skipped) {
    const debugMatch = message.trim().match(/^#debug\s+(.+)$/i)
    const debugOff = /^#debug\s+off$/i.test(message.trim())
    if (debugOff || (debugMatch && debugMatch[1].trim() === session.id)) {
      // Fetch previous bot message to re-send
      const { data: lastBotTurn } = await supabase
        .from('townhall_turns')
        .select('bot_message')
        .eq('session_id', session.id)
        .eq('participant_id', participant_id)
        .not('bot_message', 'is', null)
        .order('turn_number', { ascending: false })
        .limit(1)
        .single()

      const prevMsg = lastBotTurn?.bot_message || config?.opening_message || 'What\'s on your mind?'

      return NextResponse.json({
        bot_message: prevMsg,
        theme_id, source: 'system', is_final: false, turn_number,
        debug_mode: !debugOff,
      })
    }
    // Wrong password — don't reveal that debug exists, just treat as normal message
  }

  // Content guard: check for harmful content with strike-based escalation
  const safetyConfig = { enabled: true, profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true, ...(config?.content_safety || {}) }
  let toneNudge = false
  if (message && !skipped) {
    const check = checkMessage(participant_id, message, { safetyConfig, maxLength: 1200 })
    if (check.nudge) toneNudge = true
    if (!check.safe) {
      // Store the turn as filtered
      await supabase.from('townhall_turns')
        .update({ user_message: '[filtered]', skipped: true })
        .eq('session_id', session.id).eq('participant_id', participant_id).eq('turn_number', turn_number)

      const warningMsg = check.warning || 'I appreciate you sharing — let\'s keep the conversation focused on the topic. What else is on your mind?'
      const nextTurn = turn_number + 1
      await supabase.from('townhall_turns').insert({
        session_id: session.id, participant_id, turn_number: nextTurn, bot_message: warningMsg,
        user_message: null, user_message_en: null, language: language || 'en', theme_id, source: 'clarifier', skipped: false,
      })
      return NextResponse.json({
        bot_message: warningMsg, theme_id, source: 'clarifier',
        is_final: !!check.shutdown, turn_number: nextTurn,
        ...(check.shutdown ? { shutdown: true } : {}),
      })
    }
  }

  // Language switch detection — AI-based, only triggers at >=95% confidence
  // Don't count as a turn, confirm bilingually and re-send previous bot message in new language
  if (message && !skipped) {
    const langSwitch = await detectLanguageSwitch(message.trim())
    if (langSwitch) {
      const targetLang = langSwitch.lang

      // Get the last bot message for this participant
      const { data: lastBotTurn } = await supabase
        .from('townhall_turns')
        .select('bot_message')
        .eq('session_id', session.id)
        .eq('participant_id', participant_id)
        .not('bot_message', 'is', null)
        .order('turn_number', { ascending: false })
        .limit(1)
        .single()

      const prevBotMsg = lastBotTurn?.bot_message || config?.opening_message || 'What\'s on your mind?'

      // Build response: bilingual confirmation + translated previous bot message
      const confirm = SWITCH_CONFIRM[targetLang] || `Sure — switching languages!`
      let translatedMsg = prevBotMsg
      if (targetLang !== 'en') {
        try {
          const tr = await callClaude(
            'Translate the following text to ' + targetLang + '. Return ONLY the translation, nothing else. Preserve tone.',
            prevBotMsg, 3000
          )
          if (tr.text) translatedMsg = tr.text
        } catch { /* keep English */ }
      }

      const labels = TH_LABELS[targetLang] || TH_LABELS.en

      // Don't increment turn, don't store as a real turn
      return NextResponse.json({
        bot_message: confirm + '\n\n' + translatedMsg,
        theme_id,
        source: 'language_switch',
        is_final: false,
        turn_number, // same turn number — no increment
        language_switched: targetLang,
        skip_label: labels.skip,
        done_label: labels.done,
      })
    }
  }

  // Translate non-English responses to English for analysis
  let messageEn: string | null = null
  if (message && !skipped && language && language !== 'en') {
    try {
      const transResult = await callClaude(
        'You are a translator. Translate the following text to English. Return ONLY the translation, nothing else.',
        message,
        3000
      )
      if (transResult.text && transResult.text.length > 2) messageEn = transResult.text
    } catch { /* translation failed — store without, theme detection will work on original */ }
  }

  // Update the current turn with the user's response (raw — bleeping is done on display)
  if (message || skipped) {
    const isDone = skipped && message === '[done]'
    const skipLabel = isDone ? '[Done — participant ended conversation]' : '[Skipped — participant declined to answer]'
    const turnUpdate: Record<string, unknown> = {
      user_message: skipped ? skipLabel : message,
      user_message_en: skipped ? skipLabel : (messageEn || message),
      language: language || 'en',
      skipped: !!skipped,
    }
    await supabase
      .from('townhall_turns')
      .update(turnUpdate)
      .eq('session_id', session.id)
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
    const newCounter = (session.response_counter || 0) + 1
    await supabase
      .from('townhall_sessions')
      .update({ response_counter: newCounter })
      .eq('id', session.id)

    // Auto theme detection: trigger every N responses (fire-and-forget, don't block chat)
    if (config?.engine?.theme_detection_mode === 'auto' && !skipped) {
      const everyN = config.engine.theme_detection_every_n_responses || 20
      if (newCounter > 0 && newCounter % everyN === 0) {
        detectThemesForSession(session.id).catch(() => {})
      }
    }
  }

  // Check turn cap
  const maxTurns = config?.engine?.max_turns_per_participant || 20
  if (turn_number >= maxTurns) {
    return wrapUp(config)
  }

  // Get this participant's conversation history
  const { data: history } = await supabase
    .from('townhall_turns')
    .select('bot_message, user_message, theme_id, source, turn_number')
    .eq('session_id', session.id)
    .eq('participant_id', participant_id)
    .order('turn_number', { ascending: true })

  const turns = history || []

  // Fetch all active themes
  const { data: activeThemes } = await supabase
    .from('townhall_themes')
    .select('id, label, description, question, follow_up_angles, keywords, source, response_count, response_target')
    .eq('session_id', session.id)
    .eq('state', 'active')
    .order('response_count', { ascending: true })

  const allTopics = activeThemes || []

  // ── DETERMINE WHAT TO DO NEXT ──────────────────────────────────────────

  const isOpeningResponse = turn_number === 1 && !theme_id
  const discussedThemeIds = new Set(turns.map(t => t.theme_id).filter(Boolean))

  // Check if we should clarify (short answer on current topic)
  const currentTopicTurns = theme_id ? turns.filter(t => t.theme_id === theme_id).length : 0
  const clarifierTurnsOnTopic = theme_id ? turns.filter(t => t.theme_id === theme_id && t.source === 'clarifier').length : 0
  const maxClarifiersPerTopic = 2
  const wordCount = message ? message.split(/\s+/).length : 0
  const shouldClarify = !isOpeningResponse && !skipped && message && wordCount < 12 && currentTopicTurns <= 3 && clarifierTurnsOnTopic < maxClarifiersPerTopic

  // Testing mode: accumulate reasoning steps
  const testing = !!config?.testing || !!body.debug
  const debug: string[] = []

  let botMessage: string
  let resolvedThemeId: string | null = null
  let aiSource: string = 'guide'

  if (isOpeningResponse && message && !skipped) {
    // ── OPENING RESPONSE: Match to best topic ────────────────────────────
    if (testing) debug.push('DECISION: Opening response — matching to best topic from ' + allTopics.length + ' available topics')
    const matchResult = await matchResponseToTopic(config, message, language, allTopics, testing, toneNudge)
    resolvedThemeId = matchResult.themeId
    aiSource = resolvedThemeId ? 'guide' : 'clarifier'
    botMessage = matchResult.followUp
    if (testing) {
      const matched = allTopics.find(t => t.id === resolvedThemeId)
      debug.push(resolvedThemeId ? 'MATCHED TOPIC: "' + (matched?.label || '?') + '"' : 'NO TOPIC MATCH — using generic follow-up')
      if (matchResult.thinking.length > 0) debug.push('AI REASONING:', ...matchResult.thinking)
    }

  } else if (shouldClarify) {
    // ── CLARIFIER: Short answer, dig deeper on same topic ────────────────
    resolvedThemeId = theme_id
    aiSource = 'clarifier'
    if (testing) {
      const topic = allTopics.find(t => t.id === theme_id)
      debug.push('DECISION: Clarifier triggered')
      debug.push('REASON: Response was ' + wordCount + ' words (< 12 threshold) and only ' + currentTopicTurns + ' prior turn(s) on topic "' + (topic?.label || '?') + '"')
    }
    const clarifyResult = await generateClarifier(config, message, turns, language, testing, toneNudge)
    botMessage = clarifyResult.text
    if (testing && clarifyResult.thinking.length > 0) debug.push('AI REASONING:', ...clarifyResult.thinking)

  } else {
    // ── NEXT TOPIC: Move to an unvisited topic ───────────────────────────
    const available = allTopics.filter(
      t => t.response_count < t.response_target && !discussedThemeIds.has(t.id)
    )

    if (testing && !shouldClarify && !isOpeningResponse) {
      debug.push('DECISION: Move to next topic')
      if (wordCount >= 12) debug.push('Clarifier skipped: response was ' + wordCount + ' words (>= 12 threshold)')
      else if (clarifierTurnsOnTopic >= maxClarifiersPerTopic) debug.push('Clarifier skipped: hit max ' + maxClarifiersPerTopic + ' clarifiers on this topic')
      else if (currentTopicTurns > 3) debug.push('Clarifier skipped: already had ' + currentTopicTurns + ' turns on this topic')
      debug.push('Topics discussed: ' + discussedThemeIds.size + ' | Available: ' + available.length)
    }

    if (available.length === 0) {
      const revisit = allTopics
        .filter(t => t.response_count < t.response_target)
        .sort((a: any, b: any) => (b.response_target - b.response_count) - (a.response_target - a.response_count))
      if (revisit.length > 0) {
        const nextTopic = revisit[0]
        resolvedThemeId = nextTopic.id
        aiSource = 'revisit'
        if (testing) debug.push('ALL TOPICS VISITED — revisiting "' + nextTopic.label + '" (most headroom: ' + nextTopic.response_count + '/' + nextTopic.response_target + ')')
        const clarifyResult = await generateClarifier(config, message, turns, language, testing, toneNudge)
        botMessage = clarifyResult.text
        if (testing && clarifyResult.thinking.length > 0) debug.push('AI REASONING:', ...clarifyResult.thinking)
      } else {
        return wrapUp(config)
      }
    } else {

    let nextTopic = available[0]
    let probedKeyword: string | null = null
    if (message && !skipped) {
      const lower = message.toLowerCase()
      for (const t of available) {
        if (t.id === theme_id) continue
        const kws: string[] = (t as any).keywords || []
        if (kws.length > 0) {
          const matchedKw = kws.find(function(kw) { return lower.includes(kw.toLowerCase()) })
          if (matchedKw) {
            nextTopic = t
            probedKeyword = matchedKw
            break
          }
        }
      }
    }

    if (testing) {
      if (probedKeyword) {
        debug.push('SMART PROBE: Keyword "' + probedKeyword + '" matched — jumping to "' + nextTopic.label + '" instead of default queue')
      } else {
        debug.push('NEXT TOPIC: "' + nextTopic.label + '" (fewest responses: ' + nextTopic.response_count + '/' + nextTopic.response_target + ')')
      }
    }

    resolvedThemeId = nextTopic.id
    aiSource = nextTopic.source === 'guide' ? 'guide' : nextTopic.source === 'custom' ? 'custom' : 'detected_theme'
    const transResult = await generateTransition(config, message, language, turns, nextTopic, testing, toneNudge, !!skipped)
    botMessage = transResult.text
    if (testing && transResult.thinking.length > 0) debug.push('AI REASONING:', ...transResult.thinking)
    }
  }

  const nextTurnNumber = turn_number + 1

  if (testing) {
    debug.push('SOURCE: ' + aiSource + ' | TURN: ' + nextTurnNumber)
  }

  // Store the new turn
  await supabase.from('townhall_turns').insert({
    session_id: session.id,
    participant_id,
    turn_number: nextTurnNumber,
    bot_message: botMessage,
    user_message: null,
    user_message_en: null,
    language: language || 'en',
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
    ...(testing ? { _debug: debug } : {}),
  })
}

// ── HELPERS ────────────────────────────────────────────────────────────────

function wrapUp(config: any) {
  return NextResponse.json({
    bot_message: config?.closing_message || config?.display?.thank_you_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
    is_final: true, theme_id: null, source: null, turn_number: 999,
  })
}

async function callClaude(system: string, user: string, timeoutMs = 3000, verbose = false): Promise<{ text: string; thinking: string[] }> {
  const verboseSystem = verbose
    ? system + '\n\nDEBUG MODE — Think step by step. Before your response, write your reasoning process (what you noticed, what you considered, why you chose this response). Then write a line containing exactly "---RESPONSE---" and your actual message after it.'
    : system
  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: verbose ? 500 : 200,
      timeoutMs: verbose ? Math.max(timeoutMs, 5000) : timeoutMs,
      system: verboseSystem,
      messages: [{ role: 'user', content: user }],
    })
    const raw = result.text?.trim() || ''
    if (verbose && raw.includes('---RESPONSE---')) {
      const [thinkingPart, responsePart] = raw.split('---RESPONSE---')
      const thinking = thinkingPart.trim().split('\n').filter(Boolean)
      return { text: cleanAiOutput(responsePart.trim()), thinking }
    }
    return { text: cleanAiOutput(raw), thinking: [] }
  } catch {
    return { text: '', thinking: [] }
  }
}

function buildConversationContext(turns: any[]): string {
  return turns
    .filter(t => t.user_message)
    .map(t => `Bot: ${t.bot_message}\nParticipant: ${t.user_message}`)
    .join('\n\n')
}

// ── AI-based language switch detection ────────────────────────────────────
// Only triggers when >=95% confident the message is a language change request.
// Returns { lang, confidence } or null if not a language switch.

const LANG_CODES = ['en','es','fr','de','pt','it','zh','ja','ko','ar','hi','vi','tl','ru','pl']

async function detectLanguageSwitch(msg: string): Promise<{ lang: string; confidence: number } | null> {
  // Quick filter: very long messages are almost certainly not language switch requests
  if (msg.length > 120) return null

  const result = await callClaude(
    `You are a language-switch classifier for a chat system. The user is mid-conversation with an AI moderator.

Determine if this message is ONLY a request to switch the conversation language.
Return JSON: {"is_switch": true/false, "lang": "ISO code", "confidence": 0-100}

RULES:
- Confidence must be >= 95 to count. Be conservative — err on the side of NOT detecting.
- A message like "español" or "can you speak French?" is a clear switch (confidence 98-100).
- A message like "no hablo inglés" or "je ne parle pas anglais" is a switch (confidence 95+).
- A message that MENTIONS a language but is actually answering a question is NOT a switch. E.g. "I think the Spanish community needs more support" — this talks ABOUT Spanish, not requesting Spanish.
- If the message contains substantive content beyond the language request, it is NOT a pure switch — return is_switch: false.
- Supported languages: ${LANG_CODES.join(', ')}
- Return ONLY the JSON, nothing else.`,
    msg,
    3000
  )

  try {
    const parsed = JSON.parse(result.text)
    if (parsed.is_switch && parsed.confidence >= 95 && LANG_CODES.includes(parsed.lang)) {
      return { lang: parsed.lang, confidence: parsed.confidence }
    }
  } catch { /* parse failed — not a switch */ }
  return null
}

// Translated TH button labels per language
const TH_LABELS: Record<string, { skip: string; done: string }> = {
  en: { skip: "I'd rather not answer that", done: "I'm done sharing" },
  es: { skip: 'Prefiero no responder', done: 'Ya terminé de compartir' },
  fr: { skip: 'Je préfère ne pas répondre', done: "J'ai fini de partager" },
  de: { skip: 'Das möchte ich lieber nicht beantworten', done: 'Ich bin fertig' },
  pt: { skip: 'Prefiro não responder', done: 'Terminei de compartilhar' },
  it: { skip: 'Preferisco non rispondere', done: 'Ho finito di condividere' },
  zh: { skip: '我不想回答这个问题', done: '我说完了' },
  ja: { skip: '答えたくないです', done: '以上です' },
  ko: { skip: '대답하고 싶지 않습니다', done: '더 이상 없습니다' },
  ar: { skip: 'أفضّل عدم الإجابة', done: 'انتهيت من المشاركة' },
  hi: { skip: 'मैं इसका जवाब नहीं देना चाहता/चाहती', done: 'मैंने अपनी बात कह दी' },
  vi: { skip: 'Tôi không muốn trả lời', done: 'Tôi đã chia sẻ xong' },
  tl: { skip: 'Ayoko nang sagutin iyan', done: 'Tapos na ako' },
  ru: { skip: 'Я предпочитаю не отвечать', done: 'Я закончил(а)' },
  pl: { skip: 'Wolę nie odpowiadać', done: 'Skończyłem/am' },
}

// Bilingual confirmation messages for language switches
const SWITCH_CONFIRM: Record<string, string> = {
  es: "Sure — switching to Spanish! / ¡Claro — cambiando a español!",
  fr: "Sure — switching to French! / Bien sûr — on passe au français !",
  de: "Sure — switching to German! / Klar — wir wechseln zu Deutsch!",
  pt: "Sure — switching to Portuguese! / Claro — mudando para português!",
  it: "Sure — switching to Italian! / Certo — passiamo all'italiano!",
  zh: "Sure — switching to Chinese! / 好的，切换到中文！",
  ja: "Sure — switching to Japanese! / はい、日本語に切り替えます！",
  ko: "Sure — switching to Korean! / 네, 한국어로 전환합니다!",
  ar: "Sure — switching to Arabic! / !بالطبع — سننتقل إلى العربية",
  hi: "Sure — switching to Hindi! / बिल्कुल — हिंदी में बात करते हैं!",
  vi: "Sure — switching to Vietnamese! / Được — chuyển sang tiếng Việt!",
  tl: "Sure — switching to Filipino! / Sige — lilipat tayo sa Filipino!",
  ru: "Sure — switching to Russian! / Конечно — переключаемся на русский!",
  pl: "Sure — switching to Polish! / Jasne — przechodzimy na polski!",
  en: "Sure — switching back to English!",
}

function baseSystemPrompt(config: any, language?: string): string {
  const orgName = config?.context?.org_name || 'the organization'
  const eventDesc = config?.context?.event_description || ''
  const tone = config?.context?.tone || 'warm and conversational'
  const sensitive = config?.context?.sensitive_topics?.join(', ') || 'none'
  const industry = config?.industry || ''
  const langInstruction = language && language !== 'en'
    ? `\n\nIMPORTANT: The participant is using ${language}. You MUST respond ONLY in ${language}. Do NOT respond in English.`
    : ''

  return `You are an AI moderator facilitating a town hall discussion on behalf of ${orgName}.
${eventDesc ? `\nEVENT: ${eventDesc}` : ''}${industry ? `\nINDUSTRY: ${industry.replace(/_/g, ' ')}` : ''}

TONE: ${tone}

RULES:
- Be warm, conversational, and brief — maximum 40 words
- Never sound robotic or like a survey form
- Never mention AI, algorithms, or that you are a bot
- NEVER ask about: ${sensitive}${industry ? `\n- Use terminology and context appropriate for the ${industry.replace(/_/g, ' ')} industry` : ''}
- NEVER start two consecutive messages the same way — vary your openers (don't repeat "That's wonderful", "Thanks for sharing", "Great point", etc.)
- Sound like a real person having a conversation, not a moderator reading from a script
- Just output the message text — no reasoning, labels, quotes, or JSON${langInstruction}`
}

function withNudge(prompt: string, nudge: boolean): string {
  if (!nudge) return prompt
  return prompt + '\n\nIMPORTANT: The participant used a rude or dismissive tone in their last message. Start your response by very briefly and warmly acknowledging this (e.g. "Hey, no need for that — I\'m here to listen." or "Let\'s keep it friendly —") then continue naturally with your actual response. Do NOT lecture or moralize. Keep it light, one short phrase, then move on.'
}

// ── Match opening response to best guide topic ───────────────────────────

async function matchResponseToTopic(
  config: any,
  response: string,
  language: string | undefined,
  topics: { id: string; label: string; description: string | null; question: string; follow_up_angles: string[] }[],
  verbose = false,
  nudge = false,
): Promise<{ themeId: string | null; followUp: string; thinking: string[] }> {
  if (topics.length === 0) {
    return { themeId: null, followUp: 'Could you tell me more about that?', thinking: [] }
  }

  const topicList = topics.map((t, i) => `${i + 1}. "${t.label}" — ${t.description || t.question}`).join('\n')

  const system = withNudge(baseSystemPrompt(config, language) + `

DISCUSSION TOPICS:
${topicList}

Your job: Read the participant's opening response. Determine which topic it most closely relates to. Then ask a warm, natural follow-up question that digs deeper into what they said — guided by that topic's focus area.

Return ONLY a JSON object (no other text):
{"topic_number": <1-based index of best matching topic, or 0 if none match>, "follow_up": "<your follow-up question>"}`, nudge)

  const user = `The participant was asked a broad opening question and responded:\n\n"${response}"\n\nMatch to a topic and follow up.`

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000, verbose)
  const raw = result.text

  try {
    // Try to parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      const topicIdx = (parsed.topic_number || 0) - 1
      const followUp = parsed.follow_up || ''

      if (topicIdx >= 0 && topicIdx < topics.length && followUp) {
        return { themeId: topics[topicIdx].id, followUp: cleanAiOutput(followUp), thinking: result.thinking }
      }
      if (followUp) {
        return { themeId: null, followUp: cleanAiOutput(followUp), thinking: result.thinking }
      }
    }
  } catch {
    // JSON parse failed — try to use raw text as follow-up
    if (raw && raw.length > 10 && !raw.startsWith('{')) {
      return { themeId: topics[0].id, followUp: raw, thinking: result.thinking }
    }
  }

  // Fallback: ask a generic follow-up
  return { themeId: null, followUp: 'That\'s interesting — could you tell me more about what you mean by that?', thinking: [] }
}

// ── Generate clarifier for short responses ───────────────────────────────

async function generateClarifier(config: any, message: string, turns: any[], language?: string, verbose = false, nudge = false): Promise<{ text: string; thinking: string[] }> {
  const system = withNudge(baseSystemPrompt(config, language) + `\n\n${buildConversationContext(turns) ? `CONVERSATION SO FAR:\n${buildConversationContext(turns)}` : ''}`, nudge)

  const user = `The participant just said: "${message}"\n\nThis was a short response. Ask a warm, natural follow-up to draw out more detail. Maximum 30 words. Just the question.`

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000, verbose)
  return { text: (result.text && isOutputClean(result.text)) ? result.text : 'Could you tell me a bit more about that?', thinking: result.thinking }
}

// ── Generate natural transition to next topic ────────────────────────────

async function generateTransition(
  config: any,
  lastMessage: string | undefined,
  language: string | undefined,
  turns: any[],
  nextTopic: { label: string; description?: string | null; question: string; follow_up_angles?: string[]; source?: string },
  verbose = false,
  nudge = false,
  wasSkipped = false,
): Promise<{ text: string; thinking: string[] }> {
  const convo = buildConversationContext(turns)

  const system = withNudge(baseSystemPrompt(config, language) + `\n\n${convo ? `CONVERSATION SO FAR:\n${convo}` : ''}`, nudge)

  const isOrganic = nextTopic.source === 'auto_detected'

  const skipInstruction = wasSkipped
    ? `The participant chose to skip this question. Respect their choice — briefly acknowledge it (e.g. "No problem" or "Totally fine") and move on without dwelling on it. Do NOT say "That's wonderful" or anything enthusiastic about skipping.`
    : 'Acknowledge what they\'ve shared so far, then smoothly shift to the new topic.'

  const organicFraming = isOrganic
    ? `\n\nIMPORTANT: This topic emerged organically from other participants' conversations. Frame your transition to reference this — e.g. "A few others have mentioned ${nextTopic.label}, so I'd love to hear your take" or "This has come up in other conversations today..." or "Some participants have been talking about ${nextTopic.label}..." — vary the phrasing naturally. Do NOT say "AI detected" or "recommended".`
    : ''

  const user = `${wasSkipped ? 'The participant declined to answer the previous question.' : 'The participant has finished discussing the previous topic.'} Now transition naturally to a new topic: "${nextTopic.label}"

The question to work in: "${nextTopic.question}"
${nextTopic.follow_up_angles?.length ? 'Angles to consider: ' + nextTopic.follow_up_angles.join(', ') : ''}${organicFraming}

${skipInstruction} Maximum 40 words. Just the message.`

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000, verbose)
  return { text: (result.text && isOutputClean(result.text)) ? result.text : (isOrganic ? 'Others have been talking about ' + nextTopic.label + ' — ' + nextTopic.question : 'Let me ask you about something else — ' + nextTopic.question), thinking: result.thinking }
}
