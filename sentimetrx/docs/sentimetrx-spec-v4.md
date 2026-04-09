# SENTIMETRX — Product Specification & Engineering Handoff

**Version:** 4 | March 2026 | Sessions through March 10 2026  
**Live:** https://sentimetrx.ai | **Repo:** github.com/Got2surf2/sentimetrx

---

## 0. How to Start a New Session

Paste this as your opening message:

> *"I am building Sentimetrx, a conversational survey platform. The attached spec (v4) is the full engineering reference — architecture, all deployed files, types, survey flow, and technical decisions. Repo: github.com/Got2surf2/sentimetrx. Please read the spec fully, then help me with [describe task]. Before writing any code, fetch the current version of any file you will modify directly from GitHub."*

**Rules for every session:**
- Always fetch the live file from GitHub before modifying it — never rely on spec snippets as source of truth for current code
- Follow Section 11 (SWC rules) for all new code — no exceptions
- `industry` and `otherIndustry` live in `config` JSONB, not as top-level DB columns
- `Sentiment` type is `'positive' | 'neutral' | 'negative'` — never `'promoter' | 'passive' | 'detractor'`
- The studies POST API must return `{ id, guid }` — check `app/api/studies/route.ts` returns `guid`

---

## 1. Product Overview

Sentimetrx is a multi-tenant conversational survey platform. Respondents interact with a themed chat bot that collects NPS scores, experience ratings, open-ended responses, custom survey questions, and psychographic data through natural conversation. Study creators configure every aspect of the survey flow via a 7-step creator UI.

| Item | Detail |
|---|---|
| Live URL | https://www.sentimetrx.ai |
| GitHub | github.com/Got2surf2/sentimetrx |
| Framework | Next.js 14.2.5 — App Router |
| Database | Supabase (PostgreSQL + Row Level Security) |
| Hosting | Vercel (force-dynamic on all survey/API routes) |
| Email | Resend — study-closed notifications + team invites |
| AI | Anthropic Claude Haiku (claude-haiku-4-5-20251001) via /api/clarify |
| Auth | Supabase Auth with org-level RLS policies |

---

## 2. File Architecture

### app/ (Next.js App Router)

```
app/
  api/
    auth/signout/route.ts
    clarify/route.ts              AI clarifying question generation (Haiku)
    respond/route.ts              POST — save completed survey response
    studies/route.ts              GET list + POST create study
    studies/[id]/route.ts         GET, PATCH, DELETE study
    studies/[id]/responses/route.ts  GET responses + CSV export + DELETE
    studies/[id]/analytics/route.ts  GET aggregated analytics data
    study/[guid]/route.ts         GET public study config (no-cache headers)
    invite/route.ts               POST — send team invite email
    invite/register/route.ts      POST — accept invite, create account
    admin/clients/route.ts        GET/POST clients (super-admin only)
    admin/clients/[id]/route.ts   PATCH/DELETE client
    admin/orgs/route.ts           GET/POST orgs
    admin/orgs/[orgId]/users/route.ts  GET org users
  dashboard/
    page.tsx                      Server component, auth gate
    DashboardClient.tsx           Study cards, donut charts, filter bar, industry pill
  s/[guid]/
    page.tsx                      Survey page (force-dynamic, 100dvh)
  studies/new/page.tsx            New study creator (7 steps)
  studies/[id]/
    edit/page.tsx + EditStudyClient.tsx
    analytics/page.tsx
    responses/page.tsx
    deploy/page.tsx
  admin/
    page.tsx + AdminClient.tsx    Super-admin client/org management
    [clientId]/page.tsx + AdminClientDetail.tsx
  team/page.tsx + TeamClient.tsx
```

### components/

