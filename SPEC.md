# SentimetrX Platform Specification

**Version**: 2026-04-14
**Status**: Production (staging + production repos)

---

## Overview

SentimetrX is a SaaS platform for conversational surveys and AI-powered text analytics. It combines a chatbot-style survey engine with deep text mining, theme extraction, and visual analytics. The platform serves market researchers, CX teams, and brand managers who need to collect and analyze qualitative feedback at scale.

**Repos**:
- Staging: `sentimetrx-staging` (testing before deploy)
- Production: `sentimetrx` (pushes trigger Vercel builds)

**Stack**: Next.js 14, React, TypeScript, Supabase (PostgreSQL + Auth + Storage), Anthropic Claude API, Vercel serverless, Resend email, DataForSEO.

---

## Architecture

```
Browser ─── Next.js (Vercel) ─── Supabase (PostgreSQL)
                │                      │
                ├── Anthropic Claude    ├── Auth (PKCE)
                ├── DataForSEO         ├── Storage (logos, avatars)
                ├── Resend / SES       └── Row-level security
                └── Vercel Cron
```

### Data Flow
- **Surveys**: Public widget (`/s/[guid]`) → `/api/respond` → `responses` table → analytics
- **Datasets**: CSV upload or Google Reviews → `dataset_rows_flat` table → analytics compute → Charts/TextMine/Stats
- **Campaigns**: Template + CSV recipients → Resend API → webhook tracking → respondent status
- **Google Reviews**: DataForSEO search → location picker → async task submit → poll results → dataset rows

### Key Design Decisions
- **No sampling under 50K rows** — TextMine loads all rows client-side for instant filtering
- **Two-phase async for reviews** — DataForSEO tasks take 30-90s, so submit/check pattern across multiple sync calls
- **Server-side theme counting** — `/api/datasets/[id]/theme-counts` for accurate full-dataset counts (avoids sampling bias)
- **Value aliases** — Schema fields can define `valueAliases: Record<string, string>` to remap raw data values to display labels, applied via shared `lib/aliasUtils.ts`
- **Flat row table** — `dataset_rows_flat` stores one row per JSON document for fast pagination; legacy `dataset_rows` stores batched arrays

---

## Database Tables

### User & Organization
| Table | Purpose |
|-------|---------|
| `users` | Authenticated users (org_id, role, email, full_name) |
| `organizations` | Workspaces (name, plan, features JSON, logo_url, is_admin_org) |
| `invites` | Team invitations (token, email, org_id, status) |

### Studies & Responses
| Table | Purpose |
|-------|---------|
| `studies` | Survey configs (name, slug, guid, status, config JSON, bot settings, org_id) |
| `responses` | Survey submissions (study_id, data JSON, sentiment, nps_score, device_fingerprint) |
| `study_response_stats` | Pre-computed response aggregates per study |

### Campaigns & Email
| Table | Purpose |
|-------|---------|
| `campaigns` | Email campaigns (study_id, status, email_provider, config) |
| `campaign_respondents` | Recipients (email, status, sent/opened/clicked timestamps) |
| `campaign_emails` | Email templates (subject, html, text) |
| `campaign_schedules` | Scheduled sends (scheduled_at, status, executed_at) |
| `campaign_send_log` | Delivery history (provider, message_id, status) |

### Datasets & Analytics
| Table | Purpose |
|-------|---------|
| `datasets` | Dataset metadata (name, source, row_count, schema JSON, org_id) |
| `dataset_rows_flat` | Individual rows as JSON documents (dataset_id, row_index, data JSONB) |
| `dataset_rows` | Legacy batched rows (batch_index, rows JSON array) |
| `dataset_state` | Computation state (status, theme_model JSON, analytics JSON) |

### Google Reviews
| Table | Purpose |
|-------|---------|
| `review_sources` | Brand configs (org_id, brand_name, dataset_id, sync_frequency_hours) |
| `review_source_locations` | Locations (place_id, name, address, rating, review_count, error_message) |
| `user_locations` | User-to-location assignment for filtered access |

