# Town Hall Module

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

## Chat Engine (`app/api/townhall/chat/`)

### Processing Pipeline (per message)

1. **Rate limit** — 20 req/min per IP
2. **Session resolve** — UUID or slug lookup
3. **Auto-end check** — Timed or inactivity mode
4. **Status check** — Return closing message if ended/paused
5. **Debug toggle** — `#debug [sessionId]` enables verbose mode
6. **Content safety** — Strike-based escalation (warn → firm warning → shutdown)
7. **Language switch** — AI detection (>=95% confidence), bilingual confirmation, previous message translated
8. **Translation** — Non-English input translated to English for analysis
9. **Deflection** — Smart off-topic/sensitive topic detection (see below)
10. **Topic matching** — Opening response matched to best available theme
11. **Clarifier** — Short/vague responses get AI follow-up (frustration-aware)
12. **Next topic** — Route to under-target topic with fewest responses
13. **Wrap-up** — At turn cap, transition to post-session survey

### Deflection Engine
- **Feedback signals regex** — 80+ words (opinions, emotions, topic-relevant terms)
- **Logic**: Only deflect if message has NO feedback signals AND starts with a question, OR hits a sensitive topic
- **AI decision**: Claude returns redirect message or "NONE" (no redirect)
- **Sensitive topics**: Exact word match against `config.context.sensitive_topics[]`
- **Override**: `config.deflection.message` can replace AI redirect

### Curt Detection
- Word count <= 3 = curt response
- Declining word counts across last 3 responses = disengaging
- Reduces max clarifiers from 2 to 1 when disengaging
- Dynamic per-topic turn cap: min 2, max 4

### Topic Matching (Opening Response)
- AI matches first message to best available theme from keywords + context
- Keyword fallback when AI times out
- Even-spread budget: 60% turns for seed topics, rest for organic

### Response Counting
- **Live from turns**: `COUNT(townhall_turns WHERE theme_id=X AND user_message IS NOT NULL AND NOT skipped)`
- No cached counter — single source of truth
- Auto-completion: when live count >= response_target, theme state → completed

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
- **Auto-refresh**: Every 10 seconds. Fetch is `cache: 'no-store'` with cache-busting timestamp; route response sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` so newly-approved topics appear immediately.

---

## Participant Chat (`app/th/[sessionId]/`)

### Chat Phases
1. **Join** — Auto-join (no landing page), get opening message
2. **Chat** — Bot/participant exchange, skip/done buttons
3. **Psychographics** — Random N from bank
4. **Demographics** — Optional fields
5. **Done** — Thank you message

### UX Features
- iMessage-style bubbles (blue user, gray bot)
- Typing indicator (30ms per char, 400-1800ms range)
- Skip/Done buttons (configurable labels, translate on language switch)
- Auto-scroll to latest message
- Emoji avatars on bot messages
- Mobile-optimized (iOS scroll fix)

---

## Theme Detection (Organic Topics)

### Discovery (`lib/townhallThemeDetection.ts`)
1. Fetch English responses (non-skipped, min 20 chars)
2. Sample evenly (cap 200 for prompt size)
3. AI identifies 2-5 new themes not in existing themes
4. Deduplicate: skip if label collision or >50% keyword overlap
5. Score sentiment via lexicon
6. Compute mention_count via keyword regex
7. Insert as state='detected', source='auto_detected'

### Trigger
- Auto mode: every N responses (`theme_detection_every_n_responses`, default 20)
- Manual: "Detect" button in facilitator console
- Re-analyze: clears all organic themes, re-runs detection

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
| CSV | `GET .../export?format=csv` | All turns: bot/user messages, theme_label, source, language, sentiment, demographics, psychographics |
| Themes CSV | `GET .../export?format=themes` | Per theme: label, source, state, sentiment, keywords, response_count, mention_count |
| JSON | `GET .../export?format=json` | Grouped by participant: conversation threads + demographics + psychographics |
| PPTX | `POST .../export/pptx` | Branded deck: title, stats, sentiment, per-theme cards with quotes |

---

## Simulator (`/admin/simulator/townhall`)

### AI-Driven Personas
Responses generated from persona profiles + session topics (not scripted lines). Same persona adapts to any session.

### 5 Persona Packs

| Pack | Count | For |
|------|-------|-----|
| Community | 19 | Municipal, neighborhood, city council |
| Employee | 15 | Workplace, HR, internal feedback |
| Customer | 13 | Product, service, user feedback |
| Restaurant | 14 | Dining, hospitality, food service |
| Stakeholder | 13 | Board, donor, government, vendor |

### Edge Cases (in every pack)
- Curt/disengaged responder (1-5 word answers)
- Off-topic enthusiast (ignores questions, single pet issue)
- Non-English speaker (switches language mid-conversation)
- Profanity escalator (mild profanity, gets worse each turn)
- Sensitive topic prodder (politics or discrimination)

### Features
- Pack auto-selects based on `session_type`
- Individual persona toggle checkboxes
- Configurable participant count and turns per participant
- Live log with turn-by-turn results

---

## Multi-Language Support

- **15 languages**: en, es, fr, de, pt, it, zh, ja, ko, ar, hi, ru, vi, tl, ht
- **Language switch detection**: AI-based (>=95% confidence)
- **Bilingual confirmation**: "Sure — switching to Spanish! / Claro — cambiando a espanol!"
- **Translation**: Non-English responses auto-translated to English for analysis
- **Bot output**: Returned in participant's conversation language
- **Skip/Done labels**: Translate on language switch

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
- `bot_message`, `user_message`, `user_message_en`
- `theme_id` (FK), `theme_label` (denormalized snapshot)
- `source`: guide, clarifier, deflect, detected_theme, custom, language_switch, standby, system, revisit
- `ai_thinking` (JSONB) — Debug reasoning in testing mode
- `skipped`, `language`, `turn_number`

**townhall_participant_responses**
- `psychographics` (JSONB), `demographics` (JSONB)
- Unique per (session_id, participant_id)

---

## Key Files

| File | Purpose |
|------|---------|
| `app/townhall/new/NewSessionClient.tsx` | Creator (6-step wizard) |
| `app/townhall/[sessionId]/SessionDetailClient.tsx` | Facilitator console |
| `app/th/[sessionId]/TownHallChat.tsx` | Participant chat UI |
| `app/th/[sessionId]/live/page.tsx` | Live presenter screen |
| `app/api/townhall/chat/route.ts` | Chat engine (570+ lines) |
| `app/api/townhall/sessions/[id]/route.ts` | Session CRUD + analytics |
| `app/api/townhall/simulate/route.ts` | AI persona response generation |
| `lib/townhallThemeDetection.ts` | Organic theme discovery |
| `lib/contentGuard.ts` | Strike-based content safety |
| `lib/guardrails.ts` | Shared validation + cleanDeflectResponse() |
| `components/townhall/TownHallAnalyticsPanel.tsx` | Analytics tab |
| `components/townhall/THCreatorNav.tsx` | 6-step pill navigation |
| `app/admin/simulator/townhall/page.tsx` | AI-driven simulator (5 packs) |
| `sql/011_townhall.sql` | Base schema |
| `sql/017_townhall_ai_thinking.sql` | ai_thinking + theme_label columns |
