// PulseIQ participant chat — the unified engine endpoint.
// Resolves the pulseiq_sessions row (by uuid or slug) and delegates the turn
// to lib/chatCore.handleChatTurn — the same engine agents use, with full
// PulseIQ parity (convergence items 0-7: rounds, lifecycle, skip/done
// protocol, language switch, guards, opening match, facilitation policy).
// The ~1075-line legacy orchestrator and its townhall_* tables were DELETED
// at the end of convergence tranche 2 (2026-07-04, sql/153) after the owner's
// Phase 6 acceptance — see docs/CONVERGENCE.md §4.
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { cleanAiOutput, looksLikeAIRefusal } from '@/lib/guardrails'
import { callAI } from '@/lib/ai'
import { type UsageContext } from '@/lib/usageLog'
import {
  SWITCH_CONFIRM,
  detectLanguageSwitch,
  LANGUAGE_SWITCH_CLASSIFIER_PROMPT,
} from '@/lib/languageSwitch'
import { handleChatTurn } from '@/lib/chatCore'
import { logError } from '@/lib/log'
import { mirrorTurns } from '@/lib/phase3DualWrite'

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

// Minimal shapes for the pulseiq_sessions row and its cohort_config JSON.
// The service-role client is untyped, so these annotate the fields this
// route actually reads (all cohort_config fields optional).
interface SessionEndConfig {
  mode?: string
  duration_minutes?: number
  inactivity_timeout_minutes?: number
  closing_message?: string
}
interface CohortConfig {
  session_end?: SessionEndConfig
  closing_message?: string
  opening_message?: string
  max_turns_per_participant?: number
  content_safety?: Record<string, unknown>
}
interface PulseiqSessionRow {
  id: string
  slug: string
  org_id: string
  bot_id: string
  name: string
  status: string
  cohort_config: CohortConfig | null
  started_at: string | null
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

