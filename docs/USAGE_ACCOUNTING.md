# Sentimetrx — AI Usage Accounting & Cost Estimation Spec

**Module:** `lib/ai.ts`, `lib/usageLog.ts`, `/app/api/admin/usage/`, `/app/admin/usage/`, `/app/admin/estimator/`
**Storage:** `usage_logs` (migration `030_usage_logs.sql`; RLS hardened in `032_enable_rls_everywhere.sql`)
**External APIs:** Anthropic, OpenAI, Azure OpenAI (model APIs whose token counts get logged)
**Feature gate:** none — admin-only dashboard, available to admin-org members regardless of features

> **Spec scope:** complete enough to rebuild the module from scratch. Includes
> full DDL, the `callAI` ↔ `logUsage` integration, hardcoded cost-rate tables,
> the admin dashboard (page + API), the forward-looking cost estimator, every
> integration site table, and the cron jobs that produce usage. Source of
> truth is the code — this spec is current as of 2026-05-06 and should be
> refreshed after any substantive changes (especially when model rates move).

---

## 1. Overview

Every AI call in the codebase routes through one helper: `callAI(opts)` in `lib/ai.ts`. That helper picks a provider, sends the request, parses the response, and — critically — auto-writes a row to `usage_logs` whenever the caller passes a `usage:` context. Token counts (input, output, cache read, cache creation) are captured directly from the provider's response.

The `usage_logs` table is then read by:
- **`/admin/usage`** — historical dashboard for admins. Total spend, breakdown by module / event / model / day, top resources by cost.
- **`/admin/estimator`** — forward-looking calculator that takes scenario inputs ("X town halls × Y participants × Z turns") and returns a projected monthly AI bill.

Cost figures everywhere are computed in JavaScript from a single rate table in `lib/usageLog.ts:estimateCost()`. The estimator's rates are duplicated in `app/admin/estimator/page.tsx` and must move together when prices change.

---

## 2. Database Schema

