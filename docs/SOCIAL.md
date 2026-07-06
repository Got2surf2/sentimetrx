# Sentimetrx — Social Monitoring Spec

**Module:** `/app/social/`, `/app/api/social/*`, `/app/api/cron/social-*`, `lib/socialTagging.ts`
**Storage:** `social_connections`, `social_comments`, `social_moderation_log`, `social_alert_rules`, `social_alerts_sent`, `social_dm_log` — migrations `sql/026_social_moderation.sql`, `sql/027_social_enhancements.sql`
**External APIs:** Meta Graph API v19.0 (Facebook + Instagram), OpenAI moderation
**Feature gate:** `organizations.features.social`

> **Spec scope:** complete enough to rebuild the module from scratch. Includes
> full DDL, every API contract, verbatim AI prompts, every Graph API call, the
> tagging pipeline's regex/templates, UI state shape, env vars, and error
> handling patterns. Source of truth is the code — this spec is current as of
> 2026-05-15 and should be refreshed after any substantive changes.

---

## 1. Overview

Social monitoring lets an org connect their Facebook Pages and Instagram Business accounts and ingest every public comment in near-real-time. Two ingestion paths feed `social_comments`:

1. **Webhook** (primary) — Meta posts events to `/api/social/webhook` as comments are created. Sub-second latency.
2. **Cron poll** (backstop) — `/api/cron/social-sync` runs every 15 minutes to catch missed webhook deliveries and backfill history.

Each ingested comment is scored by the content guard (`auditContent()` + `scoreSentimentFull()`) for sentiment + content-guard flags (profanity, threats, slurs, spam). The **cron path** also runs the full `tagComment()` pipeline (`lib/socialTagging.ts`), which adds topic tags, intent tags, emotion, and an OpenAI moderation overlay. `routeResponse()` decides whether to silently moderate, queue for human review, send a templated reply, or call AI for a custom response. (The webhook path skips the `tagComment` overlay — comments arrive faster, but get the lighter content-guard treatment until the next cron sweep covers them.)

Operators triage from `/app/social` — a single-page console with filtered feed, per-comment actions, bulk actions, alert rules, and DM templates. Comments can be exported as a TextMine dataset (`/api/social/export-dataset`) for the same analytics treatment as any other source.

---

## 2. Database Schema

### `sql/026_social_moderation.sql` — full DDL

```sql
-- Social account connections (Meta OAuth tokens)
CREATE TABLE social_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_id       TEXT NOT NULL,
  account_name     TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  connected_by     UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_connections_org ON social_connections(org_id);

-- Ingested comments from FB + IG
CREATE TABLE social_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id       UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  post_id             TEXT NOT NULL,
  post_text           TEXT,
  comment_id          TEXT NOT NULL UNIQUE,
  parent_comment_id   TEXT,
  author_name         TEXT,
  author_id           TEXT,
  text                TEXT NOT NULL,
  sentiment           TEXT,
  flags               JSONB DEFAULT '[]',
  is_hidden           BOOLEAN DEFAULT false,
  is_deleted          BOOLEAN DEFAULT false,
  is_reply            BOOLEAN DEFAULT false,
  replied_at          TIMESTAMPTZ,
  our_reply           TEXT,
  platform_created_at TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_comments_org ON social_comments(org_id, ingested_at DESC);
CREATE INDEX idx_social_comments_connection ON social_comments(connection_id, platform_created_at DESC);
CREATE INDEX idx_social_comments_platform_id ON social_comments(comment_id);

-- Moderation action log
CREATE TABLE social_moderation_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  comment_id   UUID REFERENCES social_comments(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('hide','unhide','delete','reply','ai_reply','dm')),
  reply_text   TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_mod_log_org ON social_moderation_log(org_id, created_at DESC);

-- Alert rules + DM templates (polymorphic via rule_type)
CREATE TABLE social_alert_rules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_type  TEXT NOT NULL,
  config     JSONB DEFAULT '{}',
  channels   JSONB DEFAULT '[]',
  enabled    BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_alert_rules_org ON social_alert_rules(org_id);

-- Alert dispatch history
CREATE TABLE social_alerts_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  rule_id     UUID REFERENCES social_alert_rules(id) ON DELETE SET NULL,
  channel     TEXT NOT NULL,
  target      TEXT NOT NULL,
  subject     TEXT,
  body        TEXT,
  comment_ids UUID[],
  sent_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_alerts_sent_org ON social_alerts_sent(org_id, sent_at DESC);

-- DM engagement log
CREATE TABLE social_dm_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  connection_id      UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  platform           TEXT NOT NULL,
  recipient_id       TEXT NOT NULL,
  recipient_name     TEXT,
  trigger_comment_id UUID REFERENCES social_comments(id) ON DELETE SET NULL,
  intent             TEXT,
  template           TEXT,
  message_text       TEXT NOT NULL,
  sent_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_social_dm_log_org ON social_dm_log(org_id, sent_at DESC);
```

### `sql/027_social_enhancements.sql`

```sql
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS is_handled       BOOLEAN DEFAULT false;
ALTER TABLE social_comments ADD COLUMN IF NOT EXISTS sentiment_score  NUMERIC;
```

`is_handled` is the human-triage flag. `sentiment_score` is the raw AFINN comparative score (-1.0 to +1.0).

### Authorization model

**No RLS policies are defined on any of these tables.** Authorization is enforced at the application layer:

1. Every user-facing route reads the authenticated user's `org_id` from the `users` table.
2. The route uses the **service role client** to query the `social_*` tables.
3. Every `social_*` query filters with `.eq('org_id', auth.orgId)`.

Standard auth helper (used in nearly every route):

```typescript
async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}
```

Cron endpoints don't have a user context — they validate `Authorization: Bearer ${CRON_SECRET}` instead.

---

## 3. Environment Variables

| Variable | Required | Default | Used in |
|---|---|---|---|
| `META_APP_ID` | yes | — | OAuth, token refresh, webhook verification |
| `META_APP_SECRET` | yes | — | OAuth token exchange, token refresh |
| `META_REDIRECT_URI` | optional | `${NEXT_PUBLIC_SITE_URL}/api/social/callback` | OAuth callback target |
| `META_WEBHOOK_VERIFY_TOKEN` | yes | — | Webhook GET handshake |
| `NEXT_PUBLIC_SITE_URL` | required by callback; fallback in connect | `https://www.sentimetrx.ai` (only used by `connect/route.ts`) | OAuth start + callback. `callback/route.ts` returns 503 if unset; `connect/route.ts` falls back to the hardcoded host. |
| `CRON_SECRET` | yes (≥16 chars) | — | `lib/cronAuth.ts` is fail-closed — missing or short secret → 503 on every cron call. |
| `OPENAI_API_KEY` | yes | — | Used by `lib/moderation.ts` (`moderateTexts`) inside the cron sync. |

---

## 4. OAuth Flow — `/api/social/connect` & `/api/social/callback`

### `GET /api/social/connect`
**Auth:** logged-in user.
**Request:** none.
**Response:** `302` redirect to the Facebook OAuth URL. (No JSON — the browser follows the redirect directly.)

Builds the OAuth URL against `https://www.facebook.com/v19.0/dialog/oauth`:
- `client_id` = `META_APP_ID`
- `redirect_uri` = `META_REDIRECT_URI` or `${NEXT_PUBLIC_SITE_URL || 'https://www.sentimetrx.ai'}/api/social/callback`
- `state` = `signOauthState({ userId })` — **HMAC-signed** state from `lib/oauthState`. Plain base64 would let an attacker replay or forge `userId` on the callback and attach their own pages/tokens to a victim's org.
- `scope` = `pages_show_list,pages_read_engagement,pages_manage_posts`