  // ── Unified PulseIQ path ─────────────────────────────────────────────
  // Resolve the pulseiq_sessions row for this session_id (uuid or slug) and
  // delegate to lib/chatCore.handleChatTurn — the unified engine with full
  // parity (convergence items 0–7: rounds, lifecycle, protocol, language,
  // guard, opening match, facilitation policy). Every session is born on
  // this substrate (sessions POST).
  {
    const isUUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id)
    const EV_COLS = 'id, slug, org_id, bot_id, name, status, cohort_config, started_at'
    let townHall: PulseiqSessionRow | null = null
    if (isUUID4) {
      const { data } = await supabase.from('pulseiq_sessions').select(EV_COLS).eq('id', session_id).single()
      townHall = data
    }
    if (!townHall) {
      const { data } = await supabase.from('pulseiq_sessions').select(EV_COLS).eq('slug', session_id.toLowerCase()).single()
      townHall = data
    }
    if (townHall) {
      // Resolve the backing agent by id WITHOUT a status gate: the SESSION
      // status (draft/live/paused/closed, handled below) governs the
      // participant experience. Dedicated agents are created 'paused' so
      // they're invisible to the public /b path, and pausing/archiving the
      // agent in the Agents UI must not 404 a live room.
      const { data: agent } = await supabase.from('agents').select('*').eq('id', townHall.bot_id).single()
      if (agent) {
        const cohortConfig: CohortConfig = townHall.cohort_config || {}
        const unifiedSessionId = townHall.id + ':' + participant_id

        // ── Session lifecycle (convergence item 2 — ports the legacy
        // auto-end / paused / ended / turn-cap orchestration). Event ↔
        // legacy status mapping: live=active, paused=paused, closed=ended.
        const sessionEnd: SessionEndConfig = cohortConfig.session_end || {}
        if (townHall.status === 'live' && sessionEnd.mode && sessionEnd.mode !== 'manual') {
          let shouldEnd = false
          if (sessionEnd.mode === 'timed' && townHall.started_at) {
            const elapsed = (Date.now() - new Date(townHall.started_at).getTime()) / 60000
            if (elapsed >= (sessionEnd.duration_minutes || 90)) shouldEnd = true
          }
          if (sessionEnd.mode === 'inactivity') {
            // Event-wide latest participant activity (mirrors the legacy
            // session-wide check). conversation_turns.town_hall_id is stamped
            // on every cohort turn, so no per-conversation id list is needed
            // (the old `.in(conversation_id, …)` broke at a few hundred
            // participants on URL length).
            const { data: lastTurn } = await supabase
              .from('conversation_turns')
              .select('created_at')
              .eq('town_hall_id', townHall.id)
              .eq('role', 'user')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            if (lastTurn) {
              const idle = (Date.now() - new Date(lastTurn.created_at).getTime()) / 60000
              if (idle >= (sessionEnd.inactivity_timeout_minutes || 30)) shouldEnd = true
            }
          }
          if (shouldEnd) {
            const { error: endErr } = await supabase.from('pulseiq_sessions')
              .update({ status: 'closed', ended_at: new Date().toISOString() })
              .eq('id', townHall.id)
            if (endErr) void logError('townhall.chat.autoEnd', endErr, { orgId: townHall.org_id })
            else townHall.status = 'closed'
          }
        }
        if (townHall.status === 'closed') {
          return NextResponse.json({
            bot_message: cohortConfig.closing_message || sessionEnd.closing_message || 'This session has ended. Thank you for participating.',
            is_final: true, theme_id: null, source: null, turn_number: turn_number + 1,
          })
        }
        if (townHall.status === 'paused') {
          return NextResponse.json({
            bot_message: 'This session is currently paused. Please check back shortly.',
            is_final: false, theme_id: null, source: null, turn_number: turn_number, paused: true,
          })
        }

        // Synthesize messages[] from prior turns for this (session, participant).
        // Reads bot_conversation_turns — handleChatTurn's SYNCHRONOUS store
        // (the conversations/conversation_turns mirror is async + gated on
        // DUAL_WRITE_PHASE3, so reading it here would race the mirror and go
        // blind when the flag is off). The earlier townhall_turns read
        // returned nothing on this path, so the engine had no memory across
        // requests.
        const { data: priorTurns } = await supabase
          .from('bot_conversation_turns')
          .select('role, content, turn_number, source')
          .eq('bot_id', agent.id)
          .eq('session_id', unifiedSessionId)
          .order('turn_number', { ascending: true })
        const messages: { role: 'user' | 'assistant'; content: string }[] = []
        let assistantTurnsUsed = 0
        for (const t of (priorTurns || [])) {
          // Language-switch exchanges are stored for the transcript but are
          // NOT conversational turns: excluding them here keeps them out of
          // the participant turn cap AND out of chatCore's opening-response
          // detection (a Spanish-first participant's first real answer must
          // still register as the opening message). The replayed translation
          // duplicates the prior bot message anyway, so no context is lost.
          if (t.source === 'language_switch') continue
          if (t.role === 'assistant' || t.role === 'user') {
            messages.push({ role: t.role as 'assistant' | 'user', content: t.content })
            if (t.role === 'assistant') assistantTurnsUsed++
          }
        }

        // Per-participant turn cap (legacy config.engine.max_turns_per_participant,
        // new home cohort_config.max_turns_per_participant; default 20).
        const maxTurns = cohortConfig.max_turns_per_participant || 20
        if (assistantTurnsUsed >= maxTurns) {
          return NextResponse.json({
            bot_message: cohortConfig.closing_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
            is_final: true, theme_id: null, source: null, turn_number: 999,
          })
        }

        // Skip / done semantics (convergence item 3). "[done]" ends the
        // conversation with the closing message (legacy wrapUp). A plain
        // skip stores the legacy marker as the user turn — the bracketed
        // text both matches legacy transcript conventions and tells the
        // model to change topics without pressing.
        if (skipped && message === '[done]') {
          return NextResponse.json({
            bot_message: cohortConfig.closing_message || 'Thank you for sharing your thoughts. Your input is really valuable.',
            is_final: true, theme_id: null, source: null, turn_number: turn_number + 1,
          })
        }
        if (skipped) {
          messages.push({ role: 'user', content: '[Skipped — participant declined to answer. Acknowledge briefly and move to a different topic without pressing them on this one.]' })
        } else if (message) {
          messages.push({ role: 'user', content: message })
        }
        if (messages.length === 0) {
          return NextResponse.json({ error: 'No message and no prior turns' }, { status: 400 })
        }

        // ── Language switch (convergence item 4 — legacy parity). AI-based,
        // ≥95%-confidence detector; doesn't count as a conversational turn.
        // Confirm bilingually, replay the previous bot message translated,
        // and return the localized skip/done labels. Subsequent requests
        // carry language=<target>, which chatCore already honors.
        if (message && !skipped) {
          // Per-call usage attribution (was a mutable module-global that raced
          // across concurrent requests). townHall.org_id is the paying org.
          const langUsageCtx = { org_id: townHall.org_id, resource_type: 'townhall' as const, resource_id: townHall.id, event_type: 'chat' }
          const langSwitch = await detectLanguageSwitch(message.trim(), async (m) => {
            const r = await callClaude(LANGUAGE_SWITCH_CLASSIFIER_PROMPT, m, 3000, false, langUsageCtx)
            return r.text || null
          })
          if (langSwitch) {
            const targetLang = langSwitch.lang
            const lastBotMsg = [...messages].reverse().find(m => m.role === 'assistant')?.content
              || cohortConfig.opening_message || 'What\'s on your mind?'
            let translatedMsg = lastBotMsg
            if (targetLang !== 'en') {
              try {
                const tr = await callClaude('Translate the following text to ' + targetLang + '. Return ONLY the translation, nothing else. Preserve tone.', lastBotMsg, 3000, false, langUsageCtx)
                if (tr.text) translatedMsg = tr.text
              } catch { /* keep original */ }
            }
            const confirm = SWITCH_CONFIRM[targetLang] || 'Sure — switching languages!'
            const switchBotMsg = confirm + '\n\n' + translatedMsg
            const labels = TH_LABELS[targetLang] || TH_LABELS.en

            // Store the exchange in the synchronous store (+ mirror) so the
            // conversation review shows the switch, mirroring legacy markers.
            const lastNum = (priorTurns || []).reduce((m, t) => Math.max(m, t.turn_number || 0), 0)
            // source 'language_switch' keeps these rows out of the turn cap
            // and opening-response counting on subsequent requests (they are
            // transcript markers, not conversational turns).
            const switchRows = [
              { bot_id: agent.id, session_id: unifiedSessionId, turn_number: lastNum + 1, role: 'user', content: '[Language switch: ' + targetLang + '] ' + message, language: language || 'en', source: 'language_switch' },
              { bot_id: agent.id, session_id: unifiedSessionId, turn_number: lastNum + 2, role: 'assistant', content: switchBotMsg, language: targetLang, source: 'language_switch' },
            ]
            const { error: swErr } = await supabase.from('bot_conversation_turns').insert(switchRows)
            if (swErr) void logError('townhall.chat.langSwitch', swErr, { orgId: townHall.org_id })
            void mirrorTurns(supabase, { botId: agent.id, orgId: townHall.org_id, sessionId: unifiedSessionId, language: targetLang, rows: switchRows, townHallId: townHall.id, participantId: participant_id }).then(function() {})

            return NextResponse.json({
              bot_message: switchBotMsg,
              theme_id: null,
              source: 'language_switch',
              is_final: false,
              turn_number: turn_number + 1,
              language_switched: targetLang,
              skip_label: labels.skip,
              done_label: labels.done,
            })
          }
        }

        const result = await handleChatTurn(
          { agent, service: supabase, ip, townHallContext: { townHallId: townHall.id, slug: townHall.slug, participantId: participant_id, contentSafety: cohortConfig.content_safety || undefined } },
          { messages, session_id: unifiedSessionId, language, debug: body.debug },
        )

        return NextResponse.json({
          bot_message: result.reply,
          theme_id: null,
          source: 'agent_handler',
          round_hold: !!result.roundHold,
          is_final: !!result.ended,
          ...(result.ended ? { shutdown: true } : {}),
          turn_number: turn_number + 1,
          ...(result._debug ? { _debug: result._debug } : {}),
        })
      }
    }

    // No pulseiq_sessions row matched (uuid or slug). The legacy orchestrator
    // that used to serve townhall_sessions rows from here is gone (tranche-2
    // deletion) — every session lives on the unified substrate.
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────


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
  usage?: UsageContext,
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
    // usage rides into callAI so these calls hit the per-org gate (off-mode /
    // BYOK) like every other gated call site — callAI auto-logs it, replacing
    // the manual logUsage this helper used to do (same single row).
    const result = await callAI({
      tier: 'fast',
      maxTokens: verbose ? 500 : 200,
      timeoutMs: verbose ? Math.max(timeoutMs, 5000) : timeoutMs,
      system: systemPayload,
      messages: [{ role: 'user', content: user }],
      usage,
    })
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