```
creator/
  CreatorUI.tsx          Shared primitives: Input, Section, NavButtons, Field, Divider
  CreatorNav.tsx         Fixed 7-pill nav bar + Publish button (orange when ready, grey when not)
  StepBasics.tsx         Step 0: name, industry (stored in config), bot name/emoji, color theme
  StepOpening.tsx        Step 1: greeting, NPS + LikertFollowUp, experience rating + LikertFollowUp
  StepConversation.tsx   Step 2: Q3, Q4, required/optional toggles
  StepClarifiers.tsx     Step 3: clarifier keywords + default fallback + AI toggle (NEW — extracted from StepConversation)
  StepQuestions.tsx      Step 4: custom question builder + industry suggested questions + sampling control
  StepPsychographics.tsx Step 5: psychographic bank (real psychographic questions) + custom questions
  StepReview.tsx         Step 6: review summary, Test Survey button, Publish button, Save as Draft
nav/
  TopNav.tsx
  SubHeader.tsx
  ExportModal.tsx
  StudyPageHeader.tsx
  FilterBar.tsx
survey/
  SurveyWidget.tsx
  useSurveyEngine.ts     All survey flow logic
  ClosedStudyPage.tsx
lib/
  types.ts               All shared TypeScript interfaces
  studyDraft.ts          Draft state management
  industryDefaults.ts    Industry defaults + INDUSTRY_SUGGESTED_QUESTIONS export
```

---

## 3. Database Schema (Supabase)

### studies

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| guid | text | Public URL slug — used in /s/[guid] |
| name | text | Study display name |
| bot_name | text | Bot name shown in chat header |
| bot_emoji | text | Bot avatar emoji |
| status | text | draft \| active \| closed |
| visibility | text | public \| private |
| config | jsonb | Full StudyConfig object (see Section 4) — **industry lives here** |
| created_by | uuid | FK auth.users |
| org_id | uuid | FK orgs |
| client_id | uuid | FK clients |
| created_at | timestamptz | Auto |

### responses

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| study_id | uuid | FK studies.id |
| study_guid | text | Denormalized for fast lookup |
| agent | text | Browser UA string |
| experience_score | int2 | 1-5 experience rating (nullable if disabled) |
| nps_score | int2 | 1-5 NPS score (nullable if disabled) |
| sentiment | text | **positive \| neutral \| negative** (derived from NPS only) |
| payload | jsonb | Full SurveyPayload object |
| duration_sec | int4 | Seconds to complete survey |
| created_at | timestamptz | Auto |

> **RLS NOTE:** The responses table has no DELETE policy for authenticated users. The responses DELETE route uses `createServiceRoleClient()` to bypass RLS for deletions. Auth check still uses regular user client.

> **SENTIMENT NOTE:** `sentiment` values are `positive | neutral | negative`. Old data may have `promoter | passive | detractor` — run the migration below if needed:
> ```sql
> UPDATE responses SET sentiment = 'positive' WHERE sentiment = 'promoter';
> UPDATE responses SET sentiment = 'neutral'  WHERE sentiment = 'passive';
> UPDATE responses SET sentiment = 'negative' WHERE sentiment = 'detractor';
> ```

---

## 4. TypeScript Types (lib/types.ts)

### Sentiment

```typescript
type Sentiment = 'positive' | 'neutral' | 'negative'
```

### StudyConfig — the config JSONB column

```typescript
interface StudyConfig {
  greeting:              string

  // NPS (shown first — checkbox to disable)
  npsEnabled?:           boolean          // default true
  npsPrompt?:            string
  npsLabel?:             string           // default "NPS" — dashboard card + CSV header
  npsFollowUp?:          LikertFollowUp

  // Experience rating (shown after NPS)
  experienceEnabled?:    boolean          // default true
  ratingPrompt:          string
  ratingScale:           RatingOption[]   // 5 options: score, emoji, label
  experienceFollowUp?:   LikertFollowUp
  experienceRatingLabel?: string
  ratingVariableId?:     string           // 'nps' | 'experience' — primary score for dashboard
  ratingVariableLabel?:  string

  // Open-ended Q3 + Q4
  q3:                    string
  q3Required?:           boolean          // default true
  q3ExportLabel?:        string
  q4:                    string
  q4Required?:           boolean          // default false
  q4ExportLabel?:        string

  // Clarifiers (keyword -> follow-up map + default fallback)
  clarifiers:            StudyClarifiers
  useAIClarify?:         boolean

  // Custom questions
  questions?:            SurveyQuestion[]
  customQCount?:         number           // how many to randomly show per session (default: all)

  // Psychographics
  psychographicBank:     PsychoQuestion[]
  psychoCount?:          number           // random N per session, default 3

  // Industry — stored in config so it persists via JSONB
  industry?:             string           // industry key (e.g. 'healthcare', 'retail_ecommerce')
  otherIndustry?:        string           // free-text when industry === 'other'

  theme:                 StudyTheme
}
```

