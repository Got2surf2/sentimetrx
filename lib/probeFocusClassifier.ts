// lib/probeFocusClassifier.ts
//
// Probe-focus tagging (docs/BOTS.md § 9.x.1) — user-side mirror of
// lib/focusClassifier.ts. Same focus catalog, same model tier, opposite
// turn role.
//
// classifyResponseFocuses (focusClassifier.ts) runs on assistant turns
// and tags `focus:<slug>` — "what did the bot's reply cover."
//
// classifyProbeFocuses (this file) runs on user turns and tags
// `topic:<slug>` — "what did the user actually talk about." The two
// tags use distinct prefixes so downstream analytics can diff them:
//
//   - matched   = focus:X on assistant turn N AND topic:X on user turn N-1
//                 (bot asked about X, user answered about X)
//   - mismatched= topic:Y on user turn N-1 AND focus:X on assistant turn N,
//                 X ≠ Y (user pivoted)
//   - user-only = topic:Y on user turn N-1 with no matching focus on the
//                 assistant turn at all (off-topic the bot didn't address)
//
// AI cost: one Haiku call per user turn ≥3 words. Gated per-bot via
// agents.probe_focus_enabled (sql/084) — default off.

import { callAI, type AIUsage } from './ai'
import type { BotFocus } from './focusClassifier'

interface ClassifyResult {
  slugs: string[]
  usage: AIUsage | undefined
}

/**
 * Identify which of the bot's defined focuses a user turn addresses.
 * Returns empty slug list (and no AI call) if no focuses are enabled or
 * if the user text is too short to classify reliably.
 *
 * Conservative threshold: skip messages under 12 chars / 3 words. Those
 * are typically greetings, "yes", "ok", "thanks" — classifying them
 * burns AI calls + pollutes the topic data.
 */
export async function classifyProbeFocuses(
  focuses: BotFocus[],
  userText: string,
): Promise<ClassifyResult> {
  const active = (focuses || []).filter(f => f && f.slug && f.enabled !== false)
  if (active.length === 0) return { slugs: [], usage: undefined }

  const trimmed = (userText || '').trim()
  if (trimmed.length < 12) return { slugs: [], usage: undefined }
  if (trimmed.split(/\s+/).filter(Boolean).length < 3) return { slugs: [], usage: undefined }

  const catalog = active
    .map((f, i) => `${i + 1}. ${f.slug} — ${f.label}: ${f.description || '(no description)'}`)
    .join('\n')

  const system =
    'You are a topic classifier. Given a list of topic areas and what a USER said in a conversation, identify which topic areas the user is talking about. ' +
    'A user message often touches 1-3 topics; it may touch none if the user is asking a clarification, greeting, or making small talk. ' +
    'Return ONLY a comma-separated list of slugs from the provided catalog, or the single word NONE. No prose, no quotes.\n\n' +
    'TOPIC CATALOG:\n' + catalog

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 80,
      timeoutMs: 10000,
      system,
      messages: [{ role: 'user', content: 'User message:\n"""\n' + trimmed.slice(0, 1500) + '\n"""' }],
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
