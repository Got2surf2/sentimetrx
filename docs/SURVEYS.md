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

**QR rendering (Publish page + dashboard)**: the survey QR, the kiosk QR and the dashboard QR are generated
client-side into a `data:` URL and rendered with a plain `<img>`, **not** `next/image`. Next cannot optimize a
`data:` URL — it would require `unoptimized`, leaving the wrapper as pure overhead — so the sites carry a scoped
`eslint-disable-next-line @next/next/no-img-element` with that reason recorded inline (2026-08-16).

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
- **Rate limited two-tier (perf review §7 Brief D, 2026-07-13):** per **(IP, session_id)** at **6/min** (the primary bucket) + a per-IP **backstop at 120/min**. The old flat `clarify:<ip>` at 10/min meant a QR-code-on-TV / venue-WiFi crowd (all behind one NAT IP) exhausted the AI follow-up budget almost instantly and every later respondent's probes silently died. `session_id` now rides in the body; body parsed before the rate check; bodies > 100 KB rejected first. Cellular scanners (own IP) are unaffected.
- Input: study context, question asked, user answer, sentiment, scores, `session_id`, optional `studyGuid` (public), and `priorQA` — the **full question+answer text** of every earlier open-ended/rating answer in this same session (in order), so the model can see what the respondent has already told it
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
- `brandTag` — Optional brand label (shared brand-correction layer, Phase 4). When set, **exported open-ended verbatims** are spelling-corrected against the brand's curated entity glossary (`resolveBrandGlossary` → deterministic variant→canonical, e.g. a respondent's "Nowocats" → "NOWOCATS"). Consume-only: surveys READ the brand glossary; the raw `responses.payload` is never mutated (correction applied on read in `/api/studies/[id]/responses?export=`). No-op when blank or the glossary is empty. Set in Creator → Basics → Brand. The glossary is resolved `authoritativeOnly` — survey exports only correct toward canonicals from an OFFICIAL record (crawl / uploaded doc) or a human, never a UGC-invented name (entity_catalog source authority). (AI polish of survey verbatims is deliberately NOT applied inline — a file download must stay instant; see ENGINEERING.md "Shared correction layer".)
- `ratingType` — experience, familiarity, satisfaction, value, quality, ease, intent, perception
- `ratingScale` — Custom emoji + label + score array
- `clarifiers` — `{ keyword: follow_on_prompt, default: fallback }`
- `useAIClarify` — Enable Claude-powered follow-ups
- `forceClarify` — Deep-probe/demo mode. Bypasses the short-answer length gate **and** tells `/api/clarify` to always return a new-angle question instead of `SKIP`ping detailed answers, so every open-end gets one tailored follow-up regardless of answer length. Declines / off-topic / unsafe input still skip. Default off; `maxClarifierCount` still caps the total.
- `maxClarifierCount` — Session-wide cap on total clarifiers fired; default 5; 0 = unlimited
- `q3ClarifyDepth` / `q4ClarifyDepth` — Per-prompt clarifier depth (default 1). Max number of consecutive follow-ups the bot may ask on that open-end **while the answer stays vague** (`shouldClarify` re-checked each turn; a specific answer stops it early). Capped by `maxClarifierCount`. Set in Creator → Conversation step, shown only when that prompt's clarifier toggle is on.

### Theming
- `primaryColor`, `headerGradient`, `backgroundColor`, `accentColor`, `botAvatarGradient`
- `brandingLabel` — "SENTIMETRX" (default), max 15 chars
- `showBranding` — Toggle footer branding
- The header wordmark stack and the "Powered by sentimetrx.ai" footers (thank-you / closed screens) carry a tiny `Privacy` link → `/privacy` (public privacy notice, 2026-07-03). The kiosk attract screen omits it (the whole screen is a tap-to-begin button).

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
**Rate limiting (`POST /api/respond`) is two-tier (perf review §7 Brief D, 2026-07-13):** per **(IP, session_id)** at **20/min** (each respondent their own bucket) + a per-IP **backstop at 600/min** (abuse ceiling). Replaces the flat `respond:<ip>` at 120/min, which capped a whole venue-NAT room at ~2 saves/s. Body is parsed before the rate check (the key reads `session_id`); bodies > 100 KB are rejected first.

A `responses` row is created on the first partial save and upserted by `session_id` on every step. `app/api/respond/route.ts` stamps `completed_at` on **every** save (partial or final), so it's really a *last-activity* time — every row has a real date, including abandoned surveys. **`status` (`incomplete` / `complete`) is the authoritative complete-vs-incomplete signal — never the presence of `completed_at`.** (Before mid-2026, partial saves wrote `completed_at = NULL`; migration `068_backfill_response_timestamps.sql` recovered those historical dates from `payload.timestamp`.)

### Response stats (dashboard tiles)
Per-study aggregates (total / complete / promoters·passives·detractors / avg
experience / avg NPS / last response) live in the **`study_response_stats_live`
counter table**, maintained **incrementally by an AFTER INSERT/UPDATE/DELETE
trigger on `responses`** (sql/174, perf review §7 Brief E item 4). This replaced
the `study_response_stats` **materialized view**, whose
`refresh_study_response_stats()` did a full platform-wide GROUP BY scan and was
fired (debounced 30s) from `/api/respond` + `/api/studies/[id]/responses` on
every submit/delete — a QR-burst I/O sink at scale. The counter table is O(1)
per response (averages kept as sum+count pairs); `/api/respond` no longer
refreshes anything. The dashboard reads it via `get_study_response_stats_for_user`
(SECURITY DEFINER, org-filtered); `study_stats_for_ids` (a direct grouped read
over `responses`, bounded to the requested ids) remains the fallback.

