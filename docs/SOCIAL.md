# Sentimetrx — Social Monitoring Spec

**Module:** `/app/social/`, `/app/api/social/*`, `/app/api/cron/social-*`, `lib/socialTagging.ts`
**Storage:** `social_connections`, `social_comments`, `social_moderation_log`, `social_alert_rules`, `social_alerts_sent`, `social_dm_log` (migrations `026_social_moderation.sql`, `027_social_enhancements.sql`)
**External APIs:** Meta Graph API v19.0 (Facebook, Instagram), OpenAI moderation
**Feature gate:** `organizations.features.social` (set per-org by admins)

## Overview

Social monitoring lets an org connect their Facebook Pages and Instagram Business accounts and ingest every public comment in near-real-time (webhooks + 15-minute cron backstop). Each comment is auto-tagged for sentiment, content-guard flags (profanity, threats, slurs, spam), topics, intent, and emotion. Optional auto-moderation hides/deletes severe content and posts AI-drafted replies. Operators triage anything that needs attention from a single feed at `/social`. Comments can be exported as a TextMine dataset for the same analytics as any other source.

The module is built around two ingestion paths (webhook + cron poll), one tagging pipeline, and one moderation feed. Everything else is glue: OAuth, alerts, DM templates, stats, demo data.

---

## Database Schema (`sql/026_social_moderation.sql`, `sql/027_social_enhancements.sql`)

### `social_connections`
One row per linked Facebook Page or Instagram Business account.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK |
| `org_id` | UUID FK organizations |
| `platform` | TEXT | `'facebook'` or `'instagram'` |
| `account_id` | TEXT UNIQUE | Page ID or IG account ID |
| `account_name` | TEXT |
| `access_token` | TEXT | Long-lived (60-day) Meta token |
| `token_expires_at` | TIMESTAMPTZ |
| `connected_by` | UUID FK auth.users |
| `created_at`, `updated_at` | TIMESTAMPTZ |

Index: `(org_id)`.

### `social_comments`
One row per ingested comment. De-duplicated by `comment_id` (the Meta-side platform ID).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK |
| `org_id`, `connection_id` | UUID FK |
| `platform`, `post_id`, `post_text` | TEXT |
| `comment_id` | TEXT UNIQUE |
| `parent_comment_id`, `author_name`, `author_id` | TEXT |
| `text` | TEXT | The comment body |
| `sentiment` | TEXT | `'positive' \| 'negative' \| 'neutral'` |
| `sentiment_score` | NUMERIC | Raw AFINN comparative score, -1.0 to +1.0 (added in `027`) |
| `flags` | JSONB | Array of `{type, severity, action?}` from `tagComment()` |
| `is_hidden`, `is_deleted`, `is_reply` | BOOL |
| `is_handled` | BOOL | Triage flag (added in `027`) |
| `replied_at`, `our_reply` | reply state |
| `platform_created_at`, `ingested_at` | TIMESTAMPTZ |

Indexes: `(org_id, ingested_at DESC)`, `(connection_id, platform_created_at DESC)`, `(comment_id)`.

### `social_moderation_log`
Audit trail for every moderation action.
Columns: `id`, `org_id`, `comment_id`, `action` (`hide`/`unhide`/`delete`/`reply`/`ai_reply`/`dm`), `reply_text`, `performed_by`, `created_at`.

### `social_alert_rules`
Polymorphic table — stores alert rules **and** DM templates (distinguished by `rule_type`).
Columns: `id`, `org_id`, `rule_type`, `config` JSONB, `channels` JSONB, `enabled`, `created_at`.

### `social_alerts_sent`
History of dispatched alerts.
Columns: `id`, `org_id`, `rule_id`, `channel`, `target`, `subject`, `body`, `comment_ids` UUID[], `sent_at`.

### `social_dm_log`
History of DMs sent to comment authors.
Columns: `id`, `org_id`, `connection_id`, `platform`, `recipient_id`, `recipient_name`, `trigger_comment_id`, `intent`, `template`, `message_text`, `sent_at`.

