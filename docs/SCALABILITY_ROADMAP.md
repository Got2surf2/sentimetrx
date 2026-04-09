# Sentimetrx — Scalability Roadmap
### Target: 500K+ row datasets, multiple concurrent datasets per org

**Authored:** 2026-04-04  
**Status:** Planning — no development started

---

## Context

The current architecture was designed for datasets in the 1K–50K row range. A systematic sampling layer was added to StatsModule and the rows endpoint to handle larger loads, and a critical React infinite-loop bug (unstable `useMemo` deps) was fixed. These are stopgaps. To reliably handle 500K-row datasets across multiple orgs, a structured set of infrastructure and architectural changes is required.

This document is the canonical reference for that work.

---

## Root Problems

The following issues were identified in a full codebase audit on 2026-04-04.

| # | Problem | Where | Impact |
|---|---------|-------|--------|
| 1 | Bootstrap CI + correlation matrix run on the main JS thread | `StatsModule.tsx`, `lib/statsUtils.ts` | Tab freeze / unresponsive UI for 30–60s |
| 2 | All-rows fetch buffers entire dataset in Lambda memory before responding | `rows/route.ts` | OOM at ~200–300K rows (Vercel 1.5 GB limit) |
| 3 | Analytics recompute runs synchronously inside a request handler | `compute/route.ts` | Silent failure at Vercel 30s timeout |
| 4 | Categorical field cardinality is unbounded in `analyticsCompute` | `lib/analyticsCompute.ts` | Analytics JSONB grows to GB range at 500K unique values |
| 5 | No server-side filtering — full dataset fetched then filtered in browser | All analyze modules | 500K iterations per filter change in browser |
| 6 | Response ingestion is single-row with 2 SELECT dedup checks per submit | `app/api/respond/route.ts` | Throughput ceiling ~20 req/s; ingesting 500K responses takes hours |
| 7 | No background job infrastructure | Entire codebase | No resilient async work of any kind |
| 8 | No caching beyond the computed analytics JSONB | Entire codebase | Full 500K-row refetch on every page load |
| 9 | Text mining holds all rows in React state for client-side regex matching | `TextMineModule.tsx`, `CommentsPanel.tsx` | Memory spike + UI freeze at 500K |
| 10 | No database partitioning or composite indexes on hot query paths | Postgres schema | Full table scans; query time grows linearly with total rows across all orgs |

---

## Architecture: Current vs Target

| Concern | Today | At 500K Scale |
|---------|-------|---------------|
| Heavy stats computation | Main thread — freezes UI | Web Workers |
| Row delivery to browser | Full dataset buffered in Lambda | Streaming (ndjson) + server-side filtering |
| Analytics recompute | Synchronous in request handler | Background job queue (Inngest / Supabase Edge + pg_cron) |
| Categorical cardinality | Unbounded dict | Capped at top-5K, `truncated` flag on field summary |
| Response ingestion | Single-row insert, synchronous dedup | Batch insert + async dedup via DB constraint |
| Caching | Analytics JSONB only | Redis (Upstash) + SWR + HTTP ETags |
| Keyword/theme matching | Client-side regex over all rows | Server-side `pg_trgm` indexed search |
| DB query performance | No partitioning; some indexes | Partitioned by dataset/time + composite indexes |
| Error visibility | None | Sentry + structured logs + job failure alerts |

---

## Phase 1 — Unblock the Browser
**Effort:** 1–2 weeks  
**Goal:** No computation should ever freeze or lock the tab.

### 1a. Web Workers for heavy statistical computation

Move the following out of the main thread into a dedicated `lib/statsWorker.ts`:
- `bootstrapCI` (2000 iterations × N rows — currently the worst offender)
- Correlation matrix (`pearsonR` / `spearmanR` for all field pairs)
- ANOVA group comparisons
- OLS regression

**Pattern:** Main thread posts a typed message `{ type, fieldData }` → worker computes → posts back results. `StatsModule.tsx` receives results via `onmessage` and updates state normally.

Add a per-panel loading skeleton so the UI stays interactive while the worker runs.

**Files affected:**
- `lib/statsWorker.ts` (new)
- `components/analyze/StatsModule.tsx` — replace direct calls with worker dispatch

### 1b. Chunked / incremental computation

For the correlation matrix specifically: compute one field pair at a time using `requestIdleCallback`, yielding back to the browser between pairs. This allows the user to navigate away mid-computation without freezing.

