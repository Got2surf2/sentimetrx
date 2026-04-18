# Campaigns Module

## Overview

Email campaign manager for distributing surveys. Rich template builder, CSV recipient upload, multi-provider sending (Resend, SendGrid, SES, SMTP), delivery tracking (opens, clicks, bounces), and automatic reminder scheduling.

---

## Campaign Creation

### Flow (`app/studies/[id]/campaigns/new/`)

1. Enter campaign name (auto-suggested from study name)
2. Set target response count
3. Select email provider
4. Auto-creates 3-email template sequence:
   - **Initial invitation** — immediate
   - **First reminder** — 72 hours, non-responders only
   - **Final reminder** — 7 days, non-responders only
5. Redirect to campaign detail page for template editing + recipient upload

---

## Email Providers

| Provider | Config | Notes |
|----------|--------|-------|
| **Resend** | API key | Default, best webhook support |
| **SendGrid** | API key (v3) | Popular alternative |
| **AWS SES** | Access key + secret + region | Enterprise scale |
| **SMTP** | Host, port, user, pass | Any SMTP server (Gmail, Outlook, custom) |
| **Twilio SMS** | Account SID + auth token | Optional SMS channel |

Provider config stored as JSONB on the campaign record. Test send available before bulk dispatch.

---

## Recipient Management

### CSV Upload (4-Step Wizard)

1. **Upload** — Drag-drop or file picker. Supports CSV, TSV, JSON, Excel (.xlsx, .xls)
2. **Map** — Assign columns to field names (merge tags). Email column auto-detected.
3. **Review** — Select/deselect rows, flag duplicates, preview field values
4. **Confirm** — Import with deduplication (skips existing emails)

### Features
- Single recipient inline addition
- Delete respondents (pending status only)
- Export respondents as CSV
- Batch inserts (500 at a time)
- Unique `recipient_guid` per respondent for tracking
- `unsubscribe_token` generated per respondent

---

## Template System

### Rich Template Builder

**Block types:**

| Block | Description |
|-------|-------------|
| Text | Paragraph with formatting |
| Heading | Section header |
| Image | With alt text, width, alignment |
| Numbered Steps | Step number + heading + content |
| Divider | Horizontal line |
| Signature | Name + title |
| Button | CTA with URL and color |
| Spacer | Vertical padding |

**Header banner:** Color, text, logo(s), layout options

**Two editor modes:**
- **Builder** — Visual form-based with live preview
- **HTML** — Raw HTML textarea for advanced users

### Merge Tags

| Tag | Source |
|-----|--------|
| `{{first_name}}`, `{{company}}`, etc. | CSV column fields |
| `{{email}}` | Respondent email |
| `{{survey_link}}` | Auto-generated survey URL with hidden fields + recipient GUID |
| `{{unsubscribe_link}}` | Public unsubscribe endpoint |
| `{{study_name}}` | Study name |
| `{{campaign_name}}` | Campaign name |

Tags interpolated at send time via simple regex replacement. Missing variables default to empty string.

---

## Sending & Scheduling

### Send API (`POST /api/campaigns/[id]/send`)
- Fetches template by sequence number
- Determines targets based on `send_to` setting:
  - `all` — Every recipient
  - `non_responders` — Haven't completed survey
  - `incompletes` — Started but didn't finish
- Builds personalized survey URL with hidden fields + recipient GUID
- Adds unsubscribe link
- Logs each send to `campaign_send_log`
- Auto-schedules reminder emails after initial send

### Scheduling Options
- `send_delay_hours` — Hours after campaign launch (0 = immediate)
- `send_time` — Time of day (24h format, e.g., "09:00")
- `send_timezone` — IANA timezone (default "America/New_York")
- `send_at` — Specific date/time (overrides delay)

### Test Send (`POST /api/campaigns/[id]/test-send`)
- Sends to current user's email
- Uses sample respondent data for merge tag preview

---

## Tracking

