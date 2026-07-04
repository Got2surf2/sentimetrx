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

---

*Add a D-entry when a decision (a) shapes more than one module, (b) would
surprise a competent newcomer, or (c) was expensive to learn. Update
`SPEC.md`'s pointer list if the numbering changes.*
