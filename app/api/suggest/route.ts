// app/api/suggest/route.ts
// POST — ghost-text completion suggestion. Returns a single short
// continuation for the user's current input prefix, or empty string if
// nothing is a good enough fit. Branded as "Ana suggests".
//
// Surfaces (whitelisted): 'export-instructions'.
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

interface SuggestRequest {
  surface: 'export-instructions'
  prefix:  string
  context: Record<string, unknown>
}

const MAX_PREFIX_CHARS = 400
const MAX_OUTPUT_TOKENS = 30

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
      'Your job: continue what they have typed, in their voice, with ONE plausible, short completion (4–18 words). ' +
      'Use the dataset name and themes as context — your suggestion should be specific to this dataset when possible. ' +
      'Never repeat what they have already typed. Never add quotes, headers, or explanations. ' +
      'If you can not produce a high-confidence continuation that flows naturally from the prefix, return an empty string. ' +
      'Output ONLY the continuation text, nothing else.\n\n' +
      'Dataset: ' + (ctx.datasetName || 'unnamed') +
      (ctx.datasetSource ? ' (source: ' + ctx.datasetSource + ')' : '') + '. ' +
      (ctx.audience ? 'Audience: ' + ctx.audience + '. ' : '') +
      themesLine
    return { system, user: req.prefix }
  }
  return null
}

export async function POST(req: NextRequest) {
  // Auth — never serve suggestions to anonymous callers.
  const supabase = createClient()
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