### Sharing
| Table | Purpose |
|-------|---------|
| `shared_links` | Public share tokens (type, target_id, expires_at, last_accessed_at) |

---

## Feature Modules

### 1. Survey Creator (9-step wizard)

**Route**: `/studies/new`, `/studies/[id]/edit`

Steps:
1. **Basics** — name, bot emoji, brand colors, multi-language (15 langs), response limits
2. **Opening** — NPS, experience rating, 5-point custom scales, sentiment-adaptive variants
3. **Conversation** — Q3/Q4 open-ended follow-up questions
4. **Clarifiers** — keyword bank, AI follow-ups, smart deflection
5. **Questions** — 15 question types (open, radio, checkbox, dropdown, likert, date, rating, numeric, hidden, email, phone, zip, state, message), drag-reorder, skip logic
6. **Psychographics** — industry presets + custom fields
7. **Demographics** — age, gender, zip, custom fields
8. **Contact** — email, phone, field ordering
9. **Review & Publish**

**Survey Widget** (`/s/[guid]`):
- Client-side conversation engine (no server round-trips per question)
- Animated typing with configurable speed (0.25x-2x)
- Language selection, partial auto-save (resumable)
- Device fingerprint duplicate prevention
- AI-powered clarification and smart deflection (Claude API)
- Rate limiting (120 req/min per IP)

### 2. Campaign Manager

**Routes**: `/campaigns`, `/campaigns/[id]`, `/studies/[id]/campaigns`

- Rich email template builder with variable substitution
- Multi-provider: Resend (default), SendGrid, AWS SES, SMTP, Twilio SMS
- Scheduling: one-off or recurring, test sends
- Respondent tracking: sent, opened, clicked, bounced, unsubscribed
- Resend webhook integration for delivery events
- Clone campaigns, bulk CSV export
- Hidden fields for URL parameter pass-through

### 3. Analyze Module

**Routes**: `/analyze`, `/analyze/[datasetId]/charts`, `/analyze/[datasetId]/textmine`, `/analyze/[datasetId]/stats`, `/analyze/[datasetId]/settings`

#### Data Import
- CSV/Excel file upload
- Google Reviews (DataForSEO integration)
- Study responses (auto-linked)
- Auto schema detection with type inference

#### Schema Editor (`/analyze/[datasetId]/settings`)
- Field type override (categorical, numeric, date, open-ended, id, ignore)
- Sub-question type (SQT): rating, NPS, likert, single-select, multi-select, etc.
- Field labels and section grouping (core, psychographic, demographic)
- Value remapping (e.g., 5 → "Very Satisfied") with numeric scale
- **Value aliases** — display-only renaming of raw values (applied across all charts, filters, exports, stats)
- Survey question text (prompt) storage for export slides

#### Charts Module (`ChartsModule.tsx`)
Chart types: Bar/Column, Distribution (histogram/box), Scatter, Crosstab/Heatmap, Time Series, Treemap, Packed Bubbles, Waterfall, Bullet/KPI, Funnel, Gantt, Driver Analysis, Table.

Each chart has configurable slots:
- Category (categorical field)
- Color/Stack by (secondary categorical)
- Value (numeric field for aggregation)
- Split by (for distribution/bullet)

Modes: Count, Percentage, Average. Layout: Vertical/Horizontal, Grouped/Stacked.
Smart Axes: auto-detects ordinal scales and orders appropriately.
Color palettes: 7 built-in (Hermes, Ocean, Sunset, Earth, Pastel, Vivid, Mono).

#### TextMine Module (`TextMineModule.tsx`)

**Sub-tabs**: Themes, Theme Clouds, Compare, Comments