Reduce default bootstrap iterations from 2,000 → 500 for interactive use. Add a "High Precision" button that re-runs at 2,000 (in the worker).

**Files affected:**
- `lib/statsUtils.ts`
- `components/analyze/StatsModule.tsx`

---

## Phase 2 — Unblock the Server
**Effort:** 2–3 weeks  
**Goal:** The rows endpoint should never buffer a full dataset in memory.

### 2a. Streaming row response (ndjson)

Replace the current pattern in bulk mode:
```typescript
// Current — entire dataset materialised before sending
const allRows: Record<string, unknown>[] = []
while (hasMore) { allRows.push(...batchRows) }
return NextResponse.json({ rows: allRows })
```

With a `ReadableStream` that writes one JSON object per line (ndjson):
```
{"row":{"q1":"Great service","nps":9,...}}
{"row":{"q1":"Average","nps":6,...}}
...
{"meta":{"totalRows":500000,"sampled":true,"sampleSize":10000}}
```

The client reads with a `getReader()` loop, parsing complete lines and appending to a rows array incrementally. Progress can be shown during load.

**Why ndjson over JSON streaming:** Each line is a self-contained parseable object. Partial reads mid-line are safe — just buffer until `\n`.

**Files affected:**
- `app/api/datasets/[datasetId]/rows/route.ts`
- `components/analyze/StatsModule.tsx` — new streaming fetch helper
- `components/analyze/TextMineModule.tsx` — new streaming fetch helper

### 2b. Server-side filtering

Every row fetch currently returns all rows; filtering happens client-side. At 500K rows this means:
- 500K rows sent over the wire
- 500K iterations per filter in the browser

Instead, accept a serialised `filters` param on the rows endpoint. Apply filtering during the batch loop server-side before pushing to the stream. Only matching rows are sent.

**Serialisation format:** URL-encoded JSON, e.g. `?filters=[{"field":"nps","type":"range","min":9,"max":10}]`

Requires extracting the filter logic from `lib/filterUtils.ts` so it can run in both the server route and (for backward compat) client-side.

**Files affected:**
- `app/api/datasets/[datasetId]/rows/route.ts`
- `lib/filterUtils.ts` — ensure pure/portable (no browser APIs)
- `components/analyze/FilterContext.tsx` — serialise active filters to query param on fetch

### 2c. Column-projection discipline

Every fetch site should pass `?fields=` with only the columns needed:
- `StatsModule`: numeric + categorical fields only (skip open-ended text)
- `TextMineModule`: open-ended field(s) + metadata fields only (skip other categoricals)
- `CommentsPanel`: open-ended + metadata fields

This can reduce payload by 60–80% for datasets with many schema fields.

**Files affected:**
- `components/analyze/StatsModule.tsx`
- `components/analyze/TextMineModule.tsx`
- `components/analyze/textmine/CommentsPanel.tsx`

### 2d. Categorical cardinality cap in analytics compute

If a categorical field has >5,000 unique values, store only the top 5,000 by frequency and set a `truncated: true` flag on the field summary. This prevents the analytics JSONB growing without bound.

Add a corresponding UI indicator in the charts module ("Top 5,000 of N total values shown").

**Files affected:**
- `lib/analyticsCompute.ts`
- `lib/analyzeTypes.ts` — add `truncated?: boolean` to `CategoricalSummary`
- `components/analyze/ChartsModule.tsx` — render truncation notice

---

## Phase 3 — Async Analytics Pipeline
**Effort:** 2–3 weeks  
**Goal:** Recompute should never run synchronously in a request handler.

### 3a. Background job infrastructure

Evaluate and adopt one of:

| Option | Pros | Cons |
|--------|------|------|
| **Inngest** | Best DX for Next.js, built-in retries, fan-out, local dev server | External dependency, cost at scale |
| **Trigger.dev** | Similar DX, open-source option available | Newer, smaller ecosystem |
| **Supabase Edge Functions + pg_cron** | Zero new infra, already on Supabase | Less ergonomic, limited fan-out |
| **Vercel Cron + queue table** | No new infra, simple | Polling-based, 1-minute granularity minimum |

Recommendation: **Inngest** for development speed; evaluate Supabase Edge Functions if cost becomes a concern at scale.

Jobs to implement initially:
- `dataset.compute` — run `analyticsCompute` for a dataset
- `dataset.sync` — pull new study responses into a dataset
- `dataset.theme-mine` — run theme extraction on a batch of comments

