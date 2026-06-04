# Sentimetrx Platform — Complete Feature Reference

**Last reviewed:** 2026-05-15 (spec audit pass 13 of 14 — see `[[project-spec-audit-queue]]`)

> User-facing product names: **Sentimetrx** (not SentimetRx), **agents** (not bots). Two distinct products both relate to "town hall" meetings: **PulseIQ** = the live/digital pulse product (internal `townhall_*`); **Town Hall** = the recorded-in-person-meeting product (internal `recordings`, promoted to top-level 2026-06-04). Internal table/code names (`bots`, `townhall_*`, `recordings`) stay as-is. See `[[feedback-product-naming]]`.

## 1. Survey Creation Wizard

### Smart Study Wizard (AI-Powered)
- **7 study blueprints**: Satisfaction & Experience, NPS & Loyalty, Awareness & Perception, Motivation & Values, Churn & Risk, Engagement & Participation, Journey & Touchpoint
- **19 industries** (`lib/industryDefaults.ts`): Healthcare, Hospitality (Hotel / Lodging), Restaurants — Casual Dining, Restaurants — Fine Dining, Restaurants — Fast Food / Quick Service, Travel & Tourism, Politics & Advocacy, Entertainment — Media & Film, Entertainment — Performing Arts & Venues, SaaS / Software, Retail / E-commerce, Financial Services, Education (K-12), Higher Education, HR / Employee, Sports, Nonprofit, Automotive Repair, Other
- AI-generated study configuration from industry + focus area + length selection
- Focus areas: retention, communication, recognition, motivation, legacy giving, donor capacity, civic mindset, and more
- Length tuning: quick (5Q), standard (10Q), comprehensive (15Q)

### Step-by-Step Creator (10 Steps)

Order from `components/creator/CreatorNav.tsx::CREATOR_STEP_LABELS`: Basics → Opening → Conversation → Clarifiers → Questions → Psycho → Demo → Contact → Closing → Review.

**Step 1 — Basics**
- Study name, bot name, bot emoji (industry-specific emoji sets)
- Custom URL slug with availability checking
- Industry selection with auto-defaults
- 7 color presets (Ocean, Forest, Sunset, Violet, Rose, Slate, Gold) + custom color picker
- 6 theme colors: primary, header gradient, background, accent, bot avatar gradient
- Branding label (default `"SENTIMETRX"`, customizable up to 15 chars, show/hide toggle)
- Response limits: allow multiple responses or one per device
- Response capture: instant capture (single tap) or tap-then-confirm mode
- Survey font size (adjustable px)
- Typing animation speed (0.25x minimal to 2x slow, default 0.5x)
- Multi-language configuration (16 languages, auto-translate on add)
- Auto-translate responses toggle (translate non-English answers to English on submission)

**Step 2 — Opening Flow**
- Drag-ordered opening sequence: NPS, Experience Rating, Open-ended items
- NPS question: enable/disable, custom prompt text
- Experience rating: enable/disable, custom prompt, 8 rating types (experience, familiarity, satisfaction, value, quality, ease, intent, perception)
- Custom 5-point rating scale with emoji + label per score
- Sentiment-adapted Q1 variants (different follow-up for promoter/passive/detractor)
- Adaptive follow-ups: shared prompt (one for all scores) or per-response mode (unique prompt per score)

**Step 3 — Conversation (Q3/Q4)**
- Q3 and Q4 open-ended questions with per-question configuration
- Required/optional toggle
- Export label customization
- Clarifier enable/disable per question
- Enable/disable each question independently

**Step 4 — Clarifiers**
- Keyword-based clarifier bank with industry-specific defaults
- Default fallback clarifier message
- AI clarification toggle (Claude API-powered follow-ups)
- Max clarifier count per session (prevents over-probing)
- Smart deflection: AI-powered off-topic question detection with custom redirect message and optional link

**Step 5 — Custom Questions**
- Drag-and-drop question ordering
- 14 question types (`lib/types.ts::QuestionType`):
  - Open-ended (free text with AI clarification)
  - Radio (single select)
  - Checkbox (multi-select with "at least one" validation)
  - Dropdown (compact single select)
  - Likert scale (5+ point scales with emoji indicators)
  - Date picker (date or datetime with min/max constraints)
  - Rating (numeric scale with custom min/max)
  - Numeric input
  - Hidden fields (URL parameter capture)
  - Email (with validation)
  - Phone (international)
  - US ZIP code (5 or 5+4 format)
  - US State dropdown
  - Message-only (informational, auto-advances)
- Per-question configuration: required/optional, export label, AI clarification, keyword clarifiers
- Adaptive follow-up prompts (shared or per-response-value) for likert/rating questions
- Skip logic branching (equals, not_equals, any_of, none_of, greater_than, less_than)
- Conversation position toggle (show during opening vs. post-conversation phase)
- Random sampling: show N of M custom questions per session

**Step 6 — Psychographics**
- Industry-specific psychographic question bank (8-12 defaults per industry)
- Custom psychographic builder (key, question text, option list)
- Random sampling: display N of total per session (default 3, configurable)
- Export label customization
- Full multi-language support

