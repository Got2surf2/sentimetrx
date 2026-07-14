# ARCHITECTURE.md — Design Decisions

The load-bearing architectural decisions behind Sentimetrx, with the
reasoning and the consequences we accepted. This is the "why is it built
this way" record — `SPEC.md` describes *what* the system does,
`docs/DATABASE.md` + `docs/db/schema.sql` describe the data layer,
`docs/SECURITY.md` and `docs/ENGINEERING.md` hold the operating policies.

Format per decision: **Decision → Why → Consequences.** Newest decisions
get appended; superseded ones are struck through, not deleted.

---

## D1. Single database, shared-schema multi-tenancy

**Decision:** All tenants share one Postgres database and one schema. Every
tenant-owned table carries `org_id`; isolation is enforced by Row Level
Security (org-scoped SELECT policies) plus a code invariant: service-role
queries must pair `id` with `org_id` (or use a `gate*Access` helper).

**Why:** One customer-facing product with many small-to-mid tenants;
per-tenant databases would multiply migration, backup, and cost overhead
without a compliance driver demanding physical isolation.

**Consequences:** Tenant isolation is a *discipline*, not a topology — the
`id`+`org_id` pairing rule has been the source of every CRITICAL security
finding to date, so it is enforced three ways: RLS policies (all 78 tables),
CI isolation suites (`test:rls`, `test:egress`, `test:auth-flows`) against a
dedicated test project, and code review. A future enterprise tenant needing
physical isolation would be a fork-lift, not a flag.

## D2. Heterogeneous rows as JSONB blobs (`dataset_rows_flat.data`)

**Decision:** Every analyzable record — a survey response, a Google review,
a Reddit comment, a town-hall exchange, a transcript segment — is stored as
one row in a single table, with the entire record in a `data` JSONB column.
The *shape* of the data is not in the table; it lives beside it as
`dataset_state.schema_config`, a per-dataset field map (types, stats,
display roles) that grows on every sync via `mergeSchemaStats`.

**Why:** The product's core promise is "upload anything with text in it and
analyze it." A typed-column design would need a migration per customer data
shape; an EAV design would shred records across rows. One JSONB blob per
record keeps ingestion universal, keeps each record whole, and lets two
wildly different surveys coexist in one table with zero schema work.

**Consequences:** Postgres can't type-check or index inside `data` (we
filter client-side or via schema-aware server aggregation instead); the
schema description is *derived and incremental* — it must never be rebuilt
from a small sample (enrich-once-on-tiny-sample bugs); and `dataset_rows_flat`
deliberately has no `org_id` — it scopes through `dataset_id`, which the
org-snapshot/backup code must respect (this exact detail caused the
zero-row-backup bug fixed 2026-07-02).

## D3. Config-as-JSONB everywhere

**Decision:** Rich per-entity configuration (agent persona + guardrails,
survey question lists, PulseIQ `cohort_config` with pacing knobs and rounds,
collection settings) lives in JSONB columns, not normalized tables.

**Why:** Product iteration speed. New knobs (a pacing threshold, a kiosk
flag, a rounds array) ship as code + a JSON key, with defaults in code —
no migration, no backfill, and old rows stay valid.

**Consequences:** The code is the schema: defaults and validation live in
TypeScript, and renaming a key means handling both spellings or migrating
data in place. Config keys are documented in the per-module specs, and
engine-read keys are lifted to the blob's top level so shared code has one
place to look.

## D4. One conversational substrate; a town hall is a *collection* of conversations

**Decision (docs/CONVERGENCE.md):** Agents and PulseIQ converge on one
engine (`lib/chatCore.handleChatTurn`) and one data model: an **agent** is
just persona + knowledge + guardrails; a **conversation** is one participant
talking to an agent; a **PulseIQ session** (`pulseiq_sessions`) is a named
collection of conversations over a dedicated agent, plus a cohort layer
(topic pool, coverage balancing, theme discovery, facilitation pacing,
live dashboard). Cohort behavior activates via `townHallContext`, not a
different engine.

**Why:** The two systems were parallel implementations of the same
mechanics (safety, sentiment, deflection, turn storage, language). The
first real customer journey (Sarina → June town hall) demanded one agent
that runs as both a 1:1 chat and a cohort session without config copy-paste.

