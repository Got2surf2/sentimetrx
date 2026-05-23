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

The sibling endpoint also returns a parallel `next_chips: string[]` — 0-4 short follow-up questions the model thinks the user is likely to ask next, in the user's voice (≤ 80 chars each). The canvas's ChatPane swaps its initial chip row for these after the first assistant turn, so the suggested replies stay coherent with what the bot just said. Same fail-open posture: empty array → ChatPane keeps the previous chip row.

### Active context + revert signal

The canvas shell also threads an optional `context` block into each `/ui-hints` POST so the extractor can keep restaurants/parking scoped across turns. Wire shape:

```jsonc
// request body extension
{
  "userMessage": "Where can I get coffee?",
  "assistantMessage": "Starbucks and Cibo Espresso have outposts in Terminal C airside.",
  "context": {
    "activeTerminal": "C",           // derived from the current right-pane card
    "lastCanvasType": "terminal_map" // what the user is seeing right now
  }
}
```

`activeTerminal` is derived in `CanvasShell` from the currently-rendered hint: a `terminal_map` hint's `to`/`from`/`terminal` field, a `restaurants` hint's `context: terminal_X_airside` parse, or a single-garage `parking` hint's `garage_x`. In `invenue` mode it falls back to the structural location (Terminal B). The extractor prompt instructs the model to keep place selection within `activeTerminal` unless the user explicitly references another.

The response gains a `revert_canvas: boolean` field. When `true` (set by the extractor when the new turn is clearly off-topic from `lastCanvasType` and no new card fits), ChatPane calls `onHintReceived(null)` so CanvasShell falls back to the idle welcome card. This fixes the "I asked about security but the right pane stayed on restaurants" stickiness bug — the old contract had no way to clear stale content without emitting a new hint.

Together with the prompt's **NO-STRETCH** rule ("if NONE of the four card types cleanly fits, return hint:null — do not pick a tangentially-related card"), the extractor now has three explicit decisions per turn: emit a hint, stay on the existing card, or revert to idle.

### Hint types (v1 — exactly four)

| `type` | Payload | Renders as |
|---|---|---|
| `terminal_map` | `{ terminal: "A" \| "B" \| "C", gate?: "A14", from?: "C", to?: "B", via?: "shuttle" \| "terminal_link_apm" }` | Static terminal SVG with a pin at the gate and an arrow/route overlay if from/to/via supplied. |
| `parking` | `{ highlight?: ["garage_a","garage_b","garage_c","atlantis","discovery","endeavour","north_economy","south_economy","west_economy"] }` | When live spot counts are available: grid with fill bars, highlighted entry pulses amber. When counts are unavailable: 3-pick recommendation layout — ⭐ RECOMMENDED (highlighted lot or Garage C), 💰 BEST VALUE (cheapest lot), ⚡ QUICK ACCESS (premium/Terminal Top) — each with rate and a contextual note. |
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

### 5.2 Restaurant ratings — DataForSEO (default) + Google Places (fallback)

**Default path: DataForSEO Google Maps SERP.** We already have DATAFORSEO_LOGIN/PASSWORD set, so this is the zero-additional-key path. One SERP query (`"restaurants Orlando International Airport MCO"`, ~$0.002) returns ~78 Google Maps results; `scripts/_mco_dfs_seed.ts` filters those to airport-only addresses (ZIP 32827 / Jeff Fuqua Blvd / Terminal mentions; excludes ground-level Orlando spots that share the ZIP), then matches each result against the authoritative flymco directory by normalized fuzzy name. flymco's "Terminal - A & B" / "Terminal - C" / "Entire Airport" labels win the bucket assignment (Google Maps addresses don't consistently say Terminal A/B/C). Output: `data/mco_live_ratings.json`, ~29 entries with real `rating` + `review_count` + `maps_url`. `lib/places.ts::livePlacesForContext()` reads this file at server boot — zero per-request API cost, no GOOGLE_PLACES_API_KEY needed.

