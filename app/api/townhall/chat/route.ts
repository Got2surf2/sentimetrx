import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isOutputClean, cleanAiOutput, cleanDeflectResponse, looksLikeAIRefusal } from '@/lib/guardrails'
import { evaluateDeflection } from '@/lib/deflectionRouter'
import { SUBTLE_DISENGAGE } from '@/lib/engagementSignals'
import { checkMessage, scoreSentimentFull } from '@/lib/contentGuard'
import { callAI } from '@/lib/ai'
import { logUsage, type UsageContext } from '@/lib/usageLog'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'
import {
  SWITCH_CONFIRM,
  detectLanguageSwitch,
  LANGUAGE_SWITCH_CLASSIFIER_PROMPT,
} from '@/lib/languageSwitch'
import { handleChatTurn } from '@/lib/chatCore'
import { isTownHallViaAgentHandlerEnabled } from '@/lib/phase4Flags'
import { pickNextTopic, type NextTopic } from '@/lib/pickNextTopic'

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
  // Parse body before rate-limiting so we can throttle per-participant.
  // Why: at a real venue all 200 attendees share the same NAT'd wifi IP,
  // so an IP-only limit would throttle the entire room after 20 messages.
  let body: ChatRequest
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, participant_id, message, turn_number, theme_id, skipped, language } = body

  if (!session_id || !participant_id) {
    return NextResponse.json({ error: 'Missing session_id or participant_id' }, { status: 400 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'

  // Primary cap: per-participant. 20/min is generous for a single human.
  const rlPart = await checkRateLimit('townhall-chat:p:' + participant_id, 20, 60000)
  if (rlPart.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  // Backstop: per-IP ceiling for a venue. Sized for ~200 participants at peak
  // (everyone responding to the same prompt within a minute), and bounds the
  // damage if someone spoofs participant_id to evade the per-participant cap.
  const rlIp = await checkRateLimit('townhall-chat:ip:' + ip, 600, 60000)
  if (rlIp.limited) return NextResponse.json({ error: 'Rate limited' }, { status: 429 })

  const supabase = createServiceRoleClient()

  // ── Phase 4 commit 2: PulseIQ-via-agent-handler path ────────────────
  // When TOWNHALL_VIA_AGENT_HANDLER=true AND a town_halls row resolves
  // for this session_id (uuid or slug), bypass the legacy 995-line
  // PulseIQ orchestrator below and delegate to lib/chatCore.handleChatTurn.
  // PulseIQ-specific features (theme assignment, response counter,
  // language switch, auto-end, standby) are NOT carried into this path
  // — they get rebuilt on the unified substrate in Phase 5. With zero
  // town_halls rows in the system today, this branch is dark on the
  // way in; it activates only after Phase 6 creates the first row.
  if (isTownHallViaAgentHandlerEnabled()) {
    const isUUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)
    let townHall: any = null
    if (isUUID4) {
      const { data } = await supabase.from('town_halls').select('id, slug, org_id, bot_id, name, status').eq('id', session_id).single()
      townHall = data
    }
    if (!townHall) {
      const { data } = await supabase.from('town_halls').select('id, slug, org_id, bot_id, name, status').eq('slug', session_id.toLowerCase()).single()
      townHall = data
    }
    if (townHall) {
      const { data: agent } = await supabase.from('agents').select('*').eq('id', townHall.bot_id).single()
      if (agent && agent.status === 'active') {
        // Synthesize messages[] from prior turns for this (session, participant).
        // Read from townhall_turns (the legacy storage) since this path runs in
        // the transitional window before Phase 5 rewires storage onto
        // conversation_turns. Each townhall_turns row carries both bot_message
        // and user_message for one turn pair.
        const { data: priorTurns } = await supabase
          .from('townhall_turns')
          .select('bot_message, user_message, turn_number')
          .eq('session_id', townHall.id)
          .eq('participant_id', participant_id)
          .order('turn_number', { ascending: true })
        const messages: { role: 'user' | 'assistant'; content: string }[] = []
        for (const t of (priorTurns || [])) {
          if (t.bot_message) messages.push({ role: 'assistant', content: t.bot_message })
          if (t.user_message) messages.push({ role: 'user', content: t.user_message })
        }
        if (message) messages.push({ role: 'user', content: message })
        if (messages.length === 0) {
          return NextResponse.json({ error: 'No message and no prior turns' }, { status: 400 })
        }

        const result = await handleChatTurn(
          { agent, service: supabase, ip, townHallContext: { townHallId: townHall.id, slug: townHall.slug, participantId: participant_id } },
          { messages, session_id: townHall.id + ':' + participant_id, language, debug: body.debug },
        )

        return NextResponse.json({
          bot_message: result.reply,
          theme_id: null,
          source: 'agent_handler',
          is_final: false,
          turn_number: turn_number + 1,
          ...(result._debug ? { _debug: result._debug } : {}),
        })
      }
    }
    // Flag is on but no town_halls row matched (or agent inactive) — fall
    // through to legacy. This is the expected state until Phase 6 creates
    // the first town_halls row pointing at Sarina.
  }

  // Fetch session (by UUID or slug)
  let session: any = null
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)
  if (isUUID) {
    const { data } = await supabase.from('townhall_sessions').select('id, name, status, config, response_counter, started_at, org_id').eq('id', session_id).single()
    session = data
  }
  if (!session) {
    const { data } = await supabase.from('townhall_sessions').select('id, name, status, config, response_counter, started_at, org_id').eq('slug', session_id.toLowerCase()).single()
    session = data
  }
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Set usage context for all AI calls in this request
  _usageCtx = { org_id: session.org_id, resource_type: 'townhall', resource_id: session.id, event_type: 'chat' }

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
      const { error: guardInsertErr } = await supabase.from('townhall_turns').insert({
        session_id: session.id, participant_id, turn_number: nextTurn, bot_message: warningMsg,
        user_message: null, user_message_en: null, language: language || 'en', theme_id, source: 'clarifier', skipped: false,
      })
      if (guardInsertErr) console.error({ at: 'TH Chat', msg: "INSERT guard turn failed", err: guardInsertErr.message })
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
    const langSwitch = await detectLanguageSwitch(message.trim(), async (m) => {
      const result = await callClaude(LANGUAGE_SWITCH_CLASSIFIER_PROMPT, m, 3000)
      return result.text || null
    })
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
      const switchBotMsg = confirm + '\n\n' + translatedMsg

      // Store the language switch as a turn so it appears in conversation review
      await supabase.from('townhall_turns')
        .update({ user_message: '[Language switch: ' + targetLang + '] ' + message, user_message_en: message, language: language || 'en', skipped: false })
        .eq('session_id', session.id).eq('participant_id', participant_id).eq('turn_number', turn_number)

      const nextTurn = turn_number + 1
      const { error: langInsertErr } = await supabase.from('townhall_turns').insert({
        session_id: session.id, participant_id, turn_number: nextTurn, bot_message: switchBotMsg,
        user_message: null, user_message_en: null, language: targetLang, theme_id, source: 'guide', skipped: false,
      })
      if (langInsertErr) console.error({ at: 'TH Chat', msg: "INSERT language switch turn failed", err: langInsertErr.message })

      return NextResponse.json({
        bot_message: switchBotMsg,
        theme_id,
        source: 'language_switch',
        is_final: false,
        turn_number: nextTurn,
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
    // Score sentiment on user messages (not skipped/filtered)
    if (message && !skipped) {
      var sentResult = scoreSentimentFull(messageEn || message)
      turnUpdate.sentiment = sentResult.label
      turnUpdate.sentiment_score = sentResult.score
    }
    const { error: updateError } = await supabase
      .from('townhall_turns')
      .update(turnUpdate)
      .eq('session_id', session.id)
      .eq('participant_id', participant_id)
      .eq('turn_number', turn_number)
    if (updateError) console.error({ at: 'TH Chat', msg: 'UPDATE turn failed', turn_number, err: updateError })

    // Note: topics that hit their response target stay active (facilitator manually closes).
    // The next-topic selection below deprioritizes target-reached topics.

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

  // ── Smart deflection: detect off-topic / questions and redirect ───────
  // Runs before decision logic to avoid wasting clarifier slots on irrelevant input.
  // Only fires on real messages (not skips, not opening response), and only if enabled (default: on).
  const deflectionEnabled = config?.deflection?.enabled !== false
  if (deflectionEnabled && message && !skipped && turn_number > 1) {
    const testing = !!config?.testing || !!body.debug
    const analyzeText = messageEn || message

    // Sensitive-topic check, question-signal regex, and the decision rule all
    // live in lib/deflectionRouter.ts (shared with the bots route, Phase 2.3).
    // FEEDBACK_SIGNALS stays local — PulseIQ's domain-specific superset has
    // community/development terms (traffic, parking, housing, schools…) that
    // would change Sarina's behavior if applied to bots.
    const sensitiveTopics: string[] = config?.context?.sensitive_topics || []
    const FEEDBACK_SIGNALS = /\b(good|great|bad|terrible|love|hate|like|dislike|think|thinking|feel|feeling|believe|wish|hope|want|need|prefer|enjoy|annoyed|frustrated|frustrating|happy|disappointed|amazing|awful|horrible|excellent|worst|best|opinion|suggest|recommend|improve|issue|problem|concern|stress|stressed|struggling|burnout|burnt|overwhelm|exhausted|tired|anxious|depressed|worried|scared|afraid|angry|upset|hurt|suffering|difficult|tough|hard|leaving|quit|mental|health|workload|balance|worried|scary|dangerous|expensive|affordable|affordable|crowded|noisy|ugly|beautiful|broken|fix|change|build|add|remove|stop|start|keep|maintain|invest|spend|waste|ruin|destroy|save|protect|support|oppose|against|favor|agree|disagree|should|shouldn't|must|can't|won't|important|critical|essential|ridiculous|absurd|outrageous|unfair|fair|wrong|right|better|worse|enough|lack|missing|too much|too many|not enough|overflow|traffic|parking|safety|crime|noise|pollution|taxes|rent|cost|price|development|housing|schools|parks|roads|transit|bus|bike|walk|sidewalk)\b/i
    const deflectDecision = evaluateDeflection(analyzeText, sensitiveTopics, FEEDBACK_SIGNALS)
    const hitsSensitive = deflectDecision.hitsSensitive

    if (deflectDecision.shouldAttempt) {
      // Possible off-topic or question — ask AI
      const currentTopic = theme_id ? (await supabase.from('townhall_themes').select('label, question').eq('id', theme_id).single()).data : null
      const topicContext = currentTopic
        ? currentTopic.question || currentTopic.label
        : (config?.context?.event_description || config?.opening_question || session.name || 'community feedback and discussion')

      try {
        const deflectResult = await callClaude(
          `You are a facilitator in a PulseIQ discussion. Decide if the participant's message needs redirection.

Topic being discussed: "${topicContext}"
Participant said: "${analyzeText}"
${hitsSensitive ? 'WARNING: This message touches a SENSITIVE/BANNED topic. You MUST redirect away from it gently.' : ''}

RESPOND WITH EXACTLY "NONE" (no redirect needed) IF:
- They gave ANY opinion, complaint, praise, suggestion, story, or emotion about ANYTHING related to community, neighborhood, city, development, infrastructure, housing, schools, parks, transportation, taxes, safety, environment, or quality of life
- They answered a question, even briefly or tangentially
- They used a rhetorical question ("Why can't they fix it?" = complaint, NOT a question)
- They are passionate, angry, or emotional — that is feedback, not off-topic
- Their message is short ("ok", "sure", "not really")

REDIRECT ONLY IF:
- They are asking the bot for factual information ("What time does city hall open?")
- They are talking about something truly unrelated to the community/city/development (e.g., sports scores, personal medical advice)
${hitsSensitive ? '- OR their message touches the sensitive/banned topic flagged above — redirect gently WITHOUT naming the sensitive topic' : ''}

When in doubt, respond NONE. We NEVER want to redirect genuine community feedback.

If redirecting: write 1-2 sentences (max 30 words), acknowledge their point, steer back to the topic.
Output ONLY "NONE" or the redirect message. Nothing else.` +
            (language && language !== 'en' ? `\n\nIMPORTANT: Write your redirect message in ${language}.` : ''),
          'Redirect the participant.',
          3000,
          testing
        )

        const cleaned = cleanDeflectResponse(deflectResult.text || '', testing)
        let deflectText = cleaned.deflection

        if (deflectText) {
          // Custom deflection message override
          if (config?.deflection?.message?.trim()) {
            deflectText = config.deflection.message.trim()
          }

          const nextTurn = turn_number + 1
          const deflectDebugInfo = testing ? [
            'DEFLECT: Participant went off-topic or asked a question',
            'Input: "' + analyzeText.slice(0, 100) + '"',
            'Topic context: "' + topicContext + '"',
            'Redirect: "' + deflectText!.slice(0, 100) + '"',
            ...(cleaned.thinking || []),
          ] : undefined
          const deflectInsert: Record<string, unknown> = {
            session_id: session.id, participant_id, turn_number: nextTurn,
            bot_message: deflectText, user_message: null, user_message_en: null,
            language: language || 'en', theme_id, source: 'deflect', skipped: false,
          }
          if (deflectDebugInfo) deflectInsert.ai_thinking = deflectDebugInfo
          let { error: deflectInsertErr } = await supabase.from('townhall_turns').insert(deflectInsert)
          if (deflectInsertErr) {
            console.error({ at: 'TH Chat', msg: "INSERT deflect turn failed", err: deflectInsertErr.message })
            // Retry: drop ai_thinking, fall back to 'clarifier' source (CHECK constraint compat)
            delete deflectInsert.ai_thinking
            deflectInsert.source = 'clarifier'
            const { error: retryErr } = await supabase.from('townhall_turns').insert(deflectInsert)
            if (retryErr) console.error({ at: 'TH Chat', msg: "INSERT deflect retry also failed", err: retryErr.message })
          }

          return NextResponse.json({
            bot_message: deflectText, theme_id, source: 'deflect',
            is_final: false, turn_number: nextTurn,
            ...(deflectDebugInfo ? { _debug: deflectDebugInfo } : {}),
          })
        }
      } catch {
        // Deflection AI failed — proceed normally, don't block conversation
      }
    }
  }

  // Get this participant's conversation history
  const { data: history } = await supabase
    .from('townhall_turns')
    .select('bot_message, user_message, theme_id, source, turn_number, skipped')
    .eq('session_id', session.id)
    .eq('participant_id', participant_id)
    .order('turn_number', { ascending: true })

  const turns = history || []

  // Fetch all active themes + compute live response counts from turns
  const { data: activeThemes } = await supabase
    .from('townhall_themes')
    .select('id, label, description, question, follow_up_angles, keywords, source, response_target')
    .eq('session_id', session.id)
    .eq('state', 'active')

  // Live count: how many non-skipped user turns per theme_id
  const { data: turnCounts } = await supabase
    .from('townhall_turns')
    .select('theme_id')
    .eq('session_id', session.id)
    .not('user_message', 'is', null)
    .eq('skipped', false)
  const liveCountMap: Record<string, number> = {}
  for (const t of turnCounts || []) {
    if (t.theme_id) liveCountMap[t.theme_id] = (liveCountMap[t.theme_id] || 0) + 1
  }

  const allTopics = (activeThemes || [])
    .map(t => ({ ...t, response_count: liveCountMap[t.id] || 0 }))
    .sort((a, b) => a.response_count - b.response_count)

  // ── DETERMINE WHAT TO DO NEXT ──────────────────────────────────────────

  const isOpeningResponse = turn_number === 1 && !theme_id
  const discussedThemeIds = new Set(turns.map(t => t.theme_id).filter(Boolean))
  const wordCount = message ? message.split(/\s+/).length : 0

  // Testing mode: accumulate reasoning steps
  const testing = !!config?.testing || !!body.debug
  const debug: string[] = []

  // ── #1: "Move on" signal detection ────────────────────────────────────
  // Fast regex for words that mean "I'm done with this topic" — zero AI cost
  const MOVE_ON_SIGNALS = /^(stop|enough|next|move on|done|that'?s it|that'?s all|nothing else|no more|i'?m done|let'?s move on|skip|pass|next topic|next question)\s*[.!?]*$/i
  const moveOnSignal = !!(message && MOVE_ON_SIGNALS.test(message.trim()))
  if (testing && moveOnSignal) debug.push('SIGNAL: "' + message?.trim() + '" detected as move-on signal — skipping clarifier')

  // ── #5: Response trajectory — detect disengagement ────────────────────
  // Track word counts for last 3 responses on this topic; if trending down, participant is disengaging
  const recentOnTopic = theme_id
    ? turns.filter(t => t.theme_id === theme_id && t.user_message && !t.skipped).slice(-3)
    : []
  const recentWordCounts = recentOnTopic.map(t => (t.user_message || '').split(/\s+/).length)
  const trajectoryDisengaging = recentWordCounts.length >= 2 &&
    recentWordCounts.every((wc: number, i: number) => i === 0 || wc <= recentWordCounts[i - 1]) &&
    wordCount > 0 && wordCount < (recentWordCounts[recentWordCounts.length - 1] || 999)
  if (testing && trajectoryDisengaging) debug.push('SIGNAL: Response trajectory declining (' + [...recentWordCounts, wordCount].join(' → ') + ' words) — disengagement detected')

  // ── #7: Consecutive skip detection ────────────────────────────────────
  // If the participant skipped on this same topic recently, they don't want to discuss it
  const recentSkipsOnTopic = theme_id
    ? turns.filter(t => t.theme_id === theme_id && t.skipped).length
    : 0
  const skipOverload = skipped && recentSkipsOnTopic >= 1  // already skipped once on this topic
  if (testing && skipOverload) debug.push('SIGNAL: Consecutive skips on topic (' + (recentSkipsOnTopic + 1) + ') — must move on')

  // ── #6: Curt response detection ───────────────────────────────────────
  // Very short responses (1-3 words) that are substantive but signal "I've said enough"
  // These aren't "move on" signals (they contain content) but indicate the participant
  // is giving minimal engagement and shouldn't be probed further on this topic
  const CURT_RESPONSE = wordCount > 0 && wordCount <= 3 && !isOpeningResponse
  if (testing && CURT_RESPONSE) debug.push('SIGNAL: Curt response (' + wordCount + ' words) — participant giving minimal answers')

  // ── #2: Frustration-aware clarifier cap ───────────────────────────────
  // Base max is 2 clarifiers per topic, but drop to 1 if responses are getting shorter or curt
  // When theme_id is null (opening never matched), count null-theme turns to prevent infinite clarifiers
  const currentTopicTurns = turns.filter(t => t.theme_id === theme_id).length
  const clarifierTurnsOnTopic = turns.filter(t => t.theme_id === theme_id && t.source === 'clarifier').length
  const maxClarifiersPerTopic = (trajectoryDisengaging || CURT_RESPONSE) ? 1 : 2

  // ── Dynamic per-topic turn cap (min 2, max 4) ─────────────────────────
  // Goal: intelligent conversation, not filling turns. Not every person
  // needs to be probed on every topic. Start at 2, extend only if engaged.
  const MIN_TOPIC_TURNS = 2
  const MAX_TOPIC_TURNS = 4
  let dynamicTopicCap = MIN_TOPIC_TURNS
  // Extend to 3 if participant gave a substantive response (>= 8 words) on this topic
  const substantiveOnTopic = recentOnTopic.some(t => (t.user_message || '').split(/\s+/).length >= 8)
  if (substantiveOnTopic && !trajectoryDisengaging && !CURT_RESPONSE) dynamicTopicCap = 3
  // Extend to 4 only if responses are consistently rich (avg >= 10 words) and engaged
  const avgWordsOnTopic = recentOnTopic.length > 0
    ? recentOnTopic.reduce((sum, t) => sum + (t.user_message || '').split(/\s+/).length, 0) / recentOnTopic.length
    : 0
  if (avgWordsOnTopic >= 10 && !trajectoryDisengaging && !CURT_RESPONSE && recentOnTopic.length >= 2) dynamicTopicCap = MAX_TOPIC_TURNS
  const topicTurnCapHit = currentTopicTurns >= dynamicTopicCap
  if (testing && topicTurnCapHit) debug.push('SIGNAL: Topic turn cap hit (' + currentTopicTurns + '/' + dynamicTopicCap + ') — must move on')

  // ── #4: Turn budget + topic availability ──────────────────────────────
  const maxTurnsForBudget = config?.engine?.max_turns_per_participant || 20
  const seedTopics = allTopics.filter(t => t.source === 'guide')
  const organicTopics = allTopics.filter(t => t.source !== 'guide')
  const totalTopicCount = allTopics.length
  const topicsRemaining = allTopics.filter(t => !discussedThemeIds.has(t.id) && t.response_count < t.response_target).length
  const turnsUsed = turns.length
  const turnsRemaining = maxTurnsForBudget - turnsUsed

  // If organic topics are available and we've used most of our seed budget, prefer organic
  const seedTurnsUsed = turns.filter(t => {
    const topic = allTopics.find(a => a.id === t.theme_id)
    return topic && topic.source === 'guide'
  }).length
  const seedBudget = Math.ceil(maxTurnsForBudget * 0.6)
  const seedBudgetExhausted = seedTurnsUsed >= seedBudget && organicTopics.some(t => !discussedThemeIds.has(t.id))

  // Dynamic word-count threshold
  let clarifyWordThreshold = 12
  if (topicsRemaining > 3 && turnsUsed < maxTurnsForBudget * 0.3) {
    clarifyWordThreshold = 8 // early + many topics → move on faster
  } else if (topicsRemaining <= 1) {
    clarifyWordThreshold = 10 // last topic → conservative
  }
  if (testing) debug.push('BUDGET: turn ' + turnsUsed + '/' + maxTurnsForBudget + ' | topics left: ' + topicsRemaining + ' | topic-cap: ' + currentTopicTurns + '/' + dynamicTopicCap + ' (avg ' + avgWordsOnTopic.toFixed(0) + 'w) | clarify threshold: ' + clarifyWordThreshold + 'w')

  // ── Clarifier decision (all signals combined) ─────────────────────────
  let shouldClarify = !isOpeningResponse && !skipped && message &&
    !moveOnSignal &&                              // #1: not a "move on" signal
    !trajectoryDisengaging &&                     // #5: not disengaging
    !topicTurnCapHit &&                           // dynamic per-topic cap (2-4)
    wordCount < clarifyWordThreshold &&           // #4: dynamic threshold
    clarifierTurnsOnTopic < maxClarifiersPerTopic // #2: frustration-aware cap

  // ── #3: AI tone check on short responses ──────────────────────────────
  // For borderline cases (short response that would trigger clarifier),
  // ask AI: "Is this person being concise or trying to move on?"
  // Only fires when clarifier would trigger AND response has subtle signals.
  // SUBTLE_DISENGAGE regex lives in lib/engagementSignals.ts (shared module
  // introduced in Phase 2.4; see docs/CONVERGENCE.md).
  // Fast path: if 2+ consecutive curt responses (any topic), skip AI tone check entirely
  const allUserMsgs = turns.filter(t => t.user_message && !t.skipped)
  const lastTwoCurt = allUserMsgs.length >= 2 &&
    allUserMsgs.slice(-2).every(t => (t.user_message || '').split(/\s+/).length <= 3)
  if (shouldClarify && lastTwoCurt && CURT_RESPONSE) {
    shouldClarify = false
    if (testing) debug.push('FAST PATH: 2+ consecutive curt responses — skipping clarifier without AI check')
  }

  if (shouldClarify && message && SUBTLE_DISENGAGE.test(message.trim())) {
    // Subtle disengagement signal — check with AI before clarifying
    if (testing) debug.push('TONE CHECK: "' + message.trim() + '" is a subtle signal — asking AI')
    try {
      const toneResult = await callClaude(
        'You classify participant tone in a conversation. Return ONLY "move_on" or "clarify".\n\n' +
        'Rules:\n- "move_on" = the person is disengaged, annoyed, wants to change topics, or has nothing more to say\n' +
        '- "clarify" = the person is thinking, gave a partial answer, and would benefit from a follow-up\n' +
        'Be conservative — if in doubt, say "move_on". A frustrated participant asked to clarify will disengage further.',
        'The participant just said: "' + message.trim() + '"\n\nRecent conversation:\n' + buildConversationContext(turns.slice(-4)),
        2000
      )
      if (toneResult.text?.trim().toLowerCase() === 'move_on') {
        shouldClarify = false
        if (testing) debug.push('TONE RESULT: move_on — skipping clarifier')
      } else {
        if (testing) debug.push('TONE RESULT: clarify — proceeding with clarifier')
      }
    } catch {
      // AI failed — err on side of moving on (don't annoy participant)
      shouldClarify = false
      if (testing) debug.push('TONE CHECK: AI failed — defaulting to move on')
    }
  }

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
      debug.push('REASON: Response was ' + wordCount + ' words (< ' + clarifyWordThreshold + ' threshold) and ' + clarifierTurnsOnTopic + '/' + maxClarifiersPerTopic + ' clarifiers used on "' + (topic?.label || '?') + '"')
    }
    const clarifyResult = await generateClarifier(config, message, turns, language, testing, toneNudge)
    botMessage = clarifyResult.text
    if (testing && clarifyResult.thinking.length > 0) debug.push('AI REASONING:', ...clarifyResult.thinking)

  } else {
    // ── Global disengagement check ──────────────────────────────────────
    // Before jumping to another topic, check if the participant is checking
    // out across the whole conversation — not just this topic.
    // Signals: last 3+ responses are all curt (<=3 words), skipped, or declining trajectory
    const recentAll = turns.filter(t => t.user_message && !t.skipped).slice(-3)
    const recentAllCurt = recentAll.length >= 3 && recentAll.every(t => (t.user_message || '').split(/\s+/).length <= 3)
    const recentAllSkips = turns.slice(-3).filter(t => t.skipped).length >= 2
    const globalCheckout = recentAllCurt || recentAllSkips || (trajectoryDisengaging && CURT_RESPONSE)

    if (globalCheckout && turnsUsed >= 3) {
      // Participant is done — chill into standby instead of pushing more topics
      const audience = getAudienceLabels(config)
      const chillMsg = config?.engine?.chill_message ||
        'Great to know — thanks for sharing what you did! I\'ll be here if anything else comes to mind, and I may circle back as more questions pop up based on what other ' + audience.participants + ' are saying.'
      if (testing) debug.push('GLOBAL CHECKOUT: Participant disengaged across conversation — entering chill standby')
      resolvedThemeId = null
      aiSource = 'standby'
      botMessage = chillMsg
    } else {

    // ── NEXT TOPIC: Move to an unvisited topic ───────────────────────────
    // Selection (filter under/over target, seed-budget preference, smart-
    // probe, fewest-responses default) lives in lib/pickNextTopic.ts as
    // a pure function shared with the unified handleChatTurn (Phase 5
    // commit 2). The wrapper logic below — standby vs wrap-up when all
    // covered, debug logging, generate-transition — stays here as
    // PulseIQ-specific orchestration.
    const pickerInputTopics: NextTopic[] = allTopics.map(t => ({
      id: t.id,
      label: t.label,
      description: t.description,
      question: t.question,
      follow_up_angles: t.follow_up_angles,
      keywords: (t as any).keywords || [],
      source: t.source,
      response_target: t.response_target,
      response_count: t.response_count,
    }))
    const pick = pickNextTopic(pickerInputTopics, {
      discussedTopicIds: discussedThemeIds as Set<string>,
      currentMessage: (message && !skipped) ? message : undefined,
      preferOrganic: !!seedBudgetExhausted,
      currentTopicId: theme_id || undefined,
    })

    if (testing && !isOpeningResponse) {
      debug.push('DECISION: Move to next topic')
      if (moveOnSignal) debug.push('Clarifier skipped: move-on signal detected')
      else if (trajectoryDisengaging) debug.push('Clarifier skipped: response trajectory declining')
      else if (topicTurnCapHit) debug.push('Clarifier skipped: dynamic topic cap hit (' + currentTopicTurns + '/' + dynamicTopicCap + ')')
      else if (wordCount >= clarifyWordThreshold) debug.push('Clarifier skipped: response was ' + wordCount + ' words (>= ' + clarifyWordThreshold + ' threshold)')
      else if (clarifierTurnsOnTopic >= maxClarifiersPerTopic) debug.push('Clarifier skipped: hit max ' + maxClarifiersPerTopic + ' clarifiers on this topic')
      else if (currentTopicTurns >= dynamicTopicCap) debug.push('Clarifier skipped: dynamic cap reached (' + currentTopicTurns + '/' + dynamicTopicCap + ')')
      if (seedBudgetExhausted) debug.push('BUDGET: Seed budget exhausted (' + seedTurnsUsed + '/' + seedBudget + ') — prioritizing organic topics')
      debug.push('Topics discussed: ' + discussedThemeIds.size + ' | Picker reason: ' + pick.reason)
    }

    if (!pick.topic) {
      // All topics covered (or none configured) — standby or wrap up.
      if (testing) debug.push('ALL TOPICS VISITED — entering standby or wrap-up')

      const hasOrganic = config?.engine?.theme_detection_mode === 'auto'
      if (hasOrganic && turnsUsed < maxTurnsForBudget - 2) {
        const standbyAudience = getAudienceLabels(config)
        const standbyMsg = config?.engine?.standby_message ||
          'That is very helpful information — thank you! Stand by while we see what some of the other ' + standbyAudience.participants + ' are talking about. If new topics come up, I may circle back to get your thoughts.'
        resolvedThemeId = null
        aiSource = 'standby'
        botMessage = standbyMsg
        if (testing) debug.push('STANDBY: Organic detection active + turns remaining — parking conversation')
      } else {
        return wrapUp(config)
      }
    } else {
      const nextTopic = allTopics.find(t => t.id === pick.topic!.id)!
      if (testing) {
        if (pick.reason === 'smart_probe' && pick.matchedKeyword) {
          debug.push('SMART PROBE: Keyword "' + pick.matchedKeyword + '" matched — jumping to "' + nextTopic.label + '" instead of default queue')
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
    } // end globalCheckout else
  }

  const nextTurnNumber = turn_number + 1

  if (testing) {
    debug.push('SOURCE: ' + aiSource + ' | TURN: ' + nextTurnNumber)
  }

  // Store the new turn — log errors but don't fail the response
  const resolvedThemeLabel = resolvedThemeId ? (allTopics.find(t => t.id === resolvedThemeId)?.label || null) : null
  const insertPayload: Record<string, unknown> = {
    session_id: session.id,
    participant_id,
    turn_number: nextTurnNumber,
    bot_message: botMessage,
    user_message: null,
    user_message_en: null,
    language: language || 'en',
    theme_id: resolvedThemeId,
    theme_label: resolvedThemeLabel,
    source: aiSource,
    skipped: false,
  }
  // Only include ai_thinking if column exists (migration 017 applied)
  if (testing && debug.length > 0) insertPayload.ai_thinking = debug
  const { error: insertError } = await supabase.from('townhall_turns').insert(insertPayload)
  if (insertError) {
    console.error({ at: 'TH Chat', msg: 'INSERT turn failed', sessionId: session.id, participantId: participant_id, turn: nextTurnNumber, source: aiSource, err: insertError })
    // Retry: drop ai_thinking, fall back source to 'guide' (CHECK constraint compat)
    delete insertPayload.ai_thinking
    const originalSource = insertPayload.source
    if (!['guide', 'clarifier', 'detected_theme', 'custom'].includes(String(originalSource))) {
      insertPayload.source = 'guide'
    }
    const { error: retryError } = await supabase.from('townhall_turns').insert(insertPayload)
    if (retryError) console.error({ at: 'TH Chat', msg: "INSERT retry also failed", err: retryError.message })
  }

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

// Set by POST handler so callClaude can log usage without threading context
var _usageCtx: UsageContext | null = null

function wrapUp(config: any) {
  return NextResponse.json({
    bot_message: config?.closing_message || config?.display?.thank_you_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
    is_final: true, theme_id: null, source: null, turn_number: 999,
  })
}

// system can be a plain string OR { base, suffix? } where `base` is marked
// for prompt caching (static across calls — e.g. baseSystemPrompt + topic
// list) and `suffix` is the per-call dynamic tail (e.g. conversation history).
// Caching the base block is the difference between paying the full
// input-tokens-per-minute rate every call and getting most of the prompt
// served as cache reads (which don't count against the rate limit).
async function callClaude(
  system: string | { base: string; suffix?: string },
  user: string,
  timeoutMs = 3000,
  verbose = false,
): Promise<{ text: string; thinking: string[] }> {
  const debugTail = '\n\nDEBUG MODE — Think step by step. Before your response, write your reasoning process (what you noticed, what you considered, why you chose this response). Then write a line containing exactly "---RESPONSE---" and your actual message after it.'

  let systemPayload: string | Array<{ type: 'text'; text: string; cache?: boolean }>
  if (typeof system === 'string') {
    // Verbose appends per-call instructions, so don't cache that variant.
    systemPayload = verbose ? system + debugTail : system
  } else {
    const baseText = system.base + (verbose ? debugTail : '')
    systemPayload = [
      { type: 'text', text: baseText, cache: true },
      ...(system.suffix ? [{ type: 'text' as const, text: system.suffix }] : []),
    ]
  }

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: verbose ? 500 : 200,
      timeoutMs: verbose ? Math.max(timeoutMs, 5000) : timeoutMs,
      system: systemPayload,
      messages: [{ role: 'user', content: user }],
    })
    if (_usageCtx) logUsage(_usageCtx, result.usage)
    const raw = result.text?.trim() || ''
    let outText: string
    let thinking: string[] = []
    if (verbose && raw.includes('---RESPONSE---')) {
      const [thinkingPart, responsePart] = raw.split('---RESPONSE---')
      thinking = thinkingPart.trim().split('\n').filter(Boolean)
      outText = cleanAiOutput(responsePart.trim())
    } else {
      outText = cleanAiOutput(raw)
    }
    // Drop safety-style refusals — without this they'd land in townhall_turns
    // as a bot moderator message visible to participants. Empty text lets
    // callers fall through to their existing fallback paths.
    if (looksLikeAIRefusal(outText)) {
      console.warn({
        event: 'th_chat_ai_refusal',
        text_preview: outText.slice(0, 200),
      })
      return { text: '', thinking }
    }
    return { text: outText, thinking }
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

// Session type → audience language mapping
const SESSION_TYPE_LABELS: Record<string, { participant: string; participants: string; community: string }> = {
  community: { participant: 'resident', participants: 'residents', community: 'community' },
  employee:  { participant: 'team member', participants: 'team members', community: 'organization' },
  customer:  { participant: 'customer', participants: 'customers', community: 'customer base' },
  student:   { participant: 'student', participants: 'students', community: 'school community' },
  member:    { participant: 'member', participants: 'members', community: 'membership' },
  other:     { participant: 'participant', participants: 'participants', community: 'group' },
}

function getAudienceLabels(config: any): { participant: string; participants: string; community: string } {
  return SESSION_TYPE_LABELS[config?.session_type] || SESSION_TYPE_LABELS.community
}

function baseSystemPrompt(config: any, language?: string): string {
  const orgName = config?.context?.org_name || 'the organization'
  const eventDesc = config?.context?.event_description || ''
  const tone = config?.context?.tone || 'warm and conversational'
  const sensitive = config?.context?.sensitive_topics?.join(', ') || 'none'
  const industry = config?.industry || ''
  const audience = getAudienceLabels(config)
  const langInstruction = language && language !== 'en'
    ? `\n\nIMPORTANT: The participant is using ${language}. You MUST respond ONLY in ${language}. Do NOT respond in English.`
    : `\n\nIMPORTANT: Respond ONLY in English. Even if prior conversation included other languages, the participant has switched to English.`

  return `You are an AI moderator facilitating a PulseIQ discussion on behalf of ${orgName}.
The audience is ${audience.participants} — refer to them and their peers as "${audience.participants}" (not "participants" or "users").
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
  topics: { id: string; label: string; description: string | null; question: string; follow_up_angles: string[]; keywords?: string[] }[],
  verbose = false,
  nudge = false,
): Promise<{ themeId: string | null; followUp: string; thinking: string[] }> {
  if (topics.length === 0) {
    return { themeId: null, followUp: 'Could you tell me more about that?', thinking: [] }
  }

  const topicList = topics.map((t, i) => `${i + 1}. "${t.label}" — ${t.description || t.question}`).join('\n')

  // Whole system is static per (session, language, nudge=false): cache it.
  // Calls 2+ in the session reuse the cache, so the topic list + JSON
  // instructions don't get charged against the input-tokens-per-minute rate.
  const system = withNudge(baseSystemPrompt(config, language) + `

DISCUSSION TOPICS:
${topicList}

Your job: Read the participant's opening response. Determine which topic it most closely relates to. Then ask a warm, natural follow-up question that digs deeper into what they said — guided by that topic's focus area.

Return ONLY a JSON object (no other text):
{"topic_number": <1-based index of best matching topic, or 0 if none match>, "follow_up": "<your follow-up question>"}`, nudge)

  const user = `The participant was asked a broad opening question and responded:\n\n"${response}"\n\nMatch to a topic and follow up.`

  const result = await callClaude({ base: system }, user, config?.engine?.ai_timeout_ms || 3000, verbose)
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

  // Fallback: keyword-based matching before giving up
  const responseLower = response.toLowerCase()
  for (const topic of topics) {
    // Check label match
    if (responseLower.includes(topic.label.toLowerCase())) {
      return { themeId: topic.id, followUp: topic.question || 'Could you tell me more about that?', thinking: ['KEYWORD FALLBACK: matched topic label "' + topic.label + '" in response'] }
    }
    // Check keyword match
    const keywords = topic.keywords || []
    for (const kw of keywords) {
      if (kw && responseLower.includes(kw.toLowerCase())) {
        return { themeId: topic.id, followUp: topic.question || 'Could you tell me more about that?', thinking: ['KEYWORD FALLBACK: matched keyword "' + kw + '" from topic "' + topic.label + '"'] }
      }
    }
  }

  // True fallback: no AI match, no keyword match
  return { themeId: null, followUp: 'That\'s interesting — could you tell me more about what you mean by that?', thinking: [] }
}

// ── Generate clarifier for short responses ───────────────────────────────

async function generateClarifier(config: any, message: string, turns: any[], language?: string, verbose = false, nudge = false): Promise<{ text: string; thinking: string[] }> {
  // baseSystemPrompt is static per session — cache it. Convo history grows
  // per turn (per participant), so it lives in the dynamic suffix.
  const base = baseSystemPrompt(config, language)
  const convo = buildConversationContext(turns)
  const suffix = withNudge(convo ? `CONVERSATION SO FAR:\n${convo}` : '', nudge)

  const user = `The participant just said: "${message}"\n\nThis was a short response. Ask a warm, natural follow-up to draw out more detail. Maximum 30 words. Just the question.`

  const result = await callClaude({ base, suffix }, user, config?.engine?.ai_timeout_ms || 3000, verbose)
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

  // Cache baseSystemPrompt; convo history is the dynamic suffix.
  const base = baseSystemPrompt(config, language)
  const suffix = withNudge(convo ? `CONVERSATION SO FAR:\n${convo}` : '', nudge)

  const isOrganic = nextTopic.source === 'auto_detected'
  const audience = getAudienceLabels(config)

  const skipInstruction = wasSkipped
    ? `The participant chose to skip this question. Respect their choice — briefly acknowledge it (e.g. "No problem" or "Totally fine") and move on without dwelling on it. Do NOT say "That's wonderful" or anything enthusiastic about skipping.`
    : 'Acknowledge what they\'ve shared so far, then smoothly shift to the new topic.'

  const organicFraming = isOrganic
    ? `\n\nIMPORTANT: This topic emerged from listening to what other ${audience.participants} are saying. Frame it that way — e.g. "After listening to what other ${audience.participants} are saying, it seems like ${nextTopic.label} is important to the ${audience.community}, so I wanted to get your thoughts on..." or "This has been coming up in other conversations today..." or "A few other ${audience.participants} have been talking about ${nextTopic.label}..." — vary the phrasing naturally. Do NOT say "AI detected" or "recommended".`
    : ''

  const user = `${wasSkipped ? 'The participant declined to answer the previous question.' : 'The participant has finished discussing the previous topic.'} Now transition naturally to a new topic: "${nextTopic.label}"

The question to work in: "${nextTopic.question}"
${nextTopic.follow_up_angles?.length ? 'Angles to consider: ' + nextTopic.follow_up_angles.join(', ') : ''}${organicFraming}

${skipInstruction} Maximum 40 words. Just the message.`

  const result = await callClaude({ base, suffix }, user, config?.engine?.ai_timeout_ms || 3000, verbose)
  return { text: (result.text && isOutputClean(result.text)) ? result.text : (isOrganic ? 'After listening to what other ' + audience.participants + ' are saying, ' + nextTopic.label + ' seems important — ' + nextTopic.question : 'Let me ask you about something else — ' + nextTopic.question), thinking: result.thinking }
}
