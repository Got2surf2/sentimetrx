# Town Hall Module

**Last reviewed:** 2026-05-15 (spec audit pass 2 of 14 — see `[[project-spec-audit-queue]]`)

> User-facing name is **PulseIQ**. Internal table/code names (`townhall_*`, `app/townhall/*`, `app/api/townhall/*`) are kept as-is for backwards compatibility. See `[[feedback-product-naming]]`.

## Overview

Live group feedback sessions with AI moderation. Participants chat anonymously with a bot that rotates through discussion topics, probes for deeper insights, and detects emerging themes in real-time. Facilitators monitor via a live console with topic cards, sentiment tracking, and organic topic discovery.

---

## Session Creation (`app/townhall/new/`)

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

### Session Types
community, employee, customer, student, member, other — drives AI tone and peer references

---

## Facilitator Console (`app/townhall/[sessionId]/`)

### Three Tabs
1. **Topics** — Live topic cards with actions
2. **Responses** — Participant list, conversation viewer, bulk delete
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

> **Phase 4 commit 2 (2026-05-21):** the route also carries an opt-in delegation branch gated by `TOWNHALL_VIA_AGENT_HANDLER` (env, default OFF). When the flag is ON AND `session_id` resolves to a `town_halls` row (uuid or slug), the route bypasses the legacy 20-step pipeline below and delegates to `lib/chatCore.handleChatTurn` — the shared chat-core that also powers `/api/bots/[id]/chat`. PulseIQ-specific features (response counter, language switch, auto-end, standby) are NOT carried into this path; they get rebuilt on the unified substrate in Phase 5. With zero `town_halls` rows in production today, the new path is dark on the way in — it activates only after Phase 6 creates the first row pointing at an existing agent. See `docs/CONVERGENCE.md` § 4.
>
> **Phase 5 commit 3 (2026-05-21):** topic assignment IS now carried into the new path. `handleChatTurn` reads `town_hall_topics` for the town hall, tallies cohort-wide response_count from `town_hall_conversations` → `conversations` → `conversation_turns.topic_id`, builds participant-specific `discussedTopicIds`, calls `lib/pickNextTopic`, and injects a "TOWN HALL TOPIC FOCUS" instruction into the system prompt. The chosen `topic_id` is stored on both turns of the pair via `mirrorTurns` (which also auto-links the conversation to the town hall via `town_hall_conversations` and populates `conversations.participant_id`). Theme aggregation cron from Phase 5 commit 1 (`lib/cohortThemeAggregator.ts`) reads from the same substrate and writes back new topics — closing the cohort loop.

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
9. **Response counter + auto theme detection** — Counter incremented; if `theme_detection_mode='auto'`, detection fires every N responses (fire-and-forget)
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

## Live Screen (`app/th/[sessionId]/live/`)

Public presenter display (no auth, aggregate data only):

- **Dark theme**, designed for projection
- **QR code** + participant URL
- **Stats bar**: Participants, Responses, Total Turns
- **Active theme cards**: Donut progress, sentiment, keywords with frequency, example quote.
  - **Seed vs Organic shading**: Seed cards (`source='guide'`) use `#1f2937` background and a blue "Seed" pill; organic cards (`source='auto_detected'`) use `#1e293b` and a green "Organic" pill. No "AI" branding shown — the moderator-facing distinction (planned vs. emerged) is what's surfaced to the audience.
  - Cards only appear once the moderator approves the topic (state → `active`); detected/parked/dismissed are hidden from the public view.
- **Sentiment bar**: Stacked horizontal (positive/negative/mixed/neutral)
- **Auto-refresh**: Every 10 seconds. Fetch is `cache: 'no-store'` with cache-busting timestamp; route response sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`.
- **Direct PostgREST reads**: The live route (`app/api/townhall/live/[sessionId]/route.ts`) bypasses Supabase JS and calls PostgREST directly with `fetch({ cache: 'no-store' })`. Reason: Next.js's automatic `fetch` cache was caching Supabase JS's internal calls in some deployments, ignoring route-level `dynamic = 'force-dynamic'`, which caused the live screen to fall behind moderator approvals/closes. Route also exports `fetchCache = 'force-no-store'` and `revalidate = 0` for belt-and-suspenders.
- **Trending Now strip**: Top 8 phrases gaining traction in the last 5 minutes vs the rest of the session. Computed in the live route via `lib/trendingWords.ts:trendingTerms()` using a smoothed rate ratio (recent rate / baseline rate, with Laplace smoothing). Displayed as orange pills above the topic cards on the live screen.

---

## Participant Chat (`app/th/[sessionId]/`)

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

### Discovery — new substrate (`lib/cohortThemeAggregator.ts`, Phase 5 commit 1, 2026-05-21)
1. Load town hall + linked agent (`town_halls` joined to `agents` via `bot_id`)
2. Fetch user turns across the town hall's conversations (`town_hall_conversations` → `conversations` → `conversation_turns` with `role='user'`, `content_en` || `content` ≥ 20 chars). PulseIQ's `skipped` boolean has no equivalent on the new schema — all user turns are candidates.
3. Sample / AI / dedup / mention-count steps are identical to the legacy version.
4. Insert into `town_hall_topics` as state='pending', source='auto_detected'. Per-topic `sentiment` is dropped from the schema (per-turn sentiment lives on `conversation_turns.sentiment` instead).
5. Stamp `town_halls.last_theme_detection_at`.

Both lib paths coexist; the cron (`app/api/cron/townhall-theme-detection/route.ts`) scans BOTH `townhall_sessions` (status='active', `config.engine.theme_detection_mode='auto'`) AND `town_halls` (status='live', `cohort_config.theme_detection_mode` defaulting to 'auto'). Legacy lib + cron block are dropped once no town hall is on the old schema.

### Trigger
- Auto mode (legacy): every N responses (`config.engine.theme_detection_every_n_responses`, default 20)
- Auto mode (new): cron every 15 min with 10-min cooldown via `town_halls.last_theme_detection_at`. Response-count-based trigger from the chat route arrives in Phase 5 commit 3+ when `handleChatTurn` learns about `townHallContext`.
- Manual: "Detect" button in facilitator console (legacy only today)
- Re-analyze: clears all organic themes, re-runs detection (legacy only today)

---

## Analytics

### Session API (`GET /api/townhall/sessions/[id]`)
- **Lightweight** (default): Live response counts, basic theme data
- **Full analytics** (`?analytics=true`): Keyword matching, sentiment scoring, quote extraction with match reasons

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

The public participant routes (`/api/townhall/chat`, `/api/townhall/join`, `/api/townhall/live/[sessionId]`) intentionally have no auth — they return only aggregate or per-participant data validated against `session.status='active'`.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/townhall/new/NewSessionClient.tsx` | Creator (6-step wizard) |
| `app/townhall/[sessionId]/SessionDetailClient.tsx` | Facilitator console |
| `app/th/[sessionId]/TownHallChat.tsx` | Participant chat UI |
| `app/th/[sessionId]/live/page.tsx` | Live presenter screen |
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
