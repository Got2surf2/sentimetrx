// lib/taxonomyExtractor.ts
//
// Ruth's Chris taxonomy pilot — LLM classifier that produces a per-row
// 7-axis ABSA assertion set from a free-text review.
//
// Pure prompt building + parsing + validation lives here (importable from
// both Server Components and standalone scripts). The high-level wrapper
// `classifyReview()` calls into lib/ai.ts which is server-only — that path
// is dynamically imported so scripts that only need the prompt helpers
// don't pay the server-only cost.

import {
  AXES,
  AXIS_VOCAB,
  POLARITY_VALUES,
  SEVERITY_VALUES,
  PRODUCT_ITEMS,
  isValidAxisSub,
  isAlertSeverity,
  type Assertion,
  type Axis,
  type Polarity,
  type Severity,
} from './taxonomyVocabulary'

// Local copy of the AIUsageContext shape so scripts (not in Next.js context)
// can call helpers without dragging in 'server-only' transitively.
export interface TaxonomyUsageContext {
  org_id?: string
  resource_type: 'bot' | 'townhall' | 'social' | 'dataset' | 'study' | 'system'
  resource_id?: string
  event_type: string
}

export const PROMPT_VERSION = '2026-05-27.v4'

export interface ExtractorInput {
  review_text: string
  review_rating?: number | null
  legacy_tags?: string[]
}

export interface ExtractorResult {
  assertions: Assertion[]
  axis_touchpoint: string[]
  axis_attribute: string[]
  axis_product: string[]
  axis_beverage: string[]
  axis_ambiance: string[]
  axis_context: string[]
  axis_outcome: string[]
  alert_tags: string[]
  unmapped_subs: { axis: string; sub: string }[]
  model_used: string
  prompt_version: string
}