### `GET /api/social/callback?code=…&state=…`
**Auth:** signed state param (no session required).
**Response:** redirect to `/social?connected=true` on success, or `/social?error={oauth_denied|invalid_state|no_org|no_pages|oauth_failed}` on failure. Returns `503 { error: "Site URL not configured" }` if `NEXT_PUBLIC_SITE_URL` is unset (the redirect host is pinned to that env var so a forged `Host`/`X-Forwarded-Host` can't redirect victims off-site).

1. **`verifyOauthState(state)`** — rejects forged or expired states; recover `userId`. Look up `org_id` from `users`.
2. **Exchange code → short-lived token:**
   `POST https://graph.facebook.com/v19.0/oauth/access_token` with `application/x-www-form-urlencoded` body `client_id, client_secret, redirect_uri, code`. (POST keeps `META_APP_SECRET` out of upstream proxy/CDN/NEL logs that would capture a query string.)
3. **Exchange short-lived → long-lived (60-day):**
   `POST https://graph.facebook.com/v19.0/oauth/access_token` with body `grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token`.
4. **List user's Pages:** `GET /me/accounts?access_token=…`
5. For each page:
   - **Try fetch IG account:** `GET /{pageId}?fields=instagram_business_account{id,username}&access_token=…`
   - **Replace this page's connection only** (narrow delete): `DELETE FROM social_connections WHERE org_id=… AND platform='facebook' AND account_id={page.id}`, then insert. Same per-account replace for the linked Instagram Business account.
   - **Insert one row** per Page, plus one row per linked Instagram Business account if present.
6. Redirect to `/social?connected=true`

### `GET /api/social/connections`
**Response:** `{ connections: SocialConnection[] }` — for the current org.

### `DELETE /api/social/connections/[id]`
**Auth:** logged-in user, must own the connection's org.
**Response:** `{ ok: true }`. **Hard-deletes** the `social_connections` row (cascade removes its `social_comments` via the `ON DELETE CASCADE` FK).

---

## 5. Webhook — `/api/social/webhook`

### `GET` — Meta verification handshake
**Query:** `hub.mode=subscribe`, `hub.verify_token=…`, `hub.challenge=…`
**Response:** plain text `hub.challenge` value if `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN`, else 403.

### `POST` — Comment event payload
**Auth:** **HMAC-SHA256 verification** of `x-hub-signature-256` against `META_APP_SECRET` (`verifyMetaSignature` in `webhook/route.ts`, constant-time compare via `timingSafeEqual`). Without this an attacker could POST forged comment events that get inserted into `social_comments` and trigger Graph API calls with the victim org's stored access tokens. Returns `503` if `META_APP_SECRET` is unset, `401` on signature mismatch, `400` on invalid JSON.

**Payload shape (illustrative):**
```json
{
  "object": "page",       // or "instagram"
  "entry": [{
    "id": "PAGE_ID",
    "time": 1620000000,
    "changes": [{
      "field": "feed",     // or "comments" for IG
      "value": { "comment_id": "...", "post_id": "...", "verb": "add" }
    }]
  }]
}
```

**Response:** `200 { received: true }` on the success path (Meta retries on non-200). Errors during per-comment processing are logged to console and skipped — they don't fail the whole batch.

**Per change** (only `entry.changes[].field === 'feed'` with `value.item === 'comment'` for FB; `field === 'comments'` for IG):
1. **Look up connection** by `account_id = entry.id`. Skip if no matching connection.
2. **Fetch full comment** via Graph API using the connection's stored token:
   - Facebook: `GET /{comment_id}?fields=id,message,from,created_time,is_hidden,parent&access_token=…`
   - Instagram: `GET /{comment_id}?fields=id,text,username,timestamp&access_token=…`
3. **Dedupe** — skip if `social_comments.comment_id` already exists.
4. **Lightweight tag only** — `auditContent()` + `scoreSentimentFull()` (see § 7). The webhook path **does not** run the full `tagComment()` pipeline (no topic/intent/emotion overlays, no OpenAI moderation, no auto-hide/auto-delete). Those run on the next cron sweep.
5. **Insert** into `social_comments`.
6. **No auto-actions** in webhook path. The cron handles auto-hide/auto-reply for consistency.

---

## 6. Cron Sync — `/api/cron/social-sync`

**Schedule (`vercel.json`):** `*/15 * * * *` (every 15 min).
**Max duration:** 60s (`maxDuration = 60`).
**Auth:** `Authorization: Bearer ${CRON_SECRET}` enforced by `lib/cronAuth.ts` — fail-closed (503 if `CRON_SECRET` is missing or <16 chars; 401 on mismatch; constant-time compare).

**Per active connection** (`token_expires_at > now`):

### Facebook
1. `GET /{pageId}/posts?fields=id,message,created_time&limit=25&since={lastIngestUnix}&access_token=…`
2. For each post: `GET /{post_id}/comments?fields=id,message,from,created_time,is_hidden,parent{id}&limit=100&access_token=…`

### Instagram
1. `GET /{igAccountId}/media?fields=id,caption,timestamp&limit=25&access_token=…`
2. For each media: `GET /{media_id}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&access_token=…`

### Common pipeline
3. **Dedupe** — fetch existing `comment_id`s and filter:
   ```typescript
   const { data: existing } = await service.from('social_comments').select('comment_id').in('comment_id', ids)
   const existingIds = new Set(existing?.map(e => e.comment_id))
   const newComments = rawComments.filter(c => !existingIds.has(c.comment_id))
   ```
4. **Batch OpenAI moderation** on the new texts (single API call to `https://api.openai.com/v1/moderations`).
5. **Tag** — `tagComment(text, postText, moderationScore, sensitivity)` per comment.
6. **Insert** all new rows.
7. **Auto-actions** (per `social_auto_config`):
   - **Auto-hide** — if `auto_hide_enabled` AND `tagComment(...).isHidden` (the tagging pipeline already decided based on `moderation_sensitivity` + content guard severity + AI moderation thresholds; there is **no separate `auto_hide_severity` check** in the cron) → `POST /{comment_id}` with `{ is_hidden: true }`. Skipped for `demo_*` IDs.
   - **Auto-delete** — `auto_delete_enabled` is **NOT honored by the cron** (the field exists in `social_auto_config` defaults but the cron has no delete branch). Severe content goes through auto-hide instead. Open work item: either implement or remove the field.
   - **Auto-reply** — if `auto_reply_enabled`, iterate non-reply comments:
     - Mode `queue` → skip (human review only).
     - Mode `positive_neutral` → skip negatives.
     - All non-queue modes call `routeResponse(tagged, author_name, post_text.slice(0,50))`:
       - `silent` / `review` → skip.
       - `template` → post the template response.
       - `ai` → only fires when mode is `all`; calls `callAI({ tier:'fast', maxTokens:200, timeoutMs:15000 })` with the same brand-guard system prompt as the user-triggered ai-reply route.
     - On post: `POST /{comment_id}/replies` with `{ message }`, then update `our_reply` + `replied_at` locally.
   - **No `social_moderation_log` writes from the cron** — only the user-action routes log there. Auto-actions are observable via `our_reply` (auto-reply) and `is_hidden` (auto-hide) on `social_comments`, plus `console.log` lines in the function output.

**Returns:** `{ ok: true, synced: number, connections: number }`.

### Token refresh — `/api/cron/social-token-refresh`

**Schedule:** `0 6 * * *` (daily 06:00 UTC).
**Max duration:** 30s.
**Auth:** same fail-closed `CRON_SECRET` via `lib/cronAuth.ts`.

1. Find connections where `token_expires_at < now() + 7 days` AND `token_expires_at > now()`.
2. For each: `POST /v19.0/oauth/access_token` with `application/x-www-form-urlencoded` body `grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token={current_token}`. (POST keeps `META_APP_SECRET` out of upstream proxy/CDN/NEL logs.)
3. Update `access_token`, `token_expires_at`, and `updated_at`.

**Returns:** `{ ok: true, refreshed, failed }`.

---

## 7. AI Tagging Pipeline — `lib/socialTagging.ts`

Pure regex/heuristics + OpenAI moderation overlay. **No LLM calls** — the AI calls happen later in `routeResponse()` only when an `'ai'` route is chosen.

### `tagComment(text, postText?, moderation?, sensitivity?) → TagResult`

**Returns:**
```typescript
{
  sentiment:      'positive' | 'negative' | 'neutral'
  sentimentScore: number   // AFINN comparative, -1 to +1
  flags:          { type, severity, action? }[]
  isHidden:       boolean
  isDeleted:      boolean
  topics:         string[]
  intents:        string[]
  emotion:        string
}
```

`sensitivity` is `'strict' | 'moderate' | 'lenient'`, default `'moderate'`. Pulled from `organizations.features.social_auto_config.moderation_sensitivity`.

### Topic regexes (`TOPIC_KEYWORDS`)

```typescript
const TOPIC_KEYWORDS: Record<string, RegExp> = {
  'safety':         /\b(safe(?:ty)?|crime|police|policing|security|dangerous|scary|homeless(?:ness)?|violence|gun\b|shoot(?:ing)?|murder)\b/i,
  'housing':        /\b(housing|rent(?:al|er|s)?|afford(?:able|ability)|home\s*owner|apartment|mortgage|evict(?:ion)?|landlord|shelter)\b/i,
  'economy':        /\b(econom|job(?:s|less)?|business(?:es)?|tax(?:es|ation)?|inflation|wage(?:s)?|employ(?:ment|er|ee)?|small\s+business|workforce)\b/i,
  'education':      /\b(school(?:s)?|education|teacher|student|university|college|tuition|curriculum)\b/i,
  'healthcare':     /\b(health\s*care|hospital|doctor|insurance|medical|mental\s+health|prescription|medicare|medicaid)\b/i,
  'transportation': /\b(traffic|transit|bus(?:es)?|road(?:s)?|highway|parking|commut(?:e|ing|er)|bike\s*lane|public\s+transit)\b/i,
  'environment':    /\b(environment(?:al)?|climate|pollution|clean\s+energy|solar|carbon|sustainability|recycl)\b/i,
  'immigration':    /\b(immigra(?:nt|tion)|border|undocumented|visa|citizenship|\bICE\b|deport(?:ation)?)\b/i,
  'development':    /\b(develop(?:ment|er)|construction|zoning|density|gentrification|infrastructure|downtown\s+(?:develop|project|build|revitaliz|plan))\b/i,
  'culture':        /\b(restaurant|dining|arts\b|cultural|entertainment|museum|venue|nightlife)\b/i,
}
```

### Severity → action matrix

`auditContent()` returns `maxSeverity ∈ {'mild', 'rude', 'severe'}` plus `flags[]` with types `profanity | slur | threat | sexual | insult`.

| `maxSeverity` | flag includes `threat` or `slur`? | `strict` | `moderate` | `lenient` |
|---|---|---|---|---|
| `severe` | yes | `delete` | `hide` | `review` |
| `severe` | no | `hide` | `hide` | `review` |
| `rude` | — | `review` | `review` | `review` |

OpenAI moderation overlay (applied if `moderation` provided):
- `threat ≥ 0.5` OR `identity ≥ 0.5` → same as severe-threat-slur logic.
- `toxicity ≥ 0.7` → severe logic.
- `toxicity 0.4–0.7` → `review`.
- `sexual ≥ 0.5` → `hide` or `review` per sensitivity.

### Spam detection

Action `auto_hide`, sets `isHidden = true`. Triggers:

- **URL + spam signal**: comment contains a URL AND any of: promo language, social-bait phrases, scam language, ALL CAPS.
- **Standalone spam**: promo language only, scam, or social-bait alone.
- **All caps**: `>60%` of letter chars are uppercase.
- **Excessive punctuation**: 4+ repetitions of `!`, `?`, `$`, `%`.

### Intent tags

```typescript
if (/donat|contribut|give money|chip in|fundrais/i.test(text))           intents.push('donate')
if (/volunteer|sign up|join|get involved|help out|canvass/i.test(text))  intents.push('volunteer')
if (/\b(event|rally|town hall|meet.*greet|attend)\b/i.test(text))        intents.push('event')
```

### Off-topic detection

Flagged when: no topic match, no campaign-related word (`vote|elect|campaign|mayor|council|city|county|district|candidate|support|endorse|run|office|politic|rally|debate`), AND no overlap with `postText` (≥2 stop-word-stripped words shared).

### Competitor mentions
Flagged on case-insensitive match of: `Qualtrics`, `SurveyMonkey`, `Typeform`, `Medallia`.

### `routeResponse(tagged, authorName?, postTopic?) → RouteResult`

Returns `{ route: 'silent' | 'review' | 'template' | 'ai', response: string | null, reason: string }`:

- `isDeleted` → `silent` (reason `'Auto-deleted'`)
- `isHidden` → `silent` (reason `'Auto-hidden'`)
- Has `review` flag → `review` (response `null`)
- `off_topic` flag → `template`, response = `inject(pick(TEMPLATES.off_topic), authorName, postTopic)`
- `sentiment === 'positive'` AND has intent → look up `TEMPLATES['positive_intent_' + intents[0]]`. Only `donate` and `volunteer` have pools; `event` falls through to `ai`.
- `sentiment === 'positive'` AND no topic match → `template`, response = `inject(pick(TEMPLATES.positive), authorName)`
- Otherwise → `ai` (response `null`; caller is expected to call the LLM)

`inject()` substitutes `[name]` and `[topic]` placeholders, gracefully removing them when no value is provided.

### Template pool

```typescript
const TEMPLATES = {
  off_topic: [
    'Thanks for commenting, [name]! This post is about [topic] — would love to hear your thoughts on that.',
    'Appreciate you chiming in, [name]! We\'re focused on [topic] here — what\'s your perspective?',
    'Hey [name], glad you\'re here! This thread is about [topic] — any thoughts?',
    'Thanks for stopping by, [name]! We\'d love to hear what you think about [topic].',
    'Hey [name]! This conversation is about [topic] — what are your thoughts on it?',
  ],
  positive: [
    'Thank you so much, [name]! That really means a lot.',
    'Appreciate the kind words, [name]! We\'re working hard to make a difference.',
    'Thanks, [name]! Your support keeps us going.',
    'Love hearing this, [name]! Thank you for being part of this.',
    'Means the world, [name]! Let us know if there\'s anything we can do for you.',
    'Thank you, [name]! We\'re in this together.',
  ],
  positive_intent_donate: [
    'That\'s amazing, [name]! Every contribution makes a real difference. You can donate here: [url]',
    'Thank you, [name]! If you\'d like to chip in, here\'s the link: [url]',
    'Appreciate that, [name]! Here\'s where you can contribute: [url]',
  ],
  positive_intent_volunteer: [
    'Love that energy, [name]! Sign up to volunteer here: [url]',
    'That\'s awesome, [name]! We\'d love to have you — sign up here: [url]',
    'Thanks, [name]! Here\'s where you can get involved: [url]',
  ],
}
```

---

## 8. AI Prompts (Verbatim)

### Single-comment AI reply — `app/api/social/comments/[id]/ai-reply/route.ts` (system prompt assembled at lines 41–49)

System prompt (`tier: 'fast'`, `maxTokens: 200`, `timeoutMs: 15000`) — built by joining these lines with `\n`. The `ORIGINAL POST` block is **only included when `comment.post_text` exists**:

```
You are a social media manager replying to a comment on {platform}.
Keep replies concise (1-3 sentences), friendly, and on-brand.
Never be defensive or argumentative. Be helpful and warm.
CRITICAL: NEVER mention "Datanautix", "sentimetrx", "Sentimetrx", "Sarina", "Ana", or any internal platform/tool names. You are replying on behalf of the page owner, not as a software company. Do not reference any AI tools, moderation systems, or analytics platforms.
[
ORIGINAL POST:
{comment.post_text}
]
```

User prompt: `'Reply to this comment: "' + comment.text + '"'`

### Cron auto-reply — `app/api/cron/social-sync/route.ts` (line ~259)

Inlined system prompt (no `ORIGINAL POST` block; the cron does not pass post context to the LLM):

```
You are a social media manager replying to a comment on {platform}. Keep replies concise (1-3 sentences), friendly, and on-brand. Never be defensive or argumentative.

CRITICAL: NEVER mention "Datanautix", "sentimetrx", "Sentimetrx", "Sarina", "Ana", or any internal platform/tool names. You are replying on behalf of the page owner, not as a software company. Do not reference any AI tools, moderation systems, or analytics platforms.
```

User prompt: `'Reply to this comment: "' + c.text + '"'`

### Demo generator — `app/api/social/demo/route.ts:36-54`

System prompt (`tier: 'standard'`, `maxTokens: 4000`, `timeoutMs: 30000`):

```
You generate realistic social media comments (Facebook/Instagram) for demo purposes. Generate exactly {total} comments that would appear on a political candidate's or organization's social media page.

Include a realistic mix:
- 40% supportive/positive comments from genuine supporters
- 20% neutral questions (policy questions, event info, how to help)
- 15% negative but civil criticism (policy disagreements, skepticism)
- 10% trolling/hate (racist remarks, personal attacks, profanity, threats — make these realistic but clearly offensive)
- 10% spam or off-topic (promotions, irrelevant links, random stuff)
- 5% intent signals (want to donate, volunteer, attend events)

Each comment should feel authentic — use casual social media language, typos, emoji, hashtags, varying lengths (some 3 words, some a full paragraph). Include realistic usernames.

Output as JSON array: [{"author": "Display Name", "text": "comment text", "platform": "facebook"|"instagram"}]
Output ONLY the JSON array, nothing else.
```

User prompt template:
```
Candidate/Org: {candidate}
Context: {context || 'Political campaign, running for office'}
{userPostText ? 'Original Post: "' + userPostText + '"' : ''}

Generate {total} realistic comments{userPostText ? ' responding to that specific post' : ''}.
```

---

## 9. Meta Graph API Calls (Reference Table)

All against `https://graph.facebook.com/v19.0/`.

| Operation | Method | Endpoint | Fields / Body | Caller |
|---|---|---|---|---|
| OAuth: code → token | POST | `/oauth/access_token` | form body: `client_id, client_secret, redirect_uri, code` | `callback/route.ts` (`exchangeCodeForToken`) |
| OAuth: short → long | POST | `/oauth/access_token` | form body: `grant_type=fb_exchange_token, client_id, client_secret, fb_exchange_token` | `callback/route.ts` (`getLongLivedToken`), `cron/social-token-refresh` |
| List Pages | GET | `/me/accounts?access_token` | implicit `id, name, access_token` | `callback/route.ts` (`getPageTokens`) |
| Get linked IG account | GET | `/{pageId}` | `fields=instagram_business_account{id,username}` | `callback/route.ts` (`getInstagramAccount`) |
| List FB posts | GET | `/{pageId}/posts` | `fields=id,message,created_time&limit=25&since={unix}` | `cron/social-sync:19` |
| List FB comments | GET | `/{post_id}/comments` | `fields=id,message,from,created_time,is_hidden,parent{id}&limit=100` | `cron/social-sync:32` |
| List IG media | GET | `/{igAccountId}/media` | `fields=id,caption,timestamp&limit=25` | `cron/social-sync:58` |
| List IG comments | GET | `/{media_id}/comments` | `fields=id,text,username,timestamp,replies{id,text,username,timestamp}` | `cron/social-sync:69` |
| Fetch single comment (FB) | GET | `/{comment_id}` | `fields=id,message,from,created_time,is_hidden,parent` | `webhook/route.ts:100` |
| Fetch single comment (IG) | GET | `/{comment_id}` | `fields=id,text,username,timestamp` | `webhook/route.ts:102` |
| Post reply | POST | `/{comment_id}/replies` | body `{ message, access_token }` | `comments/[id]/reply:39`, `ai-reply:66`, `cron/social-sync:273` |
| Hide / unhide | POST | `/{comment_id}` | body `{ is_hidden: bool, access_token }` | `comments/[id]/hide:41`, `cron/social-sync:221` |
| Delete | DELETE | `/{comment_id}?access_token` | — | `comments/[id]/delete:37` |
| Send DM | POST | `/me/messages` | body `{ recipient: {id}, message: {text}, access_token }` | `comments/[id]/dm:44` |

---

## 10. Comment Management API

All routes require an authenticated user, enforce `org_id`, use the service role client. Demo comments (IDs prefixed `demo_` or `test_comment_`) skip all Graph API calls and only update local state.

### `GET /api/social/comments`

**Query params:** `page` (default 1), `limit` (default 50, max 200), `platform`, `sentiment`, `flagged` (`'true'`), `flag_type`, `hidden` (`'true'`), `deleted` (`'true'`), `replied` (`'true'`), `handled` (`'true'`/`'false'`/missing), `post_id`, `from`, `to` (ISO), `search` (ILIKE on `text`).

**Response:**
```json
{ "comments": SocialComment[], "total": number, "page": number, "limit": number, "pages": number }
```

Order: `platform_created_at DESC`.

### `POST /api/social/comments/[id]/hide`

**Body:** ignored — the route always **toggles** `is_hidden`. (UI state is the source of truth; callers who want explicit set-state must call `/handle`-style routes for hide too. Open work item: accept an explicit `{ hide: boolean }` body.)
**Action:** Reads current `is_hidden`, computes `newHidden = !current`, calls `POST /{comment_id}` with `{ is_hidden: newHidden }` (skipped for `demo_*` / `test_comment_*` IDs). Update local `is_hidden`. Insert `social_moderation_log` with action `hide` or `unhide`.
**Response:** `{ ok: true, is_hidden: boolean }`.

### `POST /api/social/comments/[id]/reply`

**Body:** `{ message: string }`.
**Action:** `POST /{comment_id}/replies` with `{ message }`. Update `our_reply, replied_at`. Log `reply`.
**Response:** `{ ok: true }`. (No `reply_id` is returned — the platform reply ID isn't stored.)

### `POST /api/social/comments/[id]/ai-reply`

**Body:** `{ autoPost?: boolean }` (default `true` — `body.autoPost !== false`).
**Action:** Generate reply via `callAI({tier:'fast'})` with the system prompt in § 8. Always logs `ai_reply` to `social_moderation_log`. If `autoPost`, post via Graph and update `our_reply`/`replied_at`.
**Response:** `{ reply: string, posted: boolean }`. If the Graph post fails, returns `{ reply, posted: false, error: 'Failed to post to platform' }` so the UI can show the generated text and let the user post manually.

### `POST /api/social/comments/[id]/delete`

**Action:** `DELETE /{comment_id}` Graph call (skipped for demo IDs). Set `is_deleted=true` locally. Log `delete`.
**Response:** `{ ok: true }`.

### `POST /api/social/comments/[id]/handle`

**Body:** `{ handled?: boolean }` — if omitted, toggles current state.
**Action:** Update `is_handled`. **No moderation log entry.**
**Response:** `{ ok: true, is_handled: boolean }`.

### `POST /api/social/comments/[id]/dm`

**Body:** `{ message: string, intent?: string, template?: string }`.
**Action:** `POST /me/messages` Graph call with `{ recipient: {id: comment.author_id}, message: {text} }`. Insert row into `social_dm_log`. Log `dm` to `social_moderation_log`.
**Response:** `{ ok: true }`. Returns `{ error: 'No author ID available for DM' }` (400) if the comment has no `author_id`.

### `POST /api/social/comments/bulk`

**Body:** `{ action: 'hide' | 'delete', commentIds: string[] }`.
**Action:** Iterates per-comment Graph calls (sequential to stay within Meta rate budget). Logs each to `social_moderation_log`. Per-comment failures increment `failed` and continue.
**Response:** `{ ok: true, succeeded: number, failed: number }`. (No per-error message array; check function logs.)

---

## 11. Configuration & Auxiliary Endpoints

### `GET / PATCH /api/social/auto-config`

Stored on `organizations.features.social_auto_config`.

| Field | Type | Default |
|---|---|---|
| `auto_reply_enabled` | bool | `false` |
| `auto_reply_mode` | `'all' \| 'positive_neutral' \| 'queue'` | `'queue'` |
| `auto_hide_enabled` | bool | `false` |
| `auto_hide_severity` | `'severe' \| 'rude'` | `'severe'` |
| `auto_delete_enabled` | bool | `false` |
| `moderation_sensitivity` | `'strict' \| 'moderate' \| 'lenient'` | `'moderate'` |

`PATCH` accepts a partial; merges into the existing config.

### `GET / POST / PATCH / DELETE /api/social/alerts`

CRUD for alert rules.
- `GET` → `{ rules: SocialAlertRule[] }`, ordered `created_at DESC`.
- `POST` body: `{ rule_type: string, config?: object, channels?: string[], enabled?: bool }` (only `rule_type` required; defaults: `config={}`, `channels=[]`, `enabled=true`). Returns the inserted row directly with status `201`.
- `PATCH` body: `{ id, ...updates }` where updates are whitelisted to `rule_type | config | channels | enabled` (spread of arbitrary keys would let callers escape the org filter by forging `org_id`). Returns `{ ok: true }`.
- `DELETE` body: `{ id }`. Returns `{ ok: true }`.

Channels are dispatch targets (`'email'`, `'slack'`, etc.) — implementation handled by the alert dispatcher (TODO: separate spec).

### `GET / POST /api/social/dm-templates`

Stored as `social_alert_rules` rows with `rule_type='dm_template'`.
- `GET` → `{ templates: SocialAlertRule[] }`.
- `POST` body: `{ intent, message, name? }` (both `intent` and `message` required). Stored as `config = { intent, name: name || intent, message }`. Returns the inserted row with status `201`.

### `GET /api/social/stats?from=…&to=…`

Default range: last 24h. Returns counts computed in-memory:
```json
{
  "total":          number,
  "sentiment":      { "positive": n, "negative": n, "neutral": n },
  "flagged":        n,  "hidden": n,  "deleted": n,
  "replied":        n,  "handled": n,  "needsAttention": n,
  "byPlatform":     { "facebook": n, "instagram": n }
}
```

### `POST /api/social/demo` (admin only)

**Auth:** logged-in user, must belong to an `is_admin_org` organization.
**Body:** `{ candidate: string, context?: string, postText?: string, count?: number }` (`count` defaults to 25, capped at 50).
**Action:** Auto-clears any prior `demo_%` / `test_comment_%` rows for the org, generates comments via `callAI({tier:'standard', maxTokens:4000})`, replaces the **last ~25%** with hardcoded offensive injections (so content guard fires visibly in the demo), runs each through `tagComment()` (no OpenAI moderation overlay — `moderation` arg omitted), creates or reuses a demo `social_connections` row with `account_id='demo_'+orgId`, spreads timestamps over the last 24h, inserts comments, then writes `social_moderation_log` entries for any auto-hidden / auto-deleted / review-flagged rows.
**Response:** `{ generated, flagged, autoHidden, autoDeleted, flaggedForReview, sentiment: { positive, negative, neutral } }`.

### `DELETE /api/social/demo` (admin only)

Wipes comments where `comment_id LIKE 'demo_%'` OR `comment_id LIKE 'test_comment_%'`. Returns `{ deleted: number }`.

---

## 12. TextMine Export — `/api/social/export-dataset`

The bridge from social monitoring into the analytics layer.

### `GET`
Returns `{ exists: bool, dataset?: { id, name, row_count, last_synced_at, created_at } }`. UI uses this to show "Sync to TextMine" vs "Update existing".

### `POST`
**Body:** `{ name?, platform?, sentiment?, flagged?, connectionId? }`.

**First call (no existing social dataset for org):**
1. Insert into `datasets` with `source='social'`, store the filter set in `description` (JSON).
2. Insert into `dataset_state` with `schema_config = buildSocialSchema()` and empty theme model.

**Subsequent calls:**
1. Find existing social dataset.
2. Filter `social_comments` to new ones since `last_synced_at`.
3. Dedupe against existing dataset rows by `comment_id`.

**Common pipeline:**
4. Compute `startIndex = MAX(row_index) + 1` for the dataset (or 0 if first).
5. Map each comment to a flat row:
```typescript
{
  dataset_id, row_index,
  data: {
    comment_id, platform, author_name, text, sentiment, sentiment_score,
    emotion, topics, intents,
    is_hidden, is_deleted, is_reply,
    post_text, comment_date,
    flag_types,    // comma-list of non-topic/intent/emotion flags
    max_severity   // ranked: 'none' < 'mild' < 'rude' < 'severe'
  }
}
```
6. Insert into `dataset_rows_flat` in 500-row chunks. **Flat-only** — no batched-table dual-write (this was the only flat-only insert path before PR #1; now standard).
7. Update `datasets.row_count` and `last_synced_at`.

**Response:** `{ ok, datasetId, name, synced: int, total: int, created: bool }`.

After export, the dataset behaves exactly like a CSV upload — TextMine, Charts, Stats, Search, AI re-rank all work.

---

## 13. UI — `/app/social/SocialClient.tsx`

Single-page operator console. Two tabs: **Feed**, **Settings**.

### State shape

```typescript
const [comments, setComments] = useState<Comment[]>([])
const [stats, setStats] = useState<Stats | null>(null)
const [connections, setConnections] = useState<Connection[]>([])
const [loading, setLoading] = useState(true)
const [total, setTotal] = useState(0)
const [page, setPage] = useState(1)
const [pages, setPages] = useState(1)

// Filters
const [platform, setPlatform] = useState('')
const [sentiment, setSentiment] = useState('')
const [flaggedOnly, setFlaggedOnly] = useState(false)
const [handledFilter, setHandledFilter] = useState<'' | 'true' | 'false'>('false')
const [statusFilter, setStatusFilter] = useState('')
const [flagType, setFlagType] = useState('')
const [search, setSearch] = useState('')
const [searchInput, setSearchInput] = useState('')

// Bulk selection
const [selected, setSelected] = useState<Set<string>>(new Set())

// Per-comment reply
const [replyingTo, setReplyingTo] = useState<string | null>(null)
const [replyText, setReplyText] = useState('')
const [replyLoading, setReplyLoading] = useState(false)

// Tab + view + export state
const [tab, setTab] = useState<'feed' | 'settings'>('feed')
const [viewMode, setViewMode] = useState<'recent' | 'bypost'>('recent')
const [exporting, setExporting] = useState(false)
const [socialDataset, setSocialDataset] = useState<{ id, name, row_count, last_synced_at } | null>(null)
const [postFilter, setPostFilter] = useState<Record<string, string>>({})
```

### On-mount fetches
1. `GET /api/social/comments?...` — initial feed.
2. `GET /api/social/stats` — sticky stats bar.
3. `GET /api/social/connections` — connected accounts pill.
4. `GET /api/social/export-dataset` — sets `socialDataset` if one exists.

### Feed tab structure

- **Header bar:** filter selects (platform, sentiment, flag type, status), search input, "needs attention" toggle, view-mode toggle, `Export to TextMine` button.
- **Stats strip:** counts from `/stats` endpoint.
- **Comment list:** card per comment with text, author, timestamp, sentiment pill, flag chips, action buttons.
- **Bulk actions bar:** appears when `selected.size > 0`.
- **Pagination:** standard page/pages.

### Settings tab structure

- Connected accounts list with disconnect.
- Auto-config form (PATCH `/auto-config`).
- Alert rules list + editor.
- DM templates list + editor.

---

## 14. Error Handling Patterns

### Graph API failures
- 4xx/5xx responses are logged to `console.error` and the route returns the error to the caller. No retries.
- AI-reply route degrades gracefully: if Graph posting fails after generation, returns `{ reply, posted: false, error }` so the UI can show the generated text and let the user post manually.
- Cron sync continues to the next connection on per-connection failures; doesn't abort the run.

### Dedup
- Webhook + cron both check `social_comments.comment_id` before insert (the column is `UNIQUE`, so even a race-condition double-insert fails safely).

### Rate limiting
- No explicit retries or backoff. Bulk action endpoints iterate sequentially to stay within Meta's per-request budget.

### Demo guard
- Comment IDs prefixed `demo_` or `test_comment_` skip all Graph API calls. Enforced in: `comments/[id]/hide`, `comments/[id]/delete`, `cron/social-sync`. Cleanup via `DELETE /api/social/demo`.

---

## 15. Cross-References

- **Content Guard** (`lib/contentGuard`) — `auditContent()`, `scoreSentiment()`, `scoreSentimentFull()`. Used by webhook, cron, demo.
- **Usage Logging** (`lib/usageLog.ts`) — every AI call passes `usage: { resource_type: 'social', resource_id, event_type }`. Visible in `/admin/usage` filtered by Social.
- **Organizations features** — `social_auto_config` lives here; the `social` boolean gates module visibility in `TopNav`.
- **TextMine analytics layer** — `dataset_rows_flat`, `dataset_state`, `buildSocialSchema()`. After export, social datasets get the standard analyses.

---

## 16. Build Checklist (Rebuilding from Scratch)

1. Run `sql/026_social_moderation.sql` then `sql/027_social_enhancements.sql`.
2. Set env vars (§ 3).
3. Configure Meta App with webhook subscription on the Page (`feed`) and IG account (`comments`) fields, pointing at `/api/social/webhook`.
4. Set `vercel.json` cron entries for `/api/cron/social-sync` (15 min) and `/api/cron/social-token-refresh` (daily).
5. Implement `lib/socialTagging.ts` per § 7.
6. Implement OAuth (§ 4), webhook (§ 5), cron (§ 6).
7. Implement comment management routes (§ 10).
8. Implement config/alerts/stats/export-dataset routes (§ 11–12).
9. Wire `social` flag into `organizations.features` and the nav gate.
10. Build `/app/social/SocialClient.tsx` per § 13.

## 17. Maintenance notes

- **2026-07-03 (feature-gate sweep, `2f222eb`):** the social gates — `auto-config`
  route and the `social-sync` cron — resolve org features through `resolveOrg`
  with `is_admin_org`, so the admin org's feature auto-grant applies (previously
  these read stored `organizations.features` only; one of the 17 swept sites).
- **2026-07-04 (DD efficiency sweep, `bf90a85`):** the Facebook comment fetch in
  the `social-sync` cron runs with **bounded concurrency**
  (`GRAPH_FETCH_CONCURRENCY = 4`) instead of one serial Graph API round-trip per
  post — page syncs with many posts no longer scale linearly in wall-clock.
