import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { randomUUID } from 'crypto'
import { resolveTownHall, projectHallAsSession } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'

// Translate text to a target language (for non-English participants)
async function translateText(text: string, targetLang: string): Promise<string> {
  if (!text || targetLang === 'en') return text
  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 500,
      timeoutMs: 4000,
      system: 'Translate the following text to ' + targetLang + '. Return ONLY the translation, nothing else. Preserve tone and formatting.',
      messages: [{ role: 'user', content: text }],
    })
    logUsage({ resource_type: 'townhall', event_type: 'translate' }, result.usage)
    return result.text?.trim() || text
  } catch { return text }
}

// GET /api/townhall/join/:sessionId — check session status (public, no auth)
export async function GET(_req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = createServiceRoleClient()

  // Resolve by slug first, then by UUID
  const identifier = params.sessionId

  // Resolve on the unified substrate; project cohort_config into the classic
  // `session.config` shape so the rest of the handler is shape-agnostic.
  let session: any = null
  {
    const hall = await resolveTownHall(supabase as any, identifier)
    if (hall) session = projectHallAsSession(hall)
  }
  if (!session) {
    return NextResponse.json({ found: false }, { status: 404 })
  }

  const config = session.config as any
  // Legacy compat: fall back to old field names if new ones aren't set
  const openingMsg = config?.opening_message || ((config?.display?.welcome_message || '') + (config?.opening_question ? '\n\n' + config.opening_question : '')) || 'Welcome! Share your thoughts anonymously.'
  const closingMsg = config?.closing_message || config?.session_end?.closing_message || config?.display?.thank_you_message || 'Thank you for participating!'
  return NextResponse.json({
    found: true,
    name: session.name,
    status: session.status,
    bot_name: config?.bot_name || 'PulseIQ',
    bot_emoji: config?.bot_emoji || '\uD83D\uDCAC',
    languages: config?.languages || [],
    display: config?.display || {},
    opening_message: openingMsg,
    closing_message: closingMsg,
    // Canned bot messages (facilitator configurable)
    bot_messages: {
      post_session_intro:  config?.messages?.post_session_intro  || 'Almost done — a few quick optional questions to help us understand who we heard from today.',
      post_session_demo:   config?.messages?.post_session_demo   || 'A couple of optional questions about you.',
      post_session_thanks: config?.messages?.post_session_thanks || 'Thanks for sharing! Your input helps us understand our community better.',
    },
    // Question config
    questionPosition: config?.questionPosition || 'after',
    demoFields: config?.demoFields || [],
    psychographicBank: config?.psychographicBank || [],
    psychoCount: config?.psychoCount || 3,
    testing: !!config?.testing,
    header_color: config?.header_color || '#00b4d8',
  })
}