To refresh, re-run `node_modules/.bin/tsx scripts/_mco_dfs_seed.ts`. The matching pipeline is idempotent and costs ~$0.002 per run. Restaurant ratings rarely change daily; a weekly cron would be reasonable.

**Fallback path: Google Places API (New).** Kept for callers that supply explicit Google `place_id` arrays (e.g. a future UI surface resolving a single specific place). Requires `GOOGLE_PLACES_API_KEY`. Basic SKU ($5/1K calls). Google's terms allow caching `place_id` only — all live fields refetch on render. Demo session of ~50 turns × ~1.2 hints/turn × ~4 places ≈ 240 calls / $1.20.

**Honesty rule (critical):** when `is_mock: true` (no live data + no explicit place_ids), `RestaurantsCard.tsx` suppresses the rating numbers entirely and shows "Tap to open in Google Maps for current rating & hours". Synthetic ratings next to a tap-through link to the real Google page mislead users when the two numbers disagree — that exact mismatch broke trust in an earlier review of the canvas.

**Attribution:** "Powered by Google" footnote on any pane showing rating data. Each card links to the Google Maps profile via the `maps_url`.

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

The extractor lives in `lib/uiHints.ts` and exports `extractUiHints({ userMessage, assistantMessage, classifier }) → Promise<{ hints: UiHint[]; next_chips: string[] }>`. The prompt is included verbatim in this spec — see §10.

The `restaurants` rule is intentionally *intent*-driven rather than text-driven: it fires whenever the user asks about food, dining, snacks, coffee, or shopping — even if the assistant's prose is vague or punts the user to a website. Reason: the agent's prompt occasionally suggests "see flymco.com/dining" instead of naming specific restaurants; the canvas should still surface the list rather than punishing the user for the bot's vagueness.

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
  primary_type: string | null  // e.g. "cafe", "restaurant"
  cuisine_icon: string         // emoji glyph from cuisineIcon(name, primaryType)
  logo_url: string | null      // brand logo URL — null until curation pass
  is_mock: boolean
}

