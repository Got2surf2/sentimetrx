// app/api/suggest/route.ts
// POST — ghost-text completion suggestion. Returns a single short
// continuation for the user's current input prefix, or empty string if
// nothing is a good enough fit. Branded as "Ana suggests".
//
// Surfaces (whitelisted): 'export-instructions', 'bot-system-prompt',
// 'bot-personality', 'bot-deflection-message'.
//
// Off-mode is honored via callAI's org gate — when the org's AI mode is
// 'off', callAI throws AIDisabledError and we return empty suggestion (no
// 500). Other failures also degrade to empty rather than erroring out,
// since ghost text is non-essential UX sugar.

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

type Surface =
  | 'export-instructions'
  | 'bot-system-prompt'
  | 'bot-personality'
  | 'bot-deflection-message'

interface SuggestRequest {
  surface: Surface
  prefix:  string
  context: Record<string, unknown>
}

const MAX_PREFIX_CHARS = 400
const MAX_OUTPUT_TOKENS = 30

// Shared rules every surface follows — kept in one place so prompt drift
// across surfaces doesn't cause inconsistent UX.
const RULES =
  'Continue what the user has typed with ONE plausible short continuation (4–18 words). ' +
  'Match their voice, register, and partial-word state — if they ended mid-word, complete the word. ' +
  'Never repeat what they have typed. Never add quotes, headers, labels, or explanations. ' +
  'If you cannot produce a high-confidence continuation that flows naturally, return an empty string. ' +
  'Output ONLY the continuation text, nothing else.'

function buildBotContextLine(ctx: { botName?: string; botSubject?: string; botPersonality?: string }): string {
  const parts: string[] = []
  if (ctx.botName) parts.push('Agent name: "' + ctx.botName + '"')
  if (ctx.botSubject) parts.push('Subject: "' + ctx.botSubject + '"')
  if (ctx.botPersonality) parts.push('Established personality: "' + ctx.botPersonality.slice(0, 200) + '"')
  return parts.length > 0 ? parts.join('. ') + '.' : ''
}

function buildPrompt(req: SuggestRequest): { system: string; user: string } | null {
  if (req.surface === 'export-instructions') {
    const ctx = req.context as {
      datasetName?:   string
      datasetSource?: string
      audience?:      string
      themes?:        Array<{ name: string }>
    }
    const themesLine = Array.isArray(ctx.themes) && ctx.themes.length > 0
      ? 'Top themes in this dataset: ' + ctx.themes.slice(0, 5).map(function(t) { return t.name }).join(', ') + '.'
      : ''
    const system =
      'You are Ana, an inline writing assistant for a survey analytics platform. ' +
      'The user is composing instructions for an AI-generated executive presentation about their dataset. ' +
      RULES + '\n\n' +
      'Dataset: ' + (ctx.datasetName || 'unnamed') +
      (ctx.datasetSource ? ' (source: ' + ctx.datasetSource + ')' : '') + '. ' +
      (ctx.audience ? 'Audience: ' + ctx.audience + '. ' : '') +
      themesLine
    return { system, user: req.prefix }
  }

  if (req.surface === 'bot-system-prompt') {
    const ctx = req.context as { botName?: string; botSubject?: string; botPersonality?: string }
    const system =
      'You are Ana, an inline writing assistant. ' +
      'The user is writing a system prompt for a customer-facing AI agent on this platform. ' +
      'System prompts are instructions to the agent describing how it should behave, what topics it covers, tone, refusal rules. ' +
      RULES + '\n\n' +
      buildBotContextLine(ctx)
    return { system, user: req.prefix }
  }

  if (req.surface === 'bot-personality') {
    const ctx = req.context as { botName?: string; botSubject?: string }
    const system =
      'You are Ana, an inline writing assistant. ' +
      'The user is describing the personality and voice of an AI agent. ' +
      'These are short prose descriptions like "Friendly customer-support rep for a SaaS product. Casual, uses first names, explains technical concepts simply." ' +
      RULES + '\n\n' +
      buildBotContextLine(ctx)
    return { system, user: req.prefix }
  }

  if (req.surface === 'bot-deflection-message') {
    const ctx = req.context as { botName?: string; botSubject?: string; botPersonality?: string }
    const system =
      'You are Ana, an inline writing assistant. ' +
      'The user is writing a "deflection message" — what the agent says when asked something off-topic or out of scope. ' +
      'Tone should match the agent\'s established personality. Be polite, brief, redirect to what the agent CAN help with. ' +
      RULES + '\n\n' +
      buildBotContextLine(ctx)
    return { system, user: req.prefix }
  }

  return null
}

export async function POST(req: NextRequest) {
  // Auth — never serve suggestions to anonymous callers.
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ suggestion: '' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id as string | null
  if (!orgId) return NextResponse.json({ suggestion: '' }, { status: 401 })

  let body: SuggestRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ suggestion: '' }, { status: 400 })
  }

  if (!body.prefix || body.prefix.length < 2 || body.prefix.length > MAX_PREFIX_CHARS) {
    return NextResponse.json({ suggestion: '' })
  }

  const prompt = buildPrompt(body)
  if (!prompt) return NextResponse.json({ suggestion: '' }, { status: 400 })

  try {
    const result = await callAI({
      tier:       'fast',
      maxTokens:  MAX_OUTPUT_TOKENS,
      timeoutMs:  5000,
      system:     prompt.system,
      messages:   [{ role: 'user', content: prompt.user }],
      usage:      { org_id: orgId, resource_type: 'system', event_type: 'ghost_suggest' },
    })

    let suggestion = (result.text || '').trim()

    // Defensive cleanup: model may parrot the prefix or wrap in quotes.
    if (suggestion.startsWith('"') && suggestion.endsWith('"')) {
      suggestion = suggestion.slice(1, -1).trim()
    }
    if (suggestion.toLowerCase().startsWith(body.prefix.trim().toLowerCase())) {
      suggestion = suggestion.slice(body.prefix.trim().length).trimStart()
    }

    return NextResponse.json({ suggestion })
  } catch {
    // Includes AIDisabledError (org mode='off'), timeouts, rate limits.
    // Ghost text is non-essential — always degrade silently.
    return NextResponse.json({ suggestion: '' })
  }
}