- **Theme Discovery**: Server-side NLP clustering via `/api/datasets/[id]/mine-themes`
- **Theme Editor**: Rename, merge, add/remove keywords, keyword expansion
- **Word Cloud**: Interactive, clickable — shows opinion popover on click
- **Opinion Mining** (`lib/opinionMining.ts`): Clause-aware extraction, adjective→noun mode, conjunction barriers, 2-word window
- **Compare Tab**: Cross-segment theme distribution with significance testing (z-score, p<0.05). By Group and By Theme views. Sticky controls, scrollable results.
- **Comments Panel**: Filter by theme, sentiment, breakdown field. Shows metadata pills, rating colors.
- **Breakdown Sidebar**: Select categorical field to split themes by segment
- **Driver Analysis**: Theme impact on NPS/satisfaction scores
- **Sampling**: 50K row cap, intelligent systematic sampling for larger datasets

#### Stats Module (`StatsModule.tsx`)

Panels: Descriptives, Group Tests, Correlations, Insights

- **Descriptives**: Per-field stats (n, mean, median, stddev, min, max, histogram), skewness/kurtosis
- **Group Tests**: t-test, ANOVA, Mann-Whitney U, Chi-square — drag-and-drop field assignment
- **Correlations**: Pearson matrix, significance flags
- **Insights**: Auto-scan all field combinations for significant patterns

#### Filters (`FiltersModal.tsx`, `FilterContext.tsx`)
- Categorical: checkbox pills with select all/none
- Numeric: range slider
- Date: date range picker
- Global across all tabs (Charts, TextMine, Stats)
- Value aliases applied to filter labels

#### Export
- **PPTX** (`/api/datasets/[id]/export/pptx`): Branded consulting-quality deck with bar charts, theme slides, AI-generated narratives, comment highlights. Accepts `skipAI` body param — when true, skips AI narratives and comment scoring (uses auto-generated text fallbacks). All text elements use `autoFit: true` to prevent overflow.
- **HTML** (`/api/datasets/[id]/export/html`): Reveal.js interactive presentation. Same `skipAI` support.
- **ExportModal**: Reads AI toggle from localStorage; shows amber warning when AI is off; sends `skipAI: !aiEnabled` in request body
- **Shared Links**: Public URLs with 24h/7d/30d expiry, last-accessed tracking

### 4. Google Reviews Integration

**Routes**: `/api/review-sources/*`, `LocationManager.tsx`, `GoogleReviewsWizard.tsx`

**Flow**:
1. Search brand name → DataForSEO Maps API returns locations
2. User selects locations → stored in `review_source_locations`
3. Sync triggers: manual or scheduled (configurable hours)
4. Two-phase async: submit `task_post` → poll `task_get` (30-90s processing)
5. Task refs stored as `pending_task:taskId|getPath` in `error_message` column
6. Reviews parsed → inserted into `dataset_rows_flat`
7. Schema auto-detected, analytics recomputed

**Sync UX** (`LocationManager.tsx`):
- Progress panel with LottieLoader, current location name, review count
- Browser Notification API for completion alerts (works when tab is backgrounded)
- Page title updates with progress (visible in tab bar)
- "You can navigate away" messaging
- Per-location status dots: green (synced), amber pulsing (pending), red (error), grey (unsynced)
- Retry Failed button clears errors for re-submission
- Auto-sync polling every 10s during download

**Limits**: 4,490 reviews per location (DataForSEO max), 10 locations per batch.

### 5. AI Town Hall

**Routes**: `/townhall/*`, `/th/[sessionId]`, `/api/townhall/*`

AI-moderated group discussions. Participants join via link/QR and chat with a named AI bot. Facilitator pre-loads discussion guide topics.

**Chat Engine** (`/api/townhall/chat`):
- Opening question flow → AI matches response to best topic → follows thread → transitions
- iMessage UI: blue user bubbles, gray bot bubbles, typing dots
- Multi-language: language picker, bot messages auto-translated, user responses translated to English for analytics
- Configurable bot name, emoji, opening/closing messages, canned post-session messages
- Response targets per topic with auto-deactivation
- Shared guardrails (`lib/guardrails.ts`)

