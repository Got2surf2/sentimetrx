// lib/export/scoreComments.ts
// AI-powered comment relevance scoring for export slides.
// Given a theme and candidate comments, scores each comment 1-5 for relevance,
// then returns the best ones. Falls back to keyword-only if AI is unavailable.

import { callAI } from '@/lib/ai'

export interface ScoredComment {
  text: string
  score: number   // 1-5 relevance to theme
}

export interface ThemeInfo {
  name: string
  description?: string
  keywords: string[]
  sentiment?: string
}

/**
 * Score a batch of candidate comments for relevance to a theme using Claude.
 * Returns scored comments sorted by relevance (highest first).
 *
 * Processes up to 30 candidates in a single API call for efficiency.
 * If API fails, returns all candidates with score=3 (neutral) so the caller
 * can fall back to length-based selection.
 */
export async function scoreCommentsForTheme(
  candidates: string[],
  theme: ThemeInfo,
  apiKey: string,
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
      apiKey,
    })

    const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()

    const scores: number[] = JSON.parse(clean)

    if (!Array.isArray(scores) || scores.length !== pool.length) {
      throw new Error('Score count mismatch')
    }

    return pool
      .map((text, i) => ({ text, score: Math.max(1, Math.min(5, Math.round(scores[i]))) }))
      .sort((a, b) => b.score - a.score)

  } catch {
    // AI unavailable — return all with neutral score, caller falls back to length sort
    return pool.map(text => ({ text, score: 3 }))
  }
}

/**
 * Pick the best N comments for a theme from a candidate pool.
 * Uses AI scoring if apiKey is provided, otherwise falls back to length-based.
 *
 * @param candidates - regex-matched comments (already filtered by keyword)
 * @param theme - theme info for scoring context
 * @param count - how many to pick (default 5)
 * @param apiKey - Anthropic API key (if absent, skip AI scoring)
 * @param usedComments - set of already-used comments to skip (dedup)
 * @param maxLen - max length to trim comments to
 */
export async function pickBestComments(
  candidates: string[],
  theme: ThemeInfo,
  count = 5,
  apiKey?: string,
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

  if (apiKey && pool.length > 0) {
    // AI-scored selection
    const scored = await scoreCommentsForTheme(pool, theme, apiKey)
    // Only keep comments scoring 4+ (good fit or better)
    // If not enough 4+ scores, take the best available down to score 3
    const good = scored.filter(s => s.score >= 4)
    const acceptable = good.length >= count ? good : scored.filter(s => s.score >= 3)
    const source = acceptable.length >= count ? acceptable : scored

    picked = source.slice(0, count).map(s => s.text)
  } else {
    // Fallback: length-based (original behavior)
    const sorted = [...pool].sort((a, b) => b.length - a.length)
    const top = sorted.slice(0, Math.min(sorted.length, 40))
    const n = Math.min(count, top.length)
    const step = top.length / n
    picked = Array.from({ length: n }, (_, i) => top[Math.floor(i * step)])
  }

  // Trim and register as used
  const trimmed = picked.map(s => trimToSentence(s, maxLen))
  if (usedComments) trimmed.forEach(s => usedComments.add(s.slice(0, 120)))
  return trimmed
}

/** Trim text to maxLen, cutting at the last sentence boundary if possible */
function trimToSentence(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSent = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastSent > max * 0.5) return cut.slice(0, lastSent + 1)
  const lastWord = cut.lastIndexOf(' ')
  return (lastWord > max * 0.5 ? cut.slice(0, lastWord) : cut) + '…'
}

// ── AI Phrase Extraction for Export Highlighting ──────────────────────────────

export interface HighlightedComment {
  text: string
  phrases: string[]  // conceptual phrases to highlight (bold teal in PPTX)
}

/**
 * Given selected comments and a theme, uses AI to extract the conceptual phrases
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
  apiKey?: string,
): Promise<HighlightedComment[]> {
  if (!comments.length) return []
  if (!apiKey) {
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
      apiKey,
    })

    const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    const parsed: string[][] = JSON.parse(clean)

    if (!Array.isArray(parsed) || parsed.length !== comments.length) {
      throw new Error('Phrase count mismatch')
    }

    return comments.map((text, i) => ({
      text,
      phrases: Array.isArray(parsed[i]) ? parsed[i].filter((p: any) => typeof p === 'string' && p.length > 0) : theme.keywords,
    }))
  } catch {
    // Fallback to keywords
    return comments.map(text => ({ text, phrases: theme.keywords }))
  }
}
