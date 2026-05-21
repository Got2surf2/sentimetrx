// lib/uiHints.ts
//
// Shared type definitions + extractor for the canvas/ui_hints system used by
// /demo/mco. The agent's chat response is paired with zero or one hint that
// drives the right-pane card on the canvas shell.
//
// Two design choices worth flagging:
// (1) The extractor is decoupled from the chat route (it lives in its own
//     sibling endpoint, /api/bots/[id]/ui-hints). See docs/MCO_AGENT.md § 15.
//     Three reasons: zero conflict with Phase 4 convergence, chat latency
//     unchanged, optional fold-in later.
// (2) The AI classifier is dependency-injected (same pattern as
//     lib/languageSwitch.ts) so unit tests can mock it without touching
//     callAI() / the real LLM provider.

// ── Types ───────────────────────────────────────────────────────────────────

export type UiHint =
  | TerminalMapHint
  | ParkingHint
  | RestaurantsHint
  | LinkCardHint

export interface TerminalMapHint {
  type: 'terminal_map'
  terminal?: 'A' | 'B' | 'C'
  gate?: string
  from?: 'A' | 'B' | 'C'
  to?: 'A' | 'B' | 'C'
  via?: 'shuttle' | 'terminal_link_apm'
}

export interface ParkingHint {
  type: 'parking'
  highlight?: string[]    // garage_a, garage_b, garage_c, atlantis, …
}

export interface RestaurantsHint {
  type: 'restaurants'
  place_ids: string[]
  context?: string        // e.g. "terminal_a_airside"
}

export interface LinkCardHint {
  type: 'link_card'
  title: string
  body: string
  image_url?: string
  cta_url: string
  cta_label: string
}

// Deployment context — auto-detected by the page (URL param, geolocation,
// user agent, deployment env), demo-strip-overridable in the prototype.
export type DeploymentMode = 'home' | 'invenue' | 'kiosk'

export interface DeploymentContext {
  mode: DeploymentMode
  location?: {
    label: string                // "Terminal B (from QR scan)"
    source: 'qr' | 'geo' | 'manual'
  }
}

// ── Extractor ───────────────────────────────────────────────────────────────

// The classifier signature the route wires up to lib/ai.callAI. Tests inject
// a stub. Returns the raw JSON string emitted by the model.
export type UiHintClassifier = (system: string, userMessage: string) => Promise<string>

export interface ExtractInput {
  userMessage: string
  assistantMessage: string
  classifier: UiHintClassifier
}

export const UI_HINT_EXTRACTOR_PROMPT = `You are a UI hint + follow-up chip extractor for an airport concierge agent. Given a user turn and the assistant's response, decide:
  (a) whether the turn fits one of the canvas cards below, and
  (b) what 2-4 short follow-up questions would naturally extend the conversation.

Allowed hint types and required payload shapes:

- terminal_map: { "type": "terminal_map", "terminal"?: "A"|"B"|"C", "gate"?: string, "from"?: "A"|"B"|"C", "to"?: "A"|"B"|"C", "via"?: "shuttle"|"terminal_link_apm" }
  Use when the user is asking about a gate, terminal, or terminal-to-terminal route — OR the assistant gives wayfinding involving one.

- parking: { "type": "parking", "highlight"?: string[] }
  Use when the user is asking about parking, garages, lots, or cell-phone areas — OR the assistant recommends one. Highlight names come from: garage_a, garage_b, garage_c, terminal_top, atlantis, discovery, endeavour, north_economy, south_economy, west_economy, north_cell, south_cell, valet.

- restaurants: { "type": "restaurants", "place_ids": [], "context"?: string }
  Use whenever the user is asking about food, dining, restaurants, where to eat, snacks, coffee, drinks, or shopping — EVEN IF the assistant's response is vague or punts to a website. Also fire when the assistant mentions named eateries. The card itself resolves the list; the extractor just signals intent. Set "context" to a coarse location label like "terminal_a_airside", "terminal_b_airside", "terminal_c_airside", "landside_main_terminal". Leave place_ids as [] — the renderer resolves them.

- link_card: { "type": "link_card", "title": string, "body": string, "cta_url": string, "cta_label": string }
  Use ONLY when the assistant references one specific MCO program with its own dedicated page from this exact list:
    - MCO Reserve → cta_url "https://flymco.com/speed-through-mco"
    - Experience MCO Visitor Pass → cta_url "https://flymco.com/experience-mco-visitor-pass-program"
    - Accessibility programs (Sunflower Lanyard, Annie's Space) → cta_url "https://flymco.com/accessibility"
    - MCO App → cta_url "https://flymco.com/mco-app"
    - Customs electronic submission → cta_url "https://flymco.com/customs"
    - MCO Wi-Fi → cta_url "https://flymco.com/wifi"
  Body should be 2-3 short sentences summarizing the assistant's answer in the agent's voice.
  Do NOT use link_card for dining, parking, or wayfinding — those have their own cards above.

Follow-up chips (next_chips):
  2-4 short user-voiced follow-up questions that naturally extend this exact turn. Each chip:
   - is phrased the way the user would ask it (first-person OK), not the assistant's voice
   - is short (≤ 50 chars, like a quick reply pill)
   - reflects the specific content of the assistant's last answer, not generic openers
   - if the assistant named entities (restaurants, gates, garages), reference them by name when it fits
   - DO NOT repeat the user's just-asked question
  If you genuinely cannot think of relevant follow-ups, return [].

Return a JSON object: { "hint": <hint object or null>, "next_chips": string[] }

Examples:
- User: "How do I get from C to A?" → Assistant: "Two options: Terminal Link APM in 6 min or the shuttle bus in 12..." → { "hint": { "type": "terminal_map", "from": "C", "to": "A", "via": "terminal_link_apm" }, "next_chips": ["How often does the APM run?", "Where do I catch the shuttle?", "Which is faster with luggage?"] }
- User: "Where can I eat near gate A14?" → Assistant lists Chick-fil-A, Shake Shack → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_a_airside" }, "next_chips": ["Anything sit-down?", "What's open late?", "Vegetarian options?"] }
- User: "Where's the closest parking to Terminal C?" → Assistant recommends Garage C → { "hint": { "type": "parking", "highlight": ["garage_c"] }, "next_chips": ["What does Garage C cost?", "Is valet available?", "Cheaper long-term option?"] }
- User: "What about restaurants?" → Assistant: "MCO has many dining options across all terminals" → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_a_airside" }, "next_chips": ["Show me near Terminal B", "Anything kid-friendly?", "Best rated?"] }

Output JSON only. No prose, no markdown fences.`