**Consequences:** Every engine improvement lands for both products at once
(the tranche-1 port fixed two live *agent* bugs while porting PulseIQ
features). The legacy PulseIQ orchestrator and `townhall_*` tables are
frozen and scheduled for deletion. Turn storage is two-tier by design — see
D5.

## D5. Two-tier turn storage: synchronous store + async analytics mirror

**Decision:** The chat engine writes turns synchronously to
`bot_conversation_turns` (the store it re-reads for conversation memory),
and mirrors them asynchronously to `conversations`/`conversation_turns`
(the analytics store, carrying sentiment, `content_en`, topic tags,
content flags).

**Why:** The participant-facing hot path must never wait on analytics
enrichment (translation, sentiment scoring), and analytics readers want an
enriched, substrate-neutral shape.

**Consequences:** Engine reads MUST use the synchronous store (reading the
mirror caused the "history amnesia" bug); dashboards/cohort counts read the
mirror and can lag by seconds — acceptable for aggregate surfaces, and the
facilitator dashboard overlays live counts where it matters.

## D6. Full-data analysis below 50K rows; deterministic sampling above

**Decision:** TextMine loads all rows client-side for datasets under 50K
rows — filtering, search, and theme counting run on the full corpus in the
browser. Above the threshold, statistics use deterministic per-dataset
sampling (stable seed, reproducible numbers).

**Why:** Sub-second interactivity on real customer sizes (most datasets are
thousands of rows, not millions), and *credible numbers* — a filter count
computed on all rows can be reconciled against the source export, which is
a deck-credibility requirement (every number ties to one denominator).

**Consequences:** A hard performance budget on row payload size (the 500K
perf work: flat table as sole source, capped `all=true` reservoir at 50K);
any new analysis surface must state which side of the threshold it lives on.

## D7. Serverless-only infrastructure

**Decision:** No servers. Vercel (Next.js App Router, functions, crons) +
managed Supabase (Postgres, Auth, Storage) + external APIs (Anthropic,
Resend, Deepgram, DataForSEO). Pushes to `main` auto-deploy to production;
one repo, no staging environment.

**Why:** A one-owner product: zero infrastructure to patch, scale, or wake
up for. The deploy pipeline *is* git.

**Consequences:** Everything must fit function limits (maxDuration budgets,
`waitUntil` for fire-and-forget logging, chunked AI pipelines); binary
tooling needs explicit packaging (puppeteer + @sparticuz/chromium for PDFs,
LibreOffice unavailable at runtime); every push costs a real build (~$8–10)
so pushing is gated on explicit owner authorization, verification happens
locally, and docs-only pushes are skipped by the Ignored Build Step.

## D8. Public surfaces are unauthenticated widgets resolved by slug

**Decision:** Respondent/participant surfaces (`/s/[guid]` surveys,
`/b/[guid]` agents, `/pi/[guid]` PulseIQ, `/th/<token>` town-hall reports,
`/review/<token>` client review) require no login. Routes resolve the slug
or token with the service-role client and expose only that resource;
mutation endpoints are rate-limited per participant and per IP.

**Why:** The product's data comes from the public: QR codes at events,
kiosk tablets, embedded widgets. Any auth wall would collapse response
rates.

**Consequences:** These routes are the tenant-isolation front line — they
must return only slug-scoped data (never enumerable ids), hide draft/setup
states, and carry rate limiting + content-safety guards. The CSRF proxy
exempts them explicitly, which is itself an audited list.

## D9. AI usage accounting is first-class

**Decision:** Every model call logs to `usage_logs` (tokens, computed cost
from a RATES table, `org_id`, resource attribution). Logging is
`waitUntil`-async so it never blocks a reply.

**Why:** AI is the COGS of this business. Per-org, per-resource cost truth
is what makes pricing decisions (and customer-level margin) possible — a
stale RATES table once overstated recording costs ~3×.

**Consequences:** Every new AI call site must thread `org_id` + usage
context (helpers exist); admin usage dashboards are the check that nothing
went dark.

## D10. Two brands by design: Sentimetrx product, Datanautix deliverables

