# Surveys Module

## Overview

Chat-based conversational surveys powered by AI. Participants interact with a branded bot that adapts follow-up questions based on sentiment, keywords, and AI analysis. Supports 15 question types, multi-language, skip logic, and adaptive follow-ups.

Survey cards on `/dashboard` (the surveys index) carry a **favorite star** (per-user, via the platform-wide `user_favorites` table in migration 075). Starred surveys float to the top of the dashboard above a thin orange divider, surface in the `★ Favorites` section on `/m` (PWA), and are listed on the desktop `/favorites` cross-resource page. The dashboard also exposes a **Sort** dropdown (Last updated / Created / Name) persisted in `localStorage.sentimetrx.sort.studies`. "Last updated" uses `statsMap[id].lastResponse` (the most-recent response timestamp) since the `studies` table has no `updated_at` column, falling back to `created_at`. The star is rendered inline at the end of the status/industry badges row on each StudyCard — same pattern as agents and datasets, so the star never competes with the donut chart at the top-right. The dashboard also has a **name search box** (beside Sort) — a client-side substring filter on the loaded surveys list (same affordance added to the agents, datasets, and recordings lists).

---

## Survey Creation

### 10-Step Wizard (`app/studies/new/`)

| Step | Name | What It Configures |
|------|------|--------------------|
| 0 | Basics | Study name, bot name/emoji, industry, custom slug, color theme, accessibility |
| 1 | Opening | NPS, experience rating, sentiment-adapted Q1 variants, opening flow order |
| 2 | Conversation | Legacy Q3/Q4 open-ended questions with per-question clarifier config |
| 3 | Clarifiers | Keyword triggers, AI clarification settings, deflection rules, max clarifier count |
| 4 | Questions | 15 question types with drag-and-drop ordering, skip logic, adaptive follow-ups |
| 5 | Psychographics | Industry-specific question banks, custom questions, random sampling count |
| 6 | Demographics | Configurable fields (age, gender, zip, income, education, ethnicity, etc.) |
| 7 | Contact Info | Email, phone, address collection with validation |
| 8 | Closing | Thank-you message, closing card text |
| 9 | Review | Full config summary, publish or save as draft |

**Step 0 (Basics) gate:** the **Next** button is disabled until both a study name and a bot name are set; an inline hint names whichever field is still missing (the bot name lives under "Bot name & emoji"), so the gate is never silent.

**Adaptive follow-up suggested text (Step 1 Opening):** the grey text in each follow-up prompt box is an HTML placeholder, **not** a stored default — it is cosmetic only. At runtime an empty follow-up prompt is **skipped entirely** (`showLikertFollowUp` returns early when the prompt is blank), so a blank box means "no follow-up for this response," never a follow-up asked with the placeholder text. To adopt a suggestion, focus the (empty) box and press **Tab** — the placeholder is materialized into the box as a real, editable value (per-response boxes only Tab-fill when a genuine industry default exists, not the generic "Follow-up for …" fallback). This same placeholder-is-cosmetic rule holds for the legacy Q3/Q4 boxes (Step 2), except those are *not* skipped when blank — an enabled-but-empty Q3/Q4 is asked with empty text, so leave them disabled rather than blank.

### Smart Study Wizard

AI-powered generation from:
- 7 study blueprints (Satisfaction, NPS & Loyalty, etc.)
- 18 industry presets with pre-filled prompts
- Focus area selection (retention, communication, recognition, etc.)
- Length tuning (quick 5Q / standard 10Q / comprehensive 15Q)

---

## Question Types

| Type | Description |
|------|-------------|
| `open` | Free-text response |
| `radio` | Single choice from options |
| `checkbox` | Multiple choice |
| `dropdown` | Single choice dropdown |
| `likert` | Scale with custom labels/emojis + optional per-response follow-ups |
| `date` | Date picker |
| `rating` | Star/emoji rating scale |
| `numeric` | Number input with min/max |
| `hidden` | Pre-populated from URL params (not shown) |
| `email` | Email with validation |
| `phone` | Phone number |
| `zip_code` | ZIP/postal code |
| `us_state` | US state dropdown |
| `message` | Display-only text (no input) |

