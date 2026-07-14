# CAPACITY.md — Quantified Capacity Model

What the platform can hold and serve **today**, on the plans and compute
tiers actually paid for — measured 2026-07-04, not aspirational. Companion
to `docs/ARCHITECTURE.md` (design decisions), `docs/ENGINEERING.md`
(perf budgets), `docs/SCALABILITY_ROADMAP.md` (historical 500K-row work),
and `docs/PERFORMANCE_REVIEW.md` (2026-07-13 architectural bottleneck map:
multi-M rows, 1M+ datasets, concurrency, QR-burst — supersedes this doc's
§5 ordering where they differ).

**Method.** Provider limits were read live from the accounts (API
rate-limit response headers, Vercel/Supabase account APIs, `pg_settings`)
and cross-checked against official docs. Data-scale numbers are read-only
queries against production. Latency/throughput numbers come from the k6
suite (`tests/loadtest/`) run against the **TEST** Supabase project via
`npm run dev` on 2026-07-04 — local-dev numbers are a conservative floor
for correctness of limit behavior, not a prod latency promise (dev builds
are unoptimized; prod runs on Vercel Fluid with the same DB compute class).
Efficiency-audit citations refer to the 2026-07-04 multi-agent audit
(94 agents; 33 confirmed findings, 0 refuted).

---

## 1. Current production scale (measured 2026-07-04)

| Metric | Value |
|---|---|
| Database size | 877 MB (8 GB included on Supabase Pro, then $0.125/GB) |
| `dataset_rows_flat` | 212,862 rows / 58 datasets / 781 MB total relation (data + GIN + tsv) |
| Largest single dataset | **27,234 rows** (Ruth's Chris reviews) |
| Median dataset | 846 rows |
| Average `data` blob | 793 B raw; ~3.8 KB/row all-in (indexes, toast, tsv) |
| Conversation turns | 2,823 · Usage log entries: 7,603 |

**Honesty note:** the 50K full-data threshold (D6) has never been crossed
by a real dataset in production. The >50K sampling path and the 500K
design target are verified by the flat-table architecture, unit tests,
and the load suite — they are *design-proven*, not *production-proven*.
Largest production-proven org is ~188K rows across datasets.

## 2. Provider envelope (the plans we are actually on)

### Vercel — Pro, Fluid compute, iad1
- Functions: default **2 GB / 1 vCPU**, `maxDuration` default **300 s**
  (800 s max GA). Response payloads stream (App Router), so >4.5 MB JSON
  bodies (e.g. the rows API) work; the 4.5 MB hard cap applies to request
  bodies.
- Concurrency: **30,000 concurrent executions** (published Pro ceiling),
  ramping **+1,000 per 10 s per region**; excess → 503 FUNCTION_THROTTLED.
  The ramp, not the ceiling, is what a cold viral spike would hit.
- Crons: 13 configured (100 allowed); minimum 1-minute cadence — fine.
- Vercel is **not** the near-term bottleneck for any modeled load.

### Supabase — Pro org, prod on **Micro compute** (the sleeper constraint)
- 1 GB RAM, 2 shared ARM cores, `max_connections=60` direct,
  **Supavisor pooler ≈200 client connections** (rejects, no queue, when
  exhausted), recommended max DB 10 GB.
- **Disk IO: 11 MB/s / 500 IOPS baseline**, bursting to 261 MB/s / 11,800
  IOPS on a *daily budget* — a burst-heavy day (big import + backup +
  export overlap) can exhaust the budget and pin the DB at baseline.
  Monitor: Dashboard → Database Health → "Disk IO % consumed".
- Upgrade ladder (≈2 min downtime, hourly billed): Small 2 GB/$15 →
  Medium 4 GB/$60 → Large 8 GB dedicated/$110 (79 MB/s baseline) →
  XL 16 GB/$210. **First infra dollar at real customer load goes here.**

### Anthropic — **Scale tier** (measured live; formerly "Tier 4")
- **10,000 RPM · 10M input TPM · 2M output TPM** per model class —
  identical for Haiku 4.5, Sonnet 4.6 (the chat workhorse), Opus 4.x.
- Cache reads don't count toward input TPM (prompt caching directly
  raises effective throughput). $200K/mo spend cap; beyond = Custom tier.
- At ~2K input + ~300 output tokens per chat turn, the raw envelope is
  ~5,000 turns/min input-bound / ~6,600 output-bound — **three orders of
  magnitude above today's traffic.** Provider limits are not the chat
  bottleneck; per-IP rate limits and DB writes bind first.

### OpenAI — Tier 1 (support roles only)
- Embeddings (text-embedding-3-small): 3,000 RPM / 1M TPM — ample.
- whisper-1 ASR: **500 RPM, 25 MB/file** — the binding constraint on
  bulk audio ingestion; fine for the current recording volumes.