**Decision:** The SaaS UI is Sentimetrx; exported decks/reports (PPTX, PDF)
carry Datanautix branding (wordmark, footer, file metadata). Client agents
match client *colors* only — the "powered by Datanautix" chrome is never
white-labeled away.

**Why:** Datanautix is the consulting brand that delivers artifacts;
Sentimetrx is the product that produces them. Deliverables circulate beyond
the app, so they advertise the delivering firm.

**Consequences:** Deck/report code intentionally references Datanautix — do
not "fix" it to Sentimetrx; shared chrome lives in `lib/pptx/shared` and
`brandedPdfChrome` so the exception stays consistent.

## D11. Test strategy: mocked always-on + real-DB isolation suites

**Decision:** Two layers. `npm test` (unit + integration with mocked
Supabase) runs on every push. The isolation suites (`test:rls`,
`test:egress`, `test:auth-flows`) run against a dedicated **Sentimetrx-Test**
Supabase project carrying prod's exact schema (bootstrapped by schema dump,
re-synced after migrations). Convergence-scale changes add live
verification scripts that drive the real route handlers + real AI against
the test project.

**Why:** Mocks prove logic but cannot prove that RLS actually blocks a
cross-tenant read — only a real Postgres can. And mutating verification
must never run against prod (standing rule after near-misses).

**Consequences:** A second Supabase project to keep in schema parity (one
command); CI secrets point at test, never prod; the live-verify harness
(`scripts/_verify_*.ts`, untracked) is the regression net for engine work.

## D12. Migrations: numbered SQL + applied-ledger + compat-view renames

**Decision:** Schema changes are hand-written numbered files in `sql/`,
applied to prod via `npm run migrate` (which records filename + sha256 in
`schema_migrations` and refreshes the committed snapshot
`docs/db/schema.sql`). Table renames keep a `security_invoker` compat view
under the old name until all deployed readers are gone (precedent: sql/079
`bots`→`agents`, sql/148/150 `town_halls`→`pulseiq_sessions`).

**Why:** Auto-deploy-on-push (D7) means the deployed code and the schema
change at different moments — compat views make renames deploy-order-safe.
The ledger + snapshot answer "what is actually applied?" and "what does the
database look like right now?" from the repo alone.

**Consequences:** Migrations must be idempotent (IF NOT EXISTS / CREATE OR
REPLACE); the `sql/` history alone is NOT cleanly replayable onto a fresh
database (gaps + one-offs predate the ledger) — `docs/db/schema.sql` is the
authoritative recreate-from-nothing artifact; compat views must be dropped
deliberately when their consumers die, or they linger as false signals.

## D13. Prod/test environment split: data flows down, config flows up

**Decision:** Local development defaults to the Sentimetrx-Test project
(`npm run dev`; `npm run dev:prod` opts into prod with a red banner).
Movement between the two databases is asymmetric by design:
**data flows down** — `scripts/clone-org-to-test.ts` restores a prod org
into test from the nightly S3 snapshot (every routine clone doubles as a
DR restore drill) — and **config flows up** — `npm run promote`
(`scripts/promote.ts` + `lib/promotion.ts`) exports ONE configured entity
(agent, PulseIQ session, or survey) as a versioned JSON manifest and
imports it into prod, where it lands dormant (draft; a PulseIQ session's
dedicated facilitator agent lands paused). Runtime data (responses,
conversations, detected topics) never flows up; ids never survive the trip
(surveys get a fresh guid, slugs ride a collision ladder).

**Why:** With client data approaching, ambient write-capable dev sessions
against prod became untenable — but things are *built* in test and must
reach prod somehow. A reviewable manifest file is the promotion gate: open
the JSON, check prompts/questions/guide, then import (prod import requires
`--yes` and exits before any prod connection without it). The agent
manifest is the pre-existing `bot_export_version: 1` route format, so UI
downloads and CLI files interoperate.

**Consequences:** Promotion is config-only — datasets/analytics stay
clone-down territory. `promotions/` is gitignored (manifests can carry
client prompts). Anything configurable a manifest doesn't capture is a
promotion-framework bug, not a reason to hand-edit prod.