Each question supports: `required`, `clarify` (keyword trigger), `useAI` (AI follow-up), `skipLogic` (branching), `enabled`, `conversationPosition` (inline vs post-conversation).

---

## Participant Experience

### Entry Points
- **Public URL**: `/s/{guid}` (via study GUID)
- **Custom slug**: `/s/{slug}` (URL-friendly)
- **Campaign link**: `?rid=RECIPIENT_ID` for tracking
- **Kiosk**: `?kiosk=1` (or `?kiosk=true`) — unattended shared-tablet mode (see below)

### Kiosk mode (`?kiosk=1`)
Enabled per-survey from the **Publish** page (`/studies/[id]/deploy`) → **Kiosk mode** card: copy the `?kiosk=1` link, download a kiosk QR, and set the attract-screen headline/sub-text (saved to `StudyConfig`). For shared tablets (counter/table-top "feedback station"). Same survey, different lifecycle:
- **Attract screen** between guests (`SurveyWidget` `phase='attract'`) — tap to begin a fresh session. Copy via `StudyConfig.kioskAttractHeadline` / `kioskAttractSubtext`.
- **Per-guest fresh session** — each run remounts `SurveySession` via a `key`, giving the ref-based engine a clean slate (new `session_id`, fingerprint, answers).
- **Device lock bypassed** — the one-response-per-device lock (`allowMultipleResponses: false` → `localStorage` `sentimetrx_completed_*`) is neither read nor written in kiosk mode, so guest N+1 isn't blocked by guest N.
- **Auto-reset on completion** — engine fires `onComplete` at the closing card; shell holds ~7s then returns to attract.
- **Idle-abandon** — 90s of no interaction mid-survey resets to attract (partial answers already saved by the 2s autosave).
- **Larger base font** (×1.15) for arm's-length reading.

### Conversation Flow

1. **Welcome** — Bot greets with customizable message + emoji
2. **NPS** (optional) — 1-5 scale with custom labels
3. **Experience Rating** (optional) — Customizable scale (poor-excellent), 8 rating types available
4. **Sentiment-Adapted Q1** — Different follow-up based on score (promoter/passive/detractor)
5. **AI Clarifiers** — Keyword-triggered or AI-generated follow-ups on vague responses
6. **Custom Questions** — 15 types with skip logic
7. **Psychographics** — Random N from bank
8. **Demographics** — Configurable fields
9. **Contact Info** — Optional email/phone/address
10. **Thank You** — Closing message + card

### Key UX Features
- Partial saves every 2 seconds (fire-and-forget)
- Typing indicator animation (respects `prefers-reduced-motion`)
- Mobile keyboard auto-adjustment (iOS viewport resize)
- Conversation log recorded for replay/analysis
- Multi-language with auto-translation

---

## AI Engine

### Clarifier API (`POST /api/clarify`)
- Rate limited: 10/min per IP
- Input: study context, question asked, user answer, sentiment, scores, optional `studyGuid` (public), and `priorQA` — the **full question+answer text** of every earlier open-ended/rating answer in this same session (in order), so the model can see what the respondent has already told it
- Output: follow-up question or `null` (`SKIP` when the answer is already detailed — 3+ specific points — OR it only refers back to something already covered in `priorQA`, e.g. "just the slow pacing I mentioned earlier" — or off-topic/unsafe)
- Rules: max 25 words, no repetition, only probe if vague. The prior Q/A are framed as "already captured — do NOT ask them to repeat or expand on any of it", which kills the repeat-question complaint where a later answer back-references an earlier one
- **Why `priorQA` (not the old `priorAnswers` map)**: the client previously sent only the bare answer strings keyed `q1`/`q3` with no question text, so the model couldn't tell *what* was asked and would re-probe detail the respondent had already given on a different question. The engine (`useSurveyEngine`) now records each question's prompt text as it's asked (`questionsAsked`) and ships the paired Q+A list.
- **Usage accounting**: when `studyGuid` resolves to a study row, the AI call is logged with `resource_type='study'` + `resource_id=studies.id` + `org_id=studies.org_id` (rolls up under the parent study on /admin/usage). Falls back to `resource_type='system'` if the guid is missing or unresolvable.