### LikertFollowUp

```typescript
interface LikertFollowUp {
  enabled:       boolean
  mode:          'shared' | 'per-response'
  sharedPrompt:  string
  shareClarify:  boolean
  shareAI:       boolean
  perResponse:   Record<string, {   // keyed by score ("1", "2"...)
    prompt:  string
    clarify: boolean
    useAI:   boolean
  }>
}
```

### SurveyQuestion

```typescript
type QuestionType = 'open' | 'radio' | 'checkbox' | 'dropdown' | 'likert' | 'date'

interface SurveyQuestion {
  id:           string
  type:         QuestionType
  prompt:       string
  exportLabel?: string
  required?:    boolean
  clarify?:     boolean          // open-ended only
  useAI?:       boolean          // open-ended only
  options?:     string[]         // radio, checkbox, dropdown
  likertScale?: { score: number; emoji?: string; label: string }[]
  followUp?:    LikertFollowUp   // likert only
  dateFormat?:  string
  dateMin?:     string
  dateMax?:     string
}
```

### PsychoQuestion

```typescript
interface PsychoQuestion {
  key:          string
  q:            string
  opts:         string[]
  exportLabel?: string
}
```

### SurveyPayload (saved to responses.payload JSONB)

```typescript
interface SurveyPayload {
  agent:              string
  timestamp:          string
  npsRecommend:       { score: number; label: string }
  npsFollowUp?:       string
  experienceRating:   { score: number; label: string; sentiment: Sentiment }
  experienceFollowUp?: string
  openEnded:          { q1: string; q3: string; q4: string }
  customAnswers?:     Record<string, string | string[]>  // keyed by question.id
  psychographics:     Record<string, string>
  demographics:       { age: string; gender: string; zip: string }
}
```

---

## 5. Study Creator — 7 Steps

Both new-study and edit flows use the same 7-step creator. Step navigation is in `CreatorNav.tsx`.

| Step # | Name | Component | What it configures |
|---|---|---|---|
| 0 | Basics | StepBasics.tsx | Study name, industry (stored in config.industry), bot name, emoji picker with skin tone + industry sets, color theme. Bot name/emoji changes auto-sync into greeting if greeting contains them. |
| 1 | Opening | StepOpening.tsx | Greeting, NPS toggle + prompt + label + LikertFollowUp, Experience rating toggle + prompt + scale + LikertFollowUp, Primary rating variable picker |
| 2 | Conversation | StepConversation.tsx | Q3 text + required toggle + export label, Q4 text + required toggle + export label |
| 3 | Clarifiers | StepClarifiers.tsx | Default clarifier fallback, keyword clarifier rules, AI clarify toggle. **Extracted from StepConversation in this session.** |
| 4 | Custom Questions | StepQuestions.tsx | Custom questions (open/radio/checkbox/dropdown/likert/date). Industry suggested questions panel. `customQCount` sampling control (shown when 2+ questions). |
| 5 | Psychographics | StepPsychographics.tsx | Real psychographic questions (attitudes/values/motivations) — see Section 6. `psychoCount` sampling control. |
| 6 | Review & Publish | StepReview.tsx | Summary of all settings including custom Q count and psycho count. Test Survey button (enabled after Save as Draft). Publish button. Copy Link. |

### CreatorNav completion logic