**Live Theme Detection** (`lib/townhallThemeDetection.ts`):
- Manual trigger (facilitator clicks "Detect Themes") or auto (cron every 5 min)
- Samples corpus, calls Claude Sonnet, deduplicates vs existing themes (>50% keyword overlap = skip)
- Scores sentiment via lexicon (`lib/themeUtils.ts`)
- Detected themes appear as `state='detected'` — facilitator approves/dismisses
- Config: `engine.theme_detection_mode` (off/manual/auto) + interval

**Admin Analytics Panel** (tab in facilitator console):
- Per-theme: keywords, sentiment badges, match counts, percentages, top quotes, keyword frequency
- Overall: sentiment breakdown, responses over time, distribution chart
- Sessions API extended with `?analytics=true`

**Post-Session Questions**:
- Psychographic questions one-at-a-time (randomly sampled from shared `lib/psychoBank.ts`)
- Demographic form (shared `DEMO_BANK` from `lib/types.ts`)
- All canned messages auto-translated to participant's language
- Responses stored in `townhall_participant_responses`

**Full Edit Form**: 6 collapsible sections covering all ~25 config fields. Works in all session states.

**Shared Links**: Token-based public viewer with theme cards, distribution, stats (no individual turns exposed).

**DB Tables**: `townhall_sessions`, `townhall_themes` (keywords, sentiment, detection lifecycle), `townhall_turns` (user_message + user_message_en), `townhall_participant_responses`

### 6. Shared Dashboards

**Route**: `/shared/[token]`

- **Study dashboard**: response count, rating charts, score breakdown
- **Campaign dashboard**: delivery funnel, open/click rates, target progress
- **Town Hall dashboard**: theme cards with sentiment/keywords, distribution, aggregated stats
- No authentication required
- Link expiry (24h/7d/30d), last-accessed tracking, refresh button
- Cleanup cron daily at 3am UTC

### 7. AI Features

All powered by Anthropic Claude API. **AI toggle** (`sentimetrx_ai_enabled` in localStorage) controls all analytics AI:

**Toggle behavior**: Header toggle in `DatasetHeader.tsx` sets `localStorage.sentimetrx_ai_enabled` to `'1'`/`'0'`. All AI-consuming components poll localStorage every 2s for real-time sync.

**When AI is OFF — zero AI calls are made:**
- TextMine: "Mine" button disabled, ThemeEditor keyword expansion blocked (apiKey withheld)
- Stats: "Generate Narrative" button disabled, insights API not called
- Export (PPTX/HTML): `skipAI` flag sent in request body; server skips `generateNarratives()` and AI comment scoring; ExportModal shows amber warning banner explaining data-only output
- CommentsPanel: "AI Summary" button disabled (apiKey withheld)

**AI-powered features:**
- **In-survey clarification** (`/api/clarify`) — follow-up on vague answers
- **Smart deflection** (`/api/deflect`) — redirect off-topic responses
- **Study generation** (`/api/ai/study-suggest`) — AI-generated survey config from description
- **Translation** (`/api/translate`) — 15 languages
- **Export narratives** — AI-generated insights for PPTX/HTML slides (requires AI toggle ON)
- **Theme mining** — NLP-based keyword clustering (requires AI toggle ON)
- **Keyword expansion** — synonym detection for theme keywords (requires AI toggle ON)
- **Comment scoring** — AI relevance scoring for theme quotes in exports (requires AI toggle ON)

### 8. Admin & Settings

**Routes**: `/admin/*`, `/settings/team`

- Organization management (create, edit, feature toggles)
- User management (invite, roles, remove)
- Global question bank (reusable questions across studies)
- Feature flags per org (analyze, campaigns, bot, etc.)
- Client management (for multi-tenant SaaS)

---

## API Routes Summary

