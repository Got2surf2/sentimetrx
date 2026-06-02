# Sentimetrx Platform Specification

**Version**: 2026-05-15
**Status**: Production

---

## Overview

Sentimetrx is a SaaS platform for conversational surveys, AI-moderated live group conversations (PulseIQ), AI agents, social media monitoring, and AI-powered text analytics across multiple qualitative data sources. It serves market researchers, CX teams, brand managers, and consumer-insight teams who need to collect, ingest, and analyze qualitative feedback at scale.

**Repo**: `sentimetrx` — single repo on `main`. Pushes to `main` trigger Vercel production builds. Staging is retired.

**Stack**: Next.js 16 App Router, React 19, TypeScript (strict), Supabase (PostgreSQL + Auth + Storage with RLS), pluggable AI providers (Anthropic Claude default, OpenAI, Azure OpenAI) routed through `lib/ai.ts`, Vercel serverless / Fluid Compute, Resend (default email), SendGrid / AWS SES / SMTP / Twilio SMS, DataForSEO (Google + Tripadvisor reviews), Reddit / Substack / Regulations.gov APIs.

---

## Architecture

```
Browser ─── Next.js (Vercel Fluid) ─── Supabase (PostgreSQL + Auth + Storage)
                │                          │
                ├── lib/ai.ts (provider     ├── PKCE auth
                │  router: Anthropic /      ├── RLS-enforced multi-tenancy
                │  OpenAI / Azure OpenAI)   └── pgvector / GIN / tsvector
                ├── DataForSEO (Google + Tripadvisor reviews)
                ├── Reddit / Substack / Regulations.gov APIs
                ├── Resend / SendGrid / SES / SMTP / Twilio SMS
                ├── Social provider APIs (FB / IG / Reddit / X / etc.)
                └── Vercel Cron (9 jobs)
```

### Data Flow
- **Surveys**: Public widget (`/s/[guid]`) → `/api/respond` → `responses` table → analytics
- **PulseIQ**: Participant link (`/th/[sessionId]`) → `/api/townhall/chat` → `townhall_turns` → live theme detection (auto/manual)
- **Agents** (internal: `bots`): Embeddable widget (`/b/[slug]`) → `/api/bots/[id]/chat` → `bot_conversation_turns` → conversation review cron
- **Datasets**: CSV / Google + Tripadvisor reviews / Reddit threads / Substack comments / Regulations.gov comments / Social media exports → `dataset_rows_flat` → analytics compute → Charts/TextMine/Stats/Entities/Search
- **Campaigns**: Template + recipient list → Resend / SendGrid / SES / SMTP / Twilio SMS → webhook tracking → respondent status
- **Social moderation**: OAuth-connected accounts → `social-sync` cron pulls comments → AI tags sentiment + intent → optional auto-reply / hide / DM
- **Brand profiles**: `collections.kind='brand'` rows act as the brand profile; entity catalog drives mention extraction across all sources

### Key Design Decisions
- **No sampling under 50K rows** — TextMine loads all rows client-side for instant filtering. Above 50K, deterministic per-dataset sampling.
- **Two-phase async for reviews** — DataForSEO tasks take 30-90s, so submit/check pattern across multiple sync calls
- **Server-side theme counting** — `/api/datasets/[datasetId]/theme-counts` for accurate full-dataset counts (avoids sampling bias)
- **Value aliases** — Schema fields can define `valueAliases: Record<string, string>` to remap raw data values to display labels, applied via shared `lib/aliasUtils.ts`
- **Flat row table** — `dataset_rows_flat` is the sole source of truth: one row per JSON document, GIN-indexed on `data` for JSONB lookups and on `tsv` for full-text search. Legacy `dataset_rows` batched table was removed in May 2026.
- **Pluggable AI** — All AI calls go through `lib/ai.ts → callAI()` which routes to Anthropic (default), OpenAI, or Azure OpenAI based on per-org config (`org.config.ai_provider`) or BYO-key. `lib/usageLog.ts` records every call.
- **Multi-tenancy invariants** — Every `public` table has RLS enabled + an org-scoped `SELECT` policy. Service-role queries must pair `id` with `org_id` (`.eq('id', x).eq('org_id', orgId)`) — never trust the path id alone. Internal-only routes (deck exports, governance, admin) wrap with `requireAdmin` from day one.

---

## Database Tables

