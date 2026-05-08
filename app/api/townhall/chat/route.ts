import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isOutputClean, cleanAiOutput, cleanDeflectResponse, looksLikeAIRefusal } from '@/lib/guardrails'
import { checkMessage, scoreSentimentFull } from '@/lib/contentGuard'
import { callAI } from '@/lib/ai'
import { logUsage, type UsageContext } from '@/lib/usageLog'
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
  const rl = await checkRateLimit('townhall-chat:' + ip, 20, 60000)
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
      if (guardInsertErr) console.error('[TH Chat] INSERT guard turn failed:', guardInsertErr.message)
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
      if (langInsertErr) console.error('[TH Chat] INSERT language switch turn failed:', langInsertErr.message)

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
    if (updateError) console.error('[TH Chat] UPDATE turn failed:', updateError.message, '| turn:', turn_number)

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

    // Sensitive topic check — always deflect if message touches a banned topic, even if it contains feedback words
    const sensitiveTopics: string[] = config?.context?.sensitive_topics || []
    const hitsSensitive = sensitiveTopics.length > 0 && sensitiveTopics.some((t: string) => new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(analyzeText))

    // Fast regex pre-check: skip deflection if response looks like genuine feedback
    // (contains opinion/emotion words — not worth burning an AI call)
    // BUT: always check if it hits a sensitive/banned topic
    const FEEDBACK_SIGNALS = /\b(good|great|bad|terrible|love|hate|like|dislike|think|thinking|feel|feeling|believe|wish|hope|want|need|prefer|enjoy|annoyed|frustrated|frustrating|happy|disappointed|amazing|awful|horrible|excellent|worst|best|opinion|suggest|recommend|improve|issue|problem|concern|stress|stressed|struggling|burnout|burnt|overwhelm|exhausted|tired|anxious|depressed|worried|scared|afraid|angry|upset|hurt|suffering|difficult|tough|hard|leaving|quit|mental|health|workload|balance|worried|scary|dangerous|expensive|affordable|affordable|crowded|noisy|ugly|beautiful|broken|fix|change|build|add|remove|stop|start|keep|maintain|invest|spend|waste|ruin|destroy|save|protect|support|oppose|against|favor|agree|disagree|should|shouldn't|must|can't|won't|important|critical|essential|ridiculous|absurd|outrageous|unfair|fair|wrong|right|better|worse|enough|lack|missing|too much|too many|not enough|overflow|traffic|parking|safety|crime|noise|pollution|taxes|rent|cost|price|development|housing|schools|parks|roads|transit|bus|bike|walk|sidewalk)\b/i
    const QUESTION_SIGNALS = /^\s*(who|what|where|when|why|how|can you|could you|do you|is there|are there|will you|would you)\b/i

    if (hitsSensitive || (!FEEDBACK_SIGNALS.test(analyzeText) && QUESTION_SIGNALS.test(analyzeText))) {
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
            console.error('[TH Chat] INSERT deflect turn failed:', deflectInsertErr.message)
            // Retry: drop ai_thinking, fall back to 'clarifier' source (CHECK constraint compat)
            delete deflectInsert.ai_thinking
            deflectInsert.source = 'clarifier'
            const { error: retryErr } = await supabase.from('townhall_turns').insert(deflectInsert)
            if (retryErr) console.error('[TH Chat] INSERT deflect retry also failed:', retryErr.message)
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
  // Only fires when clarifier would trigger AND response has subtle signals
  const SUBTLE_DISENGAGE = /^(whatever|sure|fine|ok|okay|i guess|idk|i don't know|yeah|yep|yes|yup|nah|no|not really|i said what i said|all of the above|all of them|both|same|agreed|exactly|absolutely|definitely|correct|right)\s*[.!?]*$/i
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
    // Prefer under-target topics, but include target-reached ones as fallback (deprioritized)
    const underTarget = allTopics.filter(t => t.response_count < t.response_target && !discussedThemeIds.has(t.id))
    const overTarget = allTopics.filter(t => t.response_count >= t.response_target && !discussedThemeIds.has(t.id))
    let available = underTarget.length > 0 ? underTarget : overTarget

    if (seedBudgetExhausted) {
      const organicAvailable = available.filter(t => t.source !== 'guide')
      if (organicAvailable.length > 0) {
        available = organicAvailable
        if (testing) debug.push('BUDGET: Seed budget exhausted (' + seedTurnsUsed + '/' + seedBudget + ') — prioritizing organic topics')
      }
    }

    if (testing && !isOpeningResponse) {
      debug.push('DECISION: Move to next topic')
      if (moveOnSignal) debug.push('Clarifier skipped: move-on signal detected')
      else if (trajectoryDisengaging) debug.push('Clarifier skipped: response trajectory declining')
      else if (topicTurnCapHit) debug.push('Clarifier skipped: dynamic topic cap hit (' + currentTopicTurns + '/' + dynamicTopicCap + ')')
      else if (wordCount >= clarifyWordThreshold) debug.push('Clarifier skipped: response was ' + wordCount + ' words (>= ' + clarifyWordThreshold + ' threshold)')
      else if (clarifierTurnsOnTopic >= maxClarifiersPerTopic) debug.push('Clarifier skipped: hit max ' + maxClarifiersPerTopic + ' clarifiers on this topic')
      else if (currentTopicTurns >= dynamicTopicCap) debug.push('Clarifier skipped: dynamic cap reached (' + currentTopicTurns + '/' + dynamicTopicCap + ')')
      debug.push('Topics discussed: ' + discussedThemeIds.size + ' | Available: ' + available.length + ' (seed: ' + available.filter(t => t.source === 'guide').length + ', organic: ' + available.filter(t => t.source !== 'guide').length + ')')
    }

    if (available.length === 0) {
      // All topics covered — don't revisit/hammer. Either standby or wrap up.
      if (testing) debug.push('ALL TOPICS VISITED — entering standby or wrap-up')

      // If organic topic detection is on, enter standby mode (topics may emerge from other participants)
      const hasOrganic = config?.engine?.theme_detection_mode === 'auto'
      if (hasOrganic && turnsUsed < maxTurnsForBudget - 2) {
        // Standby: thank them and let them know we may come back
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
    console.error('[TH Chat] INSERT turn failed:', insertError.message, '| session:', session.id, '| participant:', participant_id, '| turn:', nextTurnNumber, '| source:', aiSource)
    // Retry: drop ai_thinking, fall back source to 'guide' (CHECK constraint compat)
    delete insertPayload.ai_thinking
    const originalSource = insertPayload.source
    if (!['guide', 'clarifier', 'detected_theme', 'custom'].includes(String(originalSource))) {
      insertPayload.source = 'guide'
    }
    const { error: retryError } = await supabase.from('townhall_turns').insert(insertPayload)
    if (retryError) console.error('[TH Chat] INSERT retry also failed:', retryError.message)
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
      console.warn('[TH chat] AI refusal detected; dropping bot text. text=' + outText.slice(0, 200))
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

// ── Language switch detection (hybrid: fast regex + AI fallback) ──────────
// Fast regex catches obvious requests instantly (no API call).
// AI classifier handles ambiguous cases at >=95% confidence.

const LANG_CODES = ['en','es','fr','de','pt','it','zh','ja','ko','ar','hi','vi','tl','ru','pl']

// Language name → code mapping for regex matching
const LANG_NAMES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', espanol: 'es',
  french: 'fr', français: 'fr', francais: 'fr',
  german: 'de', deutsch: 'de',
  portuguese: 'pt', português: 'pt', portugues: 'pt',
  italian: 'it', italiano: 'it',
  chinese: 'zh', mandarin: 'zh', '中文': 'zh',
  japanese: 'ja', '日本語': 'ja',
  korean: 'ko', '한국어': 'ko',
  arabic: 'ar', 'العربية': 'ar',
  hindi: 'hi', 'हिन्दी': 'hi',
  vietnamese: 'vi', 'tiếng việt': 'vi',
  filipino: 'tl', tagalog: 'tl',
  russian: 'ru', 'русский': 'ru',
  polish: 'pl', polski: 'pl',
}

function fastDetectLanguageSwitch(msg: string): string | null {
  const lower = msg.toLowerCase().trim()
  // Pattern 1: Just a language name, optionally with "please" / "por favor" / etc.
  const bareMatch = lower.replace(/\s*(please|por favor|s'il vous plaît|bitte|per favore)\s*/gi, '').trim()
  if (LANG_NAMES[bareMatch]) return LANG_NAMES[bareMatch]

  // Pattern 2: "speak/switch/change to X", "can you speak X", "use X"
  const actionMatch = lower.match(/(?:speak|switch|change|use|talk|respond|write|switch to|change to)\s+(?:in\s+)?(\S+(?:\s+\S+)?)/i)
  if (actionMatch && LANG_NAMES[actionMatch[1].toLowerCase()]) return LANG_NAMES[actionMatch[1].toLowerCase()]

  // Pattern 3: "can you speak X" / "could you speak X" / "please speak X"
  const politeMatch = lower.match(/(?:can you|could you|please)\s+(?:speak|use|switch to|switch)\s+(?:in\s+)?(\S+(?:\s+\S+)?)/i)
  if (politeMatch && LANG_NAMES[politeMatch[1].replace(/[?.!]$/, '').toLowerCase()]) return LANG_NAMES[politeMatch[1].replace(/[?.!]$/, '').toLowerCase()]

  // Pattern 4: "no hablo/speak X" → switch to user's language
  if (/no\s+(hablo|speak|understand)\s+(english|inglés|ingles)/i.test(lower)) return 'es'
  if (/je\s+ne\s+parle\s+pas\s+(anglais|english)/i.test(lower)) return 'fr'
  if (/não\s+falo\s+(inglês|english)/i.test(lower)) return 'pt'
  if (/ich\s+spreche\s+kein\s+(englisch|english)/i.test(lower)) return 'de'

  return null
}

async function detectLanguageSwitch(msg: string): Promise<{ lang: string; confidence: number } | null> {
  // Skip detection for long messages — these are real responses, not switch requests
  if (msg.length > 120) return null

  // Step 1: Fast regex for obvious cases (instant, no API call)
  const fastResult = fastDetectLanguageSwitch(msg)
  if (fastResult) return { lang: fastResult, confidence: 100 }

  // Step 2: AI classifier for ambiguous short messages only
  // Only worth the API call for short messages that might be switch requests
  if (msg.length > 60) return null

  try {
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
    const parsed = JSON.parse(result.text)
    if (parsed.is_switch && parsed.confidence >= 95 && LANG_CODES.includes(parsed.lang)) {
      return { lang: parsed.lang, confidence: parsed.confidence }
    }
  } catch { /* AI call or parse failed — not a switch */ }
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

  const result = await callClaude(system, user, config?.engine?.ai_timeout_ms || 3000, verbose)
  return { text: (result.text && isOutputClean(result.text)) ? result.text : (isOrganic ? 'After listening to what other ' + audience.participants + ' are saying, ' + nextTopic.label + ' seems important — ' + nextTopic.question : 'Let me ask you about something else — ' + nextTopic.question), thinking: result.thinking }
}
