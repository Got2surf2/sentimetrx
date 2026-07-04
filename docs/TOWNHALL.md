# Town Hall Module

**Last reviewed:** 2026-05-15 (spec audit pass 2 of 14 — see `[[project-spec-audit-queue]]`)

> User-facing name is **PulseIQ**. Internal code names (`/api/townhall/*` routes, `components/townhall/*`, `townhall_participant_responses`) are kept as-is; the facilitator console URL renamed `/townhall` → `/pulseiq` (2026-07-04, permanent redirects; route dir `app/pulseiq/*`). The legacy `townhall_sessions/themes/turns` tables were dropped at the end of convergence tranche 2 (sql/153). See `[[feedback-product-naming]]`.

> **Update (2026-06-03) — public participant URL moved `/th/[sessionId]` → `/pi/[sessionId]`** (route dir `app/th/` → `app/pi/`). The short `/th` ("town hall") prefix is **reserved for the new recordings-based Town Hall product**; PulseIQ participant/live links now use `/pi` ("PulseIQ"). No back-compat redirect — done while there were no live sessions. The facilitator console later renamed `/townhall` → `/pulseiq` (2026-07-04); `/api/townhall/*` endpoint paths are unchanged.

## Overview

Live group feedback sessions with AI moderation. Participants chat anonymously with a bot that rotates through discussion topics, probes for deeper insights, and detects emerging themes in real-time. Facilitators monitor via a live console with topic cards, sentiment tracking, and organic topic discovery.

### Pacing modes (`config.pacing_mode`)