### Key Indexes
- `idx_responses_study` — By study_id
- `idx_responses_sentiment` — By study_id + sentiment
- `idx_responses_nps` — By study_id + nps_score

---

## Admin Tools

Nav chrome (2026-07-12, system-wide breadcrumbs): every internal survey-side page renders `SubHeader` breadcrumbs under the fixed `TopNav` (survey pages crumb under **Dashboard**; the per-study campaigns page — mapped to this spec via `app/studies/[id]/campaigns` — had no chrome at all and gained full TopNav + SubHeader). Cosmetics/navigation only, no behavior change.

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

## Engine internals (2026-08-18)

The engine's own structure is load-bearing enough to write down, because it is
not obvious from reading top to bottom.

**Declaration order is a constraint, not a style choice.** Roughly forty callbacks
in the hook depend on the thirteen translation helpers (`t`, `tUI`, `tQuestion`,
`tFollowUp`, …), so those are declared at the **top** of the hook. Each reads
exactly two things — the `activeLang` ref and `config.translations` — and is a
`useCallback` keyed on the latter, which makes it stable for the life of the study
config. Anything that calls a value must be declared **below** it: the input
renderers (`showTextInput`, `showClarifyInput`, `showTextInputOptional`) sit above
`progressFlow`/`handleOpenEnded`, and `showLikertClarifyInput` sits above
`showLikertFollowUpInput`. Moving a declaration up or down is therefore a real
change — a callback that names a value declared below it throws a
temporal-dead-zone `ReferenceError` at render.

**The one genuine cycle** — `progressFlow` → `showTextInput` → `handleOpenEnded`
→ `progressFlow` — is broken by the latest-value ref idiom (`progressFlowRef`,
`handleOpenEndedRef`, `showClarifyInputRef`, `savePartialRef`, `stepPsychoQRef`):
imperative DOM handlers call `someRef.current?.(...)` so they always reach the
current version. All five are declared together in one **Forward references**
block *ahead of* the callbacks they point at, and are kept current by a single
effect at the bottom of the hook. Both of those placements are load-bearing —
see ENGINEERING.md, "What the `react-hooks` v7 compiler actually accepts". When
adding a new step, prefer that idiom to reintroducing a forward reference.

**Per-mount initialisation.** Session id, device fingerprint, the hidden-field /
URL-param capture and the one-response-per-device lock are `useState` lazy
initialisers over module-scope factories (`resolveSessionId`,
`computeDeviceFingerprint`, `readUrlCapture`, `isDeviceBlocked`); the mutable
conversation state uses the `if (ref.current === null)` lazy-ref idiom over
`makeInitialState`. None of it runs as a side effect of rendering any more. The
campaign `?rid=` click beacon is an effect, because it is a real side effect and
a discarded render must not report a click. Kiosk mode still resets a respondent
by remounting with a fresh `key` — `useState` and `useRef` both reset on remount,
so that contract is unchanged.

**`state.current.customAnswers` is an accumulator — MERGE, never replace.** Three
things write into it, in this order: the hidden-field capture at mount (URL
params), `stepConversationExtras` (questions with a `conversationPosition`), and
`stepCustomQuestions` (the section). Until 2026-08-18 the last of those assigned
the map wholesale, which silently dropped the first two from the **final**
payload — and only the final one, because the debounced partial saves had
already shipped them, so a study looked like it was capturing its campaign
metadata right up until the response completed. Any new writer must spread the
existing map.

**Two behaviours that surprise people reading the config:**

- **The keyword clarifier fires even with `useAIClarify` off.** `buildClarify`'s
  fallback never returns `null` — it returns the matched keyword clarifier or
  `clarifiers.default` — so any open-ended answer under 12 words gets probed
  once. Turning off AI clarification does not turn off clarification.
- **`demoFields: []` does not disable demographics.** `stepDemographics` falls
  back to age/gender/ZIP whenever the list is empty. The only way to skip the
  section is to leave `demographics` out of `sectionOrder`.

## Key Files

| File | Purpose |
|------|---------|
| `app/studies/new/` | Creator wizard (10 steps) |
| `components/survey/SurveyWidget.tsx` | Widget wrapper |
| `components/survey/useSurveyEngine.ts` | Core conversation logic (~2.7k lines) |
| `tests/unit/surveyEngineFlow.test.tsx` | jsdom end-to-end harness for the engine — drives real surveys and pins the `/api/respond` payload + conversation transcript |
| `components/creator/SmartStudyWizard.tsx` | AI-powered study generation |
| `app/api/clarify/route.ts` | AI follow-up generation |
| `app/api/respond/route.ts` | Response submission |
| `app/api/study/[guid]/route.ts` | Public survey fetch |
| `lib/types.ts` | StudyConfig, SurveyQuestion, SurveyPayload types |
| `lib/studyDraft.ts` | Draft structure |
| `lib/guardrails.ts` | Content safety |
| `lib/industryDefaults.ts` | 18 industry presets; also exports `RESTAURANT_INDUSTRIES` (casual/fine/fast) used by Analyze to auto-enable the Dimensions taxonomy for restaurant orgs |
| `lib/surveyBlueprints.ts` | 7 study blueprints |

## Survey Flow panel — row rendering (2026-08-18)

`StepQuestions`' Survey Flow panel rendered its rows via a `Row` component
**declared inside** `SurveyFlowPanel`. A component created during render is a new
component type on every render, so React unmounted and remounted the whole row
list instead of updating it (`react-hooks/static-components`). Hoisted to module
scope as `FlowRow`; the one value it closed over (`onDragEnd`) is now a prop.
Drag-to-reorder behaviour is unchanged — note the file has a **second**
`onDragEnd` in a later component, so all nine usages were checked to be inside
`SurveyFlowPanel` before threading the handler.