| Step | Required to mark complete |
|---|---|
| 0 Basics | `name.trim() && bot_name.trim()` |
| 1 Opening | `greeting.trim()` |
| 2 Conversation | `q3.trim() && q4.trim()` |
| 3 Clarifiers | `clarifiers.default.trim()` |
| 4 Questions | always true (optional step) |
| 5 Psychographics | always true (optional step) |

**Publish pill:** Grey + disabled until all required steps are complete. Orange + clickable when complete. Clicking navigates to Review step (step 6). The actual save/publish fires from inside StepReview.

**Scroll behaviour:** Every step change (Next, Back, nav pill click, Publish pill) calls `window.scrollTo({ top: 0, behavior: 'smooth' })`.

---

## 6. Industry System (lib/industryDefaults.ts)

### 18 supported industries

`automotive_repair`, `casual_dining`, `education`, `fast_food`, `financial_services`, `fine_dining`, `hr_employee`, `healthcare`, `higher_education`, `hospitality`, `media_entertainment`, `nonprofits`, `performing_arts`, `political`, `retail_ecommerce`, `saas_software`, `sports`, `travel_tourism`, plus `other`.

### INDUSTRY_DEFAULTS

The main export. Keyed by industry. Each entry contains:

```typescript
{
  greeting:          string
  ratingPrompt:      string
  ratingScale:       RatingOption[]
  q3:                string
  q4:                string
  clarifiers:        StudyClarifiers
  psychographicBank: PsychoQuestion[]   // REAL psychographic questions (values/attitudes/motivations)
  npsPrompt:         string
  npsFollowUp:       LikertFollowUp     // per-response, 5 score-specific prompts
  experienceFollowUp: LikertFollowUp    // per-response, 5 score-specific prompts
}
```

**psychographicBank now contains real psychographic questions** — attitudes, values, motivations, lifestyle. Not experience/segmentation questions. 4 questions per industry. Examples:
- Healthcare: "How would you describe your overall approach to your health?" (Proactive / Reactive / Cautious / Pragmatic)
- SaaS: "How would you describe your relationship with technology and software?" (Early adopter / Pragmatist / Reluctant user / Sceptic)

### INDUSTRY_SUGGESTED_QUESTIONS (new export)

```typescript
export const INDUSTRY_SUGGESTED_QUESTIONS: Partial<Record<Exclude<Industry, 'other'>, PsychoQuestion[]>>
```

Contains the original contextual/segmentation questions that were previously in `psychographicBank` — things like "What type of vehicle do you drive?" or "What brought you in today?". These are now surfaced on the **Custom Questions step** (Step 4) as one-click suggestions rather than in Psychographics.

### Industry storage

`industry` and `otherIndustry` are stored in `config` JSONB — NOT as top-level DB columns. The studies table has no `industry` column. When building the draft in `EditStudyClient`, the config object is spread so they come through automatically via `study.config`.

For legacy studies (created before this session), check `study.config?.industry || study.industry` as a fallback.

### Industry in edit mode (StepBasics)

- If `draft.config.industry` is set, the Basics step shows an orange **"✦ [Industry name] — Industry set"** badge instead of the dropdown
- A "Change industry" link reveals the dropdown + an amber destructive-change warning
- Changing industry + re-applying defaults will overwrite current prompts/questions — two deliberate steps required
- `handleIndustrySelect` saves `industry` to config immediately on selection (even before applying defaults)

### Industry on dashboard card (DashboardClient)

A small orange `· Healthcare` pill appears next to the bot name on every study card where `config.industry` is set.

---

## 7. Custom Questions Sampling (StepQuestions + useSurveyEngine)

### Config field

```typescript
customQCount?: number  // 0 or undefined = show all; N = show random N
```

### UI

A stepper control appears on Step 4 when 2+ questions exist. Displays "All" when sampling is off. Decrement from All sets it to `totalQ - 1`. Increment from any value caps at `totalQ - 1` (always leaves at least one unshown). Setting back to "All" stores `0`.