- **`open`** (default) — the existing free-flowing model: participants are assigned starting topics and the engine rotates them through the pool at their own pace.
- **`rounds`** — moderator-gated tasting-kitchen variant. Each round is one item being served/tasted; topics carry a `round` number (`TownHallGuideTopic.round`) and round metadata lives in `config.rounds[]` (`TownHallRound`: `{number, item_name, item_photo?}`). On activation, round 1 topics seed `active` and later rounds seed `paused` (`round_number` — sql/140 legacy, sql/149 `pulseiq_topics`); the moderator advances the room one round at a time and participants hold between rounds. Solves the "speed-runner fills the whole survey before tasting everything" problem. Originally built on the legacy `townhall_sessions` substrate; tranche 2 (2026-07-03) moved the moderator round-advance onto `pulseiq_sessions`/`pulseiq_topics`.
  - **Phase 1 (model layer):** config/types + `round_number` column + round-gated seed-on-activate. Open-mode starts do not reference `round_number`, so sql/140 is only required once rounds mode is used.
  - **Phase 2 (creator UI, current):** `app/pulseiq/new/NewSessionClient.tsx` — a **Conversation style** toggle (open vs round-based tasting) on the Basics step; in rounds mode the Topics step groups question cards under **rounds** (each = a tasting item with `item_name` + optional `item_photo`), with per-round "+ Add question" and "+ Add Round". Removing a round renumbers the rest contiguously. The flat `discussion_guide` is preserved (each topic carries `round`); round metadata persists in `config.rounds[]`. Each question card has a **"Move to round"** dropdown (when >1 round) for cross-round reassignment; AI "Generate from Description" in rounds mode **appends** to round 1 (preserves existing rounds) so generated questions can then be distributed via the move control.
  - **Phase 3 (moderator control + engine gate, current):**
    - **`POST /api/townhall/sessions/[id]/round`** body `{round: N}` — completes any still-active earlier-round seed topics (`round_number < N`, `source='seed'`) and activates round N's topics from their paused seed. Tranche 2 (2026-07-03): operates on `pulseiq_sessions` + `pulseiq_topics`. Org-gated inline via the session row's `org_id`. Cross-org gate covered by `tests/integration/townhall-mutation-gate.test.ts` (401/400/404/200 + admin bypass), per the multi-tenancy invariant.
    - **Round-aware standby gate** in `chat/route.ts`: when `pacing_mode==='rounds'` and all currently-active topics are covered, the engine now emits a round-hold standby **whenever later (paused) rounds remain — regardless of `theme_detection_mode`** (rounds mode runs with detection off). On the participant's next turn after the moderator advances, `pickNextTopic` routes them into the now-active round. Open mode keeps the original organic-only standby behavior.
    - **Unified-engine parity (convergence item 1, 2026-07-03):** the same round-hold gate now exists in `lib/chatCore`'s town-hall layer for the new substrate — `pulseiq_sessions.cohort_config.pacing_mode='rounds'` + later `paused` seed topics in `pulseiq_topics` (`round_number` via sql/149) → round-hold standby hint + `roundHold` on the result, returned as `round_hold` by the Phase-4 shim. Vocabulary mapping: legacy `source='guide'` = new-schema `source='seed'`. Live-verified on the test project (CONVERGENCE §4.2).
    - **Console control** (`app/pulseiq/[sessionId]/SessionDetailClient.tsx`): a "Tasting Rounds" strip at the top of the Topics tab (active sessions only) showing each round's status (done/live/pending) + item name + response count, with a primary **"Start Round N — {item}"** button that advances the room.
  - **Phase 4 (participant hold screen, current):** the chat response now carries a `round_hold` flag (set only on the round-hold standby; distinguishes it from the disengagement "chill" standby). When held, `pi/[id]/TownHallChat.tsx` renders a branded **hold card** ("Waiting for the next item…") in place of the input and polls **`POST /api/townhall/resume/[sessionId]`** every 4s. That endpoint is isolated from the main chat handler (no AI — just the shared `pickNextTopic` over the participant's undiscussed active topics): once the moderator advances and the next round's themes are active, it serves that round's question as a real bot turn and returns it (`{holding:false, bot_message, theme_id, turn_number}`); otherwise `{holding:true}`. The participant's next answer threads onto that turn normally. On the final round (no paused rounds left) the engine wraps up with the closing message. The resumed question carries a deterministic item-aware lead-in ("Now for {item} — {question}") when the round has an item name — no AI call, keeps the poll fast.
  - **Phase 5 (round-grouped exports, current):** `export/route.ts` + `export/pptx/route.ts` read `round_number` + `config.rounds[]`. **In rounds mode only** (open-mode exports are byte-identical): the Responses CSV/XLSX gains `round` + `item` columns; the Themes sheet gains `round`/`item` and is sorted by round; the JSON carries `round` per turn + `round`/`item` per theme; the **PPTX inserts a section-divider slide per round (item name + theme count) followed by that round's theme cards** — the per-item qualitative roll-up deliverable. *QC note:* the PPTX divider needs a visual pass against a real rounds session (deck-credibility rule).
  - **Pilot status: COMPLETE (P1–P5).** Round-based tasting mode is end-to-end: author rounds → moderator gates round-by-round → participants hold/auto-resume → per-item export.

---

## Session Creation (`app/pulseiq/new/`)

### 6-Step Wizard (THCreatorNav)

| Step | Name | What It Configures |
|------|------|--------------------|
| 0 | Basics | Session name, slug, industry, bot name/emoji, session type, expected attendees, org name, event description, opening/closing messages, tone |
| 1 | Seed Topics | Discussion guide — topic cards with label, description, opening question, follow-up angles, keywords, response target |
| 2 | Sensitive Topics | Banned terms (AI-suggested + manual), priority areas |
| 3 | Conversation | Max turns, default response target, AI timeout, testing mode, session end mode, button labels, content safety toggles |
| 4 | Post-Session | Demographic fields, psychographic question bank, sample count |
| 5 | Review | Full config summary, publish |

### AI-Powered Setup
- **Generate Discussion Guide** — AI creates 4-8 topics from event description + industry
- **Per-Topic Generate** — Fill description, question, keywords, follow-up angles from just a label
- **Suggest Sensitive Topics** — AI recommends 4-8 categories with pre-expanded terms
- **Staged Keyword Expansion** — S (similar word forms) and A (associated terms) toggle buttons on every keyword and sensitive topic pill
- **Description Grading** — Real-time 1-5 quality score on event description

### Underlying agent (optional) — Step 0 picker + Step 1 import button
The facilitator can optionally link the session to one of their existing agents via the **Underlying agent** dropdown on Basics. Stored in `config.bot_id_link`; `pulseiq_sessions` carries the canonical link in its own `bot_id` column.

When linked, Step 1 shows an **Import focuses from agent** action that appends each enabled `BotFocus` as a starter `TownHallGuideTopic` (`focus.label → topic.label`, `focus.description → topic.description`; `opening_question` left blank for the facilitator to author — the topic-step validation still requires it). Skipped by default — the user has to opt in, so import is a conscious decision (memory: `project_nowocats_town_hall_launch`). If the placeholder topic is still empty, the import replaces it; otherwise it appends.

### Activation gate (`lib/townhallActivationGate.ts`)
A session cannot transition from `setup → active` until **both** rules pass:
1. `discussion_guide` has at least one enabled topic with a non-empty `label` and `opening_question`.
2. `config.context.event_description` grades ≥ 3 ("Adequate") on the 1-5 grader. The grader snapshot is stored in `config.event_description_grade = { score, suggestion, graded_text, graded_at }` and re-used by the server gate **only when `graded_text` matches the current description verbatim** — editing the description invalidates the snapshot and forces a re-grade.

The PATCH path in `/api/townhall/sessions/[id]` (`handlePhase3Patch`) calls `checkActivationReadiness()` before flipping status to active/live, and return `400 { error, readiness: { ready, topics_ok, description_ok, description_score, missing[] } }` on failure. The facilitator console (`SessionDetailClient.tsx`) mirrors the gate client-side — the Start button is disabled and lists the missing reasons inline beneath it, and the server's `readiness.missing[]` is appended to the action-error toast if the user still tries to start.

### Session Types
community, employee, customer, student, member, other — drives AI tone and peer references

---

## Facilitator Console (`app/pulseiq/[sessionId]/`)

> **Phase 5 commit 6 (2026-05-22):** the facilitator dashboard surfaces (`/api/townhall/sessions` list + `/api/townhall/sessions/[id]` detail) accept new-substrate `pulseiq_sessions` rows. `lib/townHallAdapter.ts` projects `pulseiq_sessions` + `pulseiq_topics` + `pulseiq_session_conversations` + `conversations` + `conversation_turns` into the same JSON shape `SessionDetailClient` already consumes — the dashboard renders both substrates identically. Status maps `draft|live|paused|closed` → `setup|active|paused|ended`. **Full analytics parity since 2026-07-04:** the `?analytics=true` pipeline (keyword regex, sentiment, time-series, top keywords, example quotes, topic shifts, sentiment trends) was extracted verbatim into pure `lib/townhallAnalytics.computeSessionAnalytics`, which BOTH the legacy branch and the phase-3 adapter now call — the adapter feeds it `fetchTurnsAsLegacy` projections, so `TownHallAnalyticsPanel` renders identical analytics on either substrate. (The old phase-3 empty shell also had the wrong shape — top-level fields instead of the `analytics` object the panel reads — so new-substrate sessions showed a blank panel.) The legacy branch's turns fetch also gained `fetchAllRows` paging — it was PostgREST-capped at 1000 turns.
>
> **NOWOCATS readiness (2026-05-22):** the participant + facilitator-mutating routes also now accept phase-3 town halls (NOWOCATS is the first PulseIQ town hall on the new substrate, launching early June; Sarina is the agent). Surfaces wired:
> - `/api/townhall/join/[sessionId]` GET + POST — resolves `pulseiq_sessions` by slug or id; POST skips the legacy `townhall_turns` opener insert (chatCore handles the first turn pair on the participant's first chat message).
> - `/api/townhall/live/[sessionId]` GET — serves entirely from the new substrate (tranche 2, 2026-07-03: legacy leg retired). Stats + sentiment from `conversation_turns` (stored per-turn sentiment, lexicon fallback); per-topic keyword matching, top keywords and Trending Now now computed at full legacy parity. Bracketed markers (`[Skipped …]`, `[filtered]`, `[Language switch …]`) count as skips / are excluded from answers.
> - `/api/townhall/themes/[id]` POST — `pulseiq_topics` only (tranche 2, 2026-07-03: legacy `townhall_themes` fallback retired). `sql/082` extended `pulseiq_topics.state` CHECK to accept the full legacy vocab so the existing dashboard state machine works as-is.
> - `/api/townhall/themes/custom` POST — writes to `pulseiq_topics` with `source='manual'` (tranche 2: legacy branch retired).
> - **Topic continuity + trending quality (owner dry-run findings, 2026-07-03):** a substantive on-topic answer no longer ejects the participant from the topic — the per-topic cap (2–4 assistant turns by substance) previously gated only clarifiers, so one rich reply marked the topic "discussed" and the picker rotated ("asked, answered, jumped"). New binding continue branch: under the cap with no move-on/disengage signals, the engine STAYS and builds on their words; rotations must acknowledge the prior answer in one sentence (never "we're actually focused on X"). Live-verified 4/4 (`scripts/_verify_continuity.ts`). Trending Now is now SEMANTIC (owner feedback: word frequency surfaced typos and generic words, "not things of potential interest"): a fast AI pass extracts up to 5 short phrases of NEW specific interest from the recent window (excluding planned topics), cached 60s per session (one AI call/min regardless of viewers; `event_type='trending_extract'` in usage logs); the word-count heuristic (≥2 distinct conversations when the room has >1 voice, topic label/keyword words suppressed) is the fallback. Transition tone rule hardened: the participant's prior answer was PROMPTED — engaging with its substance is mandatory before any topic bridge; dismissive framings ("before we go deeper on that…", "back on track") are explicitly forbidden.
> - **Dedicated-agent lifecycle (review fixes, 2026-07-03):** sessions POST/duplicate create the backing agent with `status='paused'` + `config.pulseiq_dedicated=true` — never served by the public `/b` path; the PulseIQ chat shim resolves it by `bot_id` with **no agent-status gate** (session status governs, so pausing the agent in the Agents UI cannot 404 a live room); session DELETE removes the dedicated agent (marker-gated — a linked real agent is never deleted); `-agent` slug collisions retry with a random suffix. Language-switch exchanges are stored `source='language_switch'` and excluded from the participant turn cap + opening-response counting. Over-length answers (`too_long`) get a polite trim ask — no `[filtered]` audit trail. The sessions list keeps a read-only legacy leg until the drop commit and 500s on query error instead of rendering an empty list. All multi-row town-hall reads page via `fetchAllRows` (PostgREST silently caps single selects at 1000 rows).
> - `/api/townhall/sessions/[id]` PATCH — `handlePhase3Patch` supports status change (with seed-on-activate copying `discussion_guide` into `pulseiq_topics`), discussion_guide sync (add / pause / reactivate / dismiss), restart (wipe conversations + drop auto_detected), reanalyze (call `detectThemesForTownHall`), delete_participants (cascade through `conversations`). **Slug edit + org transfer stay legacy-only by design** — once a phase-3 town hall has its participant URL printed on postcards / QR codes / signage, renaming the slug 404s every offline reference. The route returns `405 — slug edit on phase-3 town halls not yet supported` if the body carries `slug`; the facilitator UI's `Participant Link` input is rendered `readOnly` on phase-3 substrate (with a "URL is locked" caption) and the Save handler no longer sends the field unless it actually changed. To re-enable safe renames, a follow-on commit would (a) add a `previous_slugs text[]` column on `pulseiq_sessions`, (b) push the current slug onto that array on update, (c) extend `app/pi/[slug]/page.tsx` to fall back to `... where $1 = any(previous_slugs)` and 301 to the canonical slug.
> - `/api/townhall/sessions/[id]` DELETE — phase-3 cascade through `conversations` → drop `pulseiq_sessions`.
>
> **#5 wired (2026-05-22)**: `/api/townhall/sessions/[id]/analyze` now substrate-aware — phase-3 town halls sync into Ana via `pulseiq_session_conversations → conversations → conversation_turns`, paired-user-turn shape identical to legacy + bot-level analyze. Datasets can be combined in Analytics for multi-event rollups (e.g. all Vindman events). Theme model populated from `pulseiq_topics`. Same `DatasetRow` schema regardless of substrate.
>
> **PPTX in the Export menu (2026-07-03, owner-found):** the list page's Export button only offered CSV/Excel — the session summary deck route existed but was unreachable except via a link inside the conversation modal. `DownloadButton` now takes a `formats` prop; the PulseIQ list offers CSV / Excel / PowerPoint deck (PPTX POSTs to the deck route). Also: export `turn_number` now counts EXCHANGES per participant (1,2,3,… — one row = bot message + reply) instead of leaking the mirror's per-message indexes (0,2,4,…), and the row's `source` comes from the assistant side so clarifier/standby/deflect are visible.

> **Export route fully on the new substrate (tranche 2, 2026-07-03)**: `/api/townhall/sessions/[id]/export` resolves `pulseiq_sessions` only (uuid or slug). CSV/XLSX/themes branches consume `fetchTurnsAsLegacy` (adapter projection of `conversation_turns` into the legacy `townhall_turns` row shape — user turns paired with the preceding assistant turn, `[Skipped …]`/`[filtered]` markers → `skipped=true`, trailing unanswered questions emitted with a null `user_message`) and `fetchTopicsAsThemes` (pulseiq_topics → legacy theme shape). The json branch keeps its conversation_turns pairing with `bot_flags` + `user_flags` + `user_sentiment` + per-participant `name`/`persona` from `agent_session_personas` (the 2026-05-22 Gap #5c block, now the sole source — the legacy seeding loop was removed to avoid double-counting). Post-session responses read by `town_hall_id`.
>
> **Facilitator modal — pills + persona bar (2026-05-22)**: `SessionDetailClient.tsx` `convModal` state extended with `name` + `persona`. Modal header shows "with {name}" when persona has a name; persona bar (teal) between header and turns showing life_stage / occupation / industry / location_type / communication_style + concerns list; per-turn `bot_flags` rendered as pills under assistant bubbles, `user_flags` under user bubbles, using the shared `getFlagStyle()` from `lib/flagStyles.ts` (focus: teal, topic: amber, intent: blue, safety flags by severity).
>
> **#5b wired (2026-05-22)**: `/api/townhall/responses` POST is now substrate-aware. `sql/083` adds a nullable `town_hall_id` column to `townhall_participant_responses` + CHECK constraint enforcing one of the two substrate refs + partial unique indexes for both substrates. Route validates participant via `townhall_turns` (legacy) or `pulseiq_session_conversations → conversations.participant_id` (phase-3), then upserts to the right column. NOWOCATS has no post-session questions configured today so this is future-proofing — but any new phase-3 town hall with `psychographicBank` / `demoFields` works correctly now.
>
> **Followup (#6)**: bot-level analyze does not surface `town_hall_id` on rows — cross-event filtering in Ana requires combining per-event datasets. ~20-min change to add the join + columns. Not blocking.
>
> **Prod env gate**: `TOWNHALL_VIA_AGENT_HANDLER` must be true in Vercel env for the chat handler to use the unified path on `/api/townhall/chat`. Without it, the legacy 995-line orchestrator runs and the phase-3 experience is dark in prod.
>
> See `docs/CONVERGENCE.md` § 10 changelog for the full trail.

### Three Tabs
1. **Topics** — Live topic cards with actions
2. **Responses** — Participant list, conversation viewer, bulk delete. Per-session participant + response counts come from `townhall_session_counts_for_ids` (sql/146, aggregated in Postgres) — the prior `.in()` turn fetch was capped at 1000 rows and silently undercounted once an org's listed sessions exceeded that. The public `POST /api/townhall/responses` write is rate-limited (per-participant 10/min + per-IP 600/min), matching `townhall/chat`.
3. **Analytics** — Sentiment breakdown, response timeline, topic frequency

### Topic Cards
- **Expanded view**: Donut progress, label, description, sentiment badge, source badge (Seed/Organic/Custom), keywords, example quote, action buttons
- **Compact view**: Small pills with sentiment dot, label, response count — click to open detail popup
- **Toggle**: Compact/Expanded button in section header

### Detail Popup (click any topic)
- Full analytics: sentiment, mention count, percentage, response target
- Keywords with frequency counts
- Matching responses with match reason badges:
  - **AI-assigned** (purple) — AI matched this response to this topic during conversation
  - **keyword: term** (amber) — matched via keyword
- Context-appropriate action buttons per state

### Topic States & Actions

| State | Available Actions |
|-------|-------------------|
| Active | Close, Park, Pause |
| Detected (organic) | Approve, Park, Dismiss |
| Paused | Resume |
| Parked | Activate, Dismiss |
| Completed | Reopen |
| Dismissed | Restore |

### Live Updates
- Lightweight poll every 4 seconds (no analytics — just counts and status)
- Full analytics fetched on-demand when opening detail popup
- Polling stops when session is ended

### Session Controls
- Start / End / Pause / Resume / Restart
- Custom question push (inject ad-hoc question mid-session)
- Grid layout: 1, 2, 3, or 4 column view
- QR code + participant URL in top bar
- Live Screen link

---

## Chat Engine (`app/api/townhall/chat/route.ts`)

> **Phase 4 commit 2 (2026-05-21):** the route also carries an opt-in delegation branch gated by `TOWNHALL_VIA_AGENT_HANDLER` (env, default OFF). When the flag is ON AND `session_id` resolves to a `pulseiq_sessions` row (uuid or slug), the route bypasses the legacy 20-step pipeline below and delegates to `lib/chatCore.handleChatTurn` — the shared chat-core that also powers `/api/bots/[id]/chat`. PulseIQ-specific features (response counter, language switch, auto-end, standby) are NOT carried into this path; they get rebuilt on the unified substrate in Phase 5. With zero `pulseiq_sessions` rows in production today, the new path is dark on the way in — it activates only after Phase 6 creates the first row pointing at an existing agent. See `docs/CONVERGENCE.md` § 4.
>
> **Phase 5 commit 3 (2026-05-21):** topic assignment IS now carried into the new path. `handleChatTurn` reads `pulseiq_topics` for the town hall, tallies cohort-wide response_count from `pulseiq_session_conversations` → `conversations` → `conversation_turns.topic_id`, builds participant-specific `discussedTopicIds`, calls `lib/pickNextTopic`, and injects a "TOWN HALL TOPIC FOCUS" instruction into the system prompt. The chosen `topic_id` is stored on both turns of the pair via `mirrorTurns` (which also auto-links the conversation to the town hall via `pulseiq_session_conversations` and populates `conversations.participant_id`). Theme aggregation cron from Phase 5 commit 1 (`lib/cohortThemeAggregator.ts`) reads from the same substrate and writes back new topics — closing the cohort loop.
>
> **Phase 5 commit 4 (2026-05-21):** standby + inline trigger. When `pickNextTopic` returns `all_covered`, a TOWN HALL STANDBY instruction is pushed instead so the AI closes gracefully (custom `cohort_config.standby_message` honored). The branch also fires `detectThemesForTownHall` fire-and-forget when cohort-wide response_count crosses `cohort_config.theme_detection_every_n_responses` (default 20) — matches the legacy chat-route inline trigger so live sessions discover themes faster than the 15-min cron cadence.

### Processing Pipeline (per message)

1. **Rate limit (dual)** —
   - Primary: **20 req/min per `participant_id`** (the normal cap for one human)
   - Backstop: **600 req/min per IP** (sized for ~200 attendees on one NAT'd venue wifi — an IP-only cap would throttle the whole room after one volley)
2. **Session resolve** — UUID or slug lookup against `townhall_sessions`
3. **Auto-end check** — Timed (`duration_minutes`) or inactivity (`inactivity_timeout_minutes`) mode flips status → `ended`
4. **Status check** — Return closing message if ended/paused
5. **Content safety** — Strike-based escalation (warn → firm warning → shutdown) via `lib/contentGuard.ts`
6. **Language switch detection** — Hybrid: fast regex first, then AI classifier at >=95% confidence; bilingual confirmation + previous bot message translated
7. **Translation** — Non-English input translated to English; stored in `user_message_en` for analysis
8. **Sentiment scoring** — Every non-skipped user turn gets `sentiment` (label) and `sentiment_score` columns via `scoreSentimentFull()`
9. **Response counter + auto theme detection** — Counter incremented **atomically** via `increment_townhall_response_counter` (sql/144, returns the new value) — a live town hall is peak concurrency, and the old read-modify-write undercounted; if `theme_detection_mode='auto'`, detection fires every N responses (fire-and-forget) off the returned counter
10. **Deflection** — Smart off-topic/sensitive topic detection (see below)
11. **Move-on signal** — Fast regex (`/^(stop|enough|next|move on|done|skip|pass)/i`) — zero AI cost; immediately skips clarifier
12. **Subtle disengagement AI tone check** — When a clarifier would trigger on a borderline phrase (`ok`, `sure`, `whatever`, `idk`, `not really`, etc.), AI classifies `move_on` vs `clarify`; defaults to `move_on` on AI failure (don't annoy participants). Fast path: skip the AI call entirely if 2+ consecutive curt responses
13. **Topic matching** — Opening response matched to best available theme via AI + keyword fallback
14. **Clarifier** — Short/vague responses get AI follow-up (frustration-aware cap)
15. **Smart probe** — Before the default "fewest responses" pick, scan the user's message for any keyword belonging to another available topic; if matched, jump to that topic instead
16. **Next topic** — `lib/pickNextTopic.ts` (Phase 5 commit 2 extraction; pure function shared with the unified handler): filter under-target topics not yet discussed, fall back to over-target if all under-target are covered, smart-probe via keyword match in the current message (skips the current `theme_id`), default to first available (caller pre-sorts by `response_count` ascending). The legacy route still wraps this with seed-budget-exhausted preference (`preferOrganic`) and standby/wrap-up handling.
17. **Global checkout / chill standby** — If recent 3 responses all curt or 2 of last 3 skipped, switch to `source='standby'` with a chill message instead of pushing more topics
18. **All-topics-covered standby** — If every topic has been visited but organic detection is on and turns remain, return a standby message so the participant can be circled back when new topics emerge
19. **Wrap-up** — At turn cap (or all topics + no organic mode), transition to post-session survey
20. **AI refusal scrub** — `looksLikeAIRefusal()` (lib/guardrails.ts) drops "I can't help with that" style outputs so they never reach participants

### Deflection Engine
- **Feedback signals regex** — 80+ words (opinions, emotions, topic-relevant terms)
- **Logic**: deflect when message hits a sensitive topic (regardless of feedback signals), OR when it has no feedback signals AND starts with a question word
- **Sensitive-topic match**: `\b<term>\b` regex against each entry in `config.context.sensitive_topics[]`
- **AI decision**: Claude returns redirect text or `"NONE"` (no redirect)
- **Override**: `config.deflection.message` (if set) replaces the AI redirect
- **CHECK-constraint retry**: stored as `source='deflect'`; on insert failure (legacy schema), retries as `source='clarifier'`

### Curt Detection & Frustration-Aware Clarifier
- Word count <= 3 = curt response
- Declining word counts across last 3 responses = disengaging
- Reduces max clarifiers from 2 → 1 when disengaging or curt
- Dynamic per-topic turn cap: min 2, max 4 (extends to 3 with one substantive response ≥8 words, to 4 with avg ≥10 words across 2+ turns)

### Topic Matching (Opening Response)
- AI matches first message to best available theme from keywords + context
- Keyword fallback (label match, then keyword match) when AI times out or returns invalid JSON
- Even-spread budget: 60% turns for seed topics (`seedBudget = ceil(max_turns_per_participant * 0.6)`); past that threshold, organic topics are prioritized over remaining seed topics

### Prompt Caching
- `baseSystemPrompt` + topic list is sent as a `cache: true` block so the static system prompt is served as cache reads on calls 2+ within the session. Conversation history goes in the dynamic suffix and is not cached. Material cost/latency reduction for sessions with many participants.

### Response Counting
- **Live from turns**: `COUNT(townhall_turns WHERE theme_id=X AND user_message IS NOT NULL AND NOT skipped)`
- No cached counter — single source of truth
- Auto-completion: when live count >= response_target, theme state → completed (manual close also supported by facilitator)

---

## Live Screen (`app/pi/[sessionId]/live/`)

Public presenter display (no auth, aggregate data only):

- **Dark theme**, designed for projection
- **QR code** + participant URL
- **Stats bar**: Participants, Responses, Total Turns
- **Active theme cards**: Donut progress, sentiment, keywords with frequency, example quote.
  - **Seed vs Organic shading**: Seed cards (`source='guide'`) use `#1f2937` background and a blue "Seed" pill; organic cards (`source='auto_detected'`) use `#1e293b` and a green "Organic" pill. No "AI" branding shown — the moderator-facing distinction (planned vs. emerged) is what's surfaced to the audience.
  - Cards only appear once the moderator approves the topic (state → `active`); detected/parked/dismissed are hidden from the public view.
- **Sentiment bar**: Stacked horizontal (positive/negative/mixed/neutral)
- **Auto-refresh**: Every 10 seconds. Fetch is `cache: 'no-store'` with cache-busting timestamp; route response sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.
- **Caching**: The live route historically bypassed Supabase JS with direct PostgREST `fetch({ cache: 'no-store' })` calls to dodge Next.js fetch-cache staleness. The tranche-2 rewrite (2026-07-03) serves from the new substrate via Supabase JS; the route keeps `dynamic = 'force-dynamic'`, `fetchCache = 'force-no-store'`, `revalidate = 0` and the `Cache-Control: no-store` response header.
- **Trending Now strip**: Top 8 phrases gaining traction in the last 5 minutes vs the rest of the session. Computed in the live route via `lib/trendingWords.ts:trendingTerms()` using a smoothed rate ratio (recent rate / baseline rate, with Laplace smoothing). Displayed as orange pills above the topic cards on the live screen.

---

## Participant Chat (`app/pi/[sessionId]/`)

> The chat header's DATANAUTIX wordmark stack carries a tiny `privacy` link → `/privacy` (public privacy notice, 2026-07-03).

> **Idle-participant session end (owner dry-run, 2026-07-03):** the client used to STOP polling once the session went active, so a participant who wasn't mid-message never learned the facilitator ended the session — no closing message was delivered. Now: on activation the 3s status poll downshifts to a 15s end-watch poll; when it sees `ended` while the participant is in the chat phase, the closing message is appended as a bot bubble and the post-session questions start — identical to the `is_final` reply path. Worst-case delivery lag for an idle participant: ~15s.

> **Creator Conversation/Post-Session step parity (2026-07-03, owner-found):** the new-session wizard was missing the **Organic Topic Discovery** control (Off / On Demand / Automatic pills + detect-every-N, `engine.theme_detection_mode`) and the **post-session copy** inputs (`messages.post_session_intro` / `post_session_demo`) that the session-detail editor has; both added. Session-end mode is a pill group (was a dropdown). Deeper fix behind it: the unified engine IGNORED the mode — sessions POST now lifts `theme_detection_mode` to cohort_config top level, and BOTH the chatCore count-trigger and the 15-min cron gate on mode==='auto' (nested `engine.*` fallback for console-edited configs). Previously "Off" still ran automatic detection.

### Chat Phases (state machine in `TownHallChat.tsx`)

The participant client tracks 9 phase states: `pre-psycho`, `pre-demo`, `pre-submitting`, `chat`, `transition`, `psycho`, `demo`, `submitting`, `done`.

The order depends on the **`questionPosition`** config (`'before' | 'after'`):

- **`questionPosition: 'after'` (default)** — Join → Chat → Transition → Psycho → Demo → Submitting → Done
- **`questionPosition: 'before'`** — Join → Pre-psycho → Pre-demo → Pre-submitting → Chat → Done

In both modes:
1. **Join** — Auto-join via `GET /api/townhall/join/:id` (no landing page); receives opening message, slug resolution, demo fields, psycho bank
2. **Chat** — Bot/participant exchange; skip/done buttons; multi-language label switching
3. **Psychographics** — Random N from bank (`psychoCount`, default 3)
4. **Demographics** — Optional configured fields
5. **Done** — Thank-you message

### UX Features
- iMessage-style bubbles (blue user, gray bot)
- Typing indicator (30ms per char, 400-1800ms range)
- Skip/Done buttons (configurable labels, translate on language switch)
- Auto-scroll to latest message
- Emoji avatars on bot messages
- Mobile-optimized (iOS scroll fix)

---

## Theme Detection (Organic Topics)

### Discovery — legacy (`lib/townhallThemeDetection.ts`)
1. Fetch English responses (non-skipped, min 20 chars) from `townhall_turns`
2. Sample evenly (cap 200 for prompt size)
3. AI identifies 2-5 new themes not in existing themes
4. Deduplicate: skip if label collision or >50% keyword overlap
5. Score sentiment via lexicon
6. Compute mention_count via keyword regex
7. Insert into `townhall_themes` as state='detected', source='auto_detected'

> **AI usage attribution (2026-05-22 fix)**: `detectThemesForSession` now SELECTs `org_id` from `townhall_sessions` and passes it to `logUsage` (`event_type='theme_detect'`, `resource_type='townhall'`, `resource_id=session.id`). Previously the org_id was missing — May 15 audit item closed. Phase-3 equivalent (`lib/cohortThemeAggregator.ts`) was already passing org_id correctly. See `docs/USAGE_ACCOUNTING.md`.

### Discovery — new substrate (`lib/cohortThemeAggregator.ts`, Phase 5 commit 1, 2026-05-21)
1. Load town hall + linked agent (`pulseiq_sessions` joined to `agents` via `bot_id`)
2. Fetch user turns across the town hall's conversations (`pulseiq_session_conversations` → `conversations` → `conversation_turns` with `role='user'`, `content_en` || `content` ≥ 20 chars). PulseIQ's `skipped` boolean has no equivalent on the new schema — all user turns are candidates.
3. Sample / AI / dedup / mention-count steps are identical to the legacy version.
4. Insert into `pulseiq_topics` as state='pending', source='auto_detected'. Per-topic `sentiment` is dropped from the schema (per-turn sentiment lives on `conversation_turns.sentiment` instead).
5. Stamp `pulseiq_sessions.last_theme_detection_at`.

The cron (`app/api/cron/townhall-theme-detection/route.ts`) scans only `pulseiq_sessions` (status='live', `cohort_config.theme_detection_mode` defaulting to 'auto') — the legacy `townhall_sessions` scan was retired in tranche 2 (2026-07-03). `lib/townhallThemeDetection.ts` survives until the frozen legacy orchestrator is deleted (its count-based trigger still calls it).

### Trigger
- Auto mode (legacy): every N responses (`config.engine.theme_detection_every_n_responses`, default 20)
- Auto mode (new): cron every 15 min with 10-min cooldown via `pulseiq_sessions.last_theme_detection_at`. Response-count-based trigger from the chat route arrives in Phase 5 commit 3+ when `handleChatTurn` learns about `townHallContext`.
- Manual: "Detect" button in facilitator console (legacy only today)
- Re-analyze: clears all organic themes, re-runs detection (legacy only today)

---

## Analytics

### Session API (`GET /api/townhall/sessions/[id]`)
- **Lightweight** (default): Live response counts, basic theme data
- **Full analytics** (`?analytics=true`): Keyword matching, sentiment scoring, quote extraction with match reasons

> **New-substrate adapter (2026-05-26 fix):** `lib/townHallAdapter.ts::getTownHallAsLegacy` now computes per-participant turn count, first/last activity timestamps, and per-participant topic-coverage count from one `conversation_turns` query (was hardcoded `turns: 0`). Topic cards also overlay **live** counts (when they exceed the persisted column, which is only updated by the async cohort aggregator on a 15-min cron):
> - `response_count` = `count(DISTINCT conversation_id)` of user turns tagged with that topic_id — semantic = "how many participants have weighed in on this topic" (same definition `lib/cohortThemeAggregator.ts` + `lib/pickNextTopic.ts`'s under-target sort use).
> - `mention_count` = total user turns tagged with the topic — a participant who returned to one topic across 3 turns contributes 3 mentions but 1 response.
> The same `perTopic` map populates analytics-mode `themes[].match_count` / `mention_count`.

### List-page card UX (`app/townhall/TownHallListClient.tsx`)
Draft sessions render the four data-dependent buttons (**Analytics**, **Responses**, **Export**, **Analyze in Ana**) with `disabled` styling + tooltips explaining there's no data yet. The status pill flips from muted "Setup" to a vivid orange "Draft" so the reason the buttons are dim is obvious at a glance. Manage / Duplicate / Share / Close-Reopen / Delete / Archive stay live on drafts.

### Enrichment (analytics mode)
- **Seed topics**: Primary = AI-assigned `theme_id` from turns. Keywords supplement.
- **Organic topics**: Primary = keyword regex matching. `theme_id` supplements.
- Each quote tagged with match reason (AI-assigned vs keyword)
- Top keywords with frequency counts

### Stats
- Participants joined, total turns, answered, skipped, skip rate
- Average words per response, average turns per participant
- Post-session survey completion count

---

## Export

| Format | Endpoint | Contents |
|--------|----------|----------|
| CSV | `GET .../export?format=csv` | Responses only: bot/user messages, theme_label, source, language, sentiment, demographics, psychographics |
| XLSX | `GET .../export?format=xlsx` | Single workbook with two sheets — responses + themes (built via `buildThemesSheet`) |
| Themes CSV | `GET .../export?format=themes` | Per theme: label, source, state, sentiment, keywords, response_count, mention_count |
| JSON | `GET .../export?format=json` | Grouped by participant: conversation threads + demographics + psychographics |
| PPTX | `POST .../export/pptx` | Branded deck: title, stats, sentiment, per-theme cards with quotes |

> **Org gate:** both export routes resolve the town hall with the service role, so they verify the caller's `org_id` via `getCallerOrgContext` (admin-org may export any) and return 404 cross-org. Both resolve `pulseiq_sessions` only (tranche 2). See `docs/SECURITY.md` § 2; regression in `tests/integration/export-org-gate.test.ts`.

> The Responses-tab conversation modal (`SessionDetailClient.tsx`'s magnifying-glass button) depends on the `json` branch returning the populated `conversations` array; its per-participant `participants` map feeds `summary.total_turns` directly.

---

## Simulator (`/admin/simulator/townhall`)

### AI-Driven Personas
Responses generated from persona profiles + session topics (not scripted lines). Same persona adapts to any session.

### Generic Packs (5)

| Pack | Count | For |
|------|-------|-----|
| Community | 19 | Municipal, neighborhood, city council |
| Employee | 15 | Workplace, HR, internal feedback |
| Customer | 13 | Product, service, user feedback |
| Restaurant | 14 | Dining, hospitality, food service |
| Stakeholder | 13 | Board, donor, government, vendor |

### Project-Specific Packs

| Pack | Count | For |
|------|-------|-----|
| NOWOCATS (NW Orange County, FL) | 18 | Northwest Orange County Area Transportation Study, PM-2. Geography across Apopka / Ocoee / Winter Garden / Plymouth / Clarcona; one Spanish-language-switcher reflecting Apopka demographics; 4 edge cases (single-issue deer commenter, disengaged teen, anti-gov skeptic, developer-conspiracy commenter) |

### Florida Senate Campaign Packs (5)

A grouped set of regional packs built for the Vindman campaign trial, grouped under `Florida Senate` in the simulator UI. Each pack is geographic and demographic.

| Pack | Count | Coverage |
|------|-------|----------|
| South FL | 15 | Miami / Broward / Palm Beach — Cuban, Haitian, Jewish, Venezuelan, condo, insurance |
| Central FL | 14 | Orlando / Tampa — Puerto Rican, theme-park workers, suburban moms, veterans |
| North FL / Panhandle | 14 | Jacksonville / Tallahassee / Pensacola — military families, fishermen, rural healthcare |
| Southwest FL | 14 | Naples / Fort Myers — Hurricane Ian survivors, snowbirds, golf-course managers |
| College / Youth | 13 | UF / FIU / UCF / FAU students — first-time voters, debt, gun safety, climate |

### Bad Actors Pool (10)
Standalone persona pool that can be mixed into any session to stress-test content safety and disengagement handling: rage typer, spam bot, conspiracy flood, profanity escalator, political troll, racist dog-whistler, harassment creep, all-caps screamer, repeat submitter, subtle underminer.

### Edge Cases (embedded in every pack)
- Curt/disengaged responder (1-5 word answers)
- Off-topic enthusiast (ignores questions, single pet issue)
- Non-English speaker (switches language mid-conversation)
- Profanity escalator (mild profanity, gets worse each turn)
- Sensitive topic prodder (politics or discrimination)

### Features
- Generic pack auto-selects based on `session_type`
- Florida Senate / Bad Actors packs are opt-in
- Individual persona toggle checkboxes
- Configurable participant count and turns per participant
- Live log with turn-by-turn results

---

## Multi-Language Support

- **15 languages supported by the chat engine** (`LANG_CODES` exported from `lib/languageSwitch.ts`): en, es, fr, de, pt, it, zh, ja, ko, ar, hi, vi, tl, ru, pl
- **Language switch detection** — hybrid; logic lives in `lib/languageSwitch.ts` as of convergence Phase 2.1 (2026-05-20), the chat route imports and wires its own AI classifier shim:
  - **Fast regex** first (`fastDetectLanguageSwitch`): matches bare language names ("español", "français"), action phrases ("switch to spanish"), polite forms ("can you speak french?"), and "no hablo/parle/falo english" negation patterns. Zero AI cost when it hits.
  - **AI classifier** fallback for ambiguous short messages (<=60 chars) at >=95% confidence; long messages (>120 chars) skip detection entirely so they're treated as real answers, not switch requests. The lib accepts the AI caller as a parameter (dependency-injected) so the bots route can wire the same lib in Phase 3 once a single chat handler exists.
- **Bilingual confirmation** (`SWITCH_CONFIRM` in `lib/languageSwitch.ts`): e.g. `"Sure — switching to Spanish! / ¡Claro — cambiando a español!"`
- **Translation**: Non-English responses auto-translated to English; stored in `user_message_en` for analysis
- **Bot output**: Returned in participant's conversation language
- **Skip/Done labels**: Translate on language switch (table in `TH_LABELS`)

> **Known gap (Open TBD):** the simulator's `Creole-speaking elder from Immokalee` persona targets `switch_language: 'ht'` (Haitian Creole), but `ht` is **not in `LANG_CODES`**, so the chat engine's AI classifier will reject the switch. Either add `ht` to `LANG_CODES` + `TH_LABELS` + `SWITCH_CONFIRM`, or drop `ht` from the simulator persona.

---

## Post-Session Surveys

### Psychographic Questions
- Large bank (`GENERAL_PSYCHO_BANK`) + custom questions
- Random N sampled per participant (config.psychoCount, default 3)
- Types: Likert, multi-choice, slider, free text
- Optional (can skip)

### Demographic Questions
- Configurable fields (age, gender, zip, income, education, etc.)
- Optional
- Submitted to `POST /api/townhall/responses`
- Stored as JSONB in `townhall_participant_responses`

---

## Session Management

| Action | What It Does |
|--------|-------------|
| Start | setup → active, creates themes from discussion guide |
| End | active → ended, participants see closing message |
| Pause | active → paused, participants see "paused" message |
| Resume | paused → active |
| Restart | Clears all turns/responses/themes, resets to active |
| Duplicate | Copies config + guide into new setup session |
| Archive | Hides from default list |

### Guide Sync on Edit Save
When editing an active/paused session:
- Updated topics: label, description, keywords, question, follow-up angles, target all sync to live themes
- New topics: inserted as active themes
- Removed topics: auto-dismissed (data preserved)
- Disabled/re-enabled: pause/unpause themes

---

## Data Model

### Tables

**townhall_sessions**
- `config` (JSONB) — All settings above
- `discussion_guide` (JSONB) — Array of TownHallGuideTopic
- `status`: setup, active, paused, ended
- `response_counter` — Used for theme detection scheduling

**townhall_themes**
- `state`: active, detected, paused, completed, dismissed, parked
- `source`: guide, auto_detected, custom
- `keywords[]`, `question`, `follow_up_angles[]`
- `response_target`, `mention_count`, `sentiment`, `example_quote`

**townhall_turns**
- `bot_message`, `user_message`, `user_message_en` (English translation when conv. language ≠ en)
- `theme_id` (FK), `theme_label` (denormalized snapshot — survives renames)
- `source` CHECK enum: `guide`, `clarifier`, `detected_theme`, `custom`, `deflect`, `standby`, `language_switch`, `system`, `revisit` (sql/017)
- `sentiment`, `sentiment_score` (sql/029) — populated on every non-skipped user turn
- `ai_thinking` (JSONB) — Debug reasoning when verbose/testing mode is active (sql/017)
- `skipped`, `language`, `turn_number`

**townhall_participant_responses**
- `psychographics` (JSONB), `demographics` (JSONB)
- Unique per (session_id, participant_id)

---

## Auth Model

Route handlers in `app/api/townhall/sessions/[id]/*` use the inline helper `gateSessionAccess` (defined at the top of `sessions/[id]/route.ts`). It looks up the caller's `users.org_id` + `organizations.is_admin_org`, then verifies the session's `org_id` matches (or admin-org bypass). This is one of four parallel `gate*Access` helpers across the codebase queued for extraction to `lib/auth/gate.ts` — see `docs/SECURITY.md` Open TBD #11.

> **Cross-org write fix (2026-06-08):** two mutating routes authenticated the caller but skipped the org check entirely. `POST /api/townhall/themes/[id]` (topic moderation — approve/dismiss/pause/close/reopen) fetched the topic by bare id and paired the UPDATE with the topic's *own* `org_id` (tautological), with the legacy `townhall_themes` fallback having no org filter at all — so any logged-in user could moderate any tenant's topics by id (CRITICAL). `POST /api/townhall/sessions/[id]/duplicate` fetched the source session by bare id with no caller-org check (MEDIUM). Both now resolve the caller's `org_id`+`is_admin_org` and require `row.org_id === callerOrg || isAdmin`, returning 404 otherwise (legacy `townhall_themes` gates through its parent session's `org_id`). Regression coverage: `tests/integration/townhall-mutation-gate.test.ts`.

> **Cross-org write fix #2 (2026-06-08):** `POST /api/townhall/themes/custom` (facilitator pushes a custom question) was the same class — it looked up the `pulseiq_sessions` row by bare `session_id` and inserted a `pulseiq_topics` row into *that hall's* org with no caller-org check, and the legacy `townhall_themes` branch had no org filter at all, so any logged-in user could inject a custom question into any tenant's live town hall by id. Now resolves the caller's `org_id`+`is_admin_org`, gates the new-substrate branch on `hall.org_id === callerOrg || isAdmin` and the legacy branch on the parent `townhall_sessions.org_id` (404 otherwise; admin bypass preserved). Regression coverage: `tests/integration/core-entity-routes-gate.test.ts`.

The public participant routes (`/api/townhall/chat`, `/api/townhall/join`, `/api/townhall/live/[sessionId]`) intentionally have no auth — they return only aggregate or per-participant data validated against `session.status='active'`.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/pulseiq/new/NewSessionClient.tsx` | Creator (6-step wizard) |
| `app/pulseiq/[sessionId]/SessionDetailClient.tsx` | Facilitator console |
| `app/pi/[sessionId]/TownHallChat.tsx` | Participant chat UI |
| `app/pi/[sessionId]/live/page.tsx` | Live presenter screen |
| `app/api/townhall/chat/route.ts` | Chat engine (~1100 lines) |
| `app/api/townhall/sessions/[id]/route.ts` | Session CRUD + analytics + `gateSessionAccess` |
| `app/api/townhall/sessions/[id]/export/route.ts` | CSV / XLSX / JSON / themes export |
| `app/api/townhall/sessions/[id]/export/pptx/route.ts` | Branded PPTX export |
| `app/api/townhall/live/[sessionId]/route.ts` | Public live-screen aggregate API (direct PostgREST) |
| `app/api/townhall/simulate/route.ts` | AI persona response generation |
| `app/api/townhall/join/route.ts` | Public participant join + session resolve |
| `app/api/townhall/themes/[id]/route.ts` | Theme state transitions (approve / park / dismiss / restore) |
| `app/api/townhall/themes/detect/route.ts` | Manual organic-theme detection trigger |
| `lib/townhallThemeDetection.ts` | Organic theme discovery |
| `lib/contentGuard.ts` | Strike-based content safety |
| `lib/guardrails.ts` | Shared validation + `cleanDeflectResponse()` + `looksLikeAIRefusal()` |
| `lib/trendingWords.ts` | `trendingTerms()` for the live-screen Trending Now strip |
| `components/townhall/TownHallAnalyticsPanel.tsx` | Analytics tab |
| `components/townhall/THCreatorNav.tsx` | 6-step pill navigation |
| `app/admin/simulator/townhall/TownhallSimulatorClient.tsx` | AI-driven simulator (10 packs + bad-actor pool) |

### SQL migrations

| File | Adds |
|------|------|
| `sql/011_townhall.sql` | Base schema: `townhall_sessions`, `townhall_themes`, `townhall_turns` + RLS policies |
| `sql/012_townhall_language.sql` | `user_message_en`, `language` on turns; `slug` on sessions |
| `sql/013_townhall_responses.sql` | `townhall_participant_responses` table for psycho/demo |
| `sql/014_townhall_theme_detection.sql` | `keywords`, `sentiment` on themes; `last_theme_detection_at` on sessions |
| `sql/015_shared_links_townhall.sql` | Extends `shared_links.type` to include `townhall` |
| `sql/016_townhall_parked_state.sql` | Adds `parked` to `townhall_themes.state` CHECK |
| `sql/017_townhall_ai_thinking.sql` | `ai_thinking` JSONB + `theme_label` snapshot on turns; expands `source` CHECK |
| `sql/029_turn_sentiment.sql` | `sentiment` + `sentiment_score` on `townhall_turns` (and `bot_conversation_turns`) |
| `sql/032_enable_rls_everywhere.sql` | Re-asserts org-scoped read policies on all 4 PulseIQ tables |