// POST /api/townhall/join/:sessionId — participant joins, gets welcome + opening question
export async function POST(req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = createServiceRoleClient()

  // Resolve by slug or UUID
  const identifier = params.sessionId

  let session: any = null
  {
    const hall = await resolveTownHall(supabase as any, identifier)
    if (hall) session = projectHallAsSession(hall)
  }
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  if (session.status !== 'active') {
    return NextResponse.json({
      error: 'Session is not active',
      status: session.status,
    }, { status: 400 })
  }

  let body: { language?: string } = {}
  try { body = await req.json() } catch { /* no body is fine */ }

  const config = session.config as any
  const language = body.language || 'en'
  // crypto.randomUUID() — unguessable. Math.random() is predictable
  // enough that a moderator with a few participant IDs could enumerate
  // others.
  const participantId = 'p_' + randomUUID()

  // Use opening_message (new) or fall back to legacy welcome + opening_question
  const openingEn = config?.opening_message
    || ((config?.display?.welcome_message || 'Welcome! Share your thoughts anonymously.') + '\n\n' + (config?.opening_question || 'What\'s on your mind?'))

  // Translate opening + canned messages for non-English participants
  const botMessage = language !== 'en' ? await translateText(openingEn, language) : openingEn

  // Translate canned post-session messages
  const msgs = config?.messages || {}
  const introEn = msgs.post_session_intro || 'Almost done — a few quick optional questions to help us understand who we heard from today.'
  const demoEn  = msgs.post_session_demo  || 'A couple of optional questions about you.'
  const thanksEn = msgs.post_session_thanks || 'Thanks for sharing! Your input helps us understand our community better.'
  const closingEn = config?.closing_message || config?.session_end?.closing_message || 'Thank you for participating!'

  let translatedMessages = { post_session_intro: introEn, post_session_demo: demoEn, post_session_thanks: thanksEn }
  let translatedClosing = closingEn
  let translatedPsychoBank = config?.psychographicBank || []
  let translatedDemoFields = config?.demoFields || []
  if (language !== 'en') {
    // Batch translate canned messages
    const batch = [introEn, demoEn, thanksEn, closingEn]
    const batchText = batch.map((t, i) => '[' + (i + 1) + '] ' + t).join('\n')
    const translated = await translateText(batchText, language)
    const lines = translated.split('\n').map(l => l.replace(/^\[\d+\]\s*/, '').trim()).filter(Boolean)
    if (lines.length >= 4) {
      translatedMessages = { post_session_intro: lines[0], post_session_demo: lines[1], post_session_thanks: lines[2] }
      translatedClosing = lines[3]
    }

    // Translate psychographic questions + options
    const psychoBank = config?.psychographicBank || []
    if (psychoBank.length > 0) {
      const psychoText = psychoBank.map((pq: any, i: number) =>
        '[Q' + (i + 1) + '] ' + pq.q + '\n' + (pq.opts || []).map((o: string, j: number) => '[Q' + (i + 1) + 'O' + (j + 1) + '] ' + o).join('\n')
      ).join('\n')
      try {
        const tPsycho = await translateText(psychoText, language)
        const tLines = tPsycho.split('\n').map(l => l.trim()).filter(Boolean)
        translatedPsychoBank = psychoBank.map((pq: any, i: number) => {
          const qLine = tLines.find(l => l.startsWith('[Q' + (i + 1) + ']'))
          const translatedQ = qLine ? qLine.replace(/^\[Q\d+\]\s*/, '') : pq.q
          const translatedOpts = (pq.opts || []).map((o: string, j: number) => {
            const oLine = tLines.find(l => l.startsWith('[Q' + (i + 1) + 'O' + (j + 1) + ']'))
            return oLine ? oLine.replace(/^\[Q\d+O\d+\]\s*/, '') : o;
          })
          return { ...pq, q: translatedQ, opts: translatedOpts, _origQ: pq.q, _origOpts: pq.opts }
        })
      } catch { /* keep English fallback */ }
    }

    // Translate demo field labels
    const demoFields = (config?.demoFields || []).filter((f: any) => f.enabled)
    if (demoFields.length > 0) {
      const demoText = demoFields.map((f: any, i: number) => '[D' + (i + 1) + '] ' + f.label).join('\n')
      try {
        const tDemo = await translateText(demoText, language)
        const tLines = tDemo.split('\n').map(l => l.trim()).filter(Boolean)
        translatedDemoFields = demoFields.map((f: any, i: number) => {
          const dLine = tLines.find(l => l.startsWith('[D' + (i + 1) + ']'))
          return { ...f, label: dLine ? dLine.replace(/^\[D\d+\]\s*/, '') : f.label, _origLabel: f.label };
        })
      } catch { translatedDemoFields = demoFields }
    }
  }

  // No opening-turn insert here: chatCore (via /api/townhall/chat →
  // handleChatTurn) creates the conversations row + first user/assistant
  // turn pair on the participant's first message — pre-inserting an empty
  // opener would poison the conversation_turns sequence.

  return NextResponse.json({
    session_id: session.id,  // resolved UUID — client should use this for all subsequent calls
    participant_id: participantId,
    bot_message: botMessage,
    closing_message: translatedClosing,
    bot_messages: translatedMessages,
    questionPosition: config?.questionPosition || 'after',
    psychographicBank: translatedPsychoBank,
    demoFields: translatedDemoFields,
    theme_id: null,
    source: 'opening',
    is_final: false,
    turn_number: 1,
  })
}
