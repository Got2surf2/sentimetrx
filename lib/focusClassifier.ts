// lib/focusClassifier.ts
//
// Prompt Focus helpers.
//
// A "focus" is a bot-side topic / coverage area (parallel to but distinct from
// intents, which are user-side signals). Each focus has:
//   { slug, label, description, enabled }
//
// Two helpers live here:
//
// 1. classifyResponseFocuses(focuses, assistantText)
//    Runs a fast classification call (Haiku) over the bot's assistant reply
//    and returns the slugs of every focus the reply addresses. Used by the
//    chat route to tag each assistant turn so conversations can be filtered
//    by which focus was covered.
//
// 2. suggestFocusesFromPrompt(systemPrompt)
//    Reads a bot's system_prompt and proposes 10-20 candidate focuses for the
//    bot owner to review. Helps migrate existing bots without typing each
//    focus out by hand.

import { callAI, type AIUsage } from './ai'

export interface BotFocus {
  slug: string
  label: string
  description: string
  enabled: boolean
}

interface ClassifyResult {
  slugs: string[]
  usage: AIUsage | undefined
}

/**
 * Identify which of the bot's defined focuses an assistant reply addresses.
 * Returns an empty slug list (and no AI call) if no focuses are enabled.
 */
export async function classifyResponseFocuses(
  focuses: BotFocus[],
  assistantText: string,
): Promise<ClassifyResult> {
  const active = (focuses || []).filter(f => f && f.slug && f.enabled !== false)
  if (active.length === 0 || !assistantText || assistantText.length < 20) {
    return { slugs: [], usage: undefined }
  }

  const catalog = active
    .map((f, i) => `${i + 1}. ${f.slug} — ${f.label}: ${f.description || '(no description)'}`)
    .join('\n')

  const system =
    'You are a focus classifier. Given a list of focus areas and an assistant reply, identify which focus areas the reply primarily addresses. ' +
    'A reply often addresses 1-3 focuses; it may address none if the reply was off-topic or purely conversational. ' +
    'Return ONLY a comma-separated list of slugs from the provided catalog, or the single word NONE. No prose, no quotes.\n\n' +
    'FOCUS CATALOG:\n' + catalog

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 80,
      timeoutMs: 10000,
      system,
      messages: [{ role: 'user', content: 'Assistant reply:\n"""\n' + assistantText.slice(0, 1500) + '\n"""' }],
    })

    const text = (result.text || '').trim()
    if (!text || /^none$/i.test(text)) return { slugs: [], usage: result.usage }

    const validSlugs = new Set(active.map(f => f.slug.toLowerCase()))
    const raw = text
      .replace(/[\[\]"'`]/g, '')
      .split(/[,\n]/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
    const matched = raw.filter(s => validSlugs.has(s))

    // Dedupe while preserving order
    const seen = new Set<string>()
    const slugs: string[] = []
    for (const s of matched) {
      if (!seen.has(s)) { seen.add(s); slugs.push(s) }
    }

    return { slugs, usage: result.usage }
  } catch {
    return { slugs: [], usage: undefined }
  }
}

interface SuggestResult {
  focuses: BotFocus[]
  usage: AIUsage | undefined
}

/**
 * Read a bot's system prompt and propose 10-20 candidate focuses.
 * The bot owner reviews + edits these before saving.
 */
export async function suggestFocusesFromPrompt(systemPrompt: string): Promise<SuggestResult> {
  const trimmed = (systemPrompt || '').slice(0, 8000)
  if (trimmed.length < 100) return { focuses: [], usage: undefined }

  const system =
    'You analyze AI agent system prompts and propose a list of "focuses" — discrete topics or coverage areas the agent is expected to handle. ' +
    'Each focus represents one thing a user might come to the agent for. A good focus is specific enough to be useful for filtering conversations later but broad enough to cover several related questions.\n\n' +
    'Return ONLY a valid JSON array (no prose, no markdown fences) of 10-20 objects with this exact shape:\n' +
    '[{ "slug": "snake_case_identifier", "label": "Short Human Label", "description": "One-sentence description of what this focus covers" }]\n\n' +
    'Rules:\n' +
    '- Slug is lowercase snake_case, max 40 characters, unique within the list.\n' +
    '- Label is 2-5 words, title case.\n' +
    '- Description is one sentence, 8-20 words, written so a classifier could match assistant replies against it.\n' +
    '- Cover both information topics (things users ask about) AND feedback/intent topics (things users share or request).\n' +
    '- Skip generic catch-alls like "greeting" or "general question".'

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 1500,
      timeoutMs: 25000,
      system,
      messages: [{ role: 'user', content: 'Agent system prompt:\n"""\n' + trimmed + '\n"""\n\nPropose focuses.' }],
    })

    const text = (result.text || '').trim()
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return { focuses: [], usage: result.usage }

    let parsed: unknown
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return { focuses: [], usage: result.usage } }
    if (!Array.isArray(parsed)) return { focuses: [], usage: result.usage }

    const seen = new Set<string>()
    const focuses: BotFocus[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const slug = String(item.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      if (!slug || seen.has(slug)) continue
      const label = String(item.label || '').slice(0, 80).trim()
      const description = String(item.description || '').slice(0, 240).trim()
      if (!label) continue
      seen.add(slug)
      focuses.push({ slug, label, description, enabled: true })
    }

    return { focuses, usage: result.usage }
  } catch {
    return { focuses: [], usage: undefined }
  }
}