### Engine (components/survey/useSurveyEngine.ts)

`stepCustomQuestions` now mirrors `pickPsychoQuestions` exactly:

```typescript
const n = config.customQCount && config.customQCount > 0 && config.customQCount < allQuestions.length
  ? config.customQCount
  : allQuestions.length
const pool = [...allQuestions]
const questions: typeof pool = []
while (questions.length < n && pool.length > 0) {
  const i = Math.floor(Math.random() * pool.length)
  questions.push(...pool.splice(i, 1))
}
```

If `customQCount` is 0 or unset, all questions are shown in their original drag order.

---

## 8. Test Survey Button (StepReview)

### Problem

In New Study mode, the API returns `{ id }` (internal UUID) after save. The Test Survey URL uses `guid` (public slug). The button was rendering but had no URL.

### Fix

`New_page.tsx` now destructures `{ id, guid }` from the API response and stores `guid` in `savedGuid` state:

```typescript
const { id, guid } = await res.json()
if (guid) setSavedGuid(guid)
```

`savedGuid` is passed as `studyId` to `StepReview`. In edit mode, `study.guid` was always available.

### API requirement

`app/api/studies/route.ts` POST handler must return `{ id, guid }`. Verify the `.select()` call on the insert includes `guid`.

### Button states

- No `studyId` yet: shows grey disabled button + "Save as Draft first" hint text
- `studyId` available: shows `🔗 Test Survey` as active link opening in new tab

---

## 9. Survey Flow (components/survey/useSurveyEngine.ts)

The engine is a DOM-manipulation state machine. All flow logic runs as async functions appending to `chatRef` and rendering inputs to `inputRef`. No React state for flow — only `state.current` (plain object ref).

| # | Step | Condition | Notes |
|---|---|---|---|
| 1 | Greeting + Yes/No | Always | Decline ends survey politely. No data saved. |
| 2 | NPS | npsEnabled !== false | 5-button Likert (1-5). Sets sentiment: 5=positive, 4=neutral, 1-3=negative |
| 2a | NPS Follow-up | npsFollowUp?.enabled | Adaptive open-end. Shared or per-response. Optional clarify/AI. |
| 3 | Experience Rating | experienceEnabled !== false | Emoji 1-5 scale |
| 3a | Experience Follow-up | experienceFollowUp?.enabled | Same adaptive structure |
| 4 | Q3 | Always | Required by default. q3Required=false adds Skip link. |
| 4a | Q3 Clarifier | shouldClarify(answer) | Keyword or AI. Global max 2 clarifiers. |
| 5 | Q4 | Always | Optional by default. |
| 5a | Q4 Clarifier | shouldClarify(answer) | Same clarifier logic. |
| 6 | Custom Questions | config.questions?.length > 0 | Random `customQCount` subset, or all if unset. |
| 7 | Psychographics | Always | Random `psychoCount` from psychographicBank (default 3). |
| 8 | Demographics | Always | Age, gender, zip. Hardcoded. |
| 9 | Submit | Always | POST /api/respond |

**SENTINEL RULES:**
1. Sentiment derived from NPS score ONLY — never experience rating. If NPS disabled, sentiment is null.
2. `clarifyCount` is global across entire survey — max 2 per session, never resets.
3. `shouldClarify()` fires only for answers under 12 words that are not a decline response.
4. Sentiment values: `'positive' | 'neutral' | 'negative'` — never use old values.

---

## 10. AI Clarifying Questions (/api/clarify)

| Property | Value |
|---|---|
| Model | claude-haiku-4-5-20251001 |
| Speed | ~500ms round-trip |
| Cost | ~$0.001 per call |
| Max tokens output | 80 |
| Max clarifiers per session | 2 (global, never resets) |
| Activation | useAIClarify: true in study config |
| Fallback 1 | Keyword matching (config.clarifiers map) |
| Fallback 2 | config.clarifiers.default |
| Fallback 3 | No clarifier (survey continues normally) |

