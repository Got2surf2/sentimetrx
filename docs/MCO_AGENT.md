# Sentimetrx — MCO Agent ("AskAna at MCO") Spec

**Module:** prototype — not yet built. Target paths: `app/demo/mco/**`, `app/api/bots/[id]/chat/route.ts` (extension), `components/canvas/**`, `lib/uiHints.ts`, `lib/places.ts`.
**Storage:** reuses the existing agents/agent_knowledge_chunks substrate. The MCO agent already exists in prod (slug `mco`, bot_id `920c571b-5a09-4d3a-a20e-904a417d20b3`).
**External APIs:** Google Places API (New), flymco.com parking-availability JSON, static terminal SVGs hosted on flymco.com.
**Feature gate:** TBD (likely `organizations.features.canvas_prototype`).

> **Spec scope:** the design spec for a boardroom-demo prototype targeting the Orlando International Airport (MCO) opportunity. Pattern is intentionally reusable for other vertical demos (UCF Incubator, future municipal/transit pitches), but this doc is scoped to MCO. Source of truth is the code once built; this spec is current as of 2026-05-21 and should be refreshed at every commit that touches the prototype.

---

## 1. Vision

A digital airport concierge experience that beats what Changi (AskMax), Schiphol (SSU), DFW (IRIS), and LaGuardia (Bridget) have shipped publicly — **none of those combine a chat agent with a synchronized rich-media canvas**. They are either chat-only widgets or kiosk-screen-only wayfinding.

