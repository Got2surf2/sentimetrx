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

export const UI_HINT_EXTRACTOR_PROMPT = `You are a UI hint extractor for an airport concierge agent. Given a user turn and the assistant's response, decide whether the response references one specific visual context that would help the user. Emit at most one hint as JSON.

Allowed hint types and required payload shapes:

- terminal_map: { "type": "terminal_map", "terminal"?: "A"|"B"|"C", "gate"?: string, "from"?: "A"|"B"|"C", "to"?: "A"|"B"|"C", "via"?: "shuttle"|"terminal_link_apm" }
  Use when the assistant gives wayfinding involving a specific terminal, gate, or terminal-to-terminal route.

- parking: { "type": "parking", "highlight"?: string[] }
  Use when the assistant references parking — garages, lots, cell-phone areas. Highlight names come from: garage_a, garage_b, garage_c, terminal_top, atlantis, discovery, endeavour, north_economy, south_economy, west_economy, north_cell, south_cell, valet.

- restaurants: { "type": "restaurants", "place_ids": [], "context"?: string }
  Use when the assistant mentions specific named restaurants, shops, or dining options. Set "context" to a coarse location label like "terminal_a_airside", "terminal_b_airside", "terminal_c_airside", "landside_main_terminal". Leave place_ids as [] — the renderer resolves them.

- link_card: { "type": "link_card", "title": string, "body": string, "cta_url": string, "cta_label": string }
  Use when the assistant references one specific MCO program with its own dedicated page. Known programs:
    - MCO Reserve → cta_url "https://flymco.com/speed-through-mco"
    - Experience MCO Visitor Pass → cta_url "https://flymco.com/experience-mco-visitor-pass-program"
    - Accessibility programs (Sunflower Lanyard, Annie's Space) → cta_url "https://flymco.com/accessibility"
    - MCO App → cta_url "https://flymco.com/mco-app"
    - Customs electronic submission → cta_url "https://flymco.com/customs"
    - MCO Wi-Fi → cta_url "https://flymco.com/wifi"
  Body should be 2-3 short sentences summarizing the assistant's answer in the agent's voice.

Return a JSON object: { "hint": <hint object> } or { "hint": null } when no card applies.

Examples:
- User: "How do I get from C to A?" → Assistant: "Two options: Terminal Link APM..." → { "hint": { "type": "terminal_map", "from": "C", "to": "A", "via": "terminal_link_apm" } }
- User: "Where can I eat near gate A14?" → Assistant lists 3 restaurants → { "hint": { "type": "restaurants", "place_ids": [], "context": "terminal_a_airside" } }
- User: "What does it cost?" (about something unrelated to a card type) → { "hint": null }
- User: "Where's the closest parking to Terminal C?" → Assistant recommends Garage C → { "hint": { "type": "parking", "highlight": ["garage_c"] } }

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
// anything that isn't valid JSON containing a `hint` field.
export function parseExtractorJson(raw: string): { hint: any } | null {
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

/**
 * Extract a UI hint from a (user message, assistant message) pair.
 * Returns an array because the contract is forward-compatible with
 * multiple hints, but v1 emits at most one.
 *
 * The classifier callback receives the system prompt + the formatted
 * input. Production wires it to lib/ai.callAI (tier=fast → Haiku/4o-mini);
 * tests inject a stub that returns a canned response.
 *
 * Failure modes degrade to []. A failed extraction shouldn't break the
 * conversation — the canvas just stays on its previous card.
 */
export async function extractUiHints(input: ExtractInput): Promise<UiHint[]> {
  if (!input.userMessage?.trim() || !input.assistantMessage?.trim()) return []
  let raw: string
  try {
    raw = await input.classifier(UI_HINT_EXTRACTOR_PROMPT, buildExtractorInput(input.userMessage, input.assistantMessage))
  } catch {
    return []
  }
  const parsed = parseExtractorJson(raw)
  if (!parsed || parsed.hint == null) return []
  const validated = validateHint(parsed.hint)
  return validated ? [validated] : []
}
