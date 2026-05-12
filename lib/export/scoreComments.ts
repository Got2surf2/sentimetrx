// lib/export/scoreComments.ts
// AI scoring/phrase-extraction helpers for export quote selection.
//
// All call sites pass orgId (not an apiKey) — the org-level AI gate runs
// inside callAI() based on usage.org_id. orgId=undefined means "skip AI,
// fall back to length-based selection" (used when the export was started
// with skipAI=true).

import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export interface ThemeInfo {
  name: string
  description?: string
  keywords: string[]
  sentiment?: string
}

export interface ScoredComment {
  text: string
  score: number
}

export interface HighlightedComment {
  text: string
  phrases: string[]
}

/**
 * Score each comment for how well it represents the theme.
 * Uses Claude Haiku for speed. Returns scores 1-5 (5 = perfect, 1 = irrelevant).
 * Processes up to 30 candidates in a single API call for efficiency.
 * If API fails, returns all candidates with score=3 (neutral) so the caller
 * can fall back to length-based selection.
 */
export async function scoreCommentsForTheme(
  candidates: string[],
  theme: ThemeInfo,
  orgId: string,
  maxCandidates = 30,
): Promise<ScoredComment[]> {
  // Trim to max candidates (take evenly spaced sample if too many)
  let pool = candidates
  if (pool.length > maxCandidates) {
    const step = pool.length / maxCandidates
    pool = Array.from({ length: maxCandidates }, (_, i) => candidates[Math.floor(i * step)])
  }

  const numbered = pool.map((c, i) => `[${i + 1}] ${c.slice(0, 400)}`).join('\n\n')

  const prompt = `You are evaluating survey verbatim comments for a presentation slide about a specific theme.

THEME: "${theme.name}"
${theme.description ? `DESCRIPTION: ${theme.description}` : ''}
KEYWORDS: ${theme.keywords.join(', ')}
${theme.sentiment ? `SENTIMENT: ${theme.sentiment}` : ''}

Score each comment below from 1 to 5 for how well it represents this theme:

5 = Perfect example — clearly about this theme, substantive, quotable for a board presentation
4 = Good fit — relevant to the theme with useful detail
3 = Marginal — mentions the topic but is vague, tangential, or could fit multiple themes equally
2 = Poor fit — keyword match is incidental (e.g. "can't wait to come back" for a "wait time" theme)
1 = Irrelevant — does not actually relate to this theme despite containing a keyword

Be strict. A comment that merely contains a keyword but discusses something else should score 1-2.
A comment must genuinely discuss the theme's subject matter to score 4-5.

COMMENTS:
${numbered}

Return ONLY a JSON array of scores in order, one per comment. Example for 3 comments: [5, 2, 4]
No explanation, no markdown, just the array.`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 200,
      timeoutMs: 8000,
      messages: [{ role: 'user', content: prompt }],
      usage: { org_id: orgId, resource_type: 'dataset', event_type: 'score_comments' },
    })

    logUsage({ org_id: orgId, resource_type: 'dataset', event_type: 'score_comments' }, result.usage)

    const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    const scores: number[] = JSON.parse(clean)

    if (!Array.isArray(scores) || scores.length !== pool.length) {
      throw new Error('Score count mismatch')
    }

    return pool.map((text, i) => ({ text, score: scores[i] || 3 }))
  } catch (err) {
    // Fallback: all neutral so caller falls back to length-based selection
    return pool.map(text => ({ text, score: 3 }))
  }
}

/**
 * Pick the best `count` comments for this theme.
 * Uses AI scoring when orgId is provided, otherwise falls back to length-based.
 */