**Client-side clarifier gating (`useSurveyEngine`).** Two rules-based pre-filters decide whether the clarifier model is called at all; both were tightened after a real Outback/Bloom conversation skipped two obvious probe moments:
- **`isDecline`** matches refusal *phrases* (no/nope/skip/nothing/…) and genuinely empty input only. It does **not** treat short answers as declines — terse-but-meaningful feedback ("cold", "rude", "slow", "loud") routes to a clarifier instead of a "thanks for taking the time" brush-off. (Previously any answer `< 5` chars was auto-classified as a refusal.)
- **`shouldClarify`** still skips declines and questions/off-topic input. For **negative / low-rating** answers it now probes **regardless of length** (the AI returns SKIP if the answer is genuinely detailed), so a specific complaint like "the bloomin' onion was burnt and that's what I went there for" earns a deeper follow-up instead of being skipped for being "long enough" (the old `< 12`-word ceiling still applies to neutral/positive answers).
- **`buildClarify` respects SKIP.** When AI clarify is enabled and the model returns `null` (SKIP), the engine now asks **no** follow-up rather than forcing the keyword default — so relaxing the length gate doesn't make substantive answers naggy. The keyword default fires only when AI is disabled or the `/api/clarify` call actually fails (network/rate-limit/parse). `maxClarifierCount` still caps total clarifiers per session.

### Deflection (`POST /api/deflect`)
- Rate limited: 10/min per IP
- Detects off-topic questions
- Returns custom redirect message + optional link
- Config: `questionRedirect.enabled`, `.message`, `.linkText`, `.linkUrl`

### Guardrails (`lib/guardrails.ts`)
- Input validation: block unsafe content before AI (`isInputSafe`)
- Output validation: verify AI response is question-shaped and clean (`isOutputSafe` / `isOutputClean`)
- Refusal/leak detection: `looksLikeAIRefusal`, `looksLikeMetaPromptLeak`, `sanitizeBotReply`
- `SKIP_PATTERNS`: profanity, violence, sexual content, slurs, URLs (spam/phishing). PII detection is **not** implemented today.

---

## Configuration (StudyConfig)

### Core Settings
- `greeting` — Welcome message
- `brandTag` — Optional brand label (shared brand-correction layer, Phase 4). When set, **exported open-ended verbatims** are spelling-corrected against the brand's curated entity glossary (`resolveBrandGlossary` → deterministic variant→canonical, e.g. a respondent's "Nowocats" → "NOWOCATS"). Consume-only: surveys READ the brand glossary; the raw `responses.payload` is never mutated (correction applied on read in `/api/studies/[id]/responses?export=`). No-op when blank or the glossary is empty. Set in Creator → Basics → Brand. (AI polish of survey verbatims is deliberately NOT applied inline — a file download must stay instant; see ENGINEERING.md "Shared correction layer".)
- `ratingType` — experience, familiarity, satisfaction, value, quality, ease, intent, perception
- `ratingScale` — Custom emoji + label + score array
- `clarifiers` — `{ keyword: follow_on_prompt, default: fallback }`
- `useAIClarify` — Enable Claude-powered follow-ups
- `maxClarifierCount` — Session-wide cap on total clarifiers fired; default 5; 0 = unlimited
- `q3ClarifyDepth` / `q4ClarifyDepth` — Per-prompt clarifier depth (default 1). Max number of consecutive follow-ups the bot may ask on that open-end **while the answer stays vague** (`shouldClarify` re-checked each turn; a specific answer stops it early). Capped by `maxClarifierCount`. Set in Creator → Conversation step, shown only when that prompt's clarifier toggle is on.

