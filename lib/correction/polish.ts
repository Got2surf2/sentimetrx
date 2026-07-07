// lib/correction/polish.ts
//
// Product-agnostic AI polish for verbatim text — the shared generalization of the
// Town Hall polish pass (lib/recordings analyze.polishQaPairs). Faithfully cleans
// short verbatims (typos, ASR mis-hearings, filler, grammar) for a publication-
// ready report WITHOUT changing meaning or inventing anything, applying a brand
// glossary of canonical spellings. The raw source is never mutated — callers store
// the polished text as a derived/display layer.
//
// Returns an array aligned with the input; an item is `null` if it couldn't be
// polished (parse failure / AI off), so callers fall back to the raw verbatim.

import 'server-only'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import type { AIUsageContext } from '@/lib/ai'

const BATCH = 40

export async function polishVerbatims(
  texts: string[],
  opts: { glossary?: string[]; usage?: AIUsageContext } = {},
): Promise<(string | null)[]> {
  if (texts.length === 0) return []

  const glossaryBlock = opts.glossary && opts.glossary.length > 0
    ? `\n\nCANONICAL SPELLINGS — when any name, place, road, or term below appears (including phonetic mis-hearings, typos, or alternate spellings), use this EXACT spelling. Change nothing else about the meaning:\n${opts.glossary.slice(0, 200).map(g => `  - ${g}`).join('\n')}`
    : ''

  const system = `You are lightly cleaning short verbatim quotes for an official, public-shareable report. Each numbered item is a VERBATIM message (typed or transcribed) from a member of the public. Produce a clean, readable version of each.

FAITHFUL CLEANUP, NOT A REWRITE:
- Fix spelling, obvious typos, mis-hearings, punctuation, capitalization, and grammar so it reads cleanly.
- Preserve meaning EXACTLY. Do NOT add, infer, remove, or invent any fact, number, name, place, date, or opinion. Keep the speaker's wording and intent — just make it legible.
- Remove only filler ("um", "uh", "like", "you know"), false starts, and repeated words. If an item is already clean, return it essentially unchanged.
- Render road/route designations consistently with their prefix when clearly intended (e.g. "SR 429", "US 441") but do NOT numeralize ordinary counts.
- Stay strictly neutral and factual.

Keep every item; do NOT merge, split, reorder, or drop items.${glossaryBlock}

OUTPUT — a single JSON object, no prose, no markdown fences:
{"items":[{"i":<int>,"text":"<cleaned verbatim>"}]}`

  const batches: string[][] = []
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH))

  const results = await Promise.all(batches.map(async (batch) => {
    const userPrompt = batch.map((t, i) => `[${i}] ${t}`).join('\n')
    try {
      const res = await callAI({ tier: 'standard', maxTokens: 4000, timeoutMs: 60000, system, messages: [{ role: 'user', content: userPrompt }] })
      if (opts.usage) logUsage({ ...opts.usage, event_type: 'verbatim_polish' }, res.usage)
      const parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      const items: Array<{ i?: number; text?: unknown }> = Array.isArray(parsed?.items) ? parsed.items : []
      return batch.map((_t, i) => {
        const m = items.find(x => x && x.i === i)
        const cleaned = m && typeof m.text === 'string' ? m.text.trim() : ''
        return cleaned.length > 0 ? cleaned : null
      })
    } catch {
      return batch.map(() => null)
    }
  }))

  return results.flat()
}