---

## Connecting Accounts (OAuth) — `/api/social/connect`, `/api/social/callback`

Meta OAuth flow against Facebook Graph v19.0.

**`POST /api/social/connect`** — initiate
- Scopes requested: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
- Builds the auth URL with `state = base64(JSON({userId}))`
- Returns the redirect target

**`GET /api/social/callback`** — finish
1. Exchange `code` → short-lived user token
2. Exchange short-lived → long-lived token via `fb_exchange_token` grant (60-day expiry)
3. `GET /me/accounts` — list user's Pages
4. For each Page, attempt to fetch the linked Instagram Business account
5. Wipe stale connections for this user, then upsert one row per Page (Facebook) and one per IG account (Instagram)

Disconnect via `DELETE /api/social/connections/[id]`. List active connections via `GET /api/social/connections`.

Token refresh runs as a separate cron (see below).

---

## Real-Time Webhook — `/api/social/webhook`

Meta posts comment events to this endpoint as soon as they're created.

**`GET`** — verification handshake
- Meta sends `hub.verify_token` and `hub.challenge`; we validate the token against `META_WEBHOOK_VERIFY_TOKEN` and echo the challenge.

**`POST`** — event handler
- Object types: `page` (Facebook), `instagram`
- Field types: `feed` (Facebook comments), `comments` (Instagram comments)
- For each entry: fetch the full comment via Graph API
  - Facebook fields: `id, message, from, created_time, is_hidden, parent`
  - Instagram fields: `id, text, username, timestamp`
- Run through `tagComment()` (see Tagging Pipeline)
- De-dupe by `comment_id`, insert into `social_comments`

The webhook is the *primary* path; the cron is a backstop for missed deliveries and historical backfill.

---

## Cron Sync — `/api/cron/social-sync`

Runs every 15 minutes (configured in `vercel.json`), 60s max duration. Polls each connection for new comments since the last ingested record.

1. Validate `CRON_SECRET` bearer token
2. For each active connection (token not expired):
   - **Facebook:** `GET {pageId}/posts?limit=25` → for each post, `GET {post.id}/comments?limit=100`
   - **Instagram:** `GET {igAccountId}/media?limit=25` → for each media, `GET {media.id}/comments?limit=100` (with replies)
   - De-dupe candidates against existing `comment_id`s
   - Run **batch OpenAI moderation** on the new comment texts (single API call)
   - Run `tagComment(text, postText, moderationScore, sensitivity)` per comment
   - Insert all new rows into `social_comments`
   - Apply auto-actions per connection's `social_auto_config` (see below)

Returns `{ synced, connections }` for monitoring.

---

## AI Tagging Pipeline — `lib/socialTagging.ts`

`tagComment(text, postText?, moderation?, sensitivity?) → TagResult`

Sensitivity is `'strict' | 'moderate' | 'lenient'` (default `moderate`), pulled from the org's auto-config.

**TagResult shape:**
```ts
{
  sentiment:     'positive' | 'negative' | 'neutral'
  sentimentScore: number   // AFINN comparative, -1 to +1
  flags:         { type, severity, action? }[]
  isHidden:      boolean
  isDeleted:     boolean
  topics:        string[]
  intents:       string[]
  emotion:       string
}
```

### Flag types produced
| Category | Types |
|---|---|
| Content guard | `profanity`, `slur`, `threat`, `sexual`, `insult` |
| Actions | `auto_delete`, `auto_hide` (conditional on severity × sensitivity) |
| Triage | `review` (queue for human) |
| Spam heuristics | `spam` (URLs + promo, social bait, scam, ALL CAPS, excessive punctuation) |
| Competitor mentions | `competitor` (Qualtrics, SurveyMonkey, Typeform, Medallia) |
| Intent | `donate`, `volunteer`, `event` |
| Topics | `safety`, `housing`, `economy`, `education`, `healthcare`, `transportation`, `environment`, `immigration`, `development`, `culture` |
| Emotion | `enthusiastic`, `angry`, `worried`, `frustrated`, `curious`, `hopeful` |
| Off-topic | `off_topic` (no topic match + no overlap with post text) |