- Moderation: free, 500 RPM / 10K TPM. Tier 2 is a $50 cumulative spend
  away if ever needed.

### Resend & Deepgram
- Resend API: **10 req/s per team**; batch endpoint 100 emails/call
  (no attachments in batch). Plan quota (emails/month, or 100/day on
  Free) is the real campaign constraint — **owner: confirm the account's
  plan tier** and size campaign sends against it.
- Deepgram (PAYG): **150 concurrent live-stream sockets** (50 with
  diarization), 50 concurrent prerecorded. One live Town Hall uses ~1
  socket — no practical constraint.

## 3. Concurrency model per surface (measured under load)

k6 results, 2026-07-04, local dev + TEST project (conservative floor):

| Surface | Scenario | Result |
|---|---|---|
| Survey submit (public, `/api/respond`) | 25 concurrent respondents, 4 min sustained | p95 **748 ms**, 0 failures (537 reqs) |
| Agent chat turn (public, chatCore) | 3 concurrent conversations | avg **6.9 s**, p95 13.1 s per turn, 0 failures — AI-model-bound |
| PulseIQ session (join+chat+responses) | 5 concurrent participants, 51 full journeys | **0 failures (204 reqs)**; cohort chat avg ~5 s / p95 20 s on local dev — AI-model-bound, converging on the plain agent path plus cohort overhead |
| TextMine bulk rows (admin) | 3 concurrent × 27,234 rows | **18.5 MB** payload, avg 6.0 s, p95 8.9 s, 0 failures |

The suite earned its keep on day one: the first PulseIQ-session runs failed 25%
of requests, which unpicked to (a) a k6-script slug/UUID mismatch,
(b) a **real latent bug** — `/api/townhall/responses` validated
participants against the *async analytics mirror*, whose best-effort
writes were timing out under pooler load and are never retried, so fresh
participants 404'd on submitting demographics (fixed: validation moved to
the synchronous turn store, per D5) — and (c) a **runaway-topic defect
chain**: concurrent theme detections raced past dedup and minted 405
near-duplicate pending topics in one session, and per-turn cohort work
(tallies, balancing, semantic matching) scaled with that unbounded pool,
inflating chat p95 to 55 s. Fixed with three bounded controls: the
per-turn topic pool is capped at 25 (seeds always survive; pending slots
go to most-mentioned), the response-count detection trigger is throttled
to one per 2 min per hall, and detection skips (saving the AI spend) when
30 pending themes await review. Re-run: **0 failures**, chat p95 55 s →
20 s, participant throughput ×1.75. Under load the TEST project's Micro
pooler also visibly shed mirror writes and usage-log writes — live
confirmation of the §5 bottleneck ordering.

Interpretation per surface:

- **Public widgets (surveys):** stateless insert + upsert path.
  **Two-tier rate keying (perf review §7 Brief D, 2026-07-13):** the flat
  per-IP `respond:<ip>` at 120/min (which capped a whole venue NAT at
  ~2 submits/s — a QR-code-on-TV crowd shares one WiFi IP) was replaced by a
  per-**(IP, session_id)** bucket at 20/min + a per-IP backstop at 600/min, so
  each respondent gets their own budget and a busy room no longer throttles
  itself; `/api/clarify` got the same split (6/min per session + 120/min per
  IP, was a flat 10/min that silently killed follow-ups for a whole room).
  Platform-wide, ingestion is DB-write-bound; hundreds of concurrent
  respondents fit inside the pooler envelope since each submit holds a
  connection for <1 s.
- **AI chat (agents + PulseIQ):** each turn = 1 main Sonnet call + ~6
  auxiliary AI calls + ~10–15 pooled DB round trips, 5–13 s wall time.
  Rate limits (30/min/IP agents; 20/min/participant + 600/min/IP town
  halls) bind long before Anthropic Scale does. **Modeled ceiling: a
  ~200-participant PulseIQ session** (each participant sends ≈1 message/30 s →
  ~7 turns/s platform, ~400 concurrent pooled connections at peak
  hold-time) **is the point where the Micro pooler (~200 clients)
  saturates** — the documented mitigation is a compute bump (Small/Medium)
  before the event, which is an hour of notice, not an architecture change.
- **Admin analytics (TextMine):** single-digit concurrent admins by
  design. The 50K bulk-rows cap bounds worst-case payload at ~35 MB /
  ~12 s (extrapolated from measured 27K/18.5 MB/6 s); the route's
  `maxDuration=30` and streamed responses hold. Micro's 11 MB/s disk
  baseline is the layer that would make this feel slow if the IO budget
  is exhausted the same day by imports/backups.