| Category | Count | Examples |
|----------|-------|---------|
| Studies & Surveys | 10 | `/api/studies`, `/api/study/[guid]`, `/api/respond` |
| Campaigns & Email | 14 | `/api/campaigns/[id]/send`, `/api/campaigns/webhooks/resend` |
| Datasets & Analytics | 14 | `/api/datasets/[id]/rows`, `/api/datasets/[id]/aggregate` |
| Dataset Export | 3 | `/api/datasets/[id]/export/pptx`, `/api/datasets/[id]/export/html` |
| Google Reviews | 9 | `/api/review-sources/search`, `/api/review-sources/[id]/sync` |
| Town Hall | 10 | `/api/townhall/chat`, `/api/townhall/join/[id]`, `/api/townhall/themes/detect` |
| AI Features | 6 | `/api/clarify`, `/api/deflect`, `/api/translate` |
| Sharing | 2 | `/api/share` (study, campaign, townhall) |
| Chat/Bot | 3 | `/api/bot-chat`, `/api/nora-chat`, `/api/clara-chat` |
| Org & Users | 8 | `/api/orgs`, `/api/invite`, `/api/settings/profile` |
| Admin | 8 | `/api/admin/orgs`, `/api/admin/questions` |
| Cron Jobs | 4 | `/api/cron/campaign-scheduler`, `/api/cron/review-sync`, `/api/cron/townhall-theme-detection` |

**Total**: ~91 API routes

---

## Shared Utilities

| Module | Purpose |
|--------|---------|
| `lib/aliasUtils.ts` | Value alias resolution (resolveAlias, aliasedCounts, buildAliasMap) |
| `lib/scaleUtils.ts` | Ordinal scale detection, smart ordering, direction labels |
| `lib/filterUtils.ts` | Filter application, serialization, count helpers |
| `lib/themeUtils.ts` | Theme matching, keyword regex, lemma expansion, lexicon sentiment scoring (no AI) |
| `lib/psychoBank.ts` | Shared psychographic question bank (15 general-purpose questions) |
| `lib/townhallThemeDetection.ts` | Server-side live theme detection for Town Hall sessions |
| `lib/guardrails.ts` | Shared input/output validation (surveys + town halls) |
| `lib/statsUtils.ts` | Significance testing (z-score, chi-square, effect sizes) |
| `lib/opinionMining.ts` | Aspect-opinion extraction, clause splitting, stop words |
| `lib/analyticsCompute.ts` | Field summary computation (counts, histograms, topN) |
| `lib/dataforseo.ts` | DataForSEO API client (search, submit tasks, check results) |
| `lib/reviewSync.ts` | Google Reviews sync orchestration |
| `lib/useSessionState.ts` | SessionStorage-backed React state hook |

---

## Known Constraints & Limits

| Constraint | Value | Notes |
|-----------|-------|-------|
| Supabase max rows per request | 1,000 | Pagination required for larger datasets |
| TextMine sample cap | 50,000 rows | No sampling below this |
| DataForSEO review limit | 4,490 per location | Google API hard cap |
| DataForSEO batch size | 10 locations per sync call | Prevents serverless timeout |
| Serverless function timeout | 120s (export routes) | Vercel Pro plan |
| PPTX row cap | 10K (no filter), 30K (filtered) | Memory constraint |
| Campaign send rate | Resend free tier: 100/day | Configurable provider |
| Analytics topN | 20 values | Field summary value lists |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (server only) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `RESEND_API_KEY` | Resend email provider |
| `DATAFORSEO_LOGIN` | DataForSEO username |
| `DATAFORSEO_PASSWORD` | DataForSEO password |
| `NEXT_PUBLIC_BASE_URL` | Public URL for links |

---

## Deployment

- **Staging**: `sentimetrx-staging` repo → Vercel project (manual push)
- **Production**: `sentimetrx` repo → Vercel project (manual push)
- **Promotion**: rsync staging → production, then push
- **DB Migrations**: SQL files in `sql/` directory, applied manually to Supabase
