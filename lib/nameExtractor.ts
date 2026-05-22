// lib/nameExtractor.ts
//
// Post-response AI extractor for a participant's first name. Called
// fire-and-forget from lib/chatCore.ts when no name has been captured
// yet for the session, on user_turn_count == 2 (retry once at 5).
// Closes the "Anonymous in 88% of admin views" gap.
//
// Why AI and not regex: the existing regex heuristics in
// /api/bots/[id]/conversations only catch three narrow patterns:
//   - "My name is X" (formal self-id)
//   - First user message is ≤3 capitalized words (just typed name)
//   - "Hi/Hey/Hello/Welcome <Name>" in bot's greeting reply
// These cover ~12% of sessions. The fast-tier AI catches the long
// tail: "I'm John", "I am Sarah", "Mike here", " — Dave" sign-off,
// indirect references ("my husband Jim and I"), spelling variants,
// and names mid-sentence ("So I told Maria yesterday...").

import { callAI } from './ai'

export interface NameExtractResult {
  name: string | null
  /** Source of the extraction — directly stated ('self_id') vs inferred from context. */
  source: 'self_id' | 'inferred' | null
  /** Classifier confidence. Low confidence values should still be stored
   *  but flagged in the UI so reviewers can override. */
  confidence: 'high' | 'medium' | 'low' | null
}

const EMPTY: NameExtractResult = { name: null, source: null, confidence: null }

export async function extractName(userMessages: string[]): Promise<NameExtractResult> {
  if (!userMessages || userMessages.length === 0) return EMPTY
  // Need at least one substantive turn to extract from.
  const corpus = userMessages.filter(m => (m || '').trim().length >= 3).join('\n---\n')
  if (corpus.length < 10) return EMPTY

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 80,
      timeoutMs: 5000,
      messages: [{ role: 'user', content: 'User messages from a conversation:\n"""\n' + corpus.slice(0, 2000) + '\n"""' }],
      system:
        'Extract the speaker\'s first name from these user messages if present. ' +
        'A first name might appear via self-identification ("I\'m John", "my name is Sarah", "Mike here"), ' +
        'a sign-off (" - Dave"), or be inferred from context where the speaker is clearly referring to themselves. ' +
        'Do NOT extract names of OTHER people the speaker mentions (spouses, children, friends, public figures). ' +
        'If you cannot reliably identify the speaker\'s own first name, return null.\n\n' +
        'Return ONLY a single-line JSON object — no prose, no markdown fences:\n' +
        '{"name": "Sarah" | null, "source": "self_id" | "inferred" | null, "confidence": "high" | "medium" | "low" | null}\n\n' +
        'Rules:\n' +
        '- name: just the first name, capitalized. Strip titles ("Dr.", "Mr.") and surnames.\n' +
        '- source: "self_id" when explicitly stated ("I\'m X", "name\'s X"); "inferred" when contextually clear; null when no name.\n' +
        '- confidence: high for clear self-id, medium for sign-offs or indirect, low for ambiguous.\n' +
        '- If unsure or none found: {"name": null, "source": null, "confidence": null}',
    })

    const text = (result.text || '').trim()
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return EMPTY

    let parsed: any
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return EMPTY }

    // Defense-in-depth: validate the extracted name. Single word,
    // capitalized, alpha-only, ≤30 chars. Drops "Anonymous" / "User" /
    // pronoun-leakage / accidental full sentence.
    const raw = typeof parsed?.name === 'string' ? parsed.name.trim() : null
    if (!raw) return EMPTY
    if (raw.length > 30) return EMPTY
    if (!/^[A-Z][a-z'-]{1,29}$/.test(raw)) return EMPTY
    const bad = new Set(['Anonymous', 'User', 'Me', 'I', 'Sir', 'Madam', 'Mister', 'Mrs', 'Mr'])
    if (bad.has(raw)) return EMPTY

    const source = parsed?.source === 'self_id' || parsed?.source === 'inferred' ? parsed.source : null
    const confidence = parsed?.confidence === 'high' || parsed?.confidence === 'medium' || parsed?.confidence === 'low' ? parsed.confidence : null

    return { name: raw, source, confidence }
  } catch {
    return EMPTY
  }
}
