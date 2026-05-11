# SentimetRx Platform — Complete Feature Reference

## 1. Survey Creation Wizard

### Smart Study Wizard (AI-Powered)
- **7 study blueprints**: Satisfaction & Experience, NPS & Loyalty, Awareness & Perception, Motivation & Values, Churn & Risk, Engagement & Participation, Journey & Touchpoint
- **18 industry presets**: Healthcare, Hospitality, Casual Dining, Fine Dining, Retail, SaaS/Technology, Finance/Banking, Education, Real Estate, Automotive, Travel, Entertainment, Nonprofit, Government, Professional Services, Manufacturing, Telecom, Other
- AI-generated study configuration from industry + focus area + length selection
- Focus areas: retention, communication, recognition, motivation, legacy giving, donor capacity, civic mindset, and more
- Length tuning: quick (5Q), standard (10Q), comprehensive (15Q)

### Step-by-Step Creator (9 Steps)

**Step 1 — Basics**
- Study name, bot name, bot emoji (industry-specific emoji sets)
- Custom URL slug with availability checking
- Industry selection with auto-defaults
- 7 color presets (Ocean, Forest, Sunset, Violet, Rose, Slate, Gold) + custom color picker
- 6 theme colors: primary, header gradient, background, accent, bot avatar gradient
- Branding label (default "DATANAUTIX", customizable up to 15 chars, show/hide toggle)
- Response limits: allow multiple responses or one per device
- Response capture: instant capture (single tap) or tap-then-confirm mode
- Survey font size (adjustable px)
- Typing animation speed (0.25x minimal to 2x slow, default 0.5x)
- Multi-language configuration (15 languages, auto-translate on add)
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
- 15 question types:
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

**Step 9 — Review & Publish**
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

### 15 Supported Languages
English, Spanish, French, German, Portuguese, Italian, Chinese, Japanese, Korean, Arabic, Hindi, Vietnamese, Filipino, Russian, Polish

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

## 4. Email Campaign Manager

### Campaign Setup
- Create campaigns linked to a study
- Name, description, target response goal
- Email provider selection: Resend (default), SendGrid, AWS SES, custom SMTP

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

### Text Mining (AI-Powered Theme Extraction)
- Claude API-powered theme discovery from open-ended responses
- Industry theme library integration (Healthcare, Hospitality, SaaS, etc.)
- Theme extraction with verbatim tagging
- Manual theme editing: add, remove, rename themes post-mining
- Theme recounting without re-mining
- Statistical significance testing (chi-square) for theme distributions

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
- Role assignment (owner/member)
- Track invite usage
- Remove members from org
- Org owners (not just super-admins) can invite into their own org

---

## 9. Organization & Admin

### Organization Management
- Organization name, slug, logo
- Plan management: trial → active → suspended
- Feature flags per org:
  - `analyze`: Advanced text mining and analytics
  - `campaigns`: Email campaign manager
  - `primaryIndustries`: Restrict available industries
  - `defaultEmailProvider`: Set default email provider

### Platform Admin Dashboard
- List all organizations with stats (users, studies, responses)
- Edit org plans and features
- User management across orgs
- Question bank management
- Transfer study ownership between orgs

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

## 13. AI Integration (Claude API)

| Feature | Model | Purpose |
|---------|-------|---------|
| Smart Study Wizard | Claude | Generate complete study config from inputs |
| Clarifiers | Claude | Generate contextual follow-up questions |
| Smart Deflection | Claude | Detect off-topic questions, generate redirects |
| Study Translation | Claude Haiku | Translate all study content to 15 languages |
| Response Translation | Claude Haiku | Translate non-English responses to English |
| Theme Mining | Claude | Extract themes from open-ended text |
| Theme Recounting | Claude | Re-tag responses with updated theme model |

---

## Platform Summary

| Dimension | Count |
|-----------|-------|
| Industries | 18 |
| Study blueprints | 7 |
| Languages | 15 |
| Question types | 15 |
| Email block types | 8 |
| Export formats | 4 (CSV, PPTX, HTML, JSON) |
| Email providers | 4 |
| Theme colors | 6 customizable |
| Color presets | 7 |
| Rating types | 8 |
