# Sentimetrx — AI Usage Accounting & Cost Estimation Spec

**Module:** `lib/ai.ts`, `lib/usageLog.ts`, `lib/usageRates.ts`, `/app/api/admin/usage/`, `/app/admin/usage/`, `/app/admin/estimator/`
**Storage:** `usage_logs` (migration `030_usage_logs.sql`; service-write policy dropped in `032_enable_rls_everywhere.sql`)
**External APIs:** Anthropic, OpenAI, Azure OpenAI (model APIs whose token counts get logged)
**Feature gate:** none — admin-only dashboard, available to admin-org members regardless of features

> **Spec scope:** complete enough to rebuild the module from scratch. Includes
> full DDL, the `callAI` ↔ `logUsage` integration, hardcoded cost-rate tables,
> the admin dashboard (page + API), the forward-looking cost estimator, every
> integration site table, and the cron jobs that produce usage. Source of
> truth is the code — this spec is current as of 2026-05-15 and should be
> refreshed after any substantive changes (especially when model rates move).

---

## 1. Overview

Every AI call in the codebase routes through one helper: `callAI(opts)` in `lib/ai.ts`. That helper picks a provider, sends the request, parses the response, and — critically — auto-writes a row to `usage_logs` whenever the caller passes a `usage:` context. Token counts (input, output, cache read, cache creation) are captured directly from the provider's response.

The `usage_logs` table is then read by:
- **`/admin/usage`** — historical dashboard for admins. Total spend, breakdown by module / event / model / day, top resources by cost.
- **`/admin/estimator`** — forward-looking calculator that takes scenario inputs ("X town halls × Y participants × Z turns") and returns a projected monthly AI bill.

Cost figures everywhere are computed in JavaScript from a single rate table in `lib/usageRates.ts` (`RATES`, `TIER_DEFAULT_MODEL`, `estimateCost`). Both `lib/usageLog.ts` (server-side logger) and `app/admin/estimator/EstimatorClient.tsx` (forward-looking calculator) import from that one file, so the rate table lives in exactly one place.

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
| `event_type` | free TEXT | What the call did. Examples: `chat`, `summary`, `deflect`, `intent`, `mine_themes`, `expand_keywords`, `merge_themes`, `search`, `search_rerank`, `pptx`, `html_export`, `signals_pptx`, `insights`, `insights_deck`, `report`, `review`, `auto_reply`, `ai_reply`, `translate`, `clarify`, `study_suggest`, `persona`, `demographics`, `theme_detect`, `knowledge_classify`, `simulate`, `expand_terms`, `grade_description`, `suggest_guide`, `suggest_topic`, `suggest_sensitive`, `ana`, `demo`, `ghost_suggest`, `entity_discovery`, `score_comments`. |
| `model` | TEXT | Resolved model string (e.g. `claude-haiku-4-5-20251001`). Used for cost lookup. |
| `provider` | `'anthropic' \| 'openai' \| 'azure-openai'` | Which API was actually called. |
| `tier` | `'fast' \| 'standard' \| 'advanced'` | Echoes the caller's `tier` choice. |
| `input_tokens`, `output_tokens` | INT | Total token counts for the call. |
| `cache_read_tokens` | INT | Anthropic prompt-caching reads. Cheaper than fresh input — cost helper subtracts these from input before applying the input rate, then bills them at the cache_read rate. |
| `cache_creation_tokens` | INT | Cache-creation tokens. Currently **not** billed by `estimateCost()` — they're stored for visibility only. |

### Authorization model

**RLS is enabled.** Migration 030 created two policies; migration 032 dropped the broken `usage_logs_service_write FOR ALL USING (true)` (a public leak) but kept `usage_logs_org_read FOR SELECT USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()))`. Result:

- The **service-role client** writes (and reads) freely — it bypasses RLS entirely. Both `logUsage` and the admin dashboard API use the service role.
- The **auth client** can `SELECT` rows for the caller's own org only (the surviving `usage_logs_org_read` policy). Cross-org reads return zero rows.
- The admin dashboard itself uses the service role (admin-gated via `requireAdmin()`), so it doesn't depend on the auth policy.

No `INSERT`/`UPDATE`/`DELETE` policy is defined for the auth client, so writes from the auth client fail closed. Usage data is effectively admin-visible only — the auth-client read policy exists but is not surfaced anywhere in the UI today.

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