// Used as the classifier input — pairs user + assistant turn into one block
// the model can reason about. Kept short to minimize tokens (this runs after
// every assistant turn).
export function buildExtractorInput(userMessage: string, assistantMessage: string): string {
  return `USER: ${userMessage.slice(0, 600)}\n\nASSISTANT: ${assistantMessage.slice(0, 1500)}`
}

// Validates a raw hint object against the discriminated-union shapes.
// Returns null on any structural problem — it's safer to drop a malformed
// hint than to ship it through to a card that'll crash on missing fields.
export function validateHint(raw: any): UiHint | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw.type
  if (t === 'terminal_map') {
    const allowed = ['A', 'B', 'C']
    const h: TerminalMapHint = { type: 'terminal_map' }
    if (raw.terminal && allowed.includes(raw.terminal)) h.terminal = raw.terminal
    if (raw.from && allowed.includes(raw.from)) h.from = raw.from
    if (raw.to && allowed.includes(raw.to)) h.to = raw.to
    if (raw.via === 'shuttle' || raw.via === 'terminal_link_apm') h.via = raw.via
    if (typeof raw.gate === 'string' && raw.gate.length <= 16) h.gate = raw.gate
    return h
  }
  if (t === 'parking') {
    const h: ParkingHint = { type: 'parking' }
    if (Array.isArray(raw.highlight)) {
      h.highlight = raw.highlight.filter((s: any) => typeof s === 'string' && s.length <= 32).slice(0, 8)
    }
    return h
  }
  if (t === 'restaurants') {
    const place_ids = Array.isArray(raw.place_ids)
      ? raw.place_ids.filter((s: any) => typeof s === 'string' && s.length <= 64).slice(0, 12)
      : []
    const h: RestaurantsHint = { type: 'restaurants', place_ids }
    if (typeof raw.context === 'string' && raw.context.length <= 64) h.context = raw.context
    return h
  }
  if (t === 'link_card') {
    if (typeof raw.title !== 'string' || typeof raw.body !== 'string' ||
        typeof raw.cta_url !== 'string' || typeof raw.cta_label !== 'string') return null
    // Strict URL allowlist — the model can only emit known MCO program pages.
    // Prevents prompt-injection-driven open-redirects.
    if (!/^https:\/\/(www\.)?flymco\.com\//.test(raw.cta_url)) return null
    const h: LinkCardHint = {
      type: 'link_card',
      title: raw.title.slice(0, 80),
      body: raw.body.slice(0, 800),
      cta_url: raw.cta_url,
      cta_label: raw.cta_label.slice(0, 40),
    }
    if (typeof raw.image_url === 'string' && /^https:\/\//.test(raw.image_url)) h.image_url = raw.image_url
    return h
  }
  return null
}

// Pulls a JSON object out of an LLM response, stripping the common failure
// modes — code fences, leading prose, trailing prose. Returns null on
// anything that isn't a valid JSON object.
export function parseExtractorJson(raw: string): { hint?: any; next_chips?: any } | null {
  if (!raw) return null
  // Strip ```json fences if present
  let text = raw.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  }
  // Find the first { and last }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  try {
    return JSON.parse(text.slice(first, last + 1))
  } catch {
    return null
  }
}

function validateChips(raw: any): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s) => typeof s === 'string')
    .map((s: string) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 80)
    .slice(0, 4)
}

export interface ExtractorResult {
  hints: UiHint[]
  next_chips: string[]
}

/**
 * Extract a UI hint + follow-up chips from a (user message, assistant message) pair.
 *
 * The classifier callback receives the system prompt + the formatted
 * input. Production wires it to lib/ai.callAI (tier=fast → Haiku/4o-mini);
 * tests inject a stub that returns a canned response.
 *
 * Failure modes degrade to { hints: [], next_chips: [] }. A failed extraction
 * shouldn't break the conversation — the canvas just stays on its previous card
 * and the chip row falls back to whatever the caller had before.
 */
export async function extractUiHints(input: ExtractInput): Promise<ExtractorResult> {
  if (!input.userMessage?.trim() || !input.assistantMessage?.trim()) return { hints: [], next_chips: [] }
  let raw: string
  try {
    raw = await input.classifier(UI_HINT_EXTRACTOR_PROMPT, buildExtractorInput(input.userMessage, input.assistantMessage))
  } catch {
    return { hints: [], next_chips: [] }
  }
  const parsed = parseExtractorJson(raw)
  if (!parsed) return { hints: [], next_chips: [] }
  const validated = parsed.hint == null ? null : validateHint(parsed.hint)
  return {
    hints: validated ? [validated] : [],
    next_chips: validateChips(parsed.next_chips),
  }
}