## 4. Per-feature dataset ceilings

| Feature | Ceiling today | What sets it |
|---|---|---|
| TextMine interactive (full data) | 50K rows | D6 threshold; client memory + 35 MB payload |
| TextMine/Stats above 50K | 500K design target | deterministic sampling; flat-table architecture (tested at 500K synthetic) |
| Dataset upload/sync | ~500K rows/dataset practical | browser-driven chunk loop (D16) — no timeout exposure; time cost ~50 rows/POST |
| Taxonomy classification | 10K rows/POST chunk, browser loop | resumable cursor; keyword tier ~instant, LLM tier not yet built |
| PPTX/PDF export | ~50K rows/deck comfortably | in-request generation (D16), maxDuration 120–300 s; heaviest deck path is AI quote-picking (serial per theme — known ceiling, below) |
| Org backup (nightly) | ~240 s of dump work per hop × up to 20 hops (~80 min), for the fleet AND within one org | streamed NDJSON per table; time-budgeted self-continuation (`?after=<org-id>&hop=N`, 2026-07-04) + intra-org checkpoint resume with multi-part table objects (`&resume=<org-id>`, 2026-07-13) — a single huge org chains across hops instead of dying at 300 s |
| Org restore/clone | 200,978 rows proven (2026-07-04 drill, 0 errors self-verified) | fixpoint restore w/ FK retry (D12/BACKUPS.md) |
| Campaign send | quota-bound (Resend plan), 15-min cron cadence | sends are sequential by design vs 10 rps API limit |

## 5. What breaks first at 10× (~2M rows, dozens of concurrent users)

Ordered by which wall arrives first:

1. **Supabase Micro compute.** ~200 pooler clients, 1 GB RAM, 11 MB/s
   disk baseline. Symptoms: "Max client connections reached" during a
   big PulseIQ session; sluggish analytics on IO-budget-exhausted days; DB
   size passing the ~8 GB included tier (~2M rows ≈ 7.7 GB all-in).
   **Mitigation: compute ladder — $15–$110/mo, minutes of downtime, no
   code change.** This is a knob, not a cliff.
2. **Single-invocation nightly backup — FIXED 2026-07-04, single-org
   residual FIXED 2026-07-13.** The cron slices the org list on a 240 s
   time budget and self-continues via `?after=<last-org-id>&hop=N` (D16,
   ≤20 hops ≈ 80 min of dump time), and the deadline now flows into the
   per-org dump too: a single org that outruns the budget checkpoints to
   `partial.json` and resumes mid-table next hop (multi-part objects) —
   observed failing nightly at 785K rows before the fix. Failure mode
   stays loud per hop (500 + Sentry). Remaining ceiling is the hop cap
   itself: ~80 min of total dump time per night.
   See BACKUPS.md "Time-budgeted continuation".
3. **Read-amplifying live dashboards.** Facilitator console polls
   re-derive counts from raw turns (D17 consequence). Fine at ≤200
   participants; at 10× PulseIQ-session scale, cached per-topic counters are
   the fix (efficiency-audit item, deliberately deferred).
4. **Per-event AI cost, not AI throughput.** Anthropic Scale headroom is
   ~1000×; the practical AI constraint is $/event (~6 aux calls per
   turn). Prompt caching (shipped with this audit) and the model-tier
   split (D19) are the levers.
5. **Not on the list:** Vercel (30K concurrent, 1 TB transfer),
   Anthropic/OpenAI rate limits, Deepgram concurrency — all ≥10× away
   from mattering at modeled load.

## 6. Ceiling status (after the 2026-07-04 fix pass)

The audit's *fix-larger* items were initially documented as accepted
tradeoffs; a same-day fix pass (owner call: early pilots could scale
suddenly) retired most of them.

**Retired 2026-07-04:**

