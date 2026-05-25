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

## Channels & Providers

Email is the default channel. SMS can run alongside (`channel: 'email' | 'sms' | 'both'`) when a Twilio config is set. Provider config is stored as JSONB on the campaign record (`email_config` / `sms_config`). Test send is available for email before bulk dispatch.

**Email providers** (CHECK-constrained to one of these on `campaigns.email_provider`):

| Provider | Config | Notes |
|----------|--------|-------|
| **Resend** | API key | Default, best webhook support |
| **SendGrid** | API key (v3) | Popular alternative |
| **AWS SES** | Access key + secret + region (via AWS SDK) | Enterprise scale |
| **SMTP** | Host, port, user, pass (via nodemailer) | Any SMTP server (Gmail, Outlook, custom) |

**SMS provider** (separate, optional):

| Provider | Config | Notes |
|----------|--------|-------|
| **Twilio** | `accountSid` + `authToken` + `fromNumber` (or `TWILIO_*` env vars) | Sent only to respondents with a `phone` value when `channel ∈ {sms, both}` |

---

## Recipient Management

### CSV Upload (4-Step Wizard)

1. **Upload** — Drag-drop or file picker. Supports CSV, TSV, JSON, Excel (.xlsx, .xls)
2. **Map** — Assign columns to field names (merge tags). Email column auto-detected.
3. **Review** — Select/deselect rows, flag duplicates, preview field values
4. **Confirm** — Import with deduplication (skips existing emails)

### Features
- Single recipient inline addition
- Delete respondents (pending status only — already-sent rows are preserved)
- Export respondents as CSV
- Server-side de-dup against existing emails before a single bulk `INSERT`. GET pagination page size is 500.
- Unique `recipient_guid` per respondent for tracking (used by the click-fallback endpoint)
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
- Promotes campaign `status` from `draft|scheduled` → `active` on first successful send
- Auto-schedules reminder emails (sequence > 0) **only when** the call sends the initial email (sequence 0) and at least one respondent was sent

### Scheduling Options
- `send_delay_hours` — Hours after campaign launch (0 = immediate)
- `send_time` — Time of day (24h format, e.g., "09:00"). When set on a reminder, the scheduled-at time is snapped to that wall-clock time (rolling to next day if it has already passed)
- `send_timezone` — IANA timezone (default "America/New_York")

**Resolved 2026-05-25**: the phantom `send_at` field (no DB column, dropped by the PATCH allowlist) has been removed from `lib/types.ts`, `app/campaigns/[id]/CampaignDetailClient.tsx`, and the email-editor UI. The Timing dropdown's "Specific date" mode has been retired; all scheduling now goes through `send_delay_hours` + `send_time`. Reintroduce a real `send_at` column + scheduler change when specific-datetime scheduling becomes a customer-asked feature.

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

`email.sent` is acknowledged with no status change. Unknown event types are also no-ops.

Status upgrades are one-way (never downgrades), except `bounced` which always applies. Never overwrites `completed`.

**Security:** every webhook is verified against `RESEND_WEBHOOK_SECRET` using Svix-style HMAC (`v1`) over `<svix-id>.<svix-timestamp>.<rawBody>`. Requests outside a ±5-minute timestamp skew window are rejected to block replay.

**Idempotency:** the `svix-id` header is recorded in `public.webhook_events (source='resend', svix_id)` with `UNIQUE (source, svix_id)`. Resend retries hit the unique constraint and short-circuit with `{ ok: true, deduped: true }` before any campaign state is mutated. Fail-open if the ledger insert fails for any non-unique reason — duplicates are no worse than the pre-dedup behavior. Applied in `sql/071_webhook_events.sql`.

### Click Tracking Fallback (`POST /api/campaigns/click`)

For Resend free-plan users (no hosted click tracking), the survey page fires this endpoint with `{ rid: <recipient_guid> }` on load. It upgrades respondents in `pending|sent` to `clicked`. Unauthenticated by design; the `rid` is a UUID and the only effect is a one-way status upgrade.

### Respondent Status Lifecycle
```
pending → sent → opened → clicked → completed
                                   ↘ bounced
                         ↘ unsubscribed
```

### Stats API (`GET /api/campaigns/[id]/stats`)
- Aggregates respondent counts by status
- Returns total/failed send-log counts
- Calculates completion rate (% completed of total) and target progress (% of `target_responses`)
- Auto-completes the campaign when status is `active|scheduled` and every respondent has reached a terminal state — defined as `completed + bounced + unsubscribed = total`

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