### `sql/030_usage_logs.sql` — full DDL

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type         TEXT NOT NULL,
  resource_id           UUID,
  event_type            TEXT NOT NULL,
  model                 TEXT NOT NULL,
  provider              TEXT NOT NULL DEFAULT 'anthropic',
  tier                  TEXT NOT NULL DEFAULT 'fast',
  input_tokens          INT  NOT NULL DEFAULT 0,
  output_tokens         INT  NOT NULL DEFAULT 0,
  cache_read_tokens     INT  NOT NULL DEFAULT 0,
  cache_creation_tokens INT  NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_logs_org      ON usage_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_resource ON usage_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created  ON usage_logs(created_at DESC);

ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
```

**Column semantics:**

| Column | Values | Meaning |
|---|---|---|
| `org_id` | nullable UUID | Caller's org. NULL for system-level calls (e.g. cron-driven moderation that isn't tied to a specific org). |
| `resource_type` | `'bot' \| 'townhall' \| 'social' \| 'dataset' \| 'system'` | Which module made the call. Drives the dashboard's "By Module" breakdown. |
| `resource_id` | nullable UUID | The specific bot / session / dataset. NULL for `system`-type calls. |
| `event_type` | free TEXT | What the call did. Examples: `chat`, `summary`, `deflect`, `intent`, `mine_themes`, `expand_keywords`, `merge_themes`, `search`, `search_rerank`, `pptx`, `html_export`, `signals_pptx`, `insights`, `report`, `review`, `auto_reply`, `ai_reply`, `translate`, `clarify`, `study_suggest`, `persona`, `demographics`, `theme_detect`, `knowledge_classify`, `simulate`, `expand_terms`, `grade_description`, `suggest_guide`, `suggest_topic`, `suggest_sensitive`, `ana`, `demo`. |
| `model` | TEXT | Resolved model string (e.g. `claude-haiku-4-5-20251001`). Used for cost lookup. |
| `provider` | `'anthropic' \| 'openai' \| 'azure-openai'` | Which API was actually called. |
| `tier` | `'fast' \| 'standard' \| 'advanced'` | Echoes the caller's `tier` choice. |
| `input_tokens`, `output_tokens` | INT | Total token counts for the call. |
| `cache_read_tokens` | INT | Anthropic prompt-caching reads. Cheaper than fresh input — cost helper subtracts these from input before applying the input rate, then bills them at the cache_read rate. |
| `cache_creation_tokens` | INT | Cache-creation tokens. Currently **not** billed by `estimateCost()` — they're stored for visibility only. |

### Authorization model

**RLS is enabled** but **no policies are defined** after migration 032 (the original `usage_logs_service_write FOR ALL USING (true)` policy was a public leak and got dropped). Result: only the service-role client can read or write. The admin dashboard route uses the service-role client; auth-client `.from('usage_logs')` calls return zero rows.

This is intentional — usage data is admin-only, and per-org members shouldn't see it without an admin endpoint.

---

## 3. Environment Variables

| Variable | Required | Default | Used in |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | yes if provider=anthropic | — | `lib/ai.ts` |
| `OPENAI_API_KEY` | yes if provider=openai | — | `lib/ai.ts` (also used by `lib/embeddings.ts`, OpenAI moderation) |
| `AZURE_OPENAI_API_KEY` | yes if provider=azure-openai | — | `lib/ai.ts` |
| `AZURE_OPENAI_ENDPOINT` | yes if provider=azure-openai | — | `lib/ai.ts` |
| `AZURE_OPENAI_API_VERSION` | optional | `'2024-02-01'` | `lib/ai.ts` |
| `AI_PROVIDER` | optional | `'anthropic'` | `lib/ai.ts` provider selector |
| `CRON_SECRET` | recommended | none | gates `/api/cron/*` |

There are **no env vars that affect usage logging or cost calculation** — rates and the integration are hardcoded.

---

## 4. The AI Dispatcher — `lib/ai.ts`

`callAI(opts)` is the single entrypoint for every AI request. It (a) resolves the provider + model, (b) makes the HTTP call, (c) parses the response, (d) writes a `usage_logs` row if the caller passed a `usage` context.

### Public types

```typescript
export type AIProvider = 'anthropic' | 'openai' | 'azure-openai'
export type ModelTier  = 'fast' | 'standard' | 'advanced'

export interface AIProviderConfig {
  provider:        AIProvider
  apiKey?:         string
  azureEndpoint?:  string
  azureApiVersion?: string
}

export interface AIUsageContext {
  org_id?:        string
  resource_type:  'bot' | 'townhall' | 'social' | 'dataset' | 'system'
  resource_id?:   string
  event_type:     string
}

export interface AIRequestOptions {
  tier:            ModelTier
  system?:         string
  messages:        Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?:      number
  timeoutMs?:      number
  providerConfig?: AIProviderConfig    // explicit override
  apiKey?:         string              // shorthand: user-provided key (uses env AI_PROVIDER)
  usage?:          AIUsageContext      // if provided, auto-logs token usage
}

export interface AIUsage {
  input_tokens:          number
  output_tokens:         number
  cache_read_tokens:     number
  cache_creation_tokens: number
  model:                 string
  provider:              AIProvider
  tier:                  ModelTier
}

export interface AIResponse {
  text:        string
  stopReason:  'end_turn' | 'max_tokens' | string
  usage?:      AIUsage
}
```

### Tier → model resolution

```typescript
const MODEL_MAP: Record<AIProvider, Record<ModelTier, string>> = {
  anthropic: {
    fast:     'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-20250514',
    advanced: 'claude-sonnet-4-6',
  },
  openai: {
    fast:     'gpt-4o-mini',
    standard: 'gpt-4o',
    advanced: 'gpt-4o',
  },
  'azure-openai': {
    fast:     'gpt-4o-mini',
    standard: 'gpt-4o',
    advanced: 'gpt-4o',
  },
}

const DEFAULT_MAX_TOKENS: Record<ModelTier, number> = {
  fast:     350,
  standard: 4000,
  advanced: 3500,
}
```

### Provider resolution (in order)

1. `opts.providerConfig` if given (explicit override).
2. `opts.apiKey` + `process.env.AI_PROVIDER` (default `'anthropic'`) — used when a customer brings their own key (per-org or per-user).
3. Default: provider from `AI_PROVIDER` env, key from the matching `*_API_KEY` env.

### Response parsing

- **Anthropic:** `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens`.
- **OpenAI / Azure:** `usage.prompt_tokens` (split into cached via `prompt_tokens_details.cached_tokens`), `usage.completion_tokens`. No cache-creation field — left at 0.

### Auto-logging

After a successful response, if `opts.usage` is present, `callAI` calls:

```typescript
logUsage(opts.usage, response.usage)
```

This is fire-and-forget — never blocks the response, never throws.

### Default `timeoutMs`

15 000 ms. Override per call (search re-rank uses 20 s, deck generation 30 s).

---

## 5. The Usage Logger — `lib/usageLog.ts`

Two exports: `logUsage(context, usage)` and `estimateCost(model, input, output, cache_read)`.

### `logUsage(context, usage)`

```typescript
export async function logUsage(
  context: UsageContext,
  usage:   AIUsage | undefined
): Promise<void>
```

Behavior (lines 18-43):
- Returns early if `usage` is undefined.
- Returns early if both `input_tokens` and `output_tokens` are 0.
- Inserts a row into `usage_logs` via `createServiceRoleClient()`.
- Catches all exceptions — logs to `console.error('[usageLog] failed:', e)` and swallows. Never throws or blocks the caller.

### `estimateCost(model, input_tokens, output_tokens, cache_read_tokens)`

```typescript
export function estimateCost(
  model: string,
  input_tokens: number,
  output_tokens: number,
  cache_read_tokens: number
): number
```

Formula:
```
cost = ((input_tokens - cache_read_tokens) / 1_000_000) * rate.input
     + (cache_read_tokens / 1_000_000)                  * rate.cache_read
     + (output_tokens / 1_000_000)                      * rate.output
```

Returned as a USD number rounded to 6 decimals (`Math.round(n * 1e6) / 1e6`). Unknown models fall back to Haiku rates.

### Hardcoded rate table — `lib/usageLog.ts` (snapshot 2025-05)

```typescript
const RATES: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output:  4.00, cache_read: 0.08 },
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cache_read: 0.30 },
  'gpt-4o-mini':               { input: 0.15, output:  0.60, cache_read: 0.075 },
  'gpt-4o':                    { input: 2.50, output: 10.00, cache_read: 1.25 },
}
```

Rates are **per 1M tokens, USD**. `cache_creation_tokens` are not billed — providers haven't standardized creation-vs-read cache pricing across the board.

**Maintenance note:** the estimator (`/admin/estimator`) duplicates these rates in `RATES` of `app/admin/estimator/page.tsx`. They must be updated together.

---

## 6. Admin API — `GET /api/admin/usage?days=N`

**Auth:** caller's org must have `is_admin_org = true`. Else 403.

**Query params:** `days` (number, default 30). Window is `now() - days * 86400000`.

**Implementation:**
1. Resolves user's org → checks admin.
2. Fetches up to 10 000 rows from `usage_logs` since the cutoff via service role, ordered by `created_at DESC`.
3. Aggregates in JavaScript across five dimensions (no GROUP BY — done in memory because dataset is bounded by the row cap):
   - Totals: calls, input tokens, output tokens, summed cost.
   - **By type**: `resource_type → { calls, input, output, cache_read, cost }`.
   - **By event**: `event_type → { calls, input, output, cost }`.
   - **By model**: `model → { calls, input, output, cost }`.
   - **By day**: `created_at.slice(0, 10) → { date, calls, cost }`, sorted chronologically.
   - **Top resources**: keyed `${resource_type}:${resource_id}`, top 20 by cost. Names enriched via lookups: bots → `bots.name`, townhalls → `townhall_sessions.name`. Falls back to `resource_id.slice(0, 8)`.
4. Costs are computed via `estimateCost()` row-by-row, summed, then rounded to 4 decimals (`Math.round(n * 1e4) / 1e4`).

**Response shape:**

```jsonc
{
  "period":  { "days": 30, "since": "2026-04-06T00:00:00Z" },
  "totals":  { "calls": 12345, "input_tokens": 9876543, "output_tokens": 1234567, "cost": 47.32 },
  "by_type": {
    "bot":      { "calls": ..., "input": ..., "output": ..., "cache_read": ..., "cost": ... },
    "townhall": { ... }, "social": { ... }, "dataset": { ... }, "system": { ... }
  },
  "by_event":  { "chat": { ... }, "report": { ... }, /* ... */ },
  "by_model":  { "claude-haiku-4-5-20251001": { ... }, /* ... */ },
  "daily_trend":     [ { "date": "2026-04-30", "calls": 412, "cost": 1.84 }, /* ... */ ],
  "top_resources":   [ { "resource_type": "bot", "resource_id": "...", "name": "MyBot", "calls": 5832, "input": ..., "output": ..., "cost": ... }, /* ... */ ]
}
```

**No POST/PATCH/DELETE.** Logs are append-only. No purge endpoint either — retention is bounded only by `org_id ON DELETE CASCADE`.

---

## 7. Admin Dashboard — `/admin/usage`

Client component (`app/admin/usage/page.tsx`). Fetches `/api/admin/usage?days={days}` on mount and on `days` change.

### State shape

```typescript
const [days, setDays]                 = useState<7 | 30 | 90>(30)
const [loading, setLoading]           = useState(true)
const [totals, setTotals]             = useState<Totals>({ calls: 0, input_tokens: 0, output_tokens: 0, cost: 0 })
const [byType, setByType]             = useState<Record<string, TypeStat>>({})
const [byEvent, setByEvent]           = useState<Record<string, EventStat>>({})
const [byModel, setByModel]           = useState<Record<string, EventStat>>({})
const [daily, setDaily]               = useState<DailyPoint[]>([])
const [topResources, setTopResources] = useState<ResourceRow[]>([])
```

### Constants

```typescript
const TYPE_COLORS: Record<string, string> = {
  bot:      '#0891B2',
  townhall: '#7C3AED',
  social:   '#E85A1A',
  dataset:  '#059669',
  system:   '#6b7280',
}
const TYPE_LABELS: Record<string, string> = {
  bot:      'Agents',
  townhall: 'PulseIQ',
  social:   'Social',
  dataset:  'TextMine',
  system:   'System',
}
```

### Rendered sections

1. **Header** — page title + day-range selector (7 / 30 / 90).
2. **Summary cards** — total calls, input tokens, output tokens, total estimated cost.
3. **By Module** — grid of cards, one per `resource_type`, color-coded with `TYPE_COLORS`. Shows calls + input/output tokens + cost.
4. **Daily Cost Trend** — bar chart, normalized to the max cost in range.
5. **By Event Type** — table sorted by cost: event_type | calls | cost.
6. **By Model** — table sorted by cost: model | calls | cost.
7. **Top Resources by Cost** — table of top 20 resources: name (resolved bot/townhall name) | type | calls | input | output | cost.

### Linking

The cog-menu and `/admin` panel both link to `/admin/usage` (added 2026-05-06).

---

## 8. Cost Estimator — `/admin/estimator`

A forward-looking calculator. Takes scenario inputs and returns a projected monthly AI bill. Used pre-sale to size deals and pick markup; not connected to live usage data.

### Hardcoded rates (must move with `lib/usageLog.ts`)

```typescript
const RATES = {
  haiku:  { input: 0.80, output:  4.00, label: 'Haiku 4.5 (fast tier)' },
  sonnet: { input: 3.00, output: 15.00, label: 'Sonnet 4.6 (standard tier)' },
}
```

### Profile library

15 pre-defined call profiles — average tokens per call, by tier — covering every event type the platform actually produces.

| Profile | Input tok | Output tok | Tier | Used for |
|---|---|---|---|---|
| `th_chat` | 800 | 150 | haiku | PulseIQ chat response |
| `th_deflect` | 200 | 50 | haiku | PulseIQ deflection check |
| `th_compress` | 1200 | 300 | haiku | PulseIQ context compression |
| `th_translate` | 400 | 200 | haiku | PulseIQ multilingual translation |
| `th_theme` | 1800 | 400 | haiku | PulseIQ theme detection |
| `bot_chat` | 1200 | 300 | haiku | Bot chat response |
| `bot_deflect` | 250 | 60 | haiku | Bot deflection |
| `bot_intent` | 350 | 30 | haiku | Bot intent detection |
| `bot_persona` | 800 | 200 | haiku | Bot persona extraction |
| `bot_compress` | 1500 | 200 | haiku | Bot history compression |
| `survey_clarify` | 600 | 100 | haiku | Survey clarification |
| `survey_deflect` | 300 | 80 | haiku | Survey deflection |
| `social_reply` | 500 | 150 | haiku | Social auto-reply |
| `ana_chat` | 4000 | 800 | sonnet | Ask Ana query |
| `ana_sample` | 2500 | 200 | haiku | Ana sampling decision |

### Cost computation per profile instance

```typescript
function profileCost(profile, count) {
  const rate = RATES[profile.tier]
  return count * (
    (profile.input  / 1_000_000) * rate.input +
    (profile.output / 1_000_000) * rate.output
  )
}
```

### Scenario inputs (current UI)

| Module | Inputs | Formulas |
|---|---|---|
| **PulseIQ** | sessions, participants/session, turns/participant, deflection % (fixed 30%), compression % (10%), translation enabled (bool, 100% if yes), theme detection (one per ceil(participants/10) per session) | `chat = sessions × participants × turns`, `deflect = chat × 0.3`, etc. |
| **Agents** | conversations, turns/conversation, intent enabled, persona enabled, demographic enabled | `chat = convos × turns`, `intent = chat × 0.2`, `persona = convos`, `demographics = convos` if enabled |
| **Surveys** | responses, questions, clarify rate (50%), deflect rate (20%) | `clarify = responses × questions × 0.5`, `deflect = ... × 0.2` |
| **Social** | comments/month, auto_reply % | `auto_reply = comments × pct / 100` |
| **Ask Ana** | queries/month | `ana_chat = queries`, `ana_sample = queries × 0.3` |
| **Pricing** | duration (months), markup (%) | total = monthly_ai × months × (1 + markup/100) |

### Outputs

- Line-item breakdown (one row per profile instance with count + cost).
- Total AI calls.
- Monthly AI cost.
- Total over duration with markup.

### Known gaps (queued as task #18)

The current estimator misses a handful of cost drivers — see the project task list for the beef-up plan: multilingual %, theme-mining frequency, insights deck generation, search re-rank usage, bot conversation length distribution, webhook + cron-driven AI events, storage costs. Plus a margin/breakeven view.

---

## 9. Integration Sites (where `callAI` is called with `usage:`)

Every site below writes to `usage_logs`. Use this as the inventory of what the dashboard can attribute.

| File | resource_type | event_type | tier |
|---|---|---|---|
| `/api/bots/[id]/chat` | bot | `chat`, `summary`, `deflect`, `intent`, `persona` | fast |
| `/api/bots/[id]/knowledge` | bot | `knowledge_classify` | fast |
| `/api/bots/[id]/conversations/report` | bot | `report` | fast / standard |
| `/api/bots/[id]/conversations/insights-deck` | bot | `insights_deck` | standard |
| `/api/cron/bot-conversation-review` | bot | `review` | fast |
| `/api/townhall/chat` | townhall | varies | fast |
| `/api/townhall/join/[sessionId]` | townhall | `translate` | fast |
| `/api/townhall/expand-terms` | townhall | `expand_terms` | fast |
| `/api/townhall/grade-description` | townhall | `grade_description` | fast |
| `/api/townhall/suggest-guide` | townhall | `suggest_guide` | fast |
| `/api/townhall/suggest-topic` | townhall | `suggest_topic` | fast |
| `/api/townhall/suggest-sensitive` | townhall | `suggest_sensitive` | fast |
| `/api/townhall/simulate` | townhall | `simulate` | fast |
| `/api/datasets/[id]/mine-themes` | dataset | `mine_themes` | standard |
| `/api/datasets/[id]/expand-keywords` | dataset | `expand_keywords` | fast |
| `/api/datasets/[id]/merge-themes` | dataset | `merge_themes` | fast |
| `/api/datasets/[id]/search` | dataset | `search`, `search_rerank` | fast |
| `/api/datasets/[id]/export/html` | dataset | `html_export` | standard |
| `/api/datasets/[id]/export/pptx` | dataset | `pptx` | standard |
| `/api/datasets/[id]/export/signals-pptx` | dataset | `signals_pptx` | standard |
| `/api/datasets/insights` | dataset | `insights` | standard |
| `/api/clara-chat` | dataset | `ana` | fast |
| `/api/nora-chat` | dataset | `ana` | standard |
| `/api/social/comments/[id]/ai-reply` | social | `ai_reply` | fast |
| `/api/social/demo` | social | `demo` | standard |
| `/api/cron/social-sync` | social | `auto_reply` | fast |
| `/api/deflect` | system | `deflect` | fast |
| `/api/translate` | system | `translate` | fast |
| `/api/translate-responses` | system | `translate` | fast |
| `/api/clarify` | system | `clarify` | fast |
| `/api/ai/study-suggest` | system | `study_suggest` | fast |
| `/api/bot-chat` | system | `chat` | fast |
| `/api/ask-ana` | system | `ana` | varies |

If a route doesn't appear here, its calls aren't billed against any org — they show up in the `system` bucket only if the route passes `resource_type: 'system'`. **A best practice when adding a new AI call: always pass `usage:`.**

---

## 10. Cron Jobs That Produce Usage

From `vercel.json`:

| Path | Schedule | AI? |
|---|---|---|
| `/api/cron/campaign-scheduler` | `*/15 * * * *` | no |
| `/api/cron/cleanup-shared-links` | `0 3 * * *` | no |
| `/api/cron/review-sync` | `0 */6 * * *` | no |
| `/api/cron/townhall-theme-detection` | `*/15 * * * *` | no (SQL aggregation only) |
| `/api/cron/bot-conversation-review` | `0 */4 * * *` | **yes** — `review` events on `bot` |
| `/api/cron/social-sync` | `*/15 * * * *` | **yes** — `auto_reply` events on `social` (only when org has auto-reply enabled) |
| `/api/cron/social-token-refresh` | `0 6 * * *` | no |

The two AI-emitting crons need authoritative `org_id` set on every log row so usage is attributed correctly. `/api/cron/social-sync` already does (per-connection org). `/api/cron/bot-conversation-review` does (per-bot org).

---

## 11. Cross-References

- **`callAI` (`lib/ai.ts`)** is the single integration point. Calling the provider's HTTP API directly bypasses logging — don't.
- **`lib/embeddings.ts`** uses OpenAI directly today (not `callAI`) and **does not currently log embedding token usage**. This is a gap — embedding costs are ~$0.02 per 1M tokens, small but non-zero. Worth fixing if knowledge volume grows.
- **`lib/contentGuard.ts`** uses OpenAI moderation API; that's free and doesn't need logging.
- **`/admin/clients/[id]`** does NOT currently surface per-org usage — admins switch to `/admin/usage` for that. Adding "this org spent $X this month" to the org-detail page would be a useful enhancement (queued as part of task #18 if relevant).
- **No alerts.** There's no current mechanism to email/Slack when usage exceeds a threshold. If you need budget alerts, add a cron that aggregates `usage_logs` per org and dispatches when a configurable budget is exceeded.

---

## 12. Build Checklist (Rebuilding from Scratch)

1. Run migration `030_usage_logs.sql` to create the table + indexes.
2. Apply RLS hardening (`032_enable_rls_everywhere.sql` if rebuilding the whole database, or just `ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY` if you're isolating just this module).
3. Implement `lib/ai.ts` per § 4 — provider resolution, model map, response parsing, auto-logging via `logUsage`.
4. Implement `lib/usageLog.ts` per § 5 — `logUsage(context, usage)` and `estimateCost(model, in, out, cache_read)`. Maintain the rate table.
5. Pass `usage:` context from every AI call site (§ 9).
6. Build `/api/admin/usage/route.ts` per § 6 — admin gate + service-role read + JS aggregation.
7. Build `/admin/usage/page.tsx` per § 7 — fetch + render summary, by-module, daily trend, by-event, by-model, top resources.
8. Build `/admin/estimator/page.tsx` per § 8 — duplicate the rate table; wire profile library + scenario inputs + outputs.
9. Add nav links to both pages from the cog menu and `/admin` panel.
10. (Optional) Add per-org usage panel to `/admin/clients/[id]`.
11. (Optional) Add budget-alert cron.