Add an `analytics_jobs` table:
```sql
CREATE TABLE analytics_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id  uuid REFERENCES datasets(id) ON DELETE CASCADE,
  type        text NOT NULL,   -- 'compute' | 'sync' | 'theme-mine'
  status      text NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'done' | 'failed'
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz DEFAULT now()
);
```

**Files affected:**
- `app/api/datasets/[datasetId]/compute/route.ts` — becomes job enqueue, not synchronous compute
- `app/api/datasets/[datasetId]/sync/route.ts` — same
- New `lib/jobs/` directory with job definitions
- New SQL migration for `analytics_jobs`

### 3b. Incremental analytics updates

Currently, every sync triggers a full recompute from row 1. Instead:

1. Store intermediate accumulator state in `dataset_state` alongside the final summary
2. On new batch insert, compute only the delta (new rows since last compute)
3. Merge delta accumulators into stored accumulators
4. Re-finalize and update the summary

This reduces recompute time from O(total rows) to O(new rows).

**Files affected:**
- `lib/analyticsCompute.ts` — export `Accum` types and a `mergeAccum()` function
- `lib/analyzeTypes.ts` — add `accumulatorState` to `DatasetState`
- `app/api/datasets/[datasetId]/compute/route.ts`

### 3c. Realtime compute status

Add a Supabase Realtime subscription on `dataset_state.status` in the analyze module wrapper. When a recompute job is running, show a "Recomputing…" banner. When status flips to `ready`, refresh analytics automatically.

This replaces the current pattern where users have no visibility into whether analytics are stale.

**Files affected:**
- `components/analyze/AnalyzeModule.tsx` (or wrapper component)
- New `dataset_state.status` column in schema migration

---

## Phase 4 — Ingestion Scalability
**Effort:** 1 week  
**Goal:** Writing responses should never be the throughput bottleneck.

### 4a. Batch response ingestion

Add `POST /api/respond/batch` accepting `{ responses: ResponsePayload[] }`. Single bulk insert to `responses`. Keep the single-response endpoint for backward compat with existing survey bots.

**Files affected:**
- `app/api/respond/route.ts` (or new `app/api/respond/batch/route.ts`)

### 4b. Async device deduplication

Move IP hash / fingerprint dedup out of the hot path:

**Option A (preferred):** Add a `UNIQUE` constraint on `(study_id, ip_hash)` with an `ON CONFLICT DO NOTHING` strategy — the DB handles dedup atomically with no extra SELECT queries.

**Option B:** Write immediately as `status = 'pending_dedup'`, run a background job every minute to consolidate duplicates.

**Files affected:**
- `app/api/respond/route.ts`
- SQL migration for UNIQUE constraint

### 4c. Rate limiting

Add `@upstash/ratelimit` on `/api/respond` — e.g., 100 requests/minute per IP. Without this, a 500K-response dataset can be forged or the endpoint DDoS'd. Use sliding window to handle burst patterns from legitimate survey completions.

**Files affected:**
- `app/api/respond/route.ts`
- New Upstash environment variables

### 4d. Async sync trigger

After each response insert (or batch insert), enqueue a `dataset.sync` job rather than running sync inline. The response endpoint returns `201` immediately; the dataset updates asynchronously in the background.

**Files affected:**
- `app/api/respond/route.ts`
- Job queue from Phase 3a

---

## Phase 5 — Database Layer
**Effort:** 1 week  
**Goal:** Queries should scale with per-dataset row count, not total platform row count.

### 5a. Missing composite indexes

These should be added immediately — no schema restructuring required:

```sql
-- Device dedup (currently 2 full-table-scans per response submit)
CREATE INDEX idx_responses_dedup
  ON responses(study_id, ip_hash, status);

CREATE INDEX idx_responses_dedup_fp
  ON responses(study_id, fp_hash, status)
  WHERE fp_hash IS NOT NULL;

-- Incremental sync (fetch responses since last_synced_at)
CREATE INDEX idx_responses_sync
  ON responses(study_id, completed_at)
  WHERE status = 'complete';

-- Dataset listing sorted by activity
CREATE INDEX idx_datasets_org_updated
  ON datasets(org_id, updated_at DESC);
```

### 5b. Partition `responses` by time

At 500K rows per study × multiple studies per org, the `responses` table will grow to tens of millions of rows. Partition by `completed_at` quarterly to keep each partition small.