export function cuisineIcon(name: string, primaryType: string | null): string
export async function fetchPlaceCards(placeIds: string[]): Promise<PlaceCard[]>
```

`cuisineIcon` maps name + primaryType to a cuisine emoji (🍕, 🌮, ☕, etc.) via name-first priority lookups — handles brand identity cases where primaryType is generic "restaurant". Concurrency 8, 5-second timeout per call. Falls through on error (skip the place, keep the rest).

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
- Hint stickiness: persists until the next assistant turn produces a different hint or the extractor signals `revert_canvas: true` (see §4). A turn with `ui_hints: []` AND `revert_canvas: false` keeps the canvas as-is — useful follow-up behavior. A turn with `revert_canvas: true` returns the canvas to the idle welcome card so stale content doesn't sit next to an unrelated answer.

### 7.3a Link card modal

Tapping the right-pane link_card's CTA opens an in-product modal (`LinkCardModal.tsx`) rather than navigating away to flymco.com. The modal expands the body into a larger, presentation-friendly layout and offers two exits:

- **Close** — primary action, returns the user to the canvas. Bound to Escape, backdrop click, and the X button. Bigger and centered in kiosk mode.
- **Open full page on flymco.com** — secondary escape hatch (new tab). HIDDEN in kiosk mode because there's no keyboard/login on a wall display.

Kiosk-only: a 60-second inactivity timer auto-closes the modal so the next person walking up sees the chat + canvas baseline. Any user interaction (pointer move, keypress, touch, click) resets the timer.

This replaces the previous behavior — a hard navigation that lost the chat session in home/invenue and had no back button in kiosk.

### 7.4 Pilot agent + `?bot=` override

A pilot agent is a full clone of the live AskAna with its own `bot_id`, slug, and isolated KB. We use the pattern to test KB changes (re-crawled dining directory, prompt tweaks) before promoting to live. Established pattern in this codebase — same as the Sarina + Sir O'Gate pilots.

- `scripts/_mco_create_pilot.ts` builds the pilot: clones the `agents` row (new name "AskAna (pilot)", new slug `askana-pilot`), clones all live KB chunks (preserving embeddings — no re-embed cost), then layers the proposed changes on top. Idempotent: re-running the script restores the pilot to a clean clone of live before re-applying the diff.
- `app/demo/mco/page.tsx` accepts a `?bot=pilot` (alias) or `?bot=<uuid>` URL param. Whitelist enforced: only the literal alias `pilot` or a fully-formed UUID is honored; anything else falls through to the live AskAna bot_id. Threaded through `CanvasShell` → `ChatPane`.
- Promote workflow (TBD): once a pilot is approved, flip its KB chunks onto live AskAna and either delete the pilot agent or leave it for the next iteration. A dedicated "flip script" should diff pilot vs live KB and apply the delta atomically.

### 7.5 Live AskAna KB directory chunks

The agent's `knowledge_base` has two crawl-derived corpuses:

1. **Directory** — 20 chunks generated by `scripts/_mco_seed_directory_kb.ts` from `scripts/_mco_scrape_directory.mjs`. Captures 602 shops/dining/amenities entries from `flymco.com/shops-restaurants-services`, bucketed by category × terminal. Tag: `mco_directory_scrape_2026_05_21`.

2. **Info pages** — 134 chunks generated by `scripts/_mco_seed_pages_kb.ts` from `scripts/_mco_scrape_pages.mjs` (2026-05-22). Covers the full traveler-facing flymco.com tree: 12 FAQ pages, accessibility (incl. Annie's Space), Wi-Fi, lost & found, family amenities, concierge services, MCO Reserve + Visitor Pass, security/customs, 18 ground-transportation pages, all parking lots (info + reservations), terminal maps, airlines, Orlando-experience pages, etc. ≤2000 chars/chunk, oversized blocks split on sentence boundaries. Tag: `mco_pages_scrape_2026_05_22`.

Both seeders are idempotent: re-running deletes prior chunks with the same source tag before reinserting. Embeddings use `text-embedding-3-small` with a 28k-char safety truncation.

**Anti-deflection prompt** (applied 2026-05-22 via `scripts/_mco_tighten_prompt.ts`): Ana's personality + system_prompt now require her to use the KB inline rather than redirecting to flymco.com URLs. Four new guardrails: (1) prefer KB over URL deflection, (2) terminal mentions during dining/shopping = context, not navigation, (3) reserve +1-407-825-3177 for emergencies / off-scope only, (4) name directory entries when discussing shops/restaurants. Verified via `scripts/_mco_probe_deflection.ts` against 10 common deflection-prone queries — all answered inline.

This is the fix for the previous behavior where the bot's prose response was "see flymco.com/dining" — there was nothing in the KB to retrieve. Now 79 named airside restaurants are in the KB by terminal.

### 7.6 Welcome / landing card (right-pane default)

Before the user has asked anything, the right pane shows a `WelcomeCard` (component at `app/demo/mco/components/WelcomeCard.tsx`). Replaces the previous default of a C→A/B terminal route map, which felt arbitrary before any conversation.

The card has three sections: (a) hero with the big "MCO" mark + airport name + a one-line description of what Ana can help with; (b) a middle block that is **mode-dependent** (see below); (c) a four-tile quick-actions grid and a keyboard/tap cue.

**Mode-dependent middle block:**
- `home` / `invenue`: live parking strip from `/api/mco/parking` — three garages with color-coded fill bars (green <70% full, amber 70-89%, red ≥90%), "Live" pill when GOAA data is fresh. Falls back gracefully when counts aren't available.
- `kiosk`: "At a glance" 2×2 grid of clickable in-venue fact tiles (Free Wi-Fi · Terminal link APM · MCO Reserve · Power & charging). Each tile sends a prompt to the chat pane when tapped. Ground Transport was removed from this grid (it duplicated the Quick Actions tile below).

**Mode-dependent quick action tiles:**
- `home` / `invenue`: Parking · Dining · Speed through security · Accessibility
- `kiosk`: Shopping · Food & Drinks · Security · Ground Transport

`terminal_map` extractor rule tightened: only fires for explicit navigation/wayfinding turns. Stating "I'm in Terminal A" during a dining conversation now correctly emits a `restaurants` hint scoped to that terminal rather than a map card.

**Conversation reset:**
- Manual: a circular-arrow button in the topbar clears the chat thread, mints a fresh session id, and reverts the canvas to the welcome card. Available in all modes.
- Kiosk auto-reset: 60s of pointer/keyboard/touch inactivity triggers the same clear flow automatically. Matches the LinkCardModal kiosk auto-dismiss timeout. Home and invenue modes are exempt (personal devices, not shared screens).

**Markdown rendering in chat bubbles:** assistant messages are passed through a minimal renderer that handles `[text](url)` links and `**bold**` spans. No external dependency; anything outside those two patterns renders as plain text. Links open in a new tab with `noopener noreferrer`.

**"Continue on your phone" handoff:** the QR icon in the topbar opens `QRHandoffModal`, which POSTs the current `{ session_id, bot_id, messages }` to `/api/mco/handoff`. The API generates a 6-char Crockford-base32 code, persists the snapshot to the `mco_handoff_sessions` table (15-min TTL, service-role only, no client RLS policies), and returns `{ code, url }`. The modal renders the URL as a QR code (via `qrcode` npm) plus the short code as a typing fallback. Scanning lands the user on `/m/[code]` where a mobile-optimized chat (`MobileChat.tsx`) re-hydrates the prior thread and mints a fresh session id so the phone conversation continues independently of the kiosk. The kiosk's 60s inactivity timer is paused while the modal is open (the user is scanning the code from their phone, away from the kiosk's pointer/touch surface).

Hero text adapts to mode: `Orlando International Airport` (home) / `You're at MCO` (invenue) / `Welcome to MCO` (kiosk). Kiosk variant bumps hero + tile + glance-item sizes for touch.