**Step 7 — Demographics**
- Default fields: Age Range, Gender, ZIP Code
- Custom demographic fields: select dropdown or text input
- Option customization and reordering
- Enable/disable per field
- Transition message customization
- Multi-language labels and options

**Step 8 — Contact Info**
- Configurable contact fields: email, phone, ZIP code, US State, free text
- Per-field: label, required/optional, placeholder text, validation rules
- Transition message customization ("If you'd like us to follow up...")
- Section ordering: drag-order for custom questions, psychographics, demographics, contact

**Step 9 — Closing**
- Custom thank-you message
- Completion-card configuration (logo, message, optional CTA link/label)
- Translated per enabled language

**Step 10 — Review & Publish**
- Full configuration summary
- Validation checks across all steps (completion indicators)
- Save as draft or publish to active
- Copy survey link + QR code generation and download

---

## 2. Conversational Survey Widget

### Architecture
- Server-rendered page at `/s/[guid]` (public, no auth required)
- Custom URL slugs supported (`/s/my-custom-url`)
- Full client-side conversation engine (no server round-trips during survey)
- Mobile-first responsive design with touch interactions

### Conversation Flow
- Language selection (when 2+ languages enabled)
- Animated greeting with bot avatar and typing bubble
- "Ready to share feedback?" gate with Yes/No
- Dynamic question sequencing based on configuration
- Smart acknowledgments between questions (varied, sentiment-aware)
- Closing thank-you message + completion card

### Interaction Types
- **Rating scales**: Emoji-labeled buttons with optional confirm mode
- **Open-ended text**: Auto-expanding textarea with placeholder text
- **Single select (radio)**: Button list with highlight-on-select
- **Multi-select (checkbox)**: Toggle buttons with Done/Skip action
- **Dropdown**: Native select element
- **Likert scales**: Labeled scale buttons with emoji indicators
- **Date/datetime pickers**: Native date input with min/max constraints
- **Numeric input**: Number field with validation
- **Hidden fields**: Auto-populated from URL parameters (invisible to respondent)