### Severity → action matrix
| Severity | Strict | Moderate | Lenient |
|---|---|---|---|
| `severe` + `threat`/`slur` | delete | hide | review |
| `severe` (other) | hide | hide | review |
| `rude` | review | review | review |

OpenAI moderation overlays:
- `threat ≥ 0.5` or `identity ≥ 0.5` → same as severe-threat-slur logic
- `toxicity ≥ 0.7` → hide; 0.4–0.7 → review
- `sexual ≥ 0.5` → hide or review depending on sensitivity

### `routeResponse(tagged, authorName?, postTopic?)`

Decides what to do with a tagged comment. Returns `ResponseRoute`:
- `silent` — auto-deleted/hidden, no further action
- `review` — flag for human triage
- `template` — off-topic redirect, positive-intent (donate/volunteer), simple positive — fill from a template pool with parameter injection
- `ai` — negative, complex, or on-topic — call `callAI` with the social-manager system prompt

The template pool covers `off_topic`, `positive`, `positive_intent_donate`, `positive_intent_volunteer`.

---

## Auto-Moderation Configuration — `/api/social/auto-config`

Settings live on `organizations.features.social_auto_config`:

| Field | Type | Default | Effect |
|---|---|---|---|
| `auto_reply_enabled` | bool | false | Enable auto-replies on cron + webhook |
| `auto_reply_mode` | enum | `queue` | `queue` (no auto-replies, just human review), `positive_neutral` (skip negatives), `all` (template or AI per `routeResponse()`) |
| `auto_hide_enabled` | bool | false | Hide on platform when severity matches threshold |
| `auto_hide_severity` | enum | `severe` | `severe` or `rude` |
| `auto_delete_enabled` | bool | false | Delete on platform when threshold matched (paired with `auto_hide`) |
| `moderation_sensitivity` | enum | `moderate` | Affects `tagComment()` severity → action mapping |

`GET` returns the current config. `PATCH` updates it.

---

## Comment Management UI — `/app/social/SocialClient.tsx`

Single-page operator console. Tabs: **Feed**, **Settings**.

### Filters (Feed tab)
- `platform`: `facebook` | `instagram`
- `sentiment`: `positive` | `negative` | `neutral`
- `flaggedOnly` (boolean)
- `handledFilter`: '' / 'true' / 'false' (default `false` = "needs attention")
- `statusFilter`: hidden / deleted / replied
- `flagType`: any flag type from the tagging pipeline
- `search`: full-text on `text` (ILIKE)
- View modes: `recent` (by `ingested_at`), `bypost` (group by post)

### Per-comment actions
| Action | Endpoint | Notes |
|---|---|---|
| Hide / unhide | `POST /comments/[id]/hide` | Toggles via Meta Graph; logs `hide`/`unhide` |
| Manual reply | `POST /comments/[id]/reply` | Posts to platform, updates `our_reply` |
| AI reply | `POST /comments/[id]/ai-reply` | `callAI({tier:'fast', maxTokens:200, timeoutMs:15000})`; system prompt forbids mentioning Datanautix/sentimetrx; body `autoPost` (default true) controls posting |
| Delete | `POST /comments/[id]/delete` | Soft-delete via Graph; sets `is_deleted=true` |
| Mark handled | `POST /comments/[id]/handle` | Toggles `is_handled` flag (no platform action) |
| Send DM | `POST /comments/[id]/dm` | Posts via `/me/messages`; logs to `social_dm_log` |

### Bulk actions — `POST /comments/bulk`
- `action: 'hide' \| 'delete'` + `commentIds: UUID[]`
- Iterates per-comment Graph calls; reports `{succeeded, failed}`

Demo comments (prefixes `demo_` or `test_comment_`) skip Graph API calls and only update local state.

---

## Stats Dashboard — `/api/social/stats`