- **Bulk rows `all=true` full-dataset streaming** → `sample_dataset_rows`
  (sql/157): SQL-side deterministic sample (`ORDER BY md5(id||seed)`,
  seeded by dataset_id per D6) — only the sample crosses the wire;
  at/below the cap the full-fetch path is unchanged. Route-level and
  SQL-level samples proven identical (same id-list hash) and stable
  across calls.
  - **O(sample) rewrite (sql/160, 2026-07-10):** the first dataset to ever
    cross the 50K cap (a 56,117-row upload) hit a 30s Vercel timeout, and
    the fix had to hold as datasets keep GROWING (syncs/appends), so the
    per-load cost must not scale with total size. The real path (PostgREST
    + service role) has hard constraints, confirmed by measuring the REST
    call (not just psql/EXPLAIN): a set-returning result is capped at
    **1000 rows** (must page/return jsonb) and there's an **8s
    statement_timeout** per call. sql/157 (`ORDER BY md5 LIMIT`) re-sorted
    per page (→ timeout); an interim `row_index` keyset over a hash
    *predicate* still heap-fetched every *scanned* row (Index Scan, not
    Index-Only) → O(total), climbing with growth (real 514K = 46s, 1M
    ≈ 67s). **Final design:** an **expression index**
    `idx_drf_sample (dataset_id, hash(id‖dataset_id), id)` makes the sample
    the `cap` rows with the smallest hash, served as an **index range
    scan** — only the ~50K sampled rows are heap-fetched, so a load costs
    the same at 100K, 1M, or 10M rows. Paged by `(hash, id)` keyset, each
    page a single **jsonb** value (bypasses the 1000-row cap). Because it's
    an expression index it **self-maintains on every insert** — appended
    rows participate immediately and proportionally, no reindex/backfill.
    Deterministic (same rows → same sample; the sample evolves as rows are
    added, correct for a live dataset). **Measured on TEST via REST:** ~50K
    in 10 pages, ~16-22s, slowest page 2.8s — **flat** after appending 20K
    rows (the new rows took their proportional ~6.7K share). `maxDuration`
    60s. Index build is a plain `CREATE INDEX` in-tx (per sql/131; prod
    table ~264K rows/438MB, brief build lock acceptable).
- **Collection recompute buffering** → streams member rows in 1000-row
  pages into an incremental accumulator (`createAnalyticsAccumulator`);
  output verified byte-identical to the buffered computation.
- **Taxonomy RPC OFFSET paging** → keyset `p_after_id` on both RPCs
  (sql/155; NULL preserves legacy behavior for the deploy window).
  Rollup output byte-identical and ~30% faster; the pending drain no
  longer rescans classified blobs (48 ms end-of-scan probe vs a
  full-table detoast pass).
- **`.in('conversation_id', ids)` URL-length cliff** → gone. sql/156
  stamps `town_hall_id` on every mirrored turn (indexed, backfilled,
  cron self-heals nulls); all 9 call sites now filter by hall id. The
  ~200-participant figure in §3 is now purely the pooler ceiling, with
  the compute-bump mitigation unchanged.
- **Async mirror writes failing permanently** → two layers: transient
  errors retry at write time (3 attempts, backoff), and the 15-min cron
  reconciles every live session (cheap count probe, then targeted
  re-mirror of only the missing turn numbers). Gap-injection verified on
  TEST — the first sweep also healed 4 real turns lost during the
  earlier saturated load runs.
- **Nightly backup single-invocation ceiling** → time-budgeted
  continuation (240 s budget, id-cursor + hop-capped self-invocation,
  fail-loud per hop; see BACKUPS.md).
- **Deck AI quote-picking serial per theme** → bounded pool of 3.
- **Fresh Chromium per PDF request** → module-scoped browser reuse on
  warm instances (second render measured ~2× faster); the recordings and
  agent-study PDF routes keep their own per-call launch (separate
  low-volume copies, noted in lib/htmlToPdf.ts).

**Still open, deliberately:**

- **Sequential campaign sends** — the constraint is the Resend plan
  quota, not the loop; parallelizing buys nothing.
- **Facilitator/presenter polls re-derive engagement stats** from turns
  per poll — topic counts are stored now (sql/154) and all reads are
  hall-id-indexed (sql/156); the remaining per-poll transcript/keyword
  work is fine at ≤200 participants.
- **Collection-union bulk sampling** — the multi-dataset union path
  still samples in Node; needs a different RPC shape (single datasets
  are covered). (Single-org backup dump > 240 s left this list
  2026-07-13 — intra-org checkpoint resume, BACKUPS.md.)

## 7. Load-test suite

`tests/loadtest/` (k6; `brew install k6`):

| Script | Exercises | Cost note |
|---|---|---|
| `survey-submit.k6.js` | public ingestion + MV/refresh path + per-IP limit | free (no AI) |
| `chat-turn.k6.js` | full chatCore turn via `/api/bots/{id}/chat` | **real Anthropic spend** — keep VUS modest |
| `townhall.k6.js` | cohort join + chat + responses | real AI spend |
| `rows-fetch.k6.js` | 50K bulk rows reservoir + payload transfer | free; needs auth cookie (header comment) |

Rules: run against the **TEST project** (`npm run dev`), never prod;
all scripts send an `Origin` header (CSRF proxy) and document their
rate-limit interplay. Re-run the suite and update §3 after any change to
chatCore, `/api/respond`, the rows route, or a Supabase compute resize.

---

*Update this doc when: a provider plan/tier changes, a compute resize
happens, a dataset crosses 50K real rows, a PulseIQ session exceeds 100
participants, or the k6 numbers move by >2× in either direction.*