```sql
ALTER TABLE responses PARTITION BY RANGE (completed_at);
CREATE TABLE responses_2025_q1 PARTITION OF responses
  FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');
-- etc.
```

Queries filtered by date range (incremental sync, time-series charts) only scan the relevant partition(s).

### 5c. Partition `dataset_rows` by dataset

Each query on `dataset_rows` always filters by `dataset_id`. Partitioning by `dataset_id` (list partitioning or range on a hash) ensures each dataset's batches are physically co-located:

```sql
ALTER TABLE dataset_rows PARTITION BY HASH (dataset_id);
-- 16 partitions is a good starting point
CREATE TABLE dataset_rows_p0 PARTITION OF dataset_rows
  FOR VALUES WITH (MODULUS 16, REMAINDER 0);
-- ...
```

### 5d. Separate `response_transcripts`

`responses.payload` stores full conversation JSON which can be 50–200 KB per row. At 500K rows this is 25–100 GB on the hot table, slowing every query even those that don't need the transcript.

Extract payload to a separate `response_transcripts` table:
```sql
CREATE TABLE response_transcripts (
  response_id uuid PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL
);
```

`responses` becomes a lean index of structured fields (scores, timestamps, IDs) — queryable and fast. Transcripts are fetched only when needed (replay, export).

---

## Phase 6 — Caching Layer
**Effort:** 1 week  
**Goal:** Pre-computed data should be served from cache, not recomputed or refetched on every page load.

### 6a. HTTP caching on the analytics endpoint

`dataset_state.analytics` is already pre-computed and only changes on sync/recompute. Add proper HTTP cache headers:

```typescript
// In the analytics GET route:
headers: {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
  'ETag': hash(dataset_state.updated_at),
}
```

Client sends `If-None-Match: <etag>` on subsequent requests — if unchanged, server returns `304 Not Modified` with no body. Zero-cost page reload for up-to-date data.

### 6b. Redis row cache for sampled fetches

When a sample is fetched (`?sampleMax=10000&fields=q1,nps`), cache the result in Redis (Upstash) keyed by:
```
rows:{datasetId}:{sampleMax}:{sortedFieldHash}:{filterHash}
```

TTL: 10 minutes. Invalidate on `dataset.sync` job completion.

This eliminates the 5–10s re-fetch every time a user switches between StatsModule tabs.

**New dependency:** `@upstash/redis`

### 6c. SWR or React Query on all analyze fetches

Replace raw `fetch()` calls in analyze components with SWR or React Query. Immediate wins:
- Request deduplication (two components requesting the same URL = one fetch)
- Background revalidation on window focus
- Stale-while-revalidate pattern built in
- Straightforward cache invalidation via `mutate()`

**Files affected:** All `useEffect(...fetch...)` patterns in `components/analyze/`

---

## Phase 7 — Text Mining at Scale
**Effort:** 2 weeks  
**Goal:** Comment analysis should not require loading all rows into React state.

### 7a. Server-side theme matching

Move `commentMatchesTheme()` to a server route:

```
POST /api/datasets/[id]/comments
Body: { themes: Theme[], filters: FilterState, page: number, pageSize: number }
Response: { comments: CommentRow[], total: number, page: number }
```

The server queries `dataset_rows`, applies filters, and checks keyword matches in the database using `ilike` or `pg_trgm`. Only matching rows for the requested page are returned.

`CommentsPanel.tsx` becomes a fully paginated component — no in-memory row array needed.

**Files affected:**
- New `app/api/datasets/[datasetId]/comments/route.ts`
- `components/analyze/textmine/CommentsPanel.tsx` — paginated fetch instead of client filtering
- `components/analyze/TextMineModule.tsx` — no longer needs `fetchAllRows()`

### 7b. `pg_trgm` index for keyword search

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- If text is extracted to a column:
CREATE INDEX idx_dataset_rows_text_trgm
  ON dataset_rows USING gin(text_content gin_trgm_ops);