### Theming
- `primaryColor`, `headerGradient`, `backgroundColor`, `accentColor`, `botAvatarGradient`
- `brandingLabel` — "SENTIMETRX" (default), max 15 chars
- `showBranding` — Toggle footer branding

### Multi-Language
- `languages[]` — Supported language codes
- `translations{}` — Per-language config overrides
- `autoTranslateResponses` — Auto-translate to English on submit
- **Usage accounting**: `POST /api/translate` (creator-side, pre-publish translation) and `POST /api/translate-responses` (respondent-side, on submit) both attribute AI usage to the parent study when `studyId` / `studyGuid` is supplied. `POST /api/ai/study-suggest` (wizard starter values) also tags `resource_type='study'` but with no `resource_id` since the study doesn't exist yet.

### Accessibility
- `confirmBeforeRecord` — Tap-then-confirm mode
- `surveyFontSize` — Base px (default 18)
- `typingSpeed` — Animation multiplier (0.25-2.0)

---

## Data Model

### Tables
- `studies` — Survey config, status (draft/active/paused/closed), bot identity
- `responses` — Full JSONB payload, sentiment, scores, duration, session tracking
- `datasets` — TextMine analysis container (source: upload/study/google_reviews)

### Response timestamps & partial saves
A `responses` row is created on the first partial save and upserted by `session_id` on every step. `app/api/respond/route.ts` stamps `completed_at` on **every** save (partial or final), so it's really a *last-activity* time — every row has a real date, including abandoned surveys. **`status` (`incomplete` / `complete`) is the authoritative complete-vs-incomplete signal — never the presence of `completed_at`.** (Before mid-2026, partial saves wrote `completed_at = NULL`; migration `068_backfill_response_timestamps.sql` recovered those historical dates from `payload.timestamp`.)

### Key Indexes
- `idx_responses_study` — By study_id
- `idx_responses_sentiment` — By study_id + sentiment
- `idx_responses_nps` — By study_id + nps_score

---

## Admin Tools

### `/admin/testing` (tabbed)
Three tabs in a single page (`TestingClient.tsx`):
- **AI Tester** — test clarifier / deflector behavior against a real study; pre-populated examples + debug-mode reasoning
- **Load Simulator** — embedded synthetic-response runner (same pool as `/admin/simulator`)
- **Leakage Test** — runs the same question repeatedly, detects prompt-injection / leaked-data patterns in outputs

### Load Simulator (`/admin/simulator`)
- Generate 1–500 synthetic responses per run (UI `<input max={500}>`)
- Configurable sentiment mix (realistic / positive / negative / uniform)
- Random demographics from realistic pools
- Calls the public `/api/respond` endpoint with `status:'complete'` payloads

---

## Key Files

| File | Purpose |
|------|---------|
| `app/studies/new/` | Creator wizard (10 steps) |
| `components/survey/SurveyWidget.tsx` | Widget wrapper |
| `components/survey/useSurveyEngine.ts` | Core conversation logic (~2.6k lines) |
| `components/creator/SmartStudyWizard.tsx` | AI-powered study generation |
| `app/api/clarify/route.ts` | AI follow-up generation |
| `app/api/respond/route.ts` | Response submission |
| `app/api/study/[guid]/route.ts` | Public survey fetch |
| `lib/types.ts` | StudyConfig, SurveyQuestion, SurveyPayload types |
| `lib/studyDraft.ts` | Draft structure |
| `lib/guardrails.ts` | Content safety |
| `lib/industryDefaults.ts` | 18 industry presets; also exports `RESTAURANT_INDUSTRIES` (casual/fine/fast) used by Analyze to auto-enable the Dimensions taxonomy for restaurant orgs |
| `lib/surveyBlueprints.ts` | 7 study blueprints |