## D14. Per-row enrichments embed in the blob, not sidecar tables

**Decision:** Derived per-row artifacts that must live and die with the row —
starting with taxonomy verdicts (sql/151, 2026-07-04) — are embedded in
`dataset_rows_flat.data` under a **reserved underscore key** (`_tx`;
registry in `lib/taxonomyEmbed.ts` `RESERVED_ROW_KEYS`), with aggregates
stored beside the schema in `dataset_state` (`analytics.taxonomy`) so
dashboards never scan blobs. Sidecar row-tables keyed by `row_id` are the
rejected default.

**Why:** The taxonomy sidecars minted one row per (row, field) verdict —
128K rows before the first client; a 1M-comment dataset would mint 5–7M.
Worse, a sidecar has an independent lifecycle, and every lifecycle event
must remember it exists: they were MISSING from org backups until
2026-07-03, and the org-clone restore re-identified flat rows without
remapping sidecar `row_id`s — silently dangling every cloned verdict
(found 2026-07-04). Embedded enrichments ride backup/restore/clone/delete
with the row; the failure class is structural, not a checklist item.

**Consequences:** Reserved keys are app metadata, never dataset columns —
schema detection, the rows API projection, AI row-context, search
rendering, and the Postgres `tsv` trigger all skip them, and any new
enumerator of data keys must too (`isReservedRowKey`). Re-classification
overwrites in place (no verdict history — owner call 2026-07-03). Server
aggregation reads the blob per dataset (jsonb ops; the `data` GIN index
serves containment probes). And anything that rewrites a whole `data`
object must carry `_tx` through or knowingly drop it.

## D15. Layered aggregation instead of a cache tier

**Decision:** Derived numbers are served from four layers, chosen per
surface — and there is deliberately no external cache tier (no Redis, no
Upstash, no Vercel KV):

1. **Write-time cached aggregates** in `dataset_state` (`analytics`,
   `analytics.taxonomy`, signal stats): recomputed by the ingest/classify
   path that changed the data, read for free by dashboards.
2. **One materialized view**, `study_response_stats` (survey dashboard
   counts): refreshed `CONCURRENTLY` after response ingest, read by the
   studies dashboard. It is the only MV because it is the only surface that
   is both read-hot and cross-entity; everything else fits layer 1 or 3.
3. **On-demand SQL aggregation RPCs** (`count_field_values`,
   `crosstab_counts`, `search_dataset_rows`, …) for ad-hoc questions over
   row data — correct by construction, no staleness.
4. **Per-instance in-memory memos with short TTLs** (e.g. the presenter
   "Trending Now" 60s map) strictly as AI-cost dampers — they may miss on
   every new serverless instance and that must stay acceptable.

**Why:** Every cache is a staleness bug waiting for an invalidation
(the Coalition survey-count incident was exactly a stale layer-1 key).
Keeping derived data in Postgres beside the source rows means one backup
story, one consistency model, and zero extra infrastructure to operate
(D7). A cache tier would add a second data system for latency we don't
yet need.

**Consequences:** Layer-1 caches must be keyed on *everything* that
invalidates them (theme-model hash + row count, learned the hard way);
MV refresh cost grows with total platform responses, so refreshes must be
debounced and off the request path — never awaited by a respondent
(2026-07-04 efficiency audit finding); and any new hot read surface must
state which layer it uses.

## D16. No background job queue — three substitutes, each with a stated ceiling

**Decision:** There is no job queue (no Inngest, no QStash, no worker
dyno). Long-running work uses one of three shapes: (a) **resumable
browser-driven loops** — the client POSTs bounded chunks and loops on a
cursor (taxonomy classification, imports, the super-agent 300-page deep
crawl `agent_crawl_jobs`/sql/176 whose cursor survives a closed tab); (b)
**time-budgeted request
slicing** — the handler bails at `TIME_BUDGET_MS` and reports partial
progress for the caller to continue; (c) **cron sweeps with per-run caps**
— every 15-min tick processes a bounded batch and the next tick picks up
the overflow (theme detection, social sync, campaign sends, auto-classify
safety net, the Super-agent weekly KB re-crawl `/api/cron/agent-recrawl`
whose per-run caps + wall-clock deadline defer any overflow to the next
week and whose per-page content-hash `agent_kb_page_hashes`/sql/177 makes
re-embedding idempotent — an unchanged page is skipped).