### AI Features (In-Survey)
- **Keyword clarifiers**: Pattern-match answers to trigger follow-up questions
- **AI clarifiers**: Claude API generates contextual follow-up questions
- **Smart deflection**: Detects off-topic questions, generates warm redirect with optional link
- **Input guardrails**: Filters profanity, violence, slurs, URLs
- Multi-language AI responses (clarify and deflect in the survey's active language)

### Response Handling
- Partial auto-save after each question answered (resumable sessions)
- Final submission with device fingerprint + IP hash
- Duplicate prevention (one-per-device mode using fingerprint + IP)
- Rate limiting: 120 requests/min per IP
- Session continuity via sessionStorage UUID

---

## 3. Multi-Language Support

### 16 Supported Languages (`lib/types.ts::SUPPORTED_LANGUAGES`)
English, Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Korean, Arabic, Hindi, Vietnamese, Filipino, Russian, Polish, Haitian Creole

> PulseIQ chat currently mirrors a 15-language subset (no Haitian Creole) — see `[[project-townhall-audit-2026-05-15]]`.

### Translation Coverage
- **Study content**: Greeting, all question prompts, rating/NPS prompts, closing messages
- **Custom questions**: Prompts, options, likert labels
- **Adaptive follow-ups**: Shared and per-response prompts
- **Opening flow**: Open-ended prompts
- **Psychographics**: Questions and option lists
- **Demographics**: Field labels and select options
- **Contact fields**: Labels and placeholders
- **Section transitions**: All transition messages
- **UI chrome**: Buttons, placeholders, acknowledgments (built-in for all 15 languages)

### Translation Workflow
- Toggle a language on — auto-translates immediately via Claude API
- "Redo" button to regenerate translations after content changes
- "Translate All" for batch translation of multiple languages
- Translations stored per-language in study config

### Response Translation
- Optional auto-translate of non-English responses to English on submission
- Original responses preserved alongside translations
- Per-study toggle (default: off)

### Mobile Keyboard
- `lang` attribute set on all text inputs to trigger correct keyboard layout

---

## 4. Campaign Manager (Email + SMS)

### Campaign Setup
- Create campaigns linked to a study
- Name, description, target response goal
- Channel: email-only, SMS-only, or both (`campaigns.channel ∈ {email, sms, both}`)
- Email provider selection: Resend (default), SendGrid, AWS SES, custom SMTP
- SMS provider: Twilio (requires `accountSid` + `authToken` + `fromNumber`, or `TWILIO_*` env vars). SMS only sent to recipients with a `phone` value.

### Recipient Management
- Bulk upload: CSV, TSV, JSON, Excel (.xlsx/.xls)
- Column mapping to fields (first_name, last_name, email, company, custom fields)
- Email validation and duplicate detection
- Add individual recipients inline
- Remove recipients
- Drag-and-drop file upload

### Email Template Builder (Rich Block Editor)
- **Dual-mode editor**: Visual Builder + raw HTML
- **Header layouts**: Text only, Logo only, Logo + text, Dual logos (side-by-side)
- **Content block types**:
  - Paragraph (rich text)
  - Heading (bold section header)
  - Image (URL, alt text, size control, alignment, optional clickable link)
  - Numbered step (circled number + heading + description — Constant Contact style)
  - Button (custom label, URL, color)
  - Divider (horizontal line)
  - Spacer (adjustable height 8-64px)
  - Signature (name, title, optional signature image)
- **Block controls**: Up/down reordering, delete, color-coded type badges
- **Primary CTA button**: Custom text and color, auto-linked to survey URL
- **Merge tags**: {{first_name}}, {{last_name}}, {{email}}, {{survey_link}}, {{unsubscribe_link}}, {{study_name}}, {{campaign_name}}, plus any custom CSV fields
- **Live preview**: Real-time rendering with sample merge tag values
- Subject line editor with merge tag insertion

### Email Sequencing
- Initial email (sequence 0, sent immediately)
- Reminder emails (sequence 1, 2, N... with configurable delay in hours)
- Send targeting per email: all recipients, non-responders only, incompletes only
- Send time scheduling (time of day)
- Specific date/time scheduling

### Sending & Tracking
- Test send to admin email
- Bulk send with per-recipient merge tag substitution
- Resend webhook integration for real-time tracking
- Recipient status progression: pending → sent → opened → clicked → completed → bounced → unsubscribed
- Per-recipient send log with provider message IDs
- Campaign-level stats: sent count, open rate, click rate, completion rate
- Send reminder modal with template + audience selection

### Compliance
- Automatic unsubscribe link in every email
- Public unsubscribe endpoint (no auth required)
- Unsubscribe token per recipient

### Campaign Operations
- Clone campaign (copy setup, emails, optionally recipients)
- Edit campaign settings
- Delete campaign (cascades all data)
- Pause/resume

---

## 5. Analytics & Dashboard

### Study Dashboard
- Study list with status badges, response counts, creation dates
- Per-study quick stats: total responses, sentiment breakdown
- Study cards with theme color preview

### Quick Analytics (Per-Study)
- **NPS trend**: Line chart of average NPS per day
- **Sentiment distribution**: Donut chart (promoter/passive/detractor with percentages)
- **Response volume**: Bar chart of responses per day
- **Summary cards**: Total responses, Avg NPS, Avg Experience, sentiment percentages
- **Date range picker**: From/To date filtering with "Last 30 days" and "All time" shortcuts

### Response Export
- CSV export with configurable sections: core, open-ended, psychographics, demographics, meta
- Label mode: field keys or question text as column headers
- Format: standard (one row per response) or Datanautix (one row per open-ended answer)
- Status filter: all, complete, partial
- Date range filter
- Sentiment filter

---

## 6. Advanced Analytics (Analyze Module)

*Available when organization has "analyze" feature enabled.*

### Dataset Management
- Create dataset from study responses (auto-import)
- Manual CSV upload with schema auto-detection
- Schema configuration: column types (open-ended, categorical, numeric, date, ID, ignore)
- Custom field labels and export names
- Collections group datasets for cross-dataset analysis; brand-collections (auto-curated by a dataset's brand tag) show as a distinct Brand card with drill-in to member datasets

### Text Mining (AI-Powered Theme Extraction)
- AI-powered theme discovery from open-ended responses (provider via `lib/ai.ts::callAI`)
- Industry theme library integration (Healthcare, Hospitality, SaaS, etc.)
- Theme extraction with verbatim tagging
- Manual theme editing: add, remove, rename themes post-mining
- Theme recounting without re-mining
- Statistical significance testing (chi-square) for theme distributions

### Entity Discovery & Catalog
- AI-extracts named entities (dishes, drinks, places, people, brands) from row text
- Persisted to `entity_catalog` per scope (dataset or brand-collection)
- Counted at read time via `count_entity_terms` RPC — surfaces "who/what was mentioned" alongside themes
- Brand-collection scope auto-curated from a dataset's `brand_tag`; a brand's datasets share one catalog
- Run history logged to `entity_catalog_refresh` (before/after counts, sample size, schema-field selection)
- See `docs/ANALYTICS.md § Entity Discovery & Catalog`

### Per-Row Taxonomy (admin pilot)
- 7-axis ABSA classifier (touchpoint, attribute, product, beverage, ambiance, context, outcome) with severity flag {normal, alert, crisis}
- Closed-vocab structured-output prompt via Claude Haiku; per-row assertions stored in `dataset_row_taxonomy`
- Admin-only side-by-side viewer at `/admin/taxonomy-pilot/[datasetId]` — verbatim · legacy tags · structured assertions
- Driving use case: Ruth's Chris Steak House CX-tagging-replacement pilot (2026-05-27)
- See `docs/DATA_SOURCES.md § 14 Per-Row Taxonomy`

### Full-Text Search (TextMine SearchPanel)
- Two modes: plain `tsvector` full-text or AI-augmented synonym expansion + Claude re-rank
- GIN index on `dataset_rows_flat.tsv` (migration `031_dataset_search.sql`); `search_dataset_rows()` RPC
- AI mode: query → expand to synonyms → 100 candidates per target via OR'd `websearch_to_tsquery` → strict scorer re-ranks 0.0–1.0 → threshold 0.3 → paginated
- Works across collections (resolves to member datasets and unions per-target candidate pools)
- See `docs/SEARCH.md`

### Visualizations
- Theme prevalence bar charts
- Segment heatmaps (theme x dimension matrix)
- Word clouds
- Trend analysis over time
- Interactive Plotly.js charts (hover, zoom, pan)

### Filtering & Segmentation
- Dynamic filters by sentiment, demographics, psychographics, scores, dates, response status
- AND/OR filter combinations
- Filter persistence in URL
- Quick-filter buttons for sentiment segments

### Export Options
- Interactive HTML report with embedded charts
- Shareable HTML link (one-time public access)
- PowerPoint (PPTX) with charts + summaries + methodology
- Filtered CSV data export

### Statistical Analysis
- Chi-square significance testing for categorical independence
- Sample size power calculations (95% confidence)
- Segment comparison across theme occurrence

---

## 7. Study Management

### Study Lifecycle
- **Draft**: Fully editable, not accepting responses
- **Active**: Accepting responses, configuration editable
- **Paused**: Responses paused, can resume
- **Closed**: Read-only, shows closed message to respondents

### Operations
- **Create**: Blank study, from blueprint template, or via Smart Wizard
- **Edit**: Full configuration editing with step-by-step navigation
- **Clone**: Copy all config to new study (new GUID, reset to draft, no responses copied)
- **Import/Export**: JSON export of complete study config; import to recreate on any instance
  - Export explicitly materializes all boolean/numeric defaults for cross-instance compatibility
- **Design deck**: Auto-generated PPTX presentation of full study design
- **Transfer**: Admin can transfer study between organizations
- **Delete**: Cascades all responses, campaigns, datasets

### Deploy Page
- Copy survey link
- QR code generation and download
- Study status controls (activate, pause, close)
- Embed instructions

---

## 8. Authentication & User Management

### Authentication
- Supabase Auth backend
- Google OAuth (primary)
- Email/password (alternative)
- Magic link email confirmation
- Password reset flow

### User Roles
- **Platform admin**: System-wide access (internal org only)
- **Org owner**: Full org control — invite/remove members, manage settings
- **Org member**: Create and manage own studies

### Team Management
- Invite members via token link (7-day expiry)
- Branded HTML invite email auto-sent via Resend from `invites@sentimetrx.ai`; copy-link fallback if send fails
- Resend or revoke pending invites from the team page
- Invitee accepts via warm-themed `/invite/[token]` showing org name + role; email field is locked to the invited address; auto-signed-in on accept (no second login)
- Accepting an invite for an email that already has an `auth.users` row verifies the typed password against the existing account before linking it to the new org (handles partially-created or pre-existing auth users without overwriting their password)
- Role assignment (owner/member)
- Track invite usage
- Remove members from org
- Org owners (not just super-admins) can invite into their own org

---

## 9. Organization & Admin

### Organization Management
- Organization name, slug, logo
- Plan management: trial → active → suspended
- Module feature flags (`lib/types.ts::ModuleFeatures`) — gate UI nav + API access per org and per user:
  - `surveys` — conversational surveys (Sarina)
  - `analyze` — TextMine, entity discovery, statistics, search, theme mining
  - `googleReviews` — DataforSEO Google + Tripadvisor reviews
  - `reddit` — Reddit thread + comments downloader
  - `substack` — Substack post comments downloader
  - `townhall` — PulseIQ live/digital pulse sessions
  - `recordings` — **Town Hall** (recorded in-person meetings → Q&A + presentation report); top-level product as of 2026-06-04
  - `campaigns` — email + SMS campaigns
  - `bots` — branded agents
  - `social` — Meta (Facebook + Instagram) monitoring
- Org config (`lib/types.ts::OrgFeatures`):
  - `primaryIndustries` — restrict available industries
  - `defaultEmailProvider` — default for new campaigns
  - `aiProvider` — pluggable provider config (`anthropic` / `openai` / `azure-openai`, plus azure endpoint/version)

### Platform Admin Dashboard
- List all organizations with stats (users, studies, responses)
- Edit org plans and features
- User management across orgs
- Question bank management
- Transfer study ownership between orgs

### Per-Tenant Backups (since 2026-05-19)
- **Nightly cron** at 04:00 UTC (`/api/cron/org-snapshot`) loops every org, dumps tenant-scoped tables to gzipped JSON, uploads to S3 at `org-snapshots/<org_id>/YYYY/MM/DD/snapshot.json.gz`. SSE-S3 default; SSE-KMS optional via `BACKUP_S3_KMS_KEY_ID`. Bucket versioning + lifecycle (Standard-IA 30d → Glacier 90d) recommended.
- **`/admin/backups`** — list every org with "Browse snapshots" and "Snapshot now" buttons (on-demand backup for that org).
- **`/admin/backups/[orgId]`** — per-org snapshot list with restore UI. Two restore modes: **merge** (upsert by id, leaves other rows alone; default) and **replace** (also deletes current rows not in snapshot; opt-in). Requires retyping the org slug to confirm. Refuses if `snapshot.meta.org_id` doesn't match URL org id (key-swap defense).
- **Designed for the multi-tenant problem PITR can't solve**: Supabase PITR rolls back the entire DB, which would destroy other tenants' legitimate work since the rollback point. Per-tenant logical snapshots are restorable independently.
- **Not covered**: `auth.users` (Supabase Auth schema, not `public`), Supabase Storage objects, 7 explicitly-skipped tables (legacy archives, rate-limit buckets, sentry, geo cache).
- See `docs/BACKUPS.md` for AWS setup + IAM policy JSON + cost (~$3/mo at current scale).

---

## 10. Data Export & Reporting

### Response CSV Export
- Configurable sections: core fields, open-ended, psychographics, demographics, contact, meta
- Column labels: field keys or full question text
- Formats: standard (1 row/response) or Datanautix (1 row/open-ended answer)
- Filters: status, date range, sentiment

### Study Design PPTX
- Auto-generated PowerPoint of full study configuration
- Branded slides with Datanautix theming
- Covers: overview, opening flow, questions, clarifiers, psychographics, demographics, settings

### Analytics PPTX
- Theme prevalence charts
- Segment comparison tables
- Key insights summary
- Methodology notes

### Recording Q&A Report PPTX
- Datanautix-branded deck export from a processed meeting recording
- Executive summary, conversation themes (per-topic), sentiment overview, action items & decisions
- Appendix slide for every Q&A pair (verbatim question + response)
- One-click "Export to PowerPoint" from the recording report page

### Meeting tool (presentation + Q&A)
- Configurable meeting-type presets ("Town hall Q&A", "Community meeting: presentation + Q&A")
- Upload the presenter's slide deck (PDF) — read by AI vision to seed factual meeting notes
- Auto-detects the presentation→Q&A transition; boundary is user-reviewable before analysis
- Deck adds a neutral "Meeting Overview" (what was presented, by whom, key figures) ahead of the Q&A summary
- Strictly neutral/no-opining voice throughout (shareable with the client/organizer)

### Interactive HTML Reports
- Embedded Plotly.js charts
- Responsive design
- Shareable via one-time public link

### Study JSON Export/Import
- Complete study configuration as JSON file
- All settings explicitly materialized (no undefined defaults)
- Import to any instance to recreate study

---

## 11. Theming & Branding

### Study-Level
- Bot name and emoji customization
- 6-color theme system (primary, header gradient, background, accent, bot avatar)
- 7 built-in color presets
- Custom branding label with show/hide toggle
- Adjustable survey font size

### Organization-Level
- Logo upload (displayed in navigation)
- Organization name in header
- Logo in campaign emails and analytics headers

---

## 12. Performance & Infrastructure

### Response Handling
- Rate limiting per IP per endpoint
- Session-based partial saves with upsert logic
- Device fingerprinting for duplicate prevention
- Cascading status updates (incomplete → complete)

### Database Optimization
- Indexed columns for fast queries (study_id, client_id, sentiment, scores, dates)
- Denormalized fields pulled from JSONB for indexing (sentiment, scores)
- Row-level security (RLS) for multi-tenant isolation
- Service role client for admin operations

### Campaign Automation
- Scheduled email sends via cron endpoint
- Webhook-driven status updates (Resend integration)
- Batch recipient processing

### Dataset Processing
- Batch row import with chunking
- Paginated theme mining (max 500 rows per API call)
- Computed statistics caching in dataset_state
- SQL-based aggregation functions for filter options

---

## 13. AI Integration

All AI calls route through `lib/ai.ts::callAI`, which supports three providers (`anthropic`, `openai`, `azure-openai`) and three tiers (`fast`, `standard`, `advanced`). Defaults: `fast = claude-haiku-4-5`, `standard = claude-sonnet-4`, `advanced = claude-sonnet-4-6`. Per-org override via `OrgFeatures.aiProvider`. Token counts route through `lib/usageLog.ts` to `usage_logs` whenever the caller passes a `usage:` context.

Major AI features by module:

**Surveys**
- Smart Study Wizard — generate complete study config from industry + focus + length
- In-survey clarifiers — keyword + AI follow-ups
- Smart deflection — off-topic detection and warm redirect
- Study translation (16 langs) and per-response translation to English
- Input guardrails (`lib/guardrails.ts`) — profanity / violence / slur / URL filtering

**Analyze**
- Theme mining + recounting (`lib/themeExtraction.ts`)
- Entity discovery + variant merge (`lib/entityDiscovery.ts`)
- Search query expansion + strict re-rank (`/api/datasets/[datasetId]/search`)
- Persona / opinion mining (`lib/personaExtractor.ts`, `lib/opinionMining.ts`)
- Sentiment scoring (`lib/scoreSentimentFull`)
- AI deck generation (entity analysis, brand rollups, restaurant expansion)

**PulseIQ**
- Discussion-guide generation (4–8 topics from event description)
- Sensitive-topic suggestions with staged keyword expansion
- Description grading (1–5)
- Live chat moderation, topic rotation, theme detection (cron)

**Agents (Bots)**
- Hybrid RAG over knowledge chunks (semantic + lexical + fuzzy, blended in one RPC)
- Session-persona extraction (turn 2–4)
- Demographic inference from chat
- Intent capture (keyword + AI)
- Periodic conversation reviews (theme drift)
- Insights deck export
- **Question Log** (since 2026-05-21/22) — durable record of user turns the bot couldn't answer (`deflect`, `kb_miss`, `ai_uncertain`); admin UI at `/bots/[id]/questions` with All / Unanswered tabs + status mutation + notes; CSV export with PII redaction by default (superadmin `?reveal=1` unmasks). Driver: NOWOCATS PM-2 legal-defensibility; generic across all agents.
- **Entity-from-KB mention tagging** (since 2026-05-22) — Haiku-extracted named entities (8 categories: person / place / organization / product / program / event / policy / other) from each agent's knowledge base; user turns mentioning a catalog entity get an `entity:<slug>` flag automatically (string-match, $0/turn). Admin UI at `/bots/[id]/entities` with re-extract button, hide / edit / manual-add actions. Driver: query "who asked about Terminal A this week" or "did anyone mention the Foundations Project" without skimming transcripts.

**Social**
- Content guard (sentiment + flags), OpenAI moderation overlay
- Topic + intent + emotion tagging
- Response routing (silent moderate / human queue / templated / AI-custom reply)

**Campaigns / Other**
- Subject-line and body suggestions
- Audit log natural-language summaries

See `docs/USAGE_ACCOUNTING.md § Estimator` for the 23 forward-looking usage profiles that drive cost modeling.

---

## 14. PulseIQ

*Gated by `organizations.features.townhall`. UI label: **PulseIQ**. Internal name: `townhall` (legacy substrate) + `town_halls` (phase-3 substrate, post-convergence). See `docs/TOWNHALL.md` and `docs/CONVERGENCE.md`.*

> **Convergence Phase 5 complete (2026-05-22)**. PulseIQ runs on a unified conversational substrate shared with Agents (`conversations` + `conversation_turns`) plus PulseIQ-specific cohort tables (`town_halls`, `town_hall_topics`, `town_hall_conversations`). The chat handler is `lib/chatCore.handleChatTurn` — same code path as `/api/bots/[id]/chat`, with a town-hall context branch that pulls topics from `town_hall_topics`, picks the next via `lib/pickNextTopic`, and tags both turns of the pair with the chosen `topic_id`. The facilitator dashboard (`/api/townhall/sessions` list + `/api/townhall/sessions/[id]` detail) accepts both substrates via `lib/townHallAdapter.ts`. Participant + facilitator-mutating routes (`join`, `live`, `themes/[id]`, `themes/custom`, `sessions/[id]` PATCH/DELETE, `sessions/[id]/analyze`) are all substrate-aware. **NOWOCATS** is the first town hall on the new substrate (Sarina bot, early June launch); **Vindman** follows post-launch using the Sir O'Gate bot. Each event = one `town_halls` row; multi-event rollup combines per-event datasets in Analytics. Legacy `townhall_sessions/_themes/_turns` tables remain in service for pre-convergence sessions and will be dropped in Tier 5 cleanup. Two known follow-ups not yet wired: `/api/townhall/responses` POST (post-session psycho/demo upsert) and bot-level analyze `town_hall_id` attribution — neither blocks NOWOCATS launch. Prod env flags required to activate: `TOWNHALL_VIA_AGENT_HANDLER=true` + `DUAL_WRITE_PHASE3=true`.

### Session Creation (6-step wizard at `app/townhall/new/`)
1. **Basics** — session name, slug, industry, bot name/emoji, session type, expected attendees, org name, event description, opening/closing messages, tone
2. **Seed Topics** — discussion guide cards (label, description, opening question, follow-up angles, keywords, response target)
3. **Sensitive Topics** — banned terms (AI-suggested + manual) and priority areas
4. **Conversation** — max turns, AI timeout, testing mode, session end mode, button labels, content safety toggles
5. **Post-Session** — demographic + psychographic sample fields
6. **Review & Publish**

### Session Types
`community`, `employee`, `customer`, `student`, `member`, `other` — drives AI tone and peer references.

### Live Console (`app/townhall/[sessionId]/`)
- Three tabs: Live Feed, Topic Cards, Themes
- Real-time chat moderation, topic rotation, organic theme discovery
- Per-participant ban / mute, content-guard flagging
- Live sentiment + activity counts

### Participant Widget (`/th/[guid]`)
- Anonymous join (per-session participant_id)
- Multi-language autodetect from first turn (15 langs in chat: `LANG_CODES` in `app/api/townhall/chat/route.ts`)
- Pre-session demographic + psychographic intake
- Rate limits: 20 req/min per participant + 600 req/min per IP

### Post-Session
- Theme detection cron (`/api/cron/townhall-theme-detection`)
- Demographic + psychographic aggregations
- Standby state for round-based mode (scoped, not built — see `[[project-pulseiq-round-based]]`)

---

## 15. Agents (Branded Chatbots)

*Gated by `organizations.features.bots`. UI label: **Agents**. Internal name: `bots`. See `docs/BOTS.md`.*

### Agent Builder (`app/bots/[id]/`)
- Bot identity: name, emoji, personality, opening message
- System prompt customization
- Knowledge base: upload PDFs / docs → chunked + embedded (OpenAI embeddings) into `bot_knowledge_chunks`
- Intent rules: keyword + AI detection of donate / volunteer / event / custom intents → URL or message trigger
- Contrast positions: explicit "agent disagrees with X" stances
- Content guardrails (banned topics, demographic toggle, persona inference toggle)

### Public Chat Widget (`/b/[slug]`)
- Anonymous, rate-limited (`/api/bots/[id]/chat`, 30 req/min/IP)
- Hybrid RAG retrieval: pgvector cosine + Postgres `tsvector` + `pg_trgm` blended in one RPC
- Session persona extracted at turn 2–4, merged across the session for context
- Per-turn sentiment, language, content flags, intent matches stored
- Embeddable as iframe

### Conversation Analytics
- Periodic AI reviews flag theme drift (`/api/cron/bot-conversation-review`)
- Insights deck export: KPIs, common questions, drop-off points, sample quotes, recommendations

### Audit Log & Versioning (since 2026-05-19)
- **`bot_change_log` table** — append-only record of every mutation on a bot: create / update / delete / status_change / knowledge_added / knowledge_cleared / import. Each row carries actor (id + email), action, summary, before/after diff JSON, metadata, timestamp.
- **Per-bot history viewer** (`/bots/[id]/history`) — chronological list with before/after diffs per event. Linked from each agent card on `/bots` ("History") and from the edit-page header ("View history →").
- **JSON export** (`/api/bots/[id]/export`, "Export JSON" link on each bot card) — versioned snapshot (`bot_export_version: 1`) containing the bot row sans IDs/timestamps + all knowledge chunks. Downloaded as `bot_<slug>_<YYYY-MM-DD>.json`.
- **JSON import** (`/api/bots/import`, "↓ Import" button on `/bots`) — recreates a bot in the caller's org as `status='draft'`; slug collisions auto-suffix `-copy[N]`. Chunks imported without embeddings (re-embed on knowledge save).
- **Clone-modify-test pattern** — export → import a bot, modify the new draft, test alongside the live bot. Used to iterate on system prompt + intents without touching production. Audit log captures every step so the test journey is reproducible.

### Probe Enforcement (since 2026-05-19)
- Bot-specific server-side enforcement of required probes via `bot.config.probeEnforcement` (e.g. counter-perspective probe in pilots that need it). Chat route counts user turns, scans assistant turns for the configured detection regex, and appends a CRITICAL OVERRIDE instruction at the end of the system prompt once the fallback threshold is crossed and the probe still hasn't fired. Bot-specific without code edits — config lives on the bot row.

### Regression Tester (since 2026-05-19, Sarina)
- **`/admin/sarina-regression`** — admin button to re-run the 22-scenario NOWOCATS test against the live Sarina bot. Encoded from Arjun's 2026-05-17 test log. Per-scenario `mustInclude` / `mustNotInclude` regex assertions, transcript display, RAG debug per turn.
- **CLI runner** (`scripts/_run_sarina_regression.ts`) — same test set runnable from terminal for CI / cron later.
- **Before/after Word doc generator** (`scripts/_generate_sarina_regression_doc.ts`) — produces a side-by-side comparison memo to `~/Downloads/`.

### Storage
`bots`, `bot_knowledge_chunks`, `bot_conversation_turns`, `bot_session_personas`, `bot_conversation_reviews`, `bot_change_log` (migrations 020/022–025/028/029/038/072/074).

---

## 16. Social Monitoring

*Gated by `organizations.features.social`. See `docs/SOCIAL.md`.*

### Account Connection
- Meta OAuth (Facebook Pages + Instagram Business accounts) — `social_connections`
- Token refresh + scope validation

### Ingestion
- **Webhook** (primary): Meta → `/api/social/webhook` — sub-second latency
- **Cron poll** (backstop): `/api/cron/social-sync` every 15 min for missed deliveries + backfill
- All comments → `social_comments` with sentiment + content-guard flags
- Cron path also runs `tagComment()` overlay (topic, intent, emotion + OpenAI moderation)

### Operator Console (`/app/social`)
- Filtered feed (status, sentiment, platform, account, tags)
- Per-comment actions: hide, like, reply (templated or AI-custom), delete moderation
- Bulk actions
- Alert rules (keyword / sentiment / volume thresholds → email)
- DM templates and send log
- Export to TextMine dataset (`/api/social/export-dataset`)

### Response Routing
`routeResponse()` decides: silent moderate / human queue / templated reply / AI-custom reply.

---

## 17. Data Sources (External Ingest)

*Each gated independently. All write into `dataset_rows_flat`. See `docs/DATA_SOURCES.md`.*

| Source | Gate flag | Cadence | Driver |
|--------|-----------|---------|--------|
| **Reddit** | `reddit` | One-shot, user-initiated | UI → `/download-thread` per thread |
| **Google Reviews** (DataforSEO) | `googleReviews` | Continuous cron | `/api/cron/review-sync` every 6h, two-phase submit→poll |
| **Tripadvisor Reviews** (DataforSEO) | `googleReviews` | Continuous cron | Same review-sync cron |
| **Substack** | `substack` | One-shot | UI → `/download-comments` per post |
| **Regulations.gov** | `analyze` | One-shot, page-by-page | UI loops `/download-comments?page=N` (Vercel-timeout-friendly) |

### Common behavior
- Wizards at `/app/analyze/new/` for each source
- Service-role writes with explicit `org_id` checks (RLS default-deny after migration 032)
- Org-scoped `datasets` rows (`source = 'reddit' | 'google_reviews' | 'tripadvisor' | 'substack' | 'regulations'`)
- One-row-per-item writes — no dual-write to legacy `dataset_rows` (PR #1, May 2026)

### Real cost reference
DataForSEO Google reviews ≈ **$0.37 per 1,000** — see `[[reference-dataforseo-cost]]`.

---

## 18. Usage Accounting & Cost Estimator

*Admin-only — no per-org gate. See `docs/USAGE_ACCOUNTING.md`.*

### Historical Dashboard (`/admin/usage`)
- Every `callAI` with a `usage:` context auto-writes to `usage_logs` (input/output/cache-read/cache-creation tokens captured directly from provider response)
- Total spend, breakdown by module / event / model / day
- Top resources by cost (per-dataset / per-bot / per-session drill-in)
- Date range and filter controls

### Forward-Looking Estimator (`/admin/estimator`)
- 23 usage profiles spanning surveys, analyze, PulseIQ, agents, social, ingest, theming
- Inputs: scenario sliders (e.g. "X PulseIQs × Y participants × Z turns")
- Outputs: projected monthly AI bill, per-feature breakdown, storage cost, margin
- Multilingual factor applied per-profile
- Single rate table source of truth: `lib/usageRates.ts` (`RATES`, `TIER_DEFAULT_MODEL`, `estimateCost`)

### Cron Jobs Reporting Usage
`townhall-theme-detection`, `bot-conversation-review`, `entity-discovery`, `review-sync`, `social-sync`, `campaign-scheduler` — each writes its own `usage_logs` row when it invokes `callAI`.

---

## 19. Mobile / Progressive Web App

**Routes**: `/m`, `/manifest.webmanifest`, `/sw.js`. **Files**: `app/manifest.ts`, `app/m/page.tsx`, `app/m/MobileStatusClient.tsx`, `public/sw.js`, `public/icons/icon-{180,192,512}.png`.

A personal-use, install-on-iPhone status surface. Designed as a "check the status of things" companion to the desktop UI — not a phone-rebuild of every feature. Installs via Safari → Share → **Add to Home Screen**; no App Store distribution.

### Install path
1. Open the production URL in Safari on iPhone
2. Share → Add to Home Screen
3. Orange "S" icon lands on home screen; tapping it opens `/m` full-screen with no Safari chrome
4. iOS treats the install as a standalone app (own card in the app-switcher, own splash screen)

### What `/m` shows
Five stacked cards, each with a section count + the five most-recent items, deep-linking back to the desktop UI for drill:
- **Datasets** — name + row count + source, sorted by `created_at DESC`
- **Agents** — name + slug, sorted by `updated_at DESC`
- **Surveys** — name + response count, sorted by `created_at DESC`
- **Campaigns** — name + status, sorted by `created_at DESC`
- **PulseIQ** — name + status, sorted by `started_at` / `created_at DESC`

Plus an "Install this as an app" banner shown only when running in iOS Safari and not yet installed.

### Architecture notes
- **Auth**: standard Supabase auth on `/m`; redirects to `/login?next=/m` when unauthenticated. Service-role reads pair `id` with `org_id` (admin orgs bypass).
- **Manifest**: `app/manifest.ts` uses the Next.js App Router file convention (served as `/manifest.webmanifest`). `start_url=/m`, `display=standalone`, `theme_color=#e8622a` (brand orange).
- **Service worker**: `public/sw.js` is a minimal install/activate/fetch SW with no offline caching for v1 (the status surface reads live counts; cached counts would lie). Registered with scope `/` from the `/m` route only.
- **iOS specifics**: root layout sets `appleWebApp.capable=true`, `viewportFit=cover` so the page paints under the iPhone notch in standalone mode. `apple-touch-icon` points at the 180×180 PNG (iOS rejects SVG for this slot).
- **No native build, no Apple Developer account, no App Store review.** When/if push notifications or richer native integrations matter, the migration path is **Expo + EAS + TestFlight**.

---

## Platform Summary

| Dimension | Count |
|-----------|-------|
| Industries | 19 |
| Study blueprints | 7 |
| Languages | 16 (PulseIQ chat: 15) |
| Question types | 14 |
| Email block types | 8 |
| Export formats | 4 (CSV, PPTX, HTML, JSON) |
| Email providers | 4 (Resend, SendGrid, SES, SMTP) |
| SMS providers | 1 (Twilio) |
| AI providers | 3 (Anthropic, OpenAI, Azure OpenAI) |
| Module feature flags | 9 |
| Theme colors | 6 customizable |
| Color presets | 7 |
| Rating types | 8 |
| Creator steps | 10 |