```

With this index, a keyword match across 500K rows takes ~50ms (index scan) vs ~5 seconds (client regex over full dataset in memory).

Requires extracting open-ended field text from the `rows` JSONB into a searchable column at ingest time — one-time migration + update to row insertion.

### 7c. Streaming comment response

The comments route streams matched results as ndjson (same pattern as Phase 2a). The `IntersectionObserver` scroll infrastructure already in `CommentsPanel` requests the next page when the sentinel is visible. This already works client-side — Phase 7a gives it a real server-side backing.

---

## Phase 8 — Observability & Resilience
**Effort:** Ongoing  
**Goal:** Know when things break before users do.

### 8a. Structured API logging

Every API route should emit a structured log entry on completion:
```json
{
  "route": "/api/datasets/[id]/rows",
  "datasetId": "...",
  "duration_ms": 4200,
  "rows_fetched": 10000,
  "sampled": true,
  "sample_rate": 0.02,
  "filters_applied": 2
}
```

Use Vercel's built-in log drains or pipe to Axiom / Datadog.

### 8b. Client-side error tracking

Add Sentry (or equivalent). Currently there is **zero client-side error tracking**. At 500K rows, edge-case failures will happen — without tracking, they are invisible.

Capture unhandled promise rejections, React error boundaries, and worker message failures.

### 8c. Job failure alerting

Failed `analytics_jobs` records should trigger an alert (email / Slack webhook). Dataset analytics left in a stale/failed state is worse than no analytics — users get incorrect data.

Add a simple pg_cron job that checks for jobs stuck in `running` state for >10 minutes and re-queues them.

### 8d. Health check endpoint

```
GET /api/health
Response: { db: "ok" | "error", queue: "ok" | "error", queueDepth: number }
```

Used by uptime monitoring (e.g., Better Uptime) to detect DB connectivity loss or queue backup before users see failures.

---

## Build Sequence

```
Phase 1  (Weeks 1–2)    Web Workers + chunked computation
                        → Unblocks users now; independent of all other phases

Phase 2  (Weeks 3–5)    Streaming rows + server-side filtering + cardinality cap
                        → Removes memory ceiling; prerequisite for Phase 7

Phase 3  (Weeks 5–7)    Background job queue + incremental compute + Realtime status
                        → Production-grade pipeline; prerequisite for Phase 4d and 6b

Phase 4  (Week 7)       Batch ingestion + async dedup + rate limiting
                        → Ingestion hardening; independent, can run in parallel with Phase 3

Phase 5  (Week 8)       DB indexes + partitioning + transcript separation
                        → Query performance; DB migrations require care around downtime

Phase 6  (Week 9)       Redis cache + SWR
                        → Latency improvement; requires Phase 3 for cache invalidation

Phase 7  (Weeks 10–11)  Server-side text mining + pg_trgm
                        → Comment scale; requires Phase 2 patterns established

Phase 8  (Ongoing)      Sentry + structured logs + job alerts + health check
                        → Operational confidence; can start in parallel with any phase
```

---

## Immediate Actions (Before Any Development)

These should be done first — low effort, high diagnostic value:

1. **Measure actual analytics JSONB size** for a representative large dataset — if >20 MB, Phase 2d (cardinality cap) is critical path
2. **Test `rows?all=true` with a synthetic 300K-row dataset** — verify no OOM; establish actual memory ceiling
3. **Profile StatsModule** on a 10K-row sample in Chrome DevTools — measure bootstrap CI and correlation matrix runtime; confirm Web Worker priority
4. **Audit `dataset_rows` and `dataset_state` table definitions** — they are absent from the SQL migration files in `sql/`; locate where they were created or add them to migrations
5. **Verify composite indexes exist** — run `\d responses` and `\d dataset_rows` in psql; add missing indexes from Phase 5a immediately (zero risk, immediate gain)

---

## Open Questions

- **Job queue selection:** Inngest vs Supabase Edge Functions — depends on whether the team wants to avoid a new vendor dependency
- **Streaming format:** ndjson vs JSON Streaming (`application/json` with `Transfer-Encoding: chunked`) — ndjson is safer with Vercel's response buffering behaviour
- **Partitioning strategy for `dataset_rows`:** Hash by `dataset_id` (even distribution, simple) vs range by `created_at` (time-based queries) — depends on dominant query pattern
- **Text extraction column:** Where to store the extracted open-ended text for `pg_trgm` indexing — options are a separate column on `dataset_rows`, a separate table, or a materialized view
- **Redis vs Supabase cache:** Upstash Redis is the simplest addition; alternatively, a `dataset_row_cache` table in Postgres with a `jsonb` column and TTL via pg_cron cleanup can avoid a new dependency entirely

---

*This document should be updated as phases are completed and decisions are made on the open questions.*