**Why:** A queue is a second runtime to operate, monitor, and secure
(D7: serverless-only, one-owner ops). All three substitutes run inside
the same Next.js + cron surface already deployed, and every deferred-work
path degrades to "it happens next tick" rather than "it is lost."

**Consequences:** No built-in retries, dead-letter, or backpressure —
idempotency must come from the work itself (content-hash dedup, upserts);
browser-driven loops die with the tab (acceptable: the cursor resumes);
and throughput ceilings are set by cron cadence × per-run caps —
quantified in `docs/CAPACITY.md`. When a workload outgrows next-tick
semantics (multi-org campaign blasts), a queue is the named upgrade path.

## D17. Live surfaces poll; nothing uses WebSockets or Supabase Realtime

**Decision:** Every live surface is HTTP polling on a stated cadence —
PulseIQ participants poll join-status ~3s, facilitator console 4s,
presenter screen 10s. No Supabase Realtime subscriptions, no WebSockets
(the one exception is Deepgram's ASR socket for live capture, which is
vendor-terminated).

**Why:** Polling is stateless and serverless-native — every poll is an
ordinary function invocation with auth, rate limiting, and org scoping
applied uniformly; Realtime would add a second delivery path whose
tenant-isolation guarantees (D1) would need separate auditing against
RLS, plus connection-count limits to manage.

**Consequences:** Live dashboards pay read amplification (pollers ×
cadence × query cost) — the facilitator console re-deriving counts from
raw turns is the known hot spot (efficiency audit 2026-07-04); event
latency is bounded by the poll interval, acceptable for cohort chat.
At venue scale the fix is cheaper reads (cached counts), not a transport
change. Realtime remains available behind the same Supabase project if a
surface ever genuinely needs push.

## D18. Rate limiting lives in Postgres, and fails open

**Decision:** Rate limits are enforced by an atomic `check_rate_limit`
RPC over a `rate_limit_buckets` table — shared across all serverless
instances — with limits declared per route (public chat 30/min/IP,
survey submit 120/min/IP, town-hall 20/min/participant + 600/min/IP
backstop). If the DB call errors, the limiter **fails open** through a
deliberately permissive per-instance in-memory fallback.

**Why:** Correct rate limiting needs shared state; Postgres is the only
shared state we operate (D15: no Redis). Failing open is a product call:
a degraded database must not lock respondents out of surveys and chats —
the per-request cost guards (AI spend caps, content guard) still apply.

**Consequences:** Every rate-limited request adds one pooler round trip
(counted in the CAPACITY.md connection math); the limiter itself must
never become the bottleneck it guards against; and abuse pressure during
a DB incident is absorbed by the permissive fallback — an accepted risk,
revisit if a real abuse event hits during degradation.

## D19. Chat replies are non-streaming, and the turn is durable before the reply

**Decision:** `handleChatTurn` returns one buffered JSON reply — no token
streaming — and the turn is written to the synchronous store *before* the
HTTP response is sent. The model-tier split is part of the same posture:
the participant-facing reply runs on the advanced tier (Sonnet), while
per-turn auxiliary calls (summarization, deflection, sentiment, language)
run on cheaper tiers.

**Why:** The clients are embedded widgets, kiosks, and QR-code phones —
buffered JSON keeps them trivial (no SSE handling, no partial-render
states) and keeps every reply guardrail-checkable *in full* before a
respondent sees a word of it. Durable-before-respond means a crash after
reply can't lose a turn that the participant saw.

**Consequences:** Perceived latency equals full model time (~5–13s
measured p95 under load) — acceptable for reflective cohort conversation,
and the widget owns the typing indicator; guardrails never race the
render. If a future surface demands streaming, it must add a post-hoc
moderation path (retract-after-display), which is a product decision, not
a transport one.

---

*Add a D-entry when a decision (a) shapes more than one module, (b) would
surprise a competent newcomer, or (c) was expensive to learn. Update
`SPEC.md`'s pointer list if the numbering changes.*