| Tab (URL key) | UI label | Contents |
|---|---|---|
| `setup` | Setup | Name, provider, target responses, thank-you/reminder toggles |
| `respondents` | **Recipients** | CSV upload, single-add, respondent table with pagination |
| `emails` | Emails | Template builder/HTML editor, send history per sequence |
| `send` | Send | Trigger send, test send, delivery stats |

(The internal table is `campaign_respondents`; the user-facing label is "Recipients".)

A separate `/campaigns/[id]/edit` page provides a focused form for the same campaign-level fields surfaced in the Setup tab.

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
- `email_provider` (CHECK: resend/sendgrid/ses/smtp), `email_config` (JSONB)
- `channel` (email/sms/both) + `sms_config` (JSONB)
- `study_url` (survey URL template with `{{field}}` placeholders), `hidden_fields[]`
- `target_responses`
- `send_thank_you`, `send_incomplete` (boolean toggles)

**campaign_respondents**
- `email` (unique per campaign), `fields` (JSONB from CSV), `phone` (optional, for SMS)
- `status` (pending/sent/opened/clicked/completed/bounced/unsubscribed)
- `recipient_guid`, `unsubscribe_token`
- `response_id` FK to `responses` (set when the survey is submitted)
- Timestamp fields: `sent_at`, `opened_at`, `clicked_at`, `completed_at`

**campaign_emails**
- `sequence` (0=initial, 1+=reminders), `subject`, `body_html`, `body_text`
- `send_delay_hours`, `send_time`, `send_timezone`, `sms_body`, `is_thank_you`
- `send_to` (all/non_responders/incompletes)

**campaign_send_log**
- Per-send record: `respondent_id`, `email_id`, `provider`, `provider_msg_id`, `status` (queued/sent/delivered/opened/clicked/bounced/failed), `error_message`, `schedule_id`

**campaign_schedules**
- `scheduled_at`, `executed_at`, `status` (pending/processing/completed/failed/cancelled). The send route writes pending rows for reminder sequences after a successful initial send; the Vercel cron at `/api/cron/campaign-scheduler` (every 15 min, max 10 schedules per run, 60s `maxDuration`) drains them. Schedules whose campaign is no longer `active` are marked `cancelled`.

---

## Feature Flag

Campaigns controlled via `org.features.campaigns` — must be enabled per organization.

---

## Key Files

| File | Purpose |
|------|---------|
| `app/campaigns/page.tsx` + `CampaignDashboardClient.tsx` | Campaign list dashboard |
| `app/campaigns/[id]/CampaignDetailClient.tsx` | Detail page (setup, recipients, emails, send) |
| `app/campaigns/[id]/edit/page.tsx` | Edit-only form view |
| `app/studies/[id]/campaigns/new/NewCampaignClient.tsx` | Campaign creation |
| `lib/email/provider.ts` | Multi-provider email + Twilio SMS sending, template interpolation, `buildSurveyUrl` |
| `app/api/campaigns/` | All CRUD + send + tracking APIs |
| `app/api/campaigns/[id]/send/route.ts` | Bulk send + auto-schedule reminders |
| `app/api/campaigns/[id]/test-send/route.ts` | Test send to the current user |
| `app/api/campaigns/[id]/stats/route.ts` | Stats + auto-complete |
| `app/api/campaigns/[id]/clone/route.ts` | Duplicate campaign |
| `app/api/campaigns/[id]/export/route.ts` | Respondent CSV export |
| `app/api/campaigns/webhooks/resend/route.ts` | Svix-verified Resend delivery webhook |
| `app/api/campaigns/click/route.ts` | Click-tracking fallback for free-tier Resend |
| `app/api/campaigns/unsubscribe/[token]/route.ts` | Public unsubscribe |
| `app/api/cron/campaign-scheduler/route.ts` | Drains pending `campaign_schedules` (every 15 min) |
| `app/api/share/route.ts` | Creates / fetches / revokes shared campaign links |
| `sql/008_campaigns.sql` | Base schema (5 tables + RLS) |
| `sql/009_recipient_guid.sql` | Adds `recipient_guid` for click-tracking |
| `sql/010_phase2_campaigns.sql` | `send_time`/`send_timezone`, SMS channel, `shared_links` |
