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
  | WelcomeHint

// Welcome / default-state card. Never emitted by the extractor — only used
// by the canvas's demo-strip default slot so the right pane shows
// something representative of MCO before the user has asked anything.
export interface WelcomeHint {
  type: 'welcome'
  mode?: DeploymentMode
}

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

// Optional context the canvas shell threads into the extractor so it can
// (a) keep restaurants/parking scoped to the terminal the user is anchored
// to and (b) decide to revert the canvas when the new turn is clearly
// unrelated to whatever is currently on screen.
export interface ExtractorContext {
  activeTerminal?: 'A' | 'B' | 'C'
  lastCanvasType?: UiHint['type']
}

export interface ExtractInput {
  userMessage: string
  assistantMessage: string
  classifier: UiHintClassifier
  context?: ExtractorContext
}

export const UI_HINT_EXTRACTOR_PROMPT = `You are a UI hint + follow-up chip extractor for an airport concierge agent. Given a user turn, the assistant's response, and an optional CONTEXT block describing what the user has been anchored to, decide:
  (a) whether the turn fits one of the canvas cards below,
  (b) what 2-4 short follow-up questions would naturally extend the conversation, and
  (c) whether the canvas should revert to its idle/welcome state because the new turn is clearly unrelated to what's on screen.

CONTEXT block — if present in the user input, the canvas has accumulated state from earlier turns. Honor it:
  - "active_terminal" (A/B/C): the user has been anchored to this terminal. When you emit restaurants or parking hints, STAY WITHIN this terminal — set the restaurants "context" to "terminal_<letter>_airside" and prefer the matching garage (garage_a/b/c) — UNLESS the user's new turn explicitly references a different terminal (e.g. "Terminal A", "B", "C", "the other terminal", "across the airport").
  - "last_canvas_type": this is the card on screen right now. If the user's new turn is clearly off-topic from that card AND no new card type fits, set "revert_canvas": true so the canvas reverts to the idle welcome state instead of stickying stale content.

Allowed hint types and required payload shapes:

- terminal_map: { "type": "terminal_map", "terminal"?: "A"|"B"|"C", "gate"?: string, "from"?: "A"|"B"|"C", "to"?: "A"|"B"|"C", "via"?: "shuttle"|"terminal_link_apm" }
  Use ONLY when navigation or wayfinding is the primary topic: finding a specific gate, getting between terminals, or locating a non-dining facility (bag claim, restroom, check-in counter). Do NOT emit this just because the user mentions a terminal name. If the user says "I'm in Terminal A" or "which terminal" while the conversation is about food, shopping, or services, emit the card for the ACTUAL topic (restaurants, etc.) — not terminal_map. The assistant's answer determines the card type, not a terminal mention in the user's message.

- parking: { "type": "parking", "highlight"?: string[] }
  Use when the user is asking about parking, garages, lots, or cell-phone areas. Highlight names come from: garage_a, garage_b, garage_c, terminal_top, atlantis, discovery, endeavour, north_economy, south_economy, west_economy, north_cell, south_cell, valet.

- restaurants: { "type": "restaurants", "place_ids": [], "context"?: string }
  Use whenever the user is asking about food, dining, restaurants, where to eat, snacks, coffee, drinks, or shopping — EVEN IF the assistant's response is vague or punts to a website. Set "context" to "terminal_a_airside", "terminal_b_airside", "terminal_c_airside", or "landside_main_terminal". Leave place_ids as [] — the renderer resolves them.

- link_card: { "type": "link_card", "title": string, "body": string, "cta_url": string, "cta_label": string }
  Use when the assistant addresses one specific MCO topic that has its own dedicated page. cta_url MUST be exactly one of:
    - "https://flymco.com/speed-through-mco" — MCO Reserve (security wait, skipping the line, PreCheck alternative, "how long is security")
    - "https://flymco.com/experience-mco-visitor-pass-program" — Visitor Pass
    - "https://flymco.com/accessibility" — Accessibility programs (Sunflower Lanyard, Annie's Space)
    - "https://flymco.com/mco-app" — MCO App
    - "https://flymco.com/customs" — Customs electronic submission
    - "https://flymco.com/wifi" — MCO Wi-Fi
    - "https://flymco.com/ground-transportation" — Ground transportation (rideshare, taxi, shuttle, SunRail, rental car center)
    - "https://flymco.com/lost-and-found" — Baggage / lost & found
  Body should be 2-3 short sentences summarizing the assistant's answer in the agent's voice.
  Do NOT use link_card for dining or wayfinding — those have their own cards above.

NO-STRETCH rule: if NONE of the four card types cleanly fits the assistant's answer, return "hint": null. Do not pick a tangentially-related card just to fill the canvas — stale or wrong-topic content on the right pane is worse than no content.

Follow-up chips (next_chips):
  2-4 short user-voiced follow-up questions that naturally extend this exact turn. Each chip:
   - is phrased the way the user would ask it (first-person OK), not the assistant's voice
   - is short (≤ 50 chars, like a quick reply pill)
   - reflects the specific content of the assistant's last answer, not generic openers
   - if the assistant named entities (restaurants, gates, garages), reference them by name when it fits
   - DO NOT repeat the user's just-asked question
  If you genuinely cannot think of relevant follow-ups, return [].

Return a JSON object: { "hint": <hint object or null>, "next_chips": string[], "revert_canvas"?: boolean }

Examples:
- User: "How do I get from C to A?" → Assistant: "Two options: Terminal Link APM in 6 min or the shuttle bus in 12..." → { "hint": { "type": "terminal_map", "from": "C", "to": "A", "via": "terminal_link_apm" }, "next_chips": ["How often does the APM run?", "Where do I catch the shuttle?", "Which is faster with luggage?"] }
- User: "Where can I eat near gate A14?" → Assistant lists Chick-fil-A, Shake Shack → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_a_airside" }, "next_chips": ["Anything sit-down?", "What's open late?", "Vegetarian options?"] }
- User: "What's the security wait like?" → Assistant: "Standard 15-30 min; MCO Reserve lets you book a slot to skip the line for free." → { "hint": { "type": "link_card", "title": "MCO Reserve", "body": "Standard security at MCO runs 15-30 minutes most days. MCO Reserve is a free service that lets you book a security time slot so you can skip into a shorter line.", "cta_url": "https://flymco.com/speed-through-mco", "cta_label": "Reserve a time slot" }, "next_chips": ["When are slots released?", "Is it really free?", "Does it work with PreCheck?"] }
- CONTEXT: active_terminal=C, last_canvas_type=terminal_map. User: "Where can I get coffee?" → Assistant: "Starbucks and Cibo Espresso have outposts in Terminal C airside." → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_c_airside" }, "next_chips": ["What's open before 6 AM?", "Sit-down breakfast?"] }
- User: "I'm in Terminal A" (prior context was about shops/dining) → Assistant: "Great! For Terminal A's shops and dining, browse the directory and filter by Terminal A..." → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_a_airside" }, "next_chips": ["Best quick bite near the gate?", "Any bars open now?", "Coffee shops?"] }
- CONTEXT: last_canvas_type=restaurants. User: "Tell me a joke." → Assistant: "Off-topic gentle deflect." → { "hint": null, "next_chips": [], "revert_canvas": true }

Output JSON only. No prose, no markdown fences.`

