// lib/reoExtractor.ts
//
// LLM classifier for the lean REO (Domain > Aspect + Sentiment). Used first to
// DRAFT gold-set candidates for human spot-check; the same prompt becomes the
// production classifier once REO ships. Rules encode what the owner's gold-set
// review converged on (2026-06-08): closed vocab, sentiment calibration
// (neutral mention != Positive), Menu = the offering not a dish, evidence-required.

import {
  REO_DOMAINS, REO_ASPECTS, REO_SENTIMENTS, REO_SEVERITIES,
  isValidDomainAspect, type ReoObservation,
} from './reoVocabulary'

export const REO_PROMPT_VERSION = '2026-06-08.lean.v1'

export function buildReoSystemPrompt(): string {
  const vocab = REO_DOMAINS.map(d => `  - ${d}: ${REO_ASPECTS[d].join(', ')}`).join('\n')
  return `You are an aspect-based sentiment classifier for restaurant reviews using the Restaurant Experience Ontology (REO).

Extract EVERY distinct observation in the review — one review yields multiple observations (multi-label). For each emit: domain, aspect, sentiment, evidence, severity.

CLOSED VOCABULARY (domain: allowed aspects — never invent a value outside this):
${vocab}

sentiment: Positive | Negative | Neutral
severity: none | alert | crisis   (crisis = food poisoning / allergic reaction / foreign object in food / injury / discrimination; alert = sharp serious dissatisfaction; else none)
evidence: the SHORTEST verbatim phrase from the review (<=12 words) that supports the observation. If no verbatim phrase exists, DROP the observation.

RULES:
1. Closed vocab only — drop anything that doesn't map to a domain>aspect above.
2. SENTIMENT CALIBRATION (important): a neutral MENTION is NOT Positive. "a Cabernet to pair", "had the filet", "came for a birthday" → Neutral. Reserve Positive for genuine praise ("cooked perfectly", "amazing service"); Negative for genuine complaint. Hedged praise ("good except…", "not top notch", "pretty good but") → Neutral or Negative, never Positive.
3. Menu = the menu OFFERING / variety / options (dietary options, seasonal menu, "few choices", "no non-alcoholic drinks") — NOT a specific dish's execution. A dish's flavor → Taste; its freshness/cut/quality → Quality; its cooking/doneness/temperature → Preparation.
4. Cooking execution (overcooked, cold, raw, doneness, reheated) → FoodBeverage>Preparation. Wrong item delivered / request not honored → Service>Accuracy.
5. "won't be back" / "we'll return" → CustomerRelationship>Loyalty. "recommend" / "never recommend" → Brand>Reputation. "not the same anymore" / "worst location" → Brand>Consistency.
6. One observation per DISTINCT dish praised or panned — don't collapse two different dishes into a single label.
7. How a complaint was handled (comped, replaced, manager argued) → Service>Recovery.

Return STRICT JSON only, no prose:
{"observations":[{"domain":"...","aspect":"...","sentiment":"...","evidence":"...","severity":"..."}]}`
}

export function buildReoUserMessage(text: string, rating?: number | null): string {
  return (rating != null ? `Rating: ${rating}/5\n` : '') + `Review: "${text}"`
}

export function parseReoOutput(raw: string): ReoObservation[] {
  let s = (raw || '').trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const a = s.indexOf('{'), b = s.lastIndexOf('}')
  if (a >= 0 && b > a) s = s.slice(a, b + 1)
  let parsed: any
  try { parsed = JSON.parse(s) } catch { return [] }
  const list = Array.isArray(parsed?.observations) ? parsed.observations : []
  const out: ReoObservation[] = []
  for (const o of list) {
    if (!o || !isValidDomainAspect(o.domain, o.aspect)) continue
    const sentiment = (REO_SENTIMENTS as readonly string[]).includes(o.sentiment) ? o.sentiment : 'Neutral'
    const severity = (REO_SEVERITIES as readonly string[]).includes(o.severity) ? o.severity : 'none'
    out.push({
      domain: o.domain, aspect: o.aspect, sentiment,
      evidence: typeof o.evidence === 'string' && o.evidence.trim() ? o.evidence.trim().slice(0, 160) : undefined,
      severity,
    })
  }
  return out
}

export async function classifyReviewReo(text: string, rating?: number | null): Promise<ReoObservation[]> {
  // dynamic import so script callers don't pull lib/ai.ts ('server-only') into the static graph
  const { callAI } = await import('./ai')
  const ai = await callAI({
    tier: 'fast',                                            // Haiku 4.5
    usage: { resource_type: 'dataset', event_type: 'reo_classify' },
    system: [{ type: 'text', text: buildReoSystemPrompt(), cache: true }],
    messages: [{ role: 'user', content: buildReoUserMessage(text, rating) }],
    maxTokens: 1200,
    timeoutMs: 30000,
  })
  return parseReoOutput(ai.text)
}