### Three-Layer Guardrail System

**Layer 1 — Input Filter:** `SKIP_PATTERNS` regex checks for profanity, violence, sexual content, slurs, URLs, inputs > 600 chars. Match returns `{ question: null }` without calling Anthropic.

**Layer 2 — System Prompt:** Model instructed to return SKIP if off-topic, nonsensical, or abusive.

**Layer 3 — Output Validation:** `isOutputSafe()` — must be 5-200 chars, must look like a question, must not match `SKIP_PATTERNS`. Failed validation returns null.

### Graceful Degradation

Non-200 from Anthropic → catch → keywordFallback() → clarifiers.default → null. Survey continues normally.

> Always set `config.clarifiers.default` on every study (e.g. "Could you tell us a bit more about that?").

---

## 11. SWC Parser Rules (Next.js 14.2.5)

These cause silent build failures or runtime errors. Apply to ALL new code.

| Rule | Wrong | Right |
|---|---|---|
| No template literals in JSX attrs | `className={\`${var}\`}` | `className={"prefix-" + var}` |
| No JSX-returning arrow functions inside components | `const row = () => <div>...</div>` | Extract as named function outside component |
| No non-ASCII in TS comments | `// em dash —` | ASCII only in comments |
| Charts/donuts | SVG elements | CSS conic-gradient via inline styles |
| Toggles | Complex Tailwind combos | inline-flex pill, inline-block knob, translate-x-5/translate-x-0 |

---

## 12. Respond Route (/api/respond)

### Validation

Only reject if BOTH `npsRecommend.score` AND `experienceRating.score` are null. All score extractions use `?? null`.

### Payload saved

- `experience_score` — from experienceRating.score (nullable)
- `nps_score` — from npsRecommend.score (nullable)
- `sentiment` — `positive | neutral | negative` derived from NPS score (nullable)
- `payload` — full SurveyPayload JSONB
- `duration_sec` — time from start to submit

---

## 13. Responses Route (/api/studies/[id]/responses)

**GET** — paginated responses. `?format=csv` for export.

**DELETE** — body `{ ids: string[] }`. Auth check via user client (RLS), actual delete via service role client. Returns `{ deleted: number }`.

Pattern: always auth-check with user client, always mutate with service role client when RLS lacks the needed policy.

---

## 14. Survey Widget — Mobile & Scroll

- `scrollBottom()` scrolls unconditionally. Two retries at 60ms and 350ms.
- `minHeight: 0` on chat flex area — critical for `overflow-y: auto`.
- Input area capped at `maxHeight: 45vh`.
- `visualViewport` resize listener for iOS keyboard — sets wrapper height and scrolls.
- `SurveyWidget` uses inline styles throughout — not Tailwind.

---

## 15. Environment Variables (Vercel)

| Variable | Purpose | Required |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL | Yes |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key | Yes |
| SUPABASE_SERVICE_ROLE_KEY | Service role — bypasses RLS (server only) | Yes |
| ANTHROPIC_API_KEY | AI clarifying questions | For AI clarify |
| RESEND_API_KEY | Study-closed emails + team invites | For email |
| NEXT_PUBLIC_BASE_URL | Absolute URL base | Yes |

---

## 16. Deployed File Status

### Creator

| File | GitHub Path |
|---|---|
| CreatorNav.tsx | `components/creator/CreatorNav.tsx` |
| StepBasics.tsx | `components/creator/StepBasics.tsx` |
| StepOpening.tsx | `components/creator/StepOpening.tsx` |
| StepConversation.tsx | `components/creator/StepConversation.tsx` |
| StepClarifiers.tsx | `components/creator/StepClarifiers.tsx` |
| StepQuestions.tsx | `components/creator/StepQuestions.tsx` |
| StepPsychographics.tsx | `components/creator/StepPsychographics.tsx` |
| StepReview.tsx | `components/creator/StepReview.tsx` |
| CreatorUI.tsx | `components/creator/CreatorUI.tsx` |