Implementation: the UiHint union has a `WelcomeHint` variant (`type: 'welcome'`, optional `mode`); `HintRenderer` accepts a `mode` prop and dispatches `welcome → WelcomeCard` while injecting the active mode. The extractor never emits this hint (deliberate — `validateHint` rejects it); it exists purely so `HintRenderer` can render the default state via the same union.

Demo hints are now mode-specific (`MODE_CONFIG[mode].demoHints`). Kiosk cycle: welcome → terminal map → restaurants → MCO Reserve (4 cards, no parking). Home/invenue cycle: welcome → terminal map → restaurants → parking → MCO Reserve (5 cards).

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

## 10. Prompt source of truth

The hint extractor system prompt is exported as `UI_HINT_EXTRACTOR_PROMPT` in `lib/uiHints.ts`. It covers four hint types (`terminal_map`, `parking`, `restaurants`, `link_card`), the active-context honoring rules, the NO-STRETCH discipline, the `revert_canvas` signal, the `next_chips` follow-up rules, and the link_card cta_url allowlist (MCO Reserve, Visitor Pass, Accessibility, MCO App, Customs, Wi-Fi, Ground Transportation, Lost & Found).

Previous revisions of this spec carried a verbatim copy; it drifted from the source every commit and added no value over `git show HEAD:lib/uiHints.ts`. Read the file.

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
  - **Commit 2 LANDED 2026-05-21** — `lib/uiHints.ts` extractor (`extractUiHints`, `validateHint`, `parseExtractorJson`, `buildExtractorInput`, `UI_HINT_EXTRACTOR_PROMPT`) with the verbatim prompt from §10, dependency-injected classifier (mirrors `lib/languageSwitch.ts` for testability). New `POST /api/bots/[id]/ui-hints` sibling endpoint with the same CORS/rate-limit posture as `/chat`. 31 unit tests (`tests/unit/uiHints.test.ts`) — empty input, malformed JSON, code-fenced output, all four hint types, open-redirect guard on link_card cta_url, classifier throw, oversized-string truncation. Uses `callAI` tier=fast (~$0.0003-0.0006/call). Usage logged with `event_type: ui_hint_extract`.
  - **Commit 3 LANDED 2026-05-21** — frontend wired to the extractor. `ChatPane` fires `POST /api/bots/[id]/ui-hints` fire-and-forget after each assistant reply, surfaces the hint via `onHintReceived` callback. `CanvasShell` maintains `liveHint` state separate from `demoIdx`; live hint wins when present, demo hint otherwise. Demo strip arrow buttons + keyboard arrows clear liveHint so the demo can take back control mid-session. Mode change clears liveHint. Subtle shimmer bar at the top of the canvas card during extraction (`extracting-bar` CSS). `middleware.ts` extended to bypass CSRF on `/api/bots/[id]/ui-hints` (same posture as `/chat`).
  - **Commit 4 LANDED 2026-05-21** — live data integrations. `lib/parking.ts` talks to the GOAA public API at `api.goaa.aero/parking/availability/MCO` + `/parking/rates/MCO` (discovered via Playwright network sniff on flymco.com/parking-availability — the `api-key` is the public site key shipped in flymco's frontend JS, not a secret). 60s in-memory cache, in-flight dedup. `lib/places.ts` wraps Google Places API (New) Basic SKU with graceful degradation to context-scoped mock data when `GOOGLE_PLACES_API_KEY` is unset. Two new public routes: `GET /api/mco/parking`, `POST /api/mco/places`. `ParkingCard` + `RestaurantsCard` now fetch live data on mount; both cards label themselves as "Sample" or "Live" so the demo is honest about which is which. `middleware.ts` adds `/api/mco/*` to `PREFIX_BYPASS`.
  - **Commit 5 LANDED 2026-05-21** — brain commit (extractor scope + revert path). `lib/uiHints.ts` adds `ExtractorContext { activeTerminal, lastCanvasType }` threaded into the classifier via a CONTEXT preamble in `buildExtractorInput`; `ExtractorResult` gains `revert_canvas: boolean`. Prompt rewrite: explicit NO-STRETCH rule ("if no card cleanly fits, return hint:null"), active-terminal honoring directive ("stay within active_terminal for restaurants/parking unless the user explicitly references another"), revert_canvas signal ("set true when the new turn is clearly unrelated to last_canvas_type"), link_card cta_url allowlist extended with `https://flymco.com/speed-through-mco` for security-wait questions, `/ground-transportation`, and `/lost-and-found`. `/api/bots/[id]/ui-hints` route accepts the `context` body field (sanitized — activeTerminal must be A/B/C, lastCanvasType must be a known hint type) and returns `revert_canvas` in the response. `ChatPane` receives an `activeContext` prop and threads it into each POST; on `revert_canvas: true` it calls `onHintReceived(null)` so CanvasShell falls back to the idle welcome card. `CanvasShell` derives `activeContext` from the currently-rendered hint (terminal_map.to/from/terminal, restaurants.context terminal_X_airside, parking single garage_x) with invenue mode's structural Terminal B as a fallback. 16 new unit tests covering CONTEXT plumbing, revert_canvas signal, non-boolean coercion, and the prompt-text invariants. Total 47 passing. §10 of this spec dropped its verbatim prompt copy in favor of pointing at `UI_HINT_EXTRACTOR_PROMPT`.
  - **Commit 6 LANDED 2026-05-21** — link_card modal across all modes. New `LinkCardModal.tsx` component. `LinkCard.tsx` replaces its `<a href target=_blank>` CTA with a `<button>` that opens the modal; local `useState` for open/close, no portal (fixed overlay is enough on a single-page route). `HintRenderer` now passes `mode` to `LinkCard`. Esc + backdrop click + X button all close. Kiosk gets a 60s inactivity auto-dismiss and a bigger panel (920×var, 18px body, 30px title, 96px hero glyph) so a wall-display reader can scan it from a few feet back. The "Open full page on flymco.com" escape hatch link is hidden in kiosk (no keyboard/login on a wall) and shown in home/invenue (new tab). 47/47 uiHints tests still pass; tsc clean.
  - **Commit 7 LANDED 2026-05-22** — cuisine-icon emoji overlay on restaurant cards. `lib/places.ts` exports `cuisineIcon(name, primaryType)` mapping name+primaryType to a cuisine emoji via name-priority rules (Chick-fil-A → 🐔, Wine Bar George → 🍷, Shake Shack → 🍔, etc.) with primary_type fallback. `PlaceCard` interface gains `cuisine_icon: string` and `logo_url: string | null` (scaffolded for a future brand-asset curation pass). Both fields populated in `livePlacesForContext` and `fetchOne`. `RestaurantsCard.tsx` renders the icon centered on the gradient photo block; CSS adds `.cuisine-icon` (28px, drop-shadow) with kiosk override (34px).
  - **Commit 8 LANDED 2026-05-22** — kiosk welcome card overhaul + mode-specific demo hints. WelcomeCard kiosk mode swaps the parking block for a 2×2 "At a glance" grid (Wi-Fi · APM train · MCO Reserve · Ground transport → later Power & charging). Quick-action tiles also mode-specific. `DEMO_HINTS` becomes `MODE_CONFIG[mode].demoHints` — kiosk gets a 4-card cycle (no parking, since you're already inside), home/invenue stay 5-card. Mode-switch demoIdx clamp prevents out-of-bounds index.
  - **Commit 9 LANDED 2026-05-22** — parking 3-pick recommendation layout + kiosk tile update. When `/api/mco/parking` returns lot rows but with null available/total counts, ParkingCard renders 3 picks (⭐ RECOMMENDED, 💰 BEST VALUE, ⚡ QUICK ACCESS) with `lotNote()` derived from category/terminal instead of a wall of "Status: Open · $24/day". Live-counts path unchanged. Kiosk tiles updated to Shopping · Food & Drinks · Security · Ground Transport.
  - **Commit 10 LANDED 2026-05-22** — clickable welcome tiles. Tiles converted from `<div>` to `<button>`. `CanvasShell` holds a `pendingMessage` state; `WelcomeCard` accepts an `onTileClick` callback; `ChatPane` watches `pendingMessage` via useEffect and calls `send()`. Each tile + glance item now triggers the chat directly when tapped.
  - **Commit 11 LANDED 2026-05-22** — extractor terminal_map over-fire fix + glance item polish. `terminal_map` rule in `UI_HINT_EXTRACTOR_PROMPT` tightened to navigation/wayfinding ONLY; the prompt explicitly states the assistant's answer (not a terminal word in the user message) determines card type. Counter-example added for the dining-mention case. KIOSK_GLANCE items become clickable buttons with `prompt`; Ground Transport removed (was duplicating Quick Actions); replaced with Power & charging.
  - **Commit 12 LANDED 2026-05-22** — chat markdown rendering + Clear button + kiosk 60s auto-reset. Inline `renderMarkdown` in ChatPane handles `[text](url)` + `**bold**` so the agent's markdown links stop appearing as raw text. New topbar Clear button wipes the thread + mints fresh sessionId + reverts canvas to welcome. Kiosk mode auto-fires Clear after 60s of pointer/keyboard/touch inactivity (matches LinkCardModal kiosk dismiss). Home/invenue exempt.
  - **Commit 13 LANDED 2026-05-22** — broad flymco.com KB crawl + anti-deflection prompt + branded favicons. `scripts/_mco_scrape_pages.mjs` Playwright-crawls 83 traveler-facing flymco.com pages (12 FAQ, accessibility, Wi-Fi, lost & found, concierge, security, customs, 18 ground-transportation, all parking lots, airlines, Orlando-experience). `scripts/_mco_seed_pages_kb.ts` produces 134 chunks (≤2000 chars, sentence-aware splitting for oversized blocks; 28k-char safety truncation before embedding). Source-tag `mco_pages_scrape_2026_05_22` for idempotent re-runs. `scripts/_mco_tighten_prompt.ts` rewrites personality + system_prompt to prefer KB inline over flymco.com URL redirects + adds 4 new guardrails (9 → 13) reserving the +1-407-825-3177 number for emergencies. `scripts/_mco_probe_deflection.ts`: 10/10 deflection-prone probes (bookstores, charging, terminal-A dining, lost & found, nursing rooms, smoking, etc.) answered inline post-update. Branded favicons via `app/demo/mco/icon.tsx` (static ✈️ on MCO blue) + `app/b/[slug]/icon.tsx` (dynamic per-bot icon from config.avatarLetter + config.avatarGradient).
  - **Commit 14 LANDED 2026-05-22** — "Continue on your phone" QR handoff. New `mco_handoff_sessions` table (`sql/086`) with 6-char Crockford-b32 code PK, 15-min TTL, RLS-on with no client policies (service-role only). `POST /api/mco/handoff` persists `{session_id, bot_id, messages}` (sanitized: ≤50 turns × 4000 chars), returns `{code, url}`. Modal (`QRHandoffModal.tsx`) renders QR via `qrcode` npm; empty/loading/ready/error states. Mobile pickup page `/m/[code]` looks up the snapshot via service role and renders `MobileChat.tsx` (re-hydrates thread, mints fresh session_id, mobile-optimized UI). Kiosk inactivity timer pauses while modal is open. Send-to-phone button: amber pill with "Send to phone" label (kiosk gets the bigger 48px treatment); hidden via `@media (max-width: 900px)` on non-kiosk modes (you're already on your phone).
  - **Commit 15 LANDED 2026-05-22** — "Common Searches" header above initial chip suggestions. The opening pill row gets a small uppercase label. Follow-up chips (from `liveChips` after a turn) skip the header since they're contextual, not generic searches.
  - **Commit 16+ (future)** — real brand logo curation pass (hand-curated SVGs in `public/mco/logos/` to populate `logo_url`; cuisine-icon emoji already ships as fallback); polished terminal SVGs with gate pins; public API access (gated on Phase 4 convergence completing); kiosk hardening (touch sizing, attestation); production deployment URL; periodic cleanup cron for expired `mco_handoff_sessions` rows.
- **Demo target:** TBD — driven by MCO opportunity timeline.

## 15. Decoupled extractor architecture (Commit 2 change vs. §6.1)

Original §6.1 proposed extending the chat route to emit `ui_hints` inline. **Revised:** the extractor lives in a sibling endpoint, `POST /api/bots/[id]/ui-hints`, that the frontend calls after each chat turn. Inputs: `{ userMessage, assistantMessage }`. Output: `{ ui_hints: UiHint[] }`. Three reasons:

1. **Zero conflict with Phase 4 convergence** — the chat route is untouched. Phase 4 commit 1 already extracted the route into `lib/chatCore.ts`; we don't have to coordinate with that refactor.
2. **Chat latency unchanged** — the canvas card appears a beat after the assistant message rather than the assistant waiting on a second LLM call.
3. **Easy to fold in later if desired** — once `chatCore.ts` settles, the extractor can move inside without breaking the response shape (the optional `ui_hints` field stays additive).

The verbatim hint extractor system prompt from §10 is unchanged.