`GET /api/social/stats?from=...&to=...` (default last 24h).

Returns counts computed in memory from the comment array:
```
{ total, sentiment: {positive, negative, neutral}, flagged, hidden,
  deleted, replied, handled, needsAttention, byPlatform: {facebook, instagram} }
```

The Feed tab renders this as a sticky stats bar above the comment list.

---

## Alerts & DM Templates

**`/api/social/alerts`** (`GET`/`POST`/`PATCH`/`DELETE`)
- Alert rules CRUD
- Body: `{ rule_type, config: {}, channels: [], enabled }`
- When a rule's condition is matched (during cron sync), an entry is appended to `social_alerts_sent` and channels are dispatched (email/Slack/etc)

**`/api/social/dm-templates`** (`GET`/`POST`)
- Stored in `social_alert_rules` with `rule_type='dm_template'`
- Template body has merge tags filled by `routeResponse()` template pool

---

## TextMine Export — `/api/social/export-dataset`

The bridge from social monitoring into the regular analytics layer. Documented separately in `ANALYTICS.md` but key facts:

- **First call** — creates a dataset with `source='social'`, builds schema via `buildSocialSchema()`, sets `dataset_state`
- **Subsequent calls** — incremental sync; uses `last_synced_at` to filter only new comments
- Filters supported: `platform`, `sentiment`, `flagged`, `connectionId`
- Writes flattened rows directly into `dataset_rows_flat` (one row per comment) — no batched-table dual-write (this was the only flat-only insert path before PR #1; now standard)
- Flattened columns: `comment_id, platform, author_name, text, sentiment, sentiment_score, emotion, topics, intents, is_hidden, is_deleted, is_reply, post_text, comment_date, flag_types, max_severity`
- Severity rank for `max_severity`: `mild < rude < severe`
- Inserts in 500-row chunks
- Returns `{ datasetId, synced, total, created }`
- `GET` checks for an existing social dataset for the org (used by the UI to decide "create" vs "sync")

Once exported, the dataset behaves identically to a CSV upload or Google Reviews dataset — TextMine theme mining, Charts, Stats, Search, AI re-rank all work.

---

## Demo Mode — `/api/social/demo` (admin only)

For sales demos and onboarding. `POST` generates 25 realistic comments via `callAI({tier:'standard'})`, splices in hardcoded offensive comments at the tail, runs everything through `tagComment` with auto-actions enabled, and spreads timestamps over the last 24h.

Returns counts (generated, flagged, autoHidden, autoDeleted, flaggedForReview, sentiment breakdown). `DELETE` clears all comments with `comment_id LIKE 'demo_%'` or `'test_comment_%'`.

---

## Token Refresh — `/api/cron/social-token-refresh`

Runs daily, 30s max.

1. Find connections whose `token_expires_at` is within 7 days and still valid
2. Call Graph API `fb_exchange_token` for each
3. Update `access_token` and `token_expires_at`

Returns `{ refreshed, failed }`.

---

## Cross-References

- **Content Guard (`lib/contentGuard`)** — `auditContent()`, `scoreSentiment()`, `scoreSentimentFull()`. Used by webhook ingest, cron sync, and demo generation.
- **Usage Logging (`lib/usageLog.ts`)** — every AI call (replies, demo generation, sync auto-replies) passes a `usage` context with `resource_type: 'social'`. Visible in `/admin/usage` filtered by type=Social.
- **Organizations features object** — `social_auto_config` lives here; the `social` boolean gates module visibility in nav.
- **TextMine analytics layer** — `dataset_rows_flat`, `dataset_state`, `buildSocialSchema()`. After export, social datasets get all the standard analyses (themes, charts, stats, search).

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | OAuth client credentials |
| `META_WEBHOOK_VERIFY_TOKEN` | Webhook handshake secret |
| `OPENAI_API_KEY` | Moderation API |
| `CRON_SECRET` | Bearer token for `/api/cron/social-sync` and `/api/cron/social-token-refresh` |