### Pages

| File | GitHub Path |
|---|---|
| New_page.tsx | `app/studies/new/page.tsx` |
| EditStudyClient.tsx | `app/studies/[id]/edit/EditStudyClient.tsx` |

### Survey

| File | GitHub Path |
|---|---|
| SurveyWidget.tsx | `components/survey/SurveyWidget.tsx` |
| useSurveyEngine.ts | `components/survey/useSurveyEngine.ts` |
| ClosedStudyPage.tsx | `components/survey/ClosedStudyPage.tsx` |

### Dashboard & Nav

| File | GitHub Path |
|---|---|
| DashboardClient.tsx | `components/dashboard/DashboardClient.tsx` |
| TopNav.tsx | `components/nav/TopNav.tsx` |
| SubHeader.tsx | `components/nav/SubHeader.tsx` |
| FilterBar.tsx | `components/dashboard/FilterBar.tsx` |
| ExportModal.tsx | `components/nav/ExportModal.tsx` |
| StudyPageHeader.tsx | `components/nav/StudyPageHeader.tsx` |
| ResponsesDashboard.tsx | `components/dashboard/ResponsesDashboard.tsx` |
| AnalyticsDashboard.tsx | `components/analytics/AnalyticsDashboard.tsx` |
| DeployClient.tsx | `app/studies/[id]/deploy/DeployClient.tsx` |
| TeamClient.tsx | `app/team/TeamClient.tsx` |
| AdminClient.tsx | `app/admin/AdminClient.tsx` |
| AdminClientDetail.tsx | `app/admin/[clientId]/AdminClientDetail.tsx` |

### Lib

| File | GitHub Path |
|---|---|
| types.ts | `lib/types.ts` |
| studyDraft.ts | `lib/studyDraft.ts` |
| industryDefaults.ts | `lib/industryDefaults.ts` |

### API Routes

| File | GitHub Path |
|---|---|
| studies route | `app/api/studies/route.ts` |
| studies [id] route | `app/api/studies/[id]/route.ts` |
| respond route | `app/api/respond/route.ts` |
| clarify route | `app/api/clarify/route.ts` |
| study guid route | `app/api/study/[guid]/route.ts` |
| responses route | `app/api/studies/[id]/responses/route.ts` |
| analytics route | `app/api/studies/[id]/analytics/route.ts` |
| invite route | `app/api/invite/route.ts` |
| invite register | `app/api/invite/register/route.ts` |

---

## 17. Known Issues & Pending Actions

### API must return guid

`app/api/studies/route.ts` POST handler must return `{ id, guid }` in the JSON response. If it currently only returns `{ id }`, the Test Survey button in new-study mode will never become active. Verify the `.select()` call after insert includes `guid`.

### Legacy studies without config.industry

Studies created before this session have no `industry` in `config`. When loading in edit mode, `StepBasics` reads `draft.config.industry || (draft as any).industry`. Since neither exists for legacy studies, the industry dropdown shows blank — this is expected. The user can select and save an industry, which will persist correctly for future edits.

### Verification checklist for this session's changes

- [ ] Custom question sampling: `customQCount` set to 2 with 4 questions → only 2 shown per survey session
- [ ] Psychographic questions: open Step 5 on a Healthcare study → questions about attitudes/values not "What type of visit was this?"
- [ ] Industry suggested questions: open Step 4 on a Healthcare study → amber "Suggested for Healthcare" panel shows segmentation questions
- [ ] Test Survey button: create new study, Save as Draft → button becomes active
- [ ] Publish pill: start new study with only name filled → Publish pill is grey; complete all required steps → turns orange
- [ ] Step scroll: click any nav pill → page scrolls to top
- [ ] Industry in edit: load existing study with healthcare industry set → badge shows, not blank dropdown
- [ ] Industry on dashboard: study cards show `· Healthcare` orange pill if industry set
- [ ] Sentiment type: no TypeScript errors in useSurveyEngine around 'promoter'/'passive'/'detractor'