// ── Prompt ───────────────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const v = AXIS_VOCAB
  const items = PRODUCT_ITEMS.join(', ')
  return `You are a CX-tagging classifier for Ruth's Chris Steak House Google reviews.

Your job is to read one review and emit a JSON object with structured assertions following a 7-axis ABSA taxonomy. You must follow these rules exactly:

AXES (you must use these axis names verbatim):
- touchpoint: who served the customer
- attribute:  how they did
- product:    what was ordered (food)
- beverage:   what was drunk
- ambiance:   how the room was
- context:    when / where (daypart, holiday, channel, etc.)
- outcome:    will they come back / value perception / improvement asks

CLOSED VOCABULARY — sub-bucket values you may emit on each axis:
- touchpoint: ${v.touchpoint.join(', ')}
- attribute:  ${v.attribute.join(', ')}
- product:    ${v.product.join(', ')}
- beverage:   ${v.beverage.join(', ')}
- ambiance:   ${v.ambiance.join(', ')}
- context:    ${v.context.join(', ')}
- outcome:    ${v.outcome.join(', ')}

PRODUCT ITEMS — when the review names a specific steak / dish, set the optional "item" field to one of:
${items}

POLARITY: one of pos | neg | neu (neutral / descriptive only).

SEVERITY: cross-cutting flag on any assertion:
- normal (default for ordinary praise or complaint)
- alert  (sharp customer dissatisfaction: rudeness, pests, very long wait, dirty room)
- crisis (only for: food poisoning, allergic reaction, foreign objects in food, injury, public-health-grade food safety failure)

CRITICAL RULES:
1. Emit only sub-bucket values from the closed lists above. Do NOT invent new sub-buckets.
2. Capture mixed polarity: if the food tasted great but the service was slow, emit BOTH attribute:flavor (pos) AND attribute:speed (neg). "The food was good" → attribute:flavor (pos); only add product:<sub> when the review names a specific dish.
2a. STRICT RULE on the product axis: DO NOT emit product:<sub> unless the review TEXTUALLY names that food category or a specific dish in it.
    - "The food was great" → NO product tag (just attribute:flavor pos). The word "food" alone is not a product.
    - "Meal was bad" / "dinner was disappointing" → NO product tag.
    - DO NOT use the fact that this is a steakhouse to infer product:steak. If the customer didn't write "steak" / "ribeye" / "filet" / "prime rib" / etc., do NOT emit product:steak. This is a hallucination from background knowledge — forbidden.
    - "I ordered the steak" → product:steak. "Best ribeye I've had" → product:steak (item:ribeye).
    - "The lobster bisque was terrible" → product:soup (lobster bisque is a soup).
    - When in doubt, emit attribute:flavor on its own — that captures food sentiment without claiming what was ordered.
3. Touchpoint pairing rules:
   - "Seated late" / "wait for table" / "hostess" / "no one greeted us" → touchpoint:host  +  attribute:speed (neg).
   - "Slow to bring drinks" / "had to flag down" / "server forgot" → touchpoint:server + attribute:speed or attribute:attentive (neg).
   - "Manager didn't help" / "asked for manager" → touchpoint:manager.
4. Do not escalate severity unless the text clearly supports it. "Dirty carpets" or "smelled bad" is ambiance:clean (neg, normal) — NOT food safety. Pests (gnats, flies, roaches) IS attribute:pests (neg, alert).
5. Food poisoning, allergic reactions, or foreign objects = attribute:food safety (neg, crisis).
6. If a review explicitly says they will/won't return → outcome:return (pos) or outcome:not-recommend (neg).
7. If a review explicitly compares to a competitor (Olive Garden, Capital Grille, Longhorn, etc.), do NOT emit any tags for the competitor's food — only emit Ruth's Chris assertions. The competitor mention itself is metadata, not an assertion.
8. Each assertion needs a confidence score 0–1. Use 0.9+ for explicit text, 0.6–0.8 for clear inference, 0.4–0.55 only when guessing from weak signals.
9. Return strictly valid JSON. No commentary, no Markdown fences.
10. EVIDENCE is REQUIRED on every assertion. Quote the SHORTEST verbatim phrase from the review (≤ 12 words) that supports the assertion. Copy the words exactly — do NOT paraphrase, summarize, or generate text that isn't in the review. If you can't find a direct phrase, drop the assertion entirely. If two assertions share evidence (e.g. "great steak" → product:steak + attribute:flavor), repeat the same evidence on both.

OUTPUT SHAPE:
{
  "assertions": [
    { "axis": "<one of 7>", "sub": "<closed-vocab sub>", "item": "<optional product item>", "polarity": "pos|neg|neu", "confidence": 0.0-1.0, "severity": "normal|alert|crisis", "evidence": "<short verbatim quote>" }
  ]
}

Return an empty assertions array if the review carries no extractable signal.`
}

export function buildUserMessage(input: ExtractorInput): string {
  const parts: string[] = []
  if (input.review_rating !== undefined && input.review_rating !== null) {
    parts.push(`Rating: ${input.review_rating}/5`)
  }
  parts.push(`Review:\n"""\n${input.review_text}\n"""`)
  if (input.legacy_tags && input.legacy_tags.length > 0) {
    parts.push(`Legacy tags (for reference only — do not blindly copy; classify from the text):\n${input.legacy_tags.join(', ')}`)
  }
  return parts.join('\n\n')
}

// ── Parsing & validation ─────────────────────────────────────────────────────

export function tryParseJSON(text: string): any {
  const trimmed = text.trim()
  // Strip Markdown fence if model emits one despite instructions.
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const payload = m ? m[1] : trimmed
  return JSON.parse(payload)
}

function isAxis(s: unknown): s is Axis {
  return typeof s === 'string' && (AXES as readonly string[]).includes(s)
}

function isPolarity(s: unknown): s is Polarity {
  return typeof s === 'string' && (POLARITY_VALUES as readonly string[]).includes(s)
}

function isSeverity(s: unknown): s is Severity {
  return typeof s === 'string' && (SEVERITY_VALUES as readonly string[]).includes(s)
}

/**
 * Validate an LLM-emitted assertion, dropping anything outside the closed
 * vocabulary. Returns the cleaned assertion or null if it should be discarded.
 * Out-of-vocab subs are accumulated separately for triage.
 */