export async function pickBestComments(
  candidates: string[],
  theme: ThemeInfo,
  count = 5,
  orgId?: string,
  usedComments?: Set<string>,
  maxLen = 350,
): Promise<string[]> {
  if (!candidates.length) return []

  // Filter out already-used comments
  const fresh = usedComments
    ? candidates.filter(s => !usedComments.has(s.slice(0, 120)))
    : candidates
  const pool = fresh.length >= 3 ? fresh : candidates

  let picked: string[]

  if (orgId && pool.length > 0) {
    try {
      // AI-scored selection
      const scored = await scoreCommentsForTheme(pool, theme, orgId)
      // Only keep comments scoring 4+ (good fit or better)
      // If not enough 4+ scores, take the best available down to score 3
      const good = scored.filter(s => s.score >= 4)
      const acceptable = good.length >= count ? good : scored.filter(s => s.score >= 3)
      const source = acceptable.length >= count ? acceptable : scored

      picked = source.slice(0, count).map(s => s.text)
    } catch {
      // AI disabled (mode='off') or transient error: fall through to length-based.
      const sorted = [...pool].sort((a, b) => b.length - a.length)
      picked = sorted.slice(0, Math.min(sorted.length, count))
    }
  } else {
    // Fallback: length-based (original behavior)
    const sorted = [...pool].sort((a, b) => b.length - a.length)
    const top = sorted.slice(0, Math.min(sorted.length, 40))
    picked = top.slice(0, count)
  }

  // Trim long comments
  return picked.map(text => {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…'
  })
}

/**
 * For each comment, extract the conceptual phrase(s) — the meaningful clauses
 * that relate to the theme — not just keyword words but the full meaningful phrase.
 *
 * Example: theme "Wait Time", comment "The food was great but we had to wait over 30 minutes"
 * → phrase: "had to wait over 30 minutes"
 *
 * Falls back to keyword list if AI unavailable.
 */
export async function extractHighlightPhrases(
  comments: string[],
  theme: ThemeInfo,
  orgId?: string,
): Promise<HighlightedComment[]> {
  if (!comments.length) return []
  if (!orgId) {
    // Fallback: return keywords as phrases
    return comments.map(text => ({ text, phrases: theme.keywords }))
  }

  const numbered = comments.map((c, i) => `[${i + 1}] ${c}`).join('\n\n')

  const prompt = `For each comment below, extract the specific phrase(s) that relate to the theme "${theme.name}".

THEME: "${theme.name}"
${theme.description ? `DESCRIPTION: ${theme.description}` : ''}

Extract the CONCEPTUAL PHRASE — not just the keyword word, but the full meaningful clause.
For example:
- Theme "Wait Time", text "food was great but we waited over 30 minutes for a table" → "waited over 30 minutes for a table"
- Theme "Staff", text "our server Jessica was incredibly attentive and friendly" → "server Jessica was incredibly attentive and friendly"
- Theme "Food Quality", text "the steak was overcooked and dry but the salad was fresh" → "steak was overcooked and dry", "salad was fresh"

Rules:
- Extract 1-3 phrases per comment (only the parts relevant to this theme)
- Each phrase should be a verbatim substring from the comment text (exact match, not paraphrased)
- Keep phrases concise — a clause, not the whole sentence
- If no clear phrase relates to the theme, return an empty array for that comment

COMMENTS:
${numbered}

Return a JSON array of arrays: [["phrase1", "phrase2"], ["phrase1"], ...]
One inner array per comment, in order. No markdown, no explanation, just the JSON.`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 800,
      timeoutMs: 10000,
      messages: [{ role: 'user', content: prompt }],
      usage: { org_id: orgId, resource_type: 'dataset', event_type: 'score_comments' },
    })

    logUsage({ org_id: orgId, resource_type: 'dataset', event_type: 'score_comments' }, result.usage)

    const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    const parsed: string[][] = JSON.parse(clean)

    if (!Array.isArray(parsed) || parsed.length !== comments.length) {
      throw new Error('Phrase count mismatch')
    }

    return comments.map((text, i) => ({
      text,
      phrases: (parsed[i] || []).filter(p => typeof p === 'string' && p.length > 2),
    }))
  } catch {
    // AI disabled or failed: fall back to keywords as phrases
    return comments.map(text => ({ text, phrases: theme.keywords }))
  }
}