### User & Organization
| Table | Purpose |
|-------|---------|
| `users` | Authenticated users (org_id, role, email, full_name) |
| `organizations` | Workspaces (name, plan, features JSON, logo_url, is_admin_org, ai provider config) |
| `clients` | Sub-clients owned by an org (multi-tenant SaaS reseller flow) |
| `invites` | Team invitations (token, email, org_id, status) |
| `user_logins` | Login event log (user_id, ts, ip, user_agent) |
| `user_events` | Generic per-user activity events |
| `org_transfers` | Cross-org transfer log (for admin re-parenting) |
| `admin_action_log` | Audit trail of admin-only mutations |
| `ai_consent_audit` | AI consent acceptance per user |
| `rate_limit_buckets` | Token-bucket state for per-IP / per-org rate limits |

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
| `dataset_rows_flat` | Individual rows as JSON documents (dataset_id, row_index, data JSONB). Source of truth — every read and write goes here. GIN-indexed `tsv` column for full-text search. |
| `dataset_state` | Computation state (status, theme_model JSON, analytics JSON) |
| `archived_dataset_rows_flat` | Archive snapshot of `dataset_rows_flat` for retention / deletion safety |
| `dataset_row_taxonomy` | Per-row 7-axis ABSA taxonomy (Ruth's Chris pilot 2026-05-27). One row per `(dataset_id, row_id)` with `axis_touchpoint`, `axis_attribute`, `axis_product`, `axis_beverage`, `axis_ambiance`, `axis_context`, `axis_outcome` text[] arrays + `alert_tags` (severity:alert/crisis subset) + full structured `assertions` jsonb + `raw_legacy_tags`. Closed vocabulary in `lib/taxonomyVocabulary.ts`. RLS org-scoped + GIN indexes on each axis. |

### Reviews / Locations (Google + Tripadvisor)
| Table | Purpose |
|-------|---------|
| `review_sources` | Brand configs (org_id, brand_name, dataset_id, sync_frequency_hours, `source` ∈ {google, tripadvisor}) |
| `review_source_locations` | Locations (place_id or url_path, name, address, rating, review_count, error_message) |
| `user_locations` | User-to-location assignment for filtered access |
| `review_downloads` | Per-org rolling-window download counter for cost limits |

### Data Sources (non-review)
| Table | Purpose |
|-------|---------|
| `reddit_sources` | Subreddit watch list (org_id, subreddit, dataset_id, sync_frequency_hours) |
| `reddit_source_threads` | Threads fetched per source with sync state |

Substack and Regulations.gov sources do not have their own tables — they write directly into `datasets` + `dataset_rows_flat`.

### Brands, Collections & Entities
| Table | Purpose |
|-------|---------|
| `collections` | Generic group entity (org_id, name, kind ∈ {collection, brand, ...}). Brand profiles are rows with `kind='brand'`. |
| `collection_members` | Membership table linking entities (e.g. datasets) into a collection |
| `entity_catalog` | Per-scope catalog of named entities (id, scope_type ∈ {dataset, collection, bot}, scope_id, canonical, slug, category, aliases, sample_count, source ∈ {discovered, manual}, hidden). Dataset/collection scope = brand-relevant entities for analytics filtering; bot scope = KB-extracted entities for user-turn mention tagging (BOTS.md § 9.y). |
| `entity_catalog_refresh` | Refresh job state for the entity catalog |
| `entity_mentions` | Per-row entity hits across datasets (dataset_id, row_index, entity_id, count, span) |

### AI Agents (internal: `bots`)
| Table | Purpose |
|-------|---------|
| `bots` | Agent configs (org_id, name, slug, persona, knowledge sources, behavior, `config.probeEnforcement` for bot-specific required probes) |
| `bot_knowledge_chunks` | Embedded RAG chunks for agent knowledge bases |
| `bot_conversation_turns` | Per-turn message log (session_id, role, content, language) |
| `bot_conversation_reviews` | AI-generated review of each conversation (themes, sentiment, intent) |
| `bot_session_personas` | Inferred persona attributes per conversation session |
| `bot_change_log` | Append-only audit trail of every bot mutation (create / update / delete / status_change / knowledge_added / knowledge_cleared / import). RLS read for own-org + admin-org; service-role writes only via `lib/auditLog.ts`. Migration `sql/074`. |

### Social Media Monitoring
| Table | Purpose |
|-------|---------|
| `social_connections` | OAuth-connected social accounts per org (provider, access_token, refresh_token, scopes) |
| `social_comments` | Comments / mentions pulled from connected accounts, with AI tags |
| `social_moderation_log` | Actions taken on comments (reply / hide / delete / DM) |
| `social_alert_rules` | Per-org alerting rules (keyword, sentiment threshold, etc.) |
| `social_alerts_sent` | Delivery log of alerts to prevent duplicates |
| `social_dm_log` | Outbound DM history (templating, recipient) |

### Usage Accounting
| Table | Purpose |
|-------|---------|
| `usage_logs` | Per-call AI usage (org_id, provider, model, input_tokens, output_tokens, cost, tier, feature) |

### Sharing
| Table | Purpose |
|-------|---------|
| `shared_links` | Public share tokens (type ∈ {study, campaign, townhall, dataset-html-export, ...}, target_id, expires_at, last_accessed_at, org_id) |
| `deck_download_log` | Audit log of internal deck-export downloads |

### Observability
| Table | Purpose |
|-------|---------|
| `sentry_snapshots` | Periodic Sentry issue digest snapshots (read by daily digest cron) |
| `webhook_events` | Idempotency ledger for inbound signed webhooks. `UNIQUE (source, svix_id)` short-circuits Resend retries before any campaign state mutates. |

---

## Feature Modules

### 1. Survey Creator (10-step wizard)

**Route**: `/studies/new`, `/studies/[id]/edit`

Steps:
1. **Basics** — name, bot emoji, brand colors, multi-language (16 langs), response limits
2. **Opening** — NPS, experience rating, 5-point custom scales, sentiment-adaptive variants
3. **Conversation** — Q3/Q4 open-ended follow-up questions
4. **Clarifiers** — keyword bank, AI follow-ups, smart deflection
5. **Questions** — 14 question types (`open`, `radio`, `checkbox`, `dropdown`, `likert`, `date`, `rating`, `numeric`, `hidden`, `email`, `phone`, `zip_code`, `us_state`, `message`), drag-reorder, skip logic
6. **Psychographics** — industry presets (19 industries) + custom fields
7. **Demographics** — age, gender, zip, custom fields
8. **Contact** — email, phone, field ordering
9. **Closing** — thank-you message, redirect URL, post-submit canned messages
10. **Review & Publish**

**Survey Widget** (`/s/[guid]`):
- Client-side conversation engine (no server round-trips per question)
- Animated typing with configurable speed (0.25x-2x)
- Language selection, partial auto-save (resumable)
- Device fingerprint duplicate prevention
- AI-powered clarification and smart deflection via `lib/ai.ts` (provider configurable)
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

- **Theme Discovery**: Server-side NLP clustering via `/api/datasets/[datasetId]/mine-themes`
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
- **PPTX** (`/api/datasets/[datasetId]/export/pptx`): Branded consulting-quality deck with bar charts, theme slides, AI-generated narratives, comment highlights. Caps rows at 10K unfiltered / 30K filtered. Accepts `skipAI` body param — when true, skips AI narratives and comment scoring (uses auto-generated text fallbacks). All text elements use `autoFit: true` to prevent overflow. `maxDuration = 120s`.
- **HTML** (`/api/datasets/[datasetId]/export/html`): Reveal.js interactive presentation. Same `skipAI` support.
- **Signals PPTX** (`/api/datasets/[datasetId]/export/signals-pptx`): Signals-tier branded export.
- **Entity Analysis Deck** (`/api/entity-analysis-deck`): Per-entity PPTX export for brand profiles.
- **ExportModal**: Reads AI toggle from localStorage; shows amber warning when AI is off; sends `skipAI: !aiEnabled` in request body
- **Shared Links**: Public URLs with 24h/7d/30d expiry, last-accessed tracking

### 4. Google + Tripadvisor Reviews Integration

**Routes**: `/api/review-sources/*`, `LocationManager.tsx`, `GoogleReviewsWizard.tsx`

`review_sources.source` discriminates Google (default) from Tripadvisor; the per-location identifier column is reused (Google `place_id` for Google, Tripadvisor `url_path` for Tripadvisor).

**Flow**:
1. Search brand name → DataForSEO Maps API (Google) or Tripadvisor URL flow returns locations
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

**Taxonomy pilot (admin-only, Ruth's Chris 2026-05-27)** — closed-vocab 7-axis ABSA replacement for vendor CX tagging.
- Storage: `dataset_row_taxonomy` (see § Database Tables). One row per `(dataset_id, dataset_rows_flat.id)`.
- Vocabulary: `lib/taxonomyVocabulary.ts` (axes + sub-buckets + product items + severity {normal|alert|crisis}).
- Legacy projection: `lib/taxonomyMapping.ts` canonicalizes case-duplicate labels, routes `Service-X/SERV-X/Staff-X` parallels to `(touchpoint, attribute)` tuples, quarantines TEST (~21% of source rows), `Brand Alert`, campaign tags, and competitor `LH/OG/CSK Menu-*` prefixes.
- LLM extractor: `lib/taxonomyExtractor.ts` wraps `callAI` (`fast` tier = Haiku) with a closed-vocab structured-output prompt. Output validation drops out-of-vocab subs into `unmapped_subs` for monthly triage. `parseExtractorOutput()` exported for script use without the `'server-only'` chain.
- Pipeline: `scripts/pilot-rc-ingest.ts` (CSV → dataset under admin org), `scripts/pilot-rc-classify.ts` (concurrent classifier driver), `scripts/pilot-rc-regression.ts` (5-anchor regression — must pass before declaring the pilot green).
- Viewer: `/admin/taxonomy-pilot/[datasetId]` — side-by-side verbatim · legacy tags · structured assertions with axis-colored chips + alert/crisis badges. Wrapped with `requireAdmin`.
- API: `/api/admin/taxonomy-pilot/[datasetId]` paged read of rows + taxonomy.

**Limits**: 4,490 reviews per location (DataForSEO max). Per-org cost ceiling enforced via `review_downloads`.

### 5. PulseIQ (internal: `townhall` legacy + `town_halls` phase-3 substrate)

**Routes**: `/townhall/*` (admin), `/th/[sessionId]` (public participant), `/api/townhall/*`

AI-moderated live group discussions. Participants join via link/QR and chat with a named AI agent. Facilitator pre-loads a discussion guide of topics. (User-facing name is **PulseIQ**; tables and routes remain `townhall_*` internally.)

> **Convergence Phase 5 complete (2026-05-22)**: PulseIQ now runs on a **unified conversational substrate** shared with Agents (`conversations` + `conversation_turns`), plus PulseIQ-specific tables (`town_halls`, `town_hall_conversations`, `town_hall_topics`) for the cohort layer. The chat handler is the same `lib/chatCore.handleChatTurn` that powers `/api/bots/[id]/chat`. The legacy `townhall_sessions/_themes/_turns` tables remain in service for pre-convergence sessions and will be dropped in Tier 5 cleanup after a prod verification window. Routing decisions are substrate-aware via `lib/townHallAdapter.ts` (read adapter projects new-substrate rows into the same JSON shape the facilitator dashboard consumes). NOWOCATS (early June launch) is the first town hall on the new substrate; Vindman follows post-launch using the same Sir O'Gate bot. Each event = one `town_halls` row; cross-event analysis combines per-event datasets in Analytics. See `docs/CONVERGENCE.md` for the architectural decision + sequencing plan and `docs/TOWNHALL.md` Facilitator Console block for the per-route substrate awareness.

**Chat Engine** (`/api/townhall/chat`):
- Opening question flow → AI matches response to best topic → follows thread → transitions
- iMessage UI: blue user bubbles, gray bot bubbles, typing dots
- Multi-language: language picker, bot messages auto-translated, user responses translated to English for analytics (`townhall_turns.user_message_en`)
- Configurable bot name, emoji, opening/closing messages, canned post-session messages
- Response targets per topic with auto-deactivation
- Shared guardrails (`lib/guardrails.ts`)
- Pluggable AI provider via `callAI()`

**Live Theme Detection** (`lib/townhallThemeDetection.ts`):
- Manual trigger (facilitator clicks "Detect Themes") or auto (cron `/api/cron/townhall-theme-detection` every 15 min)
- Samples corpus, calls AI provider, deduplicates vs existing themes (>50% keyword overlap = skip)
- Scores sentiment via lexicon (`lib/themeUtils.ts`)
- Detected themes appear as `state='detected'` — facilitator approves/dismisses
- Config: `engine.theme_detection_mode` (off/manual/auto) + interval

**Simulator**: `/admin/simulator/townhall` generates synthetic participants for load testing the chat engine.

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

### 6. Agents (internal: `bots`)

**Routes**: `/bots/*` (admin), `/b/[slug]` (public embeddable widget), `/api/bots/*`, `/api/bot-chat`, `/api/clara-chat`, `/api/nora-chat`

Embeddable AI agents with a configurable persona, knowledge base, and behavior. (User-facing name is **agents**; tables and routes remain `bots`/`bot_*` internally.)

- **Persona & behavior**: name, emoji, system prompt, opening message, language, guardrails (`lib/guardrails.ts`, `lib/contentGuard.ts`)
- **Knowledge** (`bot_knowledge_chunks`): URL ingest, deep crawl, paste/upload — embedded into pgvector chunks for RAG via `lib/embeddings.ts`. Routes: `/api/bots/deep-crawl`, `/api/bots/fetch-url`, `/api/bots/research`, `/api/bots/[id]/knowledge`.
- **Conversations**: `/api/bots/[id]/chat` (CSRF-bypassed wildcard-CORS embed endpoint), turns logged to `bot_conversation_turns`. Session personas inferred into `bot_session_personas`.
- **Conversation review**: cron `/api/cron/bot-conversation-review` every 4h scans new turns and writes themes/sentiment/intent into `bot_conversation_reviews`. Exposed via `/api/bots/[id]/conversations/reviews` and `/api/bots/[id]/conversations/insights-deck`.
- **Specialty agents**: pre-configured agents — `clara` (clarification), `nora` (NPS-style), embeddable via `/api/clara-chat`, `/api/nora-chat`.
- **Audit log** (`bot_change_log`, since 2026-05-19): every mutation on a bot writes a row via `lib/auditLog.ts → logBotChange()`. Surfaced at `/bots/[id]/history` with before/after diffs. Wired into POST `/api/bots`, PATCH/DELETE `/api/bots/[id]`, POST/DELETE `/api/bots/[id]/knowledge`, POST `/api/bots/import`.
- **JSON export/import** (`/api/bots/[id]/export`, `/api/bots/import`): versioned snapshot of bot row + knowledge chunks; import recreates a draft bot in the caller's org with auto-suffixed slug on collision. Pilot-clone pattern (clone-modify-test) lives on top of this without a separate "duplicate" feature.
- **Probe enforcement** (`bot.config.probeEnforcement`): bot-specific required probes (e.g. counter-perspective probe in the Sir O'Gate Counter-Perspective Pilot). The chat route counts user turns server-side, scans assistant turns for a configured detection regex, and appends a CRITICAL OVERRIDE system instruction last when the turn count crosses `fallbackTurn` without the probe firing. See `docs/BOTS.md` § 7 for the prompt block and config shape.
- **Regression harness** (`/admin/sarina-regression`, `scripts/_run_sarina_regression.ts`): 22-scenario test suite for the NOWOCATS Sarina agent — same source-of-truth tests file backs the admin UI button and the CLI runner. Encodes the May-2026 Arjun test log as machine-checkable `mustInclude` / `mustNotInclude` regex assertions.
- **Question Log** (`logged_questions` table, `lib/logQuestion.ts`, `/bots/[id]/questions` admin UI, since 2026-05-21/22): durable record of every user turn the bot couldn't (or didn't) answer. Captured fire-and-forget from `lib/chatCore.ts` at three signals: `deflect` (deflection router fired), `kb_miss` (RAG topConfidence < 0.05 and no KB fallback), `ai_uncertain` (reply matched an "I don't know"-family regex). Admin UI: two tabs (All questions / Unanswered queue) with inline status mutation (`open | answered | referred | n_a`) + notes + deep-link to the source conversation. CSV export at `/api/bots/[id]/questions/export.csv` with PII redaction (email / NA-style phone / US street address) by default; superadmin `?reveal=1` unmasks (filename includes `_unredacted` so the artifact is self-describing). Driver: NOWOCATS PM-2 legal-defensibility requirement, but the feature is generic across every agent. See `docs/BOTS.md` § 9.x for the full spec + the deferred probe-focus tagging follow-up.
- **Entity-from-KB mention tagging** (`entity_catalog` table with `scope_type='bot'`, `lib/botEntityExtraction.ts`, `lib/entityMentionDetector.ts`, `/bots/[id]/entities` admin UI, since 2026-05-22): per-agent named-entity catalog extracted from `bot_knowledge_chunks` via Haiku, plus a per-turn string-match classifier that flags user turns mentioning any catalog entity with `entity:<slug>` in `content_flags`. Extraction is admin-triggered only (no auto-trigger on KB chunk insert); detection runs synchronously per turn at $0 (`lib/entityVariants.ts` plural/singular expansion + word-boundary regex, longest-first precedence). 8 categories (person / place / organization / product / program / event / policy / other). New rows with `sample_count=1` land `hidden=true` for noise reduction; admin can unhide, edit, or hand-curate. Pills render emerald in all four transcript surfaces (admin modal, public shared HTML, PulseIQ facilitator modal, Question Log) via `lib/flagStyles.ts`. Driver: unlock structured "who asked about X" queries across every agent's conversations. See `docs/BOTS.md` § 9.y for the full spec + retrospective.

### 7. Social Media Monitoring

**Routes**: `/social/*`, `/api/social/*`

OAuth-connected social account moderation across Facebook, Instagram, Reddit, X, and others. AI tags every inbound comment with sentiment + intent; rules engine optionally auto-replies, hides, or sends DMs.

- **OAuth flow**: `/api/social/connect` → provider authorize → `/api/social/callback` (state HMAC-signed via `lib/oauthState.ts`). Tokens stored in `social_connections` with refresh logic on `social-token-refresh` cron (daily 6 UTC).
- **Sync**: `social-sync` cron (every 15 min) pulls comments per active connection into `social_comments`, tagging via `lib/socialTagging.ts`.
- **Moderation actions**: reply / hide / delete / DM — each writes to `social_moderation_log`. Endpoints: `/api/social/comments/[id]/{reply,hide,delete,dm,handle,ai-reply}`.
- **Webhooks**: `/api/social/webhook` receives provider push events with HMAC verification (CSRF-bypassed).
- **Alerts**: `social_alert_rules` → `social_alerts_sent` (dedupe). `/api/social/alerts`.
- **Export to dataset**: `/api/social/export-dataset` converts a comment set into a regular dataset for full Analyze tooling.
- **Demo mode**: `/api/social/demo` for sales walkthroughs.

### 8. Data Sources

**Routes**: `/api/review-sources/*`, `/api/reddit-sources/*`, `/api/substack-sources/*`, `/api/regulations-sources/*`

Pluggable ingest pipelines that feed `dataset_rows_flat` from external qualitative sources. All sources produce the same flat-row shape so the rest of Analyze treats them identically.

- **Google Reviews + Tripadvisor** (DataForSEO) — see § 9 below for the detailed two-phase async flow.
- **Reddit** (`lib/reddit.ts`, `lib/redditSync.ts`) — subreddit watch list (`reddit_sources`), threads landed in `reddit_source_threads`, comments flattened into rows. Routes: search, sync, download-thread.
- **Substack** (`lib/substack.ts`) — paste publication URL → list posts → download all comments per post into rows. No source table; writes directly to a dataset.
- **Regulations.gov** (`lib/regulations.ts`) — search dockets → batch-download comments into a dataset.

Per-org cost limits enforced via `review_downloads` (rolling window).

### 9. Shared Dashboards

**Route**: `/shared/[token]`

- **Study dashboard**: response count, rating charts, score breakdown
- **Campaign dashboard**: delivery funnel, open/click rates, target progress
- **PulseIQ dashboard**: theme cards with sentiment/keywords, distribution, aggregated stats (no individual turns exposed)
- **Dataset HTML export**: shareable Reveal.js presentation
- No authentication required
- Link expiry (24h/7d/30d), last-accessed tracking, refresh button
- Cleanup cron `/api/cron/cleanup-shared-links` daily at 3am UTC

### 10. AI Features

All AI calls route through `lib/ai.ts → callAI()`, which dispatches to the configured provider (Anthropic Claude default, OpenAI, or Azure OpenAI) per-org. BYO-key flow lets an org provide its own provider credentials. Every call is logged in `usage_logs` via `lib/usageLog.ts`.

**AI toggle** (`sentimetrx_ai_enabled` in localStorage) controls all analytics AI:

**Toggle behavior**: Header toggle in `app/analyze/[datasetId]/DatasetHeader.tsx` sets `localStorage.sentimetrx_ai_enabled` to `'1'`/`'0'`. All AI-consuming components poll localStorage every 2s for real-time sync. `useOrgAiMode` hook syncs with `/api/me/ai-mode` (org-level override).

**When AI is OFF — zero AI calls are made:**
- TextMine: "Mine" button disabled, ThemeEditor keyword expansion blocked (apiKey withheld)
- Stats: "Generate Narrative" button disabled, insights API not called
- Export (PPTX/HTML): `skipAI` flag sent in request body; server skips `generateNarratives()` and AI comment scoring; ExportModal shows amber warning banner explaining data-only output
- CommentsPanel: "AI Summary" button disabled (apiKey withheld)

**AI-powered features:**
- **In-survey clarification** (`/api/clarify`) — follow-up on vague answers
- **Smart deflection** (`/api/deflect`) — redirect off-topic responses
- **Study generation** (`/api/ai/study-suggest`, `/api/suggest`) — AI-generated survey config from description
- **Translation** (`/api/translate`, `/api/translate-responses`) — 16 languages
- **Export narratives** — AI-generated insights for PPTX/HTML slides (requires AI toggle ON)
- **Theme mining + keyword expansion + merge** (`mine-themes`, `expand-keywords`, `merge-themes`) (requires AI toggle ON)
- **Entity discovery** — auto-extract brand-relevant entities per dataset (`discover-entities`, weekly `entity-discovery` cron)
- **Comment scoring** — AI relevance scoring for theme quotes in exports (requires AI toggle ON)
- **Agent chat** — `/api/bots/[id]/chat`, `/api/bot-chat`, `/api/clara-chat`, `/api/nora-chat`
- **PulseIQ chat + theme detection** — `/api/townhall/chat` and the theme-detection cron
- **Social auto-tagging + reply suggestions** — sentiment, intent, AI reply drafts on inbound comments
- **Conversation review** — `bot-conversation-review` cron

### 11. Admin & Settings

**Routes**: `/admin/*`, `/settings/team`, `/api/admin/*`, `/api/settings/*`

- Organization management (create, edit, feature toggles, primary industries, AI provider/key)
- User management (invite, roles, remove, bulk-invite via CSV)
- Global question bank (reusable questions across studies)
- Feature flags per org — 9 module toggles (surveys, campaigns, analyze, agents, pulseiq, social, brands, decks, governance)
- Client management (sub-clients owned by an org for multi-tenant SaaS)
- Admin-only deck routes (gated by `requireAdmin`): pitch, rollup, architecture, engineering-reality, agent-capabilities, entity-analysis, pulseiq, signal-tiers, restaurant-expansion. Downloads logged to `deck_download_log`.
- Health: `/admin/health`, content-guard tester, agent tester, simulators (PulseIQ load), Sentry digest viewer, usage estimator, governance reports.
- **Per-tenant backups** (`/admin/backups`, `/admin/backups/[orgId]`): admin-gated browser + restore UI on top of the nightly S3 snapshot cron. Lists every org with on-demand "Snapshot now" + per-org snapshot browser. Restore offers `merge` (upsert by id) and `replace` (also delete rows not in snapshot, opt-in). Refuses if `snapshot.meta.org_id` doesn't match the URL org id. Requires retyping the org slug to confirm. See `docs/BACKUPS.md` for AWS setup + IAM policy.
- **Sarina regression tester** (`/admin/sarina-regression`): button to re-run Arjun's 22-scenario test against the live NOWOCATS bot; per-test pass/partial/fail with reply text + RAG debug.

### 12. Progressive Web App / Mobile Status

**Routes**: `/m`, `/manifest.webmanifest`, `/sw.js`. **Files**: `app/manifest.ts`, `app/m/page.tsx`, `app/m/MobileStatusClient.tsx`, `public/sw.js`, `public/icons/icon-{180,192,512}.png`.

A focused mobile-first status surface that installs as a home-screen app on iOS via Safari's **Add to Home Screen** (no App Store involvement). Provides a one-screen "check the status of things" view: per-section counts + the five most-recent items for **Datasets**, **Agents**, **Surveys**, **Campaigns**, **PulseIQ**. Heavy workflows (TextMine, builders, admin tables) deep-link back to the desktop UI rather than reimplementing on phone.

- **Manifest** (`app/manifest.ts`): Next.js 14 file-convention manifest, served as `/manifest.webmanifest`. `start_url=/m`, `display=standalone`, theme color `#e8622a`. Three icon sizes (180/192/512 PNG, generated from `public/favicon.svg` via `sips`) plus a maskable 512 for Android adaptive icons.
- **Service worker** (`public/sw.js`): minimal install/activate/fetch handlers, no offline caching for v1 (the status surface reads live counts; a stale cache would lie). Registered scope `/` on the `/m` route only. Present-but-passive is enough for iOS to treat the site as installable and to unlock web push later (iOS 16.4+).
- **Auth + multi-tenancy**: standard Supabase auth on `/m` (redirects to `/login?next=/m` when unauthenticated). Service-role reads are filtered to the caller's `org_id`; admin orgs bypass per the standard CLAUDE.md multi-tenancy rule.
- **iOS integration**: root `layout.tsx` exports `appleWebApp` metadata (capable, title, status-bar style) + viewport `viewportFit=cover` so the page paints under the iPhone notch in standalone mode. apple-touch-icon points at `/icons/icon-180.png`.
- **No App Store distribution.** Install path is Share → Add to Home Screen on iOS Safari. If we later need broader distribution (TestFlight, App Store, push notifications beyond web push), the next step is Expo + EAS.

---

## API Routes Summary

| Category | Examples |
|----------|---------|
| Studies & Surveys | `/api/studies`, `/api/studies/[id]/{analytics,analyze,responses,design-export}`, `/api/study/[guid]`, `/api/respond` |
| Campaigns & Email | `/api/campaigns`, `/api/campaigns/[id]/{send,clone,emails,export,respondents,stats,test-send}`, `/api/campaigns/{click,unsubscribe,unsubscribe/[token],webhooks/resend}` |
| Datasets & Analytics | `/api/datasets`, `/api/datasets/[datasetId]/{rows,aggregate,filter-options,refresh-schema,state,sync,compute,auto-setup,trim,mine-themes,merge-themes,expand-keywords,theme-counts,theme-impact,search,search-interest,signal-stats,user-location-filter,discover-entities,entities,rows-by-entity,collection-check}`, `/api/datasets/{insights,signal-stats-batch}` |
| Dataset Export | `/api/datasets/[datasetId]/export/{pptx,html,html/share,signals-pptx}` |
| Reviews (Google + Tripadvisor) | `/api/review-sources`, `/api/review-sources/{search,[sourceId]/{locations,sync,user-locations}}` |
| Other Data Sources | `/api/reddit-sources/*`, `/api/substack-sources/*`, `/api/regulations-sources/*` |
| PulseIQ | `/api/townhall/{chat,join/[sessionId],live/[sessionId],sessions/[id]/{analyze,duplicate,export,export/pptx},sessions/search,themes/{detect,custom,[id]},stats/[sessionId],status/[sessionId],simulate,suggest-guide,suggest-sensitive,suggest-topic,expand-terms,grade-description,responses}` |
| Agents (bots) | `/api/bots`, `/api/bots/[id]/{chat,analyze,conversations/*,intents-stats,knowledge,knowledge/[chunkId],export,history,questions,questions/[questionId],questions/export.csv,ui-hints}`, `/api/bots/{deep-crawl,fetch-url,research,import}`, `/api/bot-chat`, `/api/clara-chat`, `/api/nora-chat` |
| Social | `/api/social/{connect,callback,connections,connections/[id],webhook,sync,demo,stats,alerts,auto-config,comments,comments/[id]/{reply,ai-reply,hide,delete,dm,handle},comments/bulk,dm-templates,export-dataset}` |
| Brands & Entities | `/api/brands`, `/api/collections`, `/api/collections/[id]`, `/api/industry-themes` |
| AI Features | `/api/ai/study-suggest`, `/api/clarify`, `/api/deflect`, `/api/translate`, `/api/translate-responses`, `/api/suggest`, `/api/ana/render-deck`, `/api/ask-ana` |
| Decks (admin-only) | `/api/{pitch,rollup,architecture,engineering-reality,agent-capabilities,entity-analysis,pulseiq,signal-tiers,restaurant-expansion}-deck` |
| Sharing | `/api/share`, `/api/share/analytics` |
| Org & Users | `/api/orgs`, `/api/orgs/[id]`, `/api/orgs/[id]/users`, `/api/org`, `/api/org/{logo,settings,users}`, `/api/me`, `/api/me/ai-mode`, `/api/invite`, `/api/invite/[id]`, `/api/invite/[id]/resend`, `/api/invite/register`, `/api/auth/{log-login,magic-link,signout}`, `/api/settings/{profile,team,team/disable,team/features}` |
| Admin | `/api/admin/{orgs,orgs/[id]/users,orgs/[id]/ai-key,users,users/[id],clients,clients/[id],questions,questions/[id],bulk-invite,invite-preview,agent-tester,content-guard-test,sentry,sentry/issues,usage,org-snapshots/[orgId],org-snapshots/[orgId]/restore}` |
| Cron Jobs (11) | `/api/cron/{campaign-scheduler,cleanup-shared-links,review-sync,entity-discovery,townhall-theme-detection,bot-conversation-review,social-sync,social-token-refresh,sentry-digest,temple-events-refresh,org-snapshot}` |

**Total**: ~200 API routes (added bot export/import/history routes, admin org-snapshots routes, and the org-snapshot cron in 2026-W21).

---

## Shared Utilities

| Module | Purpose |
|--------|---------|
| `lib/ai.ts` | Unified AI client (`callAI`) — provider routing (Anthropic / OpenAI / Azure OpenAI), tiering, BYO-key, usage logging |
| `lib/aiKey.ts` | Per-org AI key resolution |
| `lib/usageLog.ts` / `lib/usageRates.ts` | Usage accounting (writes `usage_logs`, computes cost) |
| `lib/auth/*` | Auth helpers (`requireUser`, `requireAdmin`) |
| `lib/resolveOrg.ts` / `lib/userContext.ts` | Org resolution and caller-org gating helpers |
| `lib/rateLimit.ts` | Token-bucket rate limiting backed by `rate_limit_buckets` |
| `lib/guardrails.ts` / `lib/contentGuard.ts` / `lib/moderation.ts` | Shared input/output validation (surveys, PulseIQ, agents) |
| `lib/aliasUtils.ts` | Value alias resolution (resolveAlias, aliasedCounts, buildAliasMap) |
| `lib/scaleUtils.ts` | Ordinal scale detection, smart ordering, direction labels |
| `lib/filterUtils.ts` | Filter application, serialization, count helpers |
| `lib/themeUtils.ts` | Theme matching, keyword regex, lemma expansion, lexicon sentiment scoring (no AI) |
| `lib/sentimentLexicon.ts` | Lexicon-based sentiment scoring |
| `lib/psychoBank.ts` | Shared psychographic question bank (general-purpose) |
| `lib/townhallThemeDetection.ts` | Server-side live theme detection for PulseIQ sessions |
| `lib/statsUtils.ts` / `lib/signalStats.ts` / `lib/signalTier.ts` | Significance testing (z-score, chi-square, effect sizes), signal tiering |
| `lib/opinionMining.ts` / `lib/personaExtractor.ts` | Aspect-opinion extraction, clause splitting, persona inference |
| `lib/analyticsCompute.ts` | Field summary computation (counts, histograms, topN) |
| `lib/dataforseo.ts` / `lib/reviewSync.ts` / `lib/reviewLimits.ts` | DataForSEO client, review sync orchestration, per-org cost caps |
| `lib/reddit.ts` / `lib/redditSync.ts` | Reddit ingest |
| `lib/substack.ts` | Substack ingest |
| `lib/regulations.ts` | Regulations.gov ingest |
| `lib/socialTagging.ts` / `lib/oauthState.ts` / `lib/safeFetch.ts` | Social moderation tagging, HMAC OAuth state, SSRF-safe fetch |
| `lib/brandMatch.ts` / `lib/brandRules.ts` / `lib/collectionSchema.ts` | Brand profile rules and matching |
| `lib/entityDiscovery.ts` / `lib/entityFilter.ts` / `lib/entityVariants.ts` | Entity discovery and filtering |
| `lib/embeddings.ts` | Embedding generation for agent knowledge / RAG |
| `lib/cronAuth.ts` | Cron bearer-token auth (`CRON_SECRET`) |
| `lib/sentry.ts` | Sentry init / wrapping |
| `lib/sentryScrub.ts` | Sentry `beforeSend` PII scrub — wired into `sentry.{client,server,edge}.config.ts`; drops `request.{data,body,cookies}`, auth/cookie headers, PII key names in `extra`/`contexts`/`tags`; reduces `user` to `{id}` only; also drops the MS Office "Object Not Found" content-script false-positive. Closes SECURITY.md TBD #1. |
| `lib/loginLog.ts` / `lib/userEvents.ts` | Login + user-event logging |
| `lib/auditLog.ts` | Bot audit log writer (`logBotChange`, `snapshotForDiff`, `diffSnapshots`) — server-side service-role writes to `bot_change_log` |
| `lib/orgSnapshot.ts` | Per-tenant logical backup — `dumpOrgSnapshot(orgId)` returns versioned JSON of ~40 tenant-scoped tables. `TABLE_SPECS` map is the source of truth. |
| `lib/backupS3.ts` | S3 gzip+upload + list + download wrapper for `org-snapshots/<org_id>/YYYY/MM/DD/snapshot.json.gz`. SSE-S3 default, SSE-KMS if configured. |
| `lib/governanceReports.ts` | Weekly governance report generation |
| `lib/industryDefaults.ts` / `lib/industryThemes.ts` / `lib/surveyBlueprints.ts` | Industry presets and survey blueprints |
| `lib/studyDraft.ts` / `lib/smartStudyGenerator.ts` | Survey draft + AI-generated study suggestion |
| `lib/xlsxExport.ts` | Excel export helpers |
| `lib/useSessionState.ts` | SessionStorage-backed React state hook |

---

## Known Constraints & Limits

| Constraint | Value | Notes |
|-----------|-------|-------|
| Supabase max rows per request | 1,000 | Default; paginate for larger reads |
| TextMine sample cap | 50,000 rows | No sampling below this; deterministic per-dataset sampling above |
| DataForSEO review limit | 4,490 per location | Google API hard cap |
| DataForSEO batch size | 10 locations per sync call | Prevents serverless timeout |
| Serverless function timeout | 120s (export routes, default 300s on plan) | Vercel Pro / Fluid |
| PPTX row cap | 10K (no filter), 30K (filtered) | Memory constraint |
| Campaign send rate | Provider-dependent | Resend / SendGrid / SES / SMTP / Twilio SMS |
| Survey widget rate limit | 120 req/min per IP | `lib/rateLimit.ts`, applied in `/api/respond` |
| Analytics topN | 20 values | Field summary value lists |
| Review download cost cap | Per-org rolling window | Enforced via `review_downloads` |

---

## Environment Variables

Authoritative list of platform env vars; provider-specific ones (SMTP_*, social OAuth client IDs/secrets, etc.) are set as needed per integration.

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key (server only) |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (default AI provider) |
| `OPENAI_API_KEY` | OpenAI provider key (optional) |
| `AZURE_OPENAI_API_KEY` / `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI (optional) |
| `RESEND_API_KEY` | Resend email provider |
| `SENDGRID_API_KEY` | SendGrid (optional) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `SES_REGION` | AWS SES (optional) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Generic SMTP (optional) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Twilio SMS (optional) |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | DataForSEO (Google + Tripadvisor reviews) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reddit API |
| `REGULATIONS_API_KEY` | Regulations.gov API |
| `SOCIAL_*_CLIENT_ID` / `SOCIAL_*_CLIENT_SECRET` | Social provider OAuth credentials (per provider) |
| `OAUTH_STATE_SECRET` | HMAC secret for OAuth state signing |
| `CRON_SECRET` | Bearer token shared by Vercel cron and the cron endpoints |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Sentry error reporting |
| `INTERNAL_API_KEY` | Internal-only deck route auth (in addition to `requireAdmin`) |
| `NEXT_PUBLIC_BASE_URL` | Public URL for links |

---

## Deployment

- **Production**: push to `main` → Vercel auto-deploys. Single repo on `main`; staging is retired.
- **DB Migrations**: numbered SQL files in `sql/` (`sql/NNN_name.sql`). Apply to production with `supabase db query --linked --file sql/NNN_name.sql` — the CLI is already linked. CI does not run migrations.
- **Specs**: docs under `docs/` and this top-level `SPEC.md` must be updated in the same commit as any behavior change. The Monday governance routine reads `docs/weekly-reports/YYYY-WXX-devlog.md`.

---

## Multi-Tenancy Invariants

Every CRITICAL security finding so far has reduced to one of these. Treat them as non-negotiable:

1. **Every new `public` table needs RLS enabled + an org-scoped `SELECT` policy.** `npm run test:rls` catches the policy-exists half.
2. **Service-role queries must pair `id` with `org_id`** — `service.from(t).eq('id', x).eq('org_id', orgId)`, or use a `gate*Access` helper. A bare `id` lookup with the service-role client is a cross-tenant leak.
3. **Internal-only routes** (deck exports, governance, internal exports, admin tools) wrap with `requireAdmin` from day one. URL obscurity is not a defense.
4. **Route-handler org filters are not covered by RLS tests.** Service-role + explicit `.eq('org_id', orgId)` failure modes need their own egress tests (`test:egress`).

See `docs/SECURITY.md` for the full threat model and `CLAUDE.md` for ongoing project-level guardrails.