// A system prompt may be a plain string or split into blocks. Marking a block
// `cache: true` enables Anthropic prompt caching (cache_control: ephemeral) so
// repeated prefixes don't count against the input-tokens-per-minute rate limit
// or the per-call cost. Non-Anthropic providers receive the blocks joined.
export type SystemBlock = { type: 'text'; text: string; cache?: boolean }

export interface AIRequestOptions {
  tier:            ModelTier
  system?:         string | SystemBlock[]
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

### Per-org AI gate (runs before provider resolution)

When `opts.usage?.org_id` is set, `callAI` consults `resolveOrgAiConfig(orgId)` from `lib/aiKey.ts` (cached 60s per org). Three modes:

- `off` — throws `AIDisabledError`. No outbound vendor call. Used to fully disable AI for an org (e.g. paused billing).
- `byo` — caller's customer brings their own key. `callAI` forces `providerConfig` to the configured provider + key, overriding any `opts.apiKey` the caller passed. This prevents export routes that hardcode `ANTHROPIC_API_KEY` from bypassing the BYOK redirect.
- `platform` (default) — falls through to standard env-key resolution.

The gate fires unconditionally when `org_id` is present, even if the caller passed an explicit `apiKey`.

### Provider resolution (in order)

1. `opts.providerConfig` if given (explicit override, or set by the BYOK gate above).
2. `opts.apiKey` + `process.env.AI_PROVIDER` (default `'anthropic'`) — used when a customer brings their own key.
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

15 000 ms. Overridden per call where needed — search initial pass 5 s, search re-rank 20 s, PPTX export 38 s, HTML export 45 s, entity-analysis-deck batch 30 s.

---

## 5. The Usage Logger — `lib/usageLog.ts` + `lib/usageRates.ts`

Constants and helpers are split between two files:

- **`lib/usageRates.ts`** — pure module (no server-only imports). Exports `RATES`, `TIER_DEFAULT_MODEL`, `estimateCost`. Safe to import from client components — the estimator page does.
- **`lib/usageLog.ts`** — server-only. Exports `logUsage` and re-exports `RATES` / `TIER_DEFAULT_MODEL` / `estimateCost` from `usageRates` for existing server callers.

### `logUsage(context, usage)`

```typescript
export function logUsage(context: UsageContext, usage: AIUsage | undefined): void
```

Behavior (lines 25–50):
- Returns early if `usage` is undefined.
- Returns early if both `input_tokens` and `output_tokens` are 0.
- Inserts a row into `usage_logs` via `createServiceRoleClient()`.
- Fire-and-forget: the `.insert(...).then(...)` chain is not awaited, so the caller is never blocked.
- All exceptions are swallowed. Failures log `[usage] log error: ...` (synchronous throw) or `[usage] log failed: ...` (insert resolved with `error`).

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

### Hardcoded rate table — `lib/usageRates.ts` (snapshot May 2025)

```typescript
export const RATES: Record<string, { input: number; output: number; cache_read: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output:  4.00, cache_read: 0.08 },
  'claude-sonnet-4-20250514':  { input: 3.00, output: 15.00, cache_read: 0.30 },
  'claude-sonnet-4-6':         { input: 3.00, output: 15.00, cache_read: 0.30 },
  'gpt-4o-mini':               { input: 0.15, output:  0.60, cache_read: 0.075 },
  'gpt-4o':                    { input: 2.50, output: 10.00, cache_read: 1.25 },
}

export const TIER_DEFAULT_MODEL: Record<'fast' | 'standard' | 'advanced', string> = {
  fast:     'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-20250514',
  advanced: 'claude-sonnet-4-6',
}
```

Rates are **per 1M tokens, USD**. `cache_creation_tokens` are not billed — providers haven't standardized creation-vs-read cache pricing across the board.

**One source of truth:** `/admin/usage` and `/admin/estimator` both import from `lib/usageRates.ts`, so updating the rate table in one file propagates to both surfaces.

---

## 6. Admin API — `GET /api/admin/usage?days=N`

**Auth:** wrapped with `requireAdmin()` from `lib/auth/requireAdmin`. Returns a 401/403 response if the caller isn't authenticated or their org doesn't have `is_admin_org = true`.

**Query params:** `days` (number, default 30). Window is `now() - days * 86400000`.

**Implementation:**
1. `requireAdmin()` gates the request; bail with its response if denied.
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

A forward-looking calculator. Takes scenario inputs and returns a projected monthly AI bill plus a margin / breakeven view. Used pre-sale to size deals and pick markup; not connected to live usage data.

### Rates — imported, not duplicated

The client component (`app/admin/estimator/EstimatorClient.tsx`) imports `RATES` and `TIER_DEFAULT_MODEL` from `@/lib/usageRates`. A profile resolves to a model via `TIER_DEFAULT_MODEL[profile.tier]`, then to per-1M-token prices via `RATES[model]`. Update the rates in `lib/usageRates.ts` and both `/admin/usage` and `/admin/estimator` move in lockstep.

A separate constant covers storage: `STORAGE_RATE_PER_GB = 0.023` (Supabase/S3 standard).

### Profile library

23 pre-defined call profiles — average tokens per call, by tier — covering every event type the platform produces.

| Profile | Input tok | Output tok | Tier | Used for |
|---|---|---|---|---|
| `th_chat` | 800 | 150 | fast | PulseIQ chat response |
| `th_deflect` | 400 | 80 | fast | PulseIQ deflection check |
| `th_compress` | 600 | 100 | fast | PulseIQ context compression |
| `th_translate` | 300 | 200 | fast | PulseIQ translation |
| `th_theme` | 1500 | 300 | fast | PulseIQ theme detection |
| `bot_chat` | 1200 | 300 | fast | Agent chat response |
| `bot_deflect` | 400 | 80 | fast | Agent deflection |
| `bot_intent` | 300 | 30 | fast | Agent intent detection |
| `bot_persona` | 500 | 200 | fast | Agent persona extraction |
| `bot_demo` | 500 | 150 | fast | Agent demographics |
| `bot_compress` | 600 | 100 | fast | Agent context compression |
| `bot_translate` | 300 | 200 | fast | Agent translation |
| `survey_clarify` | 600 | 150 | fast | Survey clarification |
| `survey_deflect` | 400 | 80 | fast | Survey deflection |
| `survey_translate` | 300 | 200 | fast | Survey translation |
| `social_reply` | 500 | 150 | fast | Social AI reply |
| `social_theme` | 3000 | 800 | standard | Social theme mining |
| `ds_theme_mine` | 3000 | 800 | standard | Dataset theme mining |
| `search_rerank` | 2500 | 400 | standard | Search re-rank |
| `ana_chat` | 4000 | 800 | advanced | Ask Ana query |
| `ana_sample` | 2000 | 400 | advanced | Ana sampling decision |
| `insights_deck` | 5000 | 2000 | advanced | Insights deck / report |
| `insights_export` | 3000 | 1500 | advanced | HTML/PPTX export |

### Cost computation per profile instance

```typescript
function costForCalls(profileKey, count) {
  const p = PROFILES[profileKey]
  if (!p || count <= 0) return 0
  const model = TIER_DEFAULT_MODEL[p.tier]
  const rates = RATES[model]
  if (!rates) return 0
  return count * (
    (p.input  / 1_000_000) * rates.input +
    (p.output / 1_000_000) * rates.output
  )
}
```

### Scenario inputs (current UI)

| Module | Inputs | Formulas |
|---|---|---|
| **PulseIQ** | sessions, participants/session, turns/participant, topics/session, multilingual %, theme re-runs per session | `chat = sessions × participants × turns`, `deflect = chat × 0.3`, `compress = chat × 0.1`, `translate = chat × pct/100`, `theme = sessions × ceil(participants/10) × max(1, reruns)` |
| **Agents** | conversations/mo, avg turns/convo, P95 turns/convo, multilingual %, intent toggle, demographic toggle | `chat = convos × turns`, `deflect = chat × 0.3`, `intent = chat × 0.2` (if enabled), `persona = convos`, `demo = convos` (if enabled), `compress = chat × clamp((P95-mean)/40, 0.05, 0.25)`, `translate = chat × pct/100` |
| **Surveys** | responses, questions/survey, multilingual % | `clarify = responses × questions × 0.5`, `deflect = ... × 0.2`, `translate = ... × pct/100` |
| **Social** | comments/mo, auto-reply %, theme mining runs/mo | `auto_reply = comments × pct/100`, `theme = runs` |
| **Datasets & Search** | search queries/mo, re-rank %, theme mining runs/mo | `rerank = queries × pct/100`, `theme = runs` |
| **Ask Ana** | queries/mo | `ana_chat = queries`, `ana_sample = queries × 0.3` |
| **Insights & Exports** | decks/mo, HTML/PPTX exports/mo | one call per item |
| **Storage** | storage GB | `storage_cost = GB × 0.023` per month |
| **Pricing** | duration (months), markup %, quoted price (optional) | `total = (ai + storage) × months`; `with_markup = total × (1 + markup/100)` |

Each top-level module has an enable/disable toggle; disabled modules contribute nothing.

### Outputs

- Line-item table — one row per profile instance with count + monthly cost, plus a storage line.
- Summary cards — total AI calls, total cost over duration, total with markup.
- Monthly cost / monthly with markup (when `duration > 1`).
- **Margin block** (when `quotedPrice > 0`) — gross margin $, gross margin %, cost / quote ratio. Color-coded green ≥ 50 %, amber ≥ 20 %, red below.
- **Marginal cost cards** — incremental cost of one more bot conversation (chat × turns + persona + compression) and one more PulseIQ participant (chat + deflect at the configured turns).

### Forward roadmap

Embedding token logging (see § 11), per-org budget alerts, and breakeven-by-utilization curves are still queued — see the project task list. The known-gaps from earlier iterations (multilingual %, theme freq, insights deck, search re-rank, storage, margin view) are all now wired up.

---

## 9. Integration Sites (where `callAI` is called with `usage:`)

Every site below writes to `usage_logs`. Use this as the inventory of what the dashboard can attribute.

| File | resource_type | event_type | tier |
|---|---|---|---|
| `/api/bots/[id]/chat` (delegates to `lib/chatCore.handleChatTurn`) | bot | `chat`, `summary`, `deflect`, `intent`, `focus_classify` | fast |
| `/api/bots/[id]/knowledge` | bot | `knowledge_classify` | fast |
| `/api/bots/[id]/conversations/report` | bot | `report` | fast / standard |
| `/api/bots/[id]/conversations/insights-deck` | bot | `insights_deck` | standard |
| `/api/cron/bot-conversation-review` | bot | `review` | fast |
| `/api/townhall/chat` (legacy path — `townhall_sessions`) | townhall | `chat` (single ctx for the request) | fast |
| `/api/townhall/chat` (phase-3 delegation path, active when `TOWNHALL_VIA_AGENT_HANDLER=true` and `session_id` resolves to a `town_halls` row — delegates to `lib/chatCore.handleChatTurn`) | **bot** | `chat`, `summary`, `deflect`, `intent`, `focus_classify` | fast | <!-- Note attribution shift: phase-3 town hall conversations log usage under resource_type='bot' + resource_id=agent.id (chatCore is bot-centric). When NOWOCATS launches and the flag flips on, attribute town-hall AI cost via the underlying agent rather than the town hall slug. See docs/CONVERGENCE.md § 4 Phase 4 + § 10 (Phase 4 commit 2). -->
| `/api/townhall/join/[sessionId]` | townhall | `translate` | fast |
| `/api/townhall/expand-terms` | townhall | `expand_terms` | fast |
| `/api/townhall/grade-description` | townhall | `grade_description` | fast |
| `/api/townhall/suggest-guide` | townhall | `suggest_guide` | fast |
| `/api/townhall/suggest-topic` | townhall | `suggest_topic` | fast |
| `/api/townhall/suggest-sensitive` | townhall | `suggest_sensitive` | fast |
| `/api/townhall/simulate` | townhall | `simulate` | fast |
| `lib/townhallThemeDetection.ts` (invoked from `/api/townhall/chat` and `/api/cron/townhall-theme-detection`) | townhall | `theme_detect` | fast |
| `lib/cohortThemeAggregator.ts` (Phase 5 commit 1 — invoked from `/api/cron/townhall-theme-detection` for `town_halls` rows on the new substrate) | townhall | `theme_detect` | standard |
| `/api/datasets/[datasetId]/mine-themes` | dataset | `mine_themes` | standard |
| `/api/datasets/[datasetId]/expand-keywords` | dataset | `expand_keywords` | fast |
| `/api/datasets/[datasetId]/merge-themes` | dataset | `merge_themes` | fast |
| `/api/datasets/[datasetId]/search` | dataset | `search`, `search_rerank` | fast |
| `/api/datasets/[datasetId]/export/html` | dataset | `html_export` | standard |
| `/api/datasets/[datasetId]/export/pptx` | dataset | `pptx` | standard |
| `/api/datasets/[datasetId]/export/signals-pptx` | dataset | `signals_pptx` | standard |
| `lib/export/scoreComments.ts` (invoked from export routes) | dataset | `score_comments` | fast |
| `lib/entityDiscovery.ts` (invoked from entity rebuild API + `/api/cron/entity-discovery`) | dataset | `entity_discovery` | fast |
| `/api/datasets/insights` | dataset | `insights` | standard |
| `/api/clara-chat` | dataset | `ana` (no `org_id` set) | fast |
| `/api/nora-chat` | dataset | `ana` (no `org_id` set) | standard |
| `/api/social/comments/[id]/ai-reply` | social | `ai_reply` | fast |
| `/api/social/demo` | social | `demo` | standard |
| `/api/cron/social-sync` | social | `auto_reply` | fast |
| `/api/deflect` | system | `deflect` | fast |
| `/api/translate` | system | `translate` | fast |
| `/api/translate-responses` | system | `translate` | fast |
| `/api/clarify` | system | `clarify` | fast |
| `/api/ai/study-suggest` | system | `study_suggest` | fast |
| `/api/bot-chat` | system | `chat` | fast |
| `/api/suggest` | system | `ghost_suggest` | fast |

**Unlogged AI calls** — these helpers call `callAI()` without a `usage:` context, so they don't appear in the dashboard or get billed against any org:

- `/api/architecture-deck`, `/api/engineering-reality-deck` — no live `callAI`, narrative slides only.
- `/api/entity-analysis-deck` — does call `callAI` (entity canonicalisation batch, 30 s timeout) without `usage:`. Worth wiring up if entity-deck volume grows.

> **Best practice when adding a new AI call: always pass `usage:`.** Routes that omit it are invisible to the dashboard and to BYOK / off-mode gating.

---

## 10. Cron Jobs That Produce Usage

From `vercel.json`:

| Path | Schedule | AI? |
|---|---|---|
| `/api/cron/campaign-scheduler` | `*/15 * * * *` | no |
| `/api/cron/cleanup-shared-links` | `0 3 * * *` | no |
| `/api/cron/review-sync` | `0 */6 * * *` | no |
| `/api/cron/entity-discovery` | `0 5 * * 0` (Sun 05:00 UTC) | **yes** — `entity_discovery` events on `dataset` (via `lib/entityDiscovery.ts`) |
| `/api/cron/townhall-theme-detection` | `*/15 * * * *` | **yes** — `theme_detect` events on `townhall` via BOTH `lib/townhallThemeDetection.ts` (legacy `townhall_sessions` scan) AND `lib/cohortThemeAggregator.ts` (new `town_halls` scan, Phase 5 commit 1) |
| `/api/cron/bot-conversation-review` | `0 */4 * * *` | **yes** — `review` events on `bot` |
| `/api/cron/social-sync` | `*/15 * * * *` | **yes** — `auto_reply` events on `social` (only when org has auto-reply enabled) |
| `/api/cron/social-token-refresh` | `0 6 * * *` | no |
| `/api/cron/sentry-digest` | `0 13 * * *` | no |

AI-emitting crons need authoritative `org_id` set on every log row so usage is attributed correctly. `/api/cron/social-sync` does (per-connection org), `/api/cron/bot-conversation-review` does (per-bot org), and `/api/cron/entity-discovery` does (per-dataset org). `/api/cron/townhall-theme-detection` calls the lib helper without supplying `org_id` today — the resulting rows attribute to `townhall` resource but have a null `org_id`. Worth fixing if per-org usage attribution matters.

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
3. Implement `lib/ai.ts` per § 4 — provider resolution (including the per-org AI gate), model map, response parsing, auto-logging via `logUsage`.
4. Implement `lib/usageRates.ts` (pure constants) and `lib/usageLog.ts` (server-only logger) per § 5.
5. Pass `usage:` context from every AI call site (§ 9). Helpers under `lib/` that issue AI calls (`townhallThemeDetection`, `entityDiscovery`, `personaExtractor`, `export/scoreComments`) must accept caller-supplied org/resource context and log their own rows.
6. Build `/api/admin/usage/route.ts` per § 6 — wrap with `requireAdmin()`, then service-role read + JS aggregation.
7. Build `/admin/usage/page.tsx` per § 7 — server wrapper + `UsageClient` rendering summary, by-module, daily trend, by-event, by-model, top resources.
8. Build `/admin/estimator/page.tsx` per § 8 — server wrapper + `EstimatorClient` importing `RATES` / `TIER_DEFAULT_MODEL` from `lib/usageRates`. Wire profile library + scenario inputs + storage + margin.
9. Add nav links to both pages from `TopNav` (cog menu) and the `/admin` panel.
10. (Optional) Add per-org usage panel to `/admin/clients/[id]`.
11. (Optional) Add budget-alert cron.
12. (Optional) Wire `lib/embeddings.ts` and `lib/contentGuard.ts` (moderation API) through usage logging if those costs ever stop being negligible.