We already have the agent ([/b/mco](https://www.sentimetrx.ai/b/mco), seeded 2026-05-21 from a 45-page Playwright crawl of flymco.com). This spec covers the **landscape canvas wrapper** on top of that agent that makes it demo-worthy in a boardroom and credible as a wall-mounted kiosk later.

### Goals

- **G1.** A boardroom demo we can run on a 27"+ landscape display at the MCO meeting, where the agent answers in natural language *and* shows the relevant terminal map / parking grid / restaurant list on the other side of the screen.
- **G2.** A reusable canvas pattern. Once shipped for MCO, the same shell works for UCF Incubator (right pane = location maps + program comparison cards) or any future agent-led vertical demo.
- **G3.** A bridge to the eventual public API discussed in [[bots-api-access]] brainstorm — the `ui_hints` emission shape becomes the v1 structured-response contract for external skinning.

### Non-goals (v1)

- Production kiosk hardening (touch-target sizing, attestation, indoor beacon routing, real-time TSA wait integration, multi-monitor tiling).
- Mobile / portrait support.
- Multi-language UI chrome (the underlying agent already supports 16 languages; the canvas labels can stay English for the demo).
- Booking, payment, or any transactional flow.

---

## 2. Brand: AskAna

Following Changi's "AskMax" precedent. Ana is an existing Sentimetrx-internal brand (legacy Ana product); reusing the name gives the airport agent a personable identity rather than a generic "MCO Concierge" label.

- **Display name:** `AskAna`
- **Persona name (referred to by the bot itself):** Ana
- **Subtitle:** `Orlando International Airport`
- **Avatar:** `✈️` (kept from the initial branding pass; the plane emoji + the "Ana" name reads as "Ana, your airport guide" without needing a face avatar).
- **Greeting (first message):** "Hi, I'm Ana — your guide to Orlando International Airport. Ask me about parking, terminals, security, ground transportation, accessibility, or anything else about flying through MCO."
- **Self-reference rule (system prompt addition):** the bot may refer to herself as "Ana" or use the first-person — never as "the MCO Concierge" or "the assistant."

### Reusability note

The Ana brand is **agent-deployment-specific, not site-wide**. Other future deployments may use other personified names (e.g. "AskUma" for the UCF Incubator, "AskMia" for a municipal agent). The canvas shell is brand-agnostic; the agent's `personality` field carries the name.

---

## 3. Layout (landscape, ≥1440×900)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  AskAna ✈️   Orlando International Airport               [QR] [⟲ Reset]  │  ← top bar (56px)
├──────────────────────────────┬───────────────────────────────────────────┤
│                              │                                           │
│   Conversation thread        │   Canvas slot                             │
│   (scrolls)                  │   (single card at a time;                 │
│                              │    cross-fade transitions)                │
│                              │                                           │
│                              │                                           │
│                              │                                           │
│                              │                                           │
│   ─────────────────────      │                                           │
│   [ Suggested chip ]         │                                           │
│   [ Suggested chip ]         │                                           │
│                              │                                           │
│   ┌────────────────────┐     │                                           │
│   │ Ask Ana about MCO… │ ►   │                                           │
│   └────────────────────┘     │                                           │
└──────────────────────────────┴───────────────────────────────────────────┘
            40%                                  60%
```

- Single canvas slot, never stacked panels. Cross-fade transitions on swap (≤ 250 ms).
- Top bar has a persistent QR ("Send this to my phone") that encodes the conversation share link.
- Input is bottom-anchored, always visible. Suggested chips above it pre-populate the input.
- When the canvas is empty (initial state), it shows an idle "panorama" — looping ambient terminal photo with the day's parking-availability summary as a centered overlay.

### Ratios + typography

- 40/60 split for ≥ 1280px width; below that, single-column fallback (defers to the existing `/b/mco` mobile chat).
- Base font: 18 px in the thread, 22 px in canvas titles, 16 px in chips.
- Color palette inherits the `mco` agent config: deep blue `#0a2540` header, amber `#f59e0b` accent, white card surfaces.

---

## 4. Right-pane trigger: `ui_hints` contract

The agent emits a **structured `ui_hints` array** alongside the prose response. This is the same explicit-emission pattern Claude Artifacts and ChatGPT Canvas use; it is reliable across phrasings and language, unlike implicit keyword matching.

### Wire shape (response body)

`POST /api/bots/[id]/chat` response (extension):

```jsonc
{
  "message": "From Terminal C to Terminals A and B you have two options...",
  "session_id": "bs_…",
  "turn_id": "…",
  "sentiment": "neutral",
  "ui_hints": [
    { "type": "terminal_map", "from": "C", "to": "B", "via": "terminal_link_apm" }
  ]
}
```

`ui_hints` is **optional** and **additive** — clients that don't know the field ignore it; the existing `/b/mco` page renders as today.

### Hint types (v1 — exactly four)

| `type` | Payload | Renders as |
|---|---|---|
| `terminal_map` | `{ terminal: "A" \| "B" \| "C", gate?: "A14", from?: "C", to?: "B", via?: "shuttle" \| "terminal_link_apm" }` | Static terminal SVG with a pin at the gate and an arrow/route overlay if from/to/via supplied. |
| `parking` | `{ highlight?: ["garage_a","garage_b","garage_c","atlantis","discovery","endeavour","north_economy","south_economy","west_economy"] }` | Grid of 4 garages × N surface lots with live availability bars from the flymco parking JSON. Highlighted entries pulse amber. |
| `restaurants` | `{ place_ids: ["ChIJ…", ...], context?: "terminal_a_airside" }` | Vertical list of cards: photo, name, cuisine tag, ★ rating + review count, price band, hours-now-open chip, "Powered by Google" footer. |
| `link_card` | `{ title: string, body: string, image_url?: string, cta_url: string, cta_label: string }` | Generic info card. Used for visitor pass program, MCO Reserve, accessibility programs, Hyatt hotel, etc. |

### Backend emission

Two-stage prompting in `/api/bots/[id]/chat/route.ts`:

1. **Primary** — the existing assistant turn runs and produces prose.
2. **Hint extractor** — a short, cheap follow-up call (Haiku or equivalent) sees the user message + assistant message and emits `ui_hints` JSON. System prompt for the extractor lists the four `type` schemas and the rule "emit at most one hint; only when the assistant's answer references a place, route, or live data the user would benefit from seeing."

Cost discipline: extractor is gated behind a `UI_HINTS_ENABLED` env flag. When off, the route behaves exactly as today (no hint, no extra call). When on, ~$0.0003 per turn on Haiku.

Future v2 can fold the hint into the primary call as a tool call, eliminating the second round-trip. v1 keeps it separate so we can disable it without touching the prose contract.

---

## 5. Data integrations

### 5.1 flymco.com parking-availability JSON

- **Endpoint:** scraped from [flymco.com/parking-availability](https://flymco.com/parking-availability/). The page itself renders a live grid; the underlying data is fetched from a JSON endpoint we'll identify in the Next.js bundle.
- **Cache:** 60 seconds, per-canvas-renderer (not per-user).
- **Failure mode:** if fetch fails, show the static garage list with "Live availability unavailable — refresh to retry" footnote. Never block the canvas render on this.

### 5.2 Google Places API (New)

- **SKU used in v1:** Basic (rating, user_ratings_total, price_level, current_opening_hours, formatted_address, name). **No photos, no reviews in v1** — those are the $17-20/1K SKU; defer to v2.
- **Pricing:** ~$5 per 1,000 calls (Basic SKU). Demo session of 50 turns × 1.2 hints/turn × ~4 restaurants/restaurant-hint ≈ 240 calls per demo, ~$1.20. Negligible.
- **Cacheability:** Google's terms allow caching `place_id` only; **all other fields must be refetched on render**. So we maintain a seed list of MCO `place_id`s (one-time research task: ~80 airside restaurants/shops × terminal × landside) and call Places at render time for each.
- **Attribution:** "Powered by Google" badge required on any pane showing Places data. Each card links to the Google Maps profile via the `place_id`.

### 5.3 Static terminal SVGs

- Source: flymco.com/terminal-maps (rendered, not the source SVG — needs DOM-extracted via Playwright on a one-time seed run).
- Stored as static assets under `public/mco/terminals/` (a, b, c).
- Gates overlaid client-side from a small JSON registry (`public/mco/gate-coords.json`).

### 5.4 Out of scope for v1

- Indoor turn-by-turn (requires beacon partnership).
- Real-time TSA wait times (the page shows snapshots; we'd need scraper that handles their internal API). Defer to v2.
- Flight status (already correctly delegated to airline by the agent's guardrails).
- Restaurant photos and reviews (Places API Pro SKU cost; v2).

---

## 6. Backend changes

### 6.1 `/api/bots/[id]/chat/route.ts`

```diff
+ // After the primary assistant turn completes, if UI_HINTS_ENABLED and
+ // request body opt-in (`include_ui_hints: true`), run the extractor.
+ if (process.env.UI_HINTS_ENABLED === 'true' && body.include_ui_hints) {
+   ui_hints = await extractUiHints({ bot, userMessage, assistantMessage })
+ }
```

The extractor lives in `lib/uiHints.ts` and exports `extractUiHints({ bot, userMessage, assistantMessage }) → Promise<UiHint[]>`. The prompt is included verbatim in this spec — see §10.

### 6.2 `lib/places.ts` (new)

```ts
export interface PlaceCard {
  place_id: string
  name: string
  rating: number | null
  user_ratings_total: number | null
  price_level: number | null   // 0..4
  opening_hours_now: 'open' | 'closed' | 'unknown'
  formatted_address: string
  maps_url: string             // "https://maps.google.com/?cid=..."
}

export async function fetchPlaceCards(placeIds: string[]): Promise<PlaceCard[]>
```

Concurrency 8, 5-second timeout per call. Falls through on error (skip the place, keep the rest).

### 6.3 `lib/parking.ts` (new)

```ts
export interface ParkingLot { id: string; label: string; level: 'terminal_ab' | 'terminal_c' | 'train' | 'economy'; total: number; available: number; updated_at: string }
export async function fetchParkingAvailability(): Promise<ParkingLot[]>
```

Caches in `lib/runtimeCache.ts` (Vercel Runtime Cache, 60 s TTL).

---

## 7. Frontend

### 7.1 Route

`app/demo/mco/page.tsx` — server component that fetches the agent record, wraps it in `<CanvasShell>`.

### 7.2 Component tree

```
<CanvasShell>
  <TopBar />
  <Pane left>
    <ConversationThread />
    <SuggestionChips />
    <ChatInput onSubmit={fn} />
  </Pane>
  <Pane right>
    {hint ? <CanvasRouter hint={hint} /> : <IdlePanorama />}
  </Pane>
</CanvasShell>

<CanvasRouter hint>
  switch hint.type:
    terminal_map → <TerminalMapCanvas terminal gate from to via />
    parking      → <ParkingCanvas highlight />
    restaurants  → <RestaurantsCanvas placeIds />
    link_card    → <LinkCanvas title body image_url cta_url cta_label />
```

### 7.3 State + transitions

- `useChat` hook wraps `/api/bots/[id]/chat` with `include_ui_hints: true`.
- Latest assistant turn's `ui_hints[0]` (if any) drives `hint` state in `CanvasShell`.
- On hint change: 250 ms cross-fade. No layout shift.
- Hint stickiness: persists until the next assistant turn produces a different hint or `null`. A turn that explicitly says "no relevant canvas" emits `ui_hints: []` — canvas stays as-is. This keeps the canvas useful even when the user asks a follow-up that doesn't add new visual context.

---

## 8. Auth + access

- Public, no auth — same posture as `/b/mco`. The agent's existing rate limits apply.
- IP-based rate limit: 60 req/min per IP (already enforced upstream).
- No PII collection beyond what the agent already does (session-scoped chat history; the existing `ask_profile` field stays off).

---

## 9. Effort estimate (single engineer, leveraging existing /b/mco agent)

| Phase | Days | Deliverable |
|---|---|---|
| Backend `ui_hints` extractor + env flag | 1.5 | `lib/uiHints.ts`, route extension, `UI_HINTS_ENABLED` flag, unit tests on the extractor prompt |
| `lib/places.ts` + MCO `place_id` seed list | 1 | Seed JSON for ~80 airside places, Places client with concurrency + timeout |
| `lib/parking.ts` + flymco JSON discovery | 1 | Identified JSON endpoint, scraper, 60s cache |
| Static terminal SVG extraction | 0.5 | Three SVGs under `public/mco/terminals/`, gate coord JSON |
| `<CanvasShell>` + 4 card components | 3.5 | All four hint types render cleanly at 1440×900 and 1920×1080 |
| Idle panorama + transitions | 0.5 | Looping ambient photo + idle parking summary |
| Polish, copy review, demo dry-run | 1 | Boardroom-ready |
| **Total to boardroom demo** | **~9 days** | |
| **Production kiosk hardening (separate phase)** | **~3-4 weeks** | Touch sizing, attestation, beacon routing, real TSA wait |

---

## 10. Verbatim prompts

### Hint extractor system prompt

```
You are a UI hint extractor for an airport concierge agent. Given a user turn and the assistant's response, decide whether the response references one specific visual context that would help the user. Emit at most one hint as JSON.

Allowed hint types and required payload shapes:

- terminal_map: { type, terminal: "A"|"B"|"C", gate?: string, from?: "A"|"B"|"C", to?: "A"|"B"|"C", via?: "shuttle"|"terminal_link_apm" }
  Use when the assistant gives wayfinding involving a specific terminal, gate, or terminal-to-terminal route.

- parking: { type, highlight?: string[] }
  Use when the assistant references parking — garages, lots, cell-phone areas. Highlight names come from: garage_a, garage_b, garage_c, atlantis, discovery, endeavour, north_economy, south_economy, west_economy, north_cell, south_cell, valet.

- restaurants: { type, place_ids: string[], context?: string }
  Use when the assistant mentions specific named restaurants or shops. place_ids must come from the seed list provided. Do not invent place_ids.

- link_card: { type, title, body, image_url?, cta_url, cta_label }
  Use when the assistant references one specific MCO program with its own page (visitor pass, MCO Reserve, accessibility, Hyatt hotel, MCO app, customs app).

Return JSON only. If no hint applies, return [].

Examples:
- User: "How do I get from C to A?" → Assistant: "Two options: Terminal Link APM..." → [{ "type": "terminal_map", "from": "C", "to": "A", "via": "terminal_link_apm" }]
- User: "Where can I eat near gate A14?" → Assistant lists 3 restaurants → [{ "type": "restaurants", "place_ids": ["ChIJ...","ChIJ..."], "context": "terminal_a_airside" }]
- User: "What does it cost?" (about something not in scope) → [].
```

---

## 11. Open questions

1. **Place ID seed list source.** Curate manually (1 day) vs. scrape Google Maps + verify (2 days, risk of getting throttled). Default: manual curation off the flymco shops/dining list.
2. **flymco parking JSON endpoint.** May require some sniffing to identify. If they obfuscate it, alternative is parsing the HTML grid. Worst case: skip live parking, show static lot list with note.
3. **Brand approval.** Reusing "Ana" externally for an airport agent — does this conflict with the legacy Ana product or any prior customer relationship? Owner: Sanjay.
4. **Hint stickiness on follow-ups.** Default decision in §7.3 is "sticky until a new explicit hint appears." Alternative: clear after N turns. Defer to demo dry-run.
5. **Multi-user vs. single-screen demo.** v1 assumes one operator driving the screen at the MCO meeting. Multi-user kiosk mode (anyone walks up and uses) is the kiosk-hardening phase, not v1.

---

## 12. Convergence interlock

The chat-route extension in §6.1 lands in the same file the Phase 4 convergence work will refactor. Order of operations:

- **If Phase 4 lands first:** the `ui_hints` extractor wires into the new unified handler. Cleaner end state, but blocks the demo by ~2-3 weeks.
- **If MCO prototype lands first:** ship the extractor as a small additive callsite in the current route, then port it during Phase 4. ~1 hour of porting work as part of the convergence cutover.

Recommendation: **MCO prototype first.** The extractor is a self-contained 30-line addition; the demo unlocks the sales conversation. Phase 4 absorbs it later.

---

## 13. Reusability for other verticals

Once the canvas shell exists, swapping it to UCF Incubator (`/b/ucf-incubator`) requires only:

- A new `place_id` seed list (if any place-of-business cards are wanted).
- A new set of static map / location SVGs (the seven incubator locations).
- A new hint type registry: drop `terminal_map`, `parking`; add `location_map`, `program_comparison`.
- New idle panorama.

Estimated additional effort for a UCF Incubator variant: ~3 days on top of the MCO build.

---

## 14. Status

- **Design:** drafted 2026-05-21 by Sanjay + Claude (this doc).
- **Build:** in progress.
  - **Commit 1 LANDED 2026-05-21** — visual shell at `/demo/mco` with the 40/60 landscape layout, mode auto-detection (URL param > UA > default), three deployment modes (home / invenue / kiosk), demo strip with mode switcher + card navigation, four canvas card components (TerminalMap, Restaurants, Parking, LinkCard), chat pane wired to the live AskAna agent (bot_id `920c571b-...`). Cards driven by demo strip (hardcoded data); intent-based hint emission not yet wired. `lib/uiHints.ts` defines the UiHint type union + DeploymentContext. tsc clean.
  - **Commit 2 (next)** — `lib/uiHints.ts` extractor function + `app/api/bots/[id]/ui-hints/route.ts` sibling endpoint + unit tests.
  - **Commit 3** — wire frontend to call extractor after each chat turn; cards become real-intent-driven; demo strip becomes dev-only.
  - **Commit 4** — live data: `lib/parking.ts` (flymco JSON), `lib/places.ts` (Google Places API), terminal SVG extraction → cards stop being hardcoded.
- **Demo target:** TBD — driven by MCO opportunity timeline.

## 15. Decoupled extractor architecture (Commit 2 change vs. §6.1)

Original §6.1 proposed extending the chat route to emit `ui_hints` inline. **Revised:** the extractor lives in a sibling endpoint, `POST /api/bots/[id]/ui-hints`, that the frontend calls after each chat turn. Inputs: `{ userMessage, assistantMessage }`. Output: `{ ui_hints: UiHint[] }`. Three reasons:

1. **Zero conflict with Phase 4 convergence** — the chat route is untouched. Phase 4 commit 1 already extracted the route into `lib/chatCore.ts`; we don't have to coordinate with that refactor.
2. **Chat latency unchanged** — the canvas card appears a beat after the assistant message rather than the assistant waiting on a second LLM call.
3. **Easy to fold in later if desired** — once `chatCore.ts` settles, the extractor can move inside without breaking the response shape (the optional `ui_hints` field stays additive).

The verbatim hint extractor system prompt from §10 is unchanged.