// Used as the classifier input — pairs user + assistant turn into one block
// the model can reason about. Kept short to minimize tokens (this runs after
// every assistant turn). If context is supplied, a CONTEXT block is prepended
// so the model can honor active_terminal and decide revert_canvas.
export function buildExtractorInput(userMessage: string, assistantMessage: string, context?: ExtractorContext): string {
  const parts: string[] = []
  if (context && (context.activeTerminal || context.lastCanvasType)) {
    const lines: string[] = []
    if (context.activeTerminal) lines.push(`active_terminal: ${context.activeTerminal}`)
    if (context.lastCanvasType) lines.push(`last_canvas_type: ${context.lastCanvasType}`)
    parts.push('CONTEXT:\n' + lines.join('\n'))
  }
  parts.push('USER: ' + userMessage.slice(0, 600))
  parts.push('ASSISTANT: ' + assistantMessage.slice(0, 1500))
  return parts.join('\n\n')
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
export function parseExtractorJson(raw: string): { hint?: any; next_chips?: any; revert_canvas?: any } | null {
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
  // True when the extractor judges the new turn is clearly unrelated to what's
  // on the canvas. ChatPane treats this as "clear the canvas back to the idle
  // welcome card" — the alternative (stickying stale content) was the bug that
  // motivated this signal.
  revert_canvas: boolean
}

/**
 * Extract a UI hint + follow-up chips from a (user message, assistant message) pair.
 *
 * The classifier callback receives the system prompt + the formatted
 * input. Production wires it to lib/ai.callAI (tier=fast → Haiku/4o-mini);
 * tests inject a stub that returns a canned response.
 *
 * Failure modes degrade to { hints: [], next_chips: [], revert_canvas: false }.
 * A failed extraction shouldn't break the conversation — the canvas stays on its
 * previous card and the chip row falls back to whatever the caller had before.
 */
export async function extractUiHints(input: ExtractInput): Promise<ExtractorResult> {
  if (!input.userMessage?.trim() || !input.assistantMessage?.trim()) return { hints: [], next_chips: [], revert_canvas: false }
  let raw: string
  try {
    raw = await input.classifier(UI_HINT_EXTRACTOR_PROMPT, buildExtractorInput(input.userMessage, input.assistantMessage, input.context))
  } catch {
    return { hints: [], next_chips: [], revert_canvas: false }
  }
  const parsed = parseExtractorJson(raw)
  if (!parsed) return { hints: [], next_chips: [], revert_canvas: false }
  const validated = parsed.hint == null ? null : validateHint(parsed.hint)
  return {
    hints: validated ? [validated] : [],
    next_chips: validateChips(parsed.next_chips),
    revert_canvas: parsed.revert_canvas === true,
  }
}