export function validateAssertion(
  a: any,
  unmapped: { axis: string; sub: string }[],
): Assertion | null {
  if (!a || typeof a !== 'object') return null
  if (!isAxis(a.axis)) return null
  if (typeof a.sub !== 'string' || !a.sub.trim()) return null
  const sub = a.sub.trim().toLowerCase()

  if (!isValidAxisSub(a.axis, sub)) {
    unmapped.push({ axis: a.axis, sub })
    return null
  }

  const polarity: Polarity = isPolarity(a.polarity) ? a.polarity : 'neu'
  const severity: Severity = isSeverity(a.severity) ? a.severity : 'normal'
  const confidence = typeof a.confidence === 'number'
    ? Math.max(0, Math.min(1, a.confidence))
    : 0.7

  const out: Assertion = {
    axis: a.axis,
    sub,
    polarity,
    confidence,
    severity,
    source: 'llm',
  }
  if (typeof a.item === 'string' && a.item.trim()) {
    const item = a.item.trim().toLowerCase()
    if ((PRODUCT_ITEMS as readonly string[]).includes(item)) out.item = item
  }
  if (typeof a.evidence === 'string' && a.evidence.trim()) {
    out.evidence = a.evidence.trim()
  }
  return out
}

export function projectAxes(assertions: Assertion[]) {
  const byAxis: Record<Axis, Set<string>> = {
    touchpoint: new Set(),
    attribute:  new Set(),
    product:    new Set(),
    beverage:   new Set(),
    ambiance:   new Set(),
    context:    new Set(),
    outcome:    new Set(),
    emotion:    new Set(),  // keyword-tier only; never emitted here (axis ∉ AXES)
  }
  const alertSubs = new Set<string>()
  for (const a of assertions) {
    byAxis[a.axis].add(a.sub)
    if (isAlertSeverity(a.severity)) alertSubs.add(a.sub)
  }
  return {
    axis_touchpoint: Array.from(byAxis.touchpoint).sort(),
    axis_attribute:  Array.from(byAxis.attribute).sort(),
    axis_product:    Array.from(byAxis.product).sort(),
    axis_beverage:   Array.from(byAxis.beverage).sort(),
    axis_ambiance:   Array.from(byAxis.ambiance).sort(),
    axis_context:    Array.from(byAxis.context).sort(),
    axis_outcome:    Array.from(byAxis.outcome).sort(),
    alert_tags:      Array.from(alertSubs).sort(),
  }
}

// ── Pure parser (no AI call) — scripts can call their own provider then this ─

export function parseExtractorOutput(rawText: string, modelUsed: string): ExtractorResult {
  let parsed: any
  try {
    parsed = tryParseJSON(rawText)
  } catch {
    parsed = { assertions: [] }
  }

  const unmapped: { axis: string; sub: string }[] = []
  const rawList: any[] = Array.isArray(parsed?.assertions) ? parsed.assertions : []
  const validated: Assertion[] = []
  for (const a of rawList) {
    const v = validateAssertion(a, unmapped)
    if (v) validated.push(v)
  }
  const projected = projectAxes(validated)

  return {
    assertions: validated,
    ...projected,
    unmapped_subs: unmapped,
    model_used: modelUsed,
    prompt_version: PROMPT_VERSION,
  }
}

// ── Public entry point (server-side, uses callAI from lib/ai.ts) ────────────

export interface ClassifyOptions {
  tier?: 'fast' | 'standard'
  usage?: TaxonomyUsageContext
  /** Override max tokens — defaults to 2000 (evidence quotes ~double output size). */
  maxTokens?: number
}

export async function classifyReview(
  input: ExtractorInput,
  opts: ClassifyOptions = {},
): Promise<ExtractorResult> {
  const tier = opts.tier ?? 'fast'
  const system = buildSystemPrompt()
  const userMsg = buildUserMessage(input)

  // Dynamic import so the static module graph doesn't pull lib/ai.ts (which
  // has 'server-only') into script callers that only use parseExtractorOutput.
  const { callAI } = await import('./ai')
  const ai = await callAI({
    tier,
    system,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: opts.maxTokens ?? 2000,
    timeoutMs: 30000,
    usage: opts.usage,
  })

  return parseExtractorOutput(ai.text, ai.usage?.model ?? 'unknown')
}