### Webhook Integration (`POST /api/campaigns/webhooks/resend`)

| Event | Status Set |
|-------|-----------|
| `email.delivered` | `sent` |
| `email.opened` | `opened` |
| `email.clicked` | `clicked` |
| `email.bounced` | `bounced` |
| `email.complained` | `bounced` |

Status upgrades are one-way (never downgrades), except `bounced` which always applies. Never overwrites `completed`.

### Respondent Status Lifecycle
```
pending → sent → opened → clicked → completed
                                   ↘ bounced
                         ↘ unsubscribed
```

### Stats API (`GET /api/campaigns/[id]/stats`)
- Aggregates counts by status
- Calculates completion rate and target progress
- Auto-completes campaign when all recipients reach terminal states

### Tracked Timestamps
- `sent_at` — Email dispatched
- `opened_at` — First open
- `clicked_at` — First link click
- `completed_at` — Survey response submitted

---

## Campaign Management

### Dashboard (`/campaigns`)
- List all campaigns with status badges
- Donut chart: % completed / sent / pending
- Color-coded cards from study theme
- Metrics: recipients, delivery rate, completion rate, target progress
- Status change dropdown

### Detail Page (`/campaigns/[id]`)

| Tab | Contents |
|-----|----------|
| Setup | Name, provider, target responses, thank-you/reminder toggles |
| Respondents | CSV upload, single-add, respondent table with pagination |
| Emails | Template builder/HTML editor, send history per sequence |
| Send | Trigger send, test send, delivery stats |

### Operations
- **Clone** — Duplicate campaign with optional recipients
- **Delete** — With confirmation
- **Export** — Respondents as CSV

---

## Shared Campaign Links

- **Create**: `POST /api/share` with type='campaign'
- **Access**: `GET /shared/{token}` — No auth, read-only
- **Expiry**: 24h, 7d (default), 30d
- Shows campaign stats, respondent data, completion metrics
- Audit: access logged with `last_accessed_at`

---

## Data Model

### Tables

**campaigns**
- `id`, `org_id`, `study_id`, `name`, `status` (draft/scheduled/active/paused/completed)
- `email_provider`, `email_config` (JSONB), `channel` (email/sms/both)
- `target_responses`, `hidden_fields[]`
- `send_thank_you`, `send_incomplete` (boolean toggles)

**campaign_respondents**
- `email` (unique per campaign), `fields` (JSONB from CSV)
- `status` (pending/sent/opened/clicked/completed/bounced/unsubscribed)
- `recipient_guid`, `unsubscribe_token`
- Timestamp fields: `sent_at`, `opened_at`, `clicked_at`, `completed_at`

**campaign_emails**
- `sequence` (0=initial, 1+=reminders), `subject`, `body_html`, `body_text`
- `send_delay_hours`, `send_time`, `send_timezone`, `send_at`
- `send_to` (all/non_responders/incompletes)

**campaign_send_log**
- Per-send record: `respondent_id`, `email_id`, `provider_msg_id`, `status`, `error_message`

**campaign_schedules**
- `scheduled_at`, `executed_at`, `status` (pending/processing/completed/failed/cancelled)

---

## Feature Flag

Campaigns controlled via `org.features.campaigns` — must be enabled per organization.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/campaigns/page.tsx` | Campaign list dashboard |
| `app/campaigns/[id]/CampaignDetailClient.tsx` | Detail page (setup, respondents, emails, send) |
| `app/studies/[id]/campaigns/new/NewCampaignClient.tsx` | Campaign creation |
| `lib/email/provider.ts` | Multi-provider email sending |
| `app/api/campaigns/` | All CRUD + send + tracking APIs |
| `app/api/campaigns/webhooks/resend/route.ts` | Delivery event webhook |
| `app/api/campaigns/unsubscribe/[token]/route.ts` | Public unsubscribe |
| `sql/008_campaigns.sql` | Base schema |
| `sql/010_phase2_campaigns.sql` | Scheduling + enhanced fields |
