# Testing strategy

This is a deliberately small, high-leverage test suite. Its job is to prove the
non-negotiable pieces work — the parts that PE / technical-diligence reviewers
care about — without the upkeep cost of comprehensive coverage.

## How to run

```bash
npm run typecheck         # tsc --noEmit (strict)
npm test                  # unit + integration via Vitest
npm run test:watch        # local TDD loop
npm run test:coverage     # v8 coverage report
npm run test:e2e          # Playwright (requires running app + admin creds)
npm run test:rls          # env-gated: cross-org RLS isolation (real Supabase)
npm run test:egress       # env-gated: cross-org data egress per table (real Supabase)
npm run test:auth-flows   # env-gated: real Supabase auth round-trips
npm run test:campaign-egress # env-gated: campaign-by-id route handlers
npm run test:dataset-egress  # env-gated: dataset sync + auto-setup + regulations download + org/logo route handlers
npm run loadtest:k6          # k6 — concurrent Town Hall API load (manual)
npm run loadtest:browsers    # Playwright — concurrent Town Hall browser load (manual)
npm run check:sql-tx         # fails when a new sql/NNN_*.sql lacks BEGIN/COMMIT
npm run check:spec-staged    # pre-commit hook target — blocks commits whose staged code maps to an unstaged spec doc
```

CI runs `typecheck`, `check:sql-tx`, and `test:coverage` on every push and PR. The test step runs with v8 coverage so each CI run publishes the coverage table and enforces a **ratcheting floor** (`coverage.thresholds` in `vitest.config.ts`): a regression below the floor fails CI. The floor is set just below the current baseline (~15% lines over `lib/**` + `app/api/**`, raised from ~13% as the `statsUtils`/`themeUtils`/`datasetUtils`/`contentGuard`/`entityFilter` pure-logic suites landed) and is bumped up as new tests land — per the governance Tests-score progression plan. The thresholds are deliberately a no-regression gate, not a coverage *target*; the target is critical-path coverage, not a headline %.

The repo also installs a local pre-commit hook (`.githooks/pre-commit`, wired up via `core.hooksPath` in the `postinstall` step) that runs `check:spec-staged` against the staging area. It blocks commits where a staged code file maps to a spec doc (per `scripts/specMap.ts`) that isn't also staged. Bypass with `SKIP_SPEC_CHECK=1 git commit ...` when the change is genuinely doc-irrelevant.

## Layout

```
tests/
├── setup.ts              # global setup (env stubs, next/headers shim)
├── unit/                 # pure functions + mocked-boundary tests
│   ├── auth/             # requireAdmin, logDeckDownload, botPageOrgGate (agent admin-page org gate)
│   ├── components/       # BrandTagInput (first component test — render + onChange + datalist fetch)
│   ├── recordings/       # coverage (per-topic counting + zero-flag, gap detection, histogram, agenda↔topic casing reconciliation §3.6); analyze (Opus+Sonnet+synthesis parse, flag-merge, sentiment, deterministic counts, overallSentiment, graceful-degrade; callAI mocked); meetingTool (resolveProfile NULL→qa coercion, clampPhases snap/clip, slicePhaseSegments, fallback); brandGlossary (mergeBrandEntities — brand-catalog seeding §3.5c); transcriptRoles (segment→question/answer monotonic split + span tightening de-overlap §3.6 + action-item transcript trace by content-word window); timeline (packLanes overlap staggering + buildTimelineModel geometry); configVersion (isAnalysisConfigDrifted — shaping-vs-metadata drift detection §5.4/§5.7)
│   ├── botEntityExtraction.test.ts
│   ├── botProbeGuards.test.ts
│   ├── brandMatch.test.ts
│   ├── classifyPendingRows.test.ts  # auto-classify-on-sync safety net — pending-row loop drain, maxRows cap/hasMore, real keyword assertions
│   ├── deflectionRouter.test.ts
│   ├── engagementSignals.test.ts
│   ├── entityAnalysis.test.ts    # PPTX entity slides — splitMentions, catalogToAggregate (catalog-first reuse), entitySlideSpecs slide shape
│   ├── entityMentionDetector.test.ts
│   ├── guardrails.test.ts
│   ├── nameExtractor.test.ts  # post-hoc AI name extractor — gating + JSON parsing + defense-in-depth regex
│   ├── personaExtractor.test.ts
│   ├── phase3DualWrite.test.ts
│   ├── probeFocusClassifier.test.ts # user-turn topic classifier — gating + comma/bracket parsing + dedup + catalog validation
│   ├── rateLimit.test.ts
│   ├── sentiment-slang.test.ts
│   ├── sentryScrub.test.ts    # Sentry beforeSend PII scrub + Office content-script noise drop
│   ├── signalStats.test.ts    # signal-stats cache freshness — recompute when row_count changes under a stable theme-model hash (stale-toolbar bug)
│   ├── taxonomyRollup.test.ts # restaurant taxonomy roll-up — aggregateTaxonomy axis/sub rates + sentiment + alerts; resolveDictionary core⊕overlay layering
│   ├── uiHints.test.ts        # ui_hints extractor (canvas demo intent layer) — parse/validate, context plumbing, revert_canvas signal, prompt-text invariants
│   └── usageLog.test.ts
├── integration/          # route handlers with mocked Supabase
│   ├── admin-usage-detail.test.ts     # GET /api/admin/usage/[type]/[id] — admin gate + aggregation roll-up + from/to range
│   ├── decks.test.ts                  # 4 admin-only deck routes × {anon, admin}
│   ├── respond.test.ts                # public survey-response endpoint
│   ├── high-traffic-routes.test.ts    # clara/nora/bot/townhall chat + study/[guid]
│   ├── rls-isolation.test.ts          # env-gated, real Supabase — RLS coverage
│   ├── cross-org-egress.test.ts       # env-gated, real Supabase — per-table egress
│   ├── auth-flows.test.ts             # env-gated, real Supabase — auth round-trips
│   ├── campaign-routes-egress.test.ts # env-gated — service-role campaign-by-id routes
│   ├── dataset-routes-egress.test.ts  # env-gated — service-role dataset/regulations/org routes
│   ├── recordings-routes.test.ts      # recordings API routes (incl. documents §4.1e) — auth/feature/org gates + validation (mocked)
│   ├── export-org-gate.test.ts        # cross-org 404 gate on the service-role export routes incl. recordings pptx (404/409/200+content-type; mocked)
│   ├── recording-transfer-gate.test.ts # PATCH recording transfer — platform-admin-only 403 gate + RPC/audit orchestration + rename isolation (mocked)
│   ├── recording-edit-pair-gate.test.ts # PATCH extraction hand-edit (§3.5d) — edited_* write, null-reverts-to-AI, cross-org 404, non-qa_pair 400 (mocked)
│   ├── tenant-routes-gate.test.ts     # campaign-send / social-handle / dataset route — 401 + cross-org 404 (mocked)
│   └── bot-routes-gate.test.ts        # agent API routes (bots/[id] + entities/questions/conversations/knowledge) — 401 no-auth/no-org, cross-org 404/403, admin bypass; both getCallerOrgContext + getAuthUser auth shapes (mocked)
├── e2e/
│   └── deck-download.spec.ts # Playwright, env-gated
└── loadtest/
    ├── townhall.k6.js        # k6 — concurrent Town Hall participant API load
    ├── townhall.spec.ts      # Playwright — concurrent Town Hall browser load
    └── playwright.config.ts  # config for the browser load test
```

We chose `tests/` at repo root rather than colocated `__tests__/` directories.
The repo is large; centralizing tests keeps the application tree clean and
makes the suite easy to reason about as a unit.

## What we test

| Area | Test | Why it matters |
| --- | --- | --- |
| Admin-only gate | `requireAdmin` returns 404 unauth, null for admin | Internal decks must not leak to anon |
| Audit logging | `logDeckDownload` is fire-and-forget | A logging failure must never block a download |
| AI input/output guardrails | `guardrails` profanity, refusal detection, output validity | Public survey + town-hall input/output are user-facing; bad output is brand risk |
| Rate limiting | `rateLimit` bucket exhaustion + reset | Public endpoints (respond) need real protection |
| Persona extraction | `personaExtractor` shape + missing fields + AI failure | We mock the LLM at `lib/ai`'s boundary; we want the parser robust to garbage |
| Usage logging | `usageLog` non-blocking | Usage logging must never crash a paid AI call |
| Brand-match scoring | `scoreBrandMatch` exact match, lookalike rejection, chain consensus | DataforSEO returns lookalikes ("Chuy's de Mexico") alongside the real brand; the scorer must rank the real chain `strong` and qualifier-prefixed lookalikes `weak` even when the chain's actual name differs from the user-typed brand |
| Sentiment slang + negation | `contentGuard.scoreSentimentFull` Gen-Z lexicon + negation valence-shifter | Modern slang ("mid", "lit", "ate", "sus") and "not"-style negations must score correctly; otherwise the sentiment column reads neutral on a large fraction of restaurant reviews |
| Probe info-only skip | `botProbeGuards.isInfoOnlyMessage` greeting/thanks/ack/sign-off detection | Bot CRITICAL OVERRIDE must not fire on "thanks!" or "ok cool" — otherwise the probe pivots feel jarring and the threshold logic burns its single shot on a no-content turn |
| Entity-from-KB extractor | `botEntityExtraction` batch boundary logic + slug-keyed aggregation + alias merging + majority-vote category resolution | The extractor is fire-and-forget against the AI boundary; the deterministic helpers (batching + aggregation) must produce stable output so re-extracts don't churn the catalog or lose hand-curated aliases |
| Entity-mention detection | `entityMentionDetector` word boundaries + case-insensitivity + plural/singular variants + multi-word longest-first precedence + alias matching + dedup-within-turn + cache invalidation | Every user turn runs this synchronously; a false-positive matches every common noun, a false-negative misses the entire feature. Hidden-row exclusion + variant expansion are the two correctness levers |
| Deflection routing | `deflectionRouter` question-signal regex, sensitive-topic match, decision rule (sensitive overrides feedback; question signal required when no sensitive hit) | Shared between bot + town hall chat routes; a regression in the decision rule fires AI deflection on every short answer (cost + UX hit) or never deflects at all (off-topic answers pollute aggregates) |
| Engagement signals | `engagementSignals` countWords edge cases, isCurtResponse threshold, SUBTLE_DISENGAGE anchor behavior, isSubtleDisengage wrapper | Used by the PulseIQ AI-tone-check fast path. Anchoring is critical — a bad regex matches "ok so what about housing" as disengagement and skips clarifying on real feedback |
| Phase 3 dual-write | `phase3DualWrite` flag gating (no-op when off), mirror call shape for turns / focus-flags / delete | The dual-write is observation-only with the flag off; the unit tests pin that contract so a future refactor doesn't accidentally make it always-on or break the table/filter shape |
| Sentry PII scrub | `sentryScrub` redacts `request.{data,body,cookies}` + auth/cookie headers + PII key names, reduces `user` to `{id}` only, scrubs email/phone in breadcrumb messages, drops the Office "Object Not Found" false-positive | The scrub is a `beforeSend` hook — bugs are silent (PII leaks to Sentry) and only caught at the next quarterly audit. Tests pin the contract so the redaction can't regress |
| Signal-stats cache freshness | `signalStats.computeSignalStats` serves cache only when theme-model hash AND row_count match; recomputes when rows are synced under a stable hash; self-heals legacy caches missing `row_count` | The TextMine toolbar caches off the theme-model hash, which is blind to synced rows — a stale strip read 67 records while the live Themes panel counted 80 (Coalition Donor collection). The row-count key is the only thing preventing the strip + exported decks from silently freezing after every sync |
| PPTX entity analysis | `entityAnalysis` splitMentions delimiters, `catalogToAggregate` (sort/drop-zero/category rollup/one-quote-per-category), `entitySlideSpecs` slide shape (top-grid + bar + long-tail>24 + quotes) | StoryTime entity slides reuse the stored entity catalog (zero extra AI). The aggregate adapter and slide-spec builder are pure and shared with `/api/entity-analysis-deck`; a regression silently malforms the entity deck or re-introduces per-export AI cost |
| Post-hoc name extractor | `nameExtractor` input gating (≥10 char corpus), JSON-from-AI parsing (markdown-fenced + raw), name validation regex, source/confidence enum normalisation, AI-throw graceful fallback | Closes the "Anonymous in 88% of admin views" gap; the lib is fire-and-forget so silent regressions don't surface — tests cover the deterministic guardrails |
| Probe-focus classifier | `probeFocusClassifier` skip-short-message gating, disabled-focus filtering, NONE handling, hallucinated-slug drop, dedup, mixed-case lowercase match, AI-throw fallback | Runs on every user turn ≥3 words when `probe_focus_enabled` is set; a bad slug filter pollutes the analytics with phantom topics, a missing dedup inflates the topic frequencies |
| Admin usage drill-in | `/api/admin/usage/[type]/[id]` admin-gate, `VALID_TYPES` allowlist, totals + by_event + by_model + daily_trend aggregation, from/to + days range fallback, name/href resolution | The page surfaces per-bot/per-study cost; an aggregation bug shows misleading numbers to admins who use it for billing reconciliation |
| Deck routes | `/api/{pitch,architecture,engineering-reality,rollup}-deck` × {anon, admin} | Confirms each route both calls `requireAdmin` AND emits a real PPTX |
| Public survey endpoint | `/api/respond` happy + missing-field + invalid-JSON + inactive-study + 404 | This endpoint accepts traffic from anywhere — its validation is load-bearing |
| High-traffic chat + study routes | clara/nora/bot/townhall chat (validation + rate-limit) + study/[guid] (404, 403, happy) | These are the most-trafficked public endpoints — validation must reject bad input fast |
| RLS isolation | Cross-org read returns null + every public table has RLS + no `USING(true)` policy outside allowlist (env-gated) | The single biggest multi-tenancy risk |
| Cross-org data egress | Per org-scoped table: Org B cannot read Org A row by id or list scan (env-gated) | Proves policies actually filter, not just that they exist — extends rls-isolation |
| Campaign route egress | Service-role-client campaign-by-id routes (`/export`, `/respondents`) 404 cross-tenant + control 200 owning-org (env-gated) | RLS doesn't apply to service-role queries — this is the safety net for handler-level org_id gates |
| Dataset / org route egress | `datasets/[id]/sync`, `datasets/[id]/auto-setup`, `regulations-sources/download-comments`, `org/logo` DELETE — 404/403 cross-tenant + control owning-org (env-gated) | Same safety net for service-role mutations on datasets and the organizations table |
| Auth flows | Real Supabase signInWithPassword + OTP + reset + admin-createUser invite shape + signOut (env-gated) | Mocking the auth client only proves wrapper code; this proves the round-trip |
| Agent admin-page org gate | `botPageOrgGate` — the service-role agent lookup pairs `id` with `org_id` for non-admins, redirects on a cross-org miss, and stays unconstrained for admins | The admin pages (`/bots/[id]/{history,entities,questions}`) load by guessable UUID via service role; the test pins the multi-tenancy invariant so a refactor can't reintroduce a bare-id cross-tenant read |
| Recordings coverage | `computeCoverage` per-topic counting + zero-count flagging, ≥5-min gap detection (leading/mid/tail + rounding), confidence histogram bucketing/clamp | Pure post-analysis report logic driving the reviewer's flags; deterministic, so cheap to pin against regressions |
| Recordings analyze | `analyzeRecording` Opus-extraction + Sonnet-curator parsing (markdown-fence tolerance, invalid-typology/empty-field drop), flag-merge precedence (curator beats low-confidence), emergent-topic override, two-pass cost (callAI mocked) | The PM-1-critical "audience question vs panel commentary" judgment lives here; the parser must survive garbage model output and the flag-merge must not regress |
| Recordings routes | The recordings API routes — 401 unauth, 403 feature-off, 404 cross-org (id+org_id pairing asserted), and input validation (instructions length, scope enum, duplicate filenames, status filter, document role/PDF + media-refusal §4.1e); Supabase + WDK mocked | Route handlers carry the org/feature gates and were shipped untested; the gate contract is the load-bearing part and must not regress |
| Export org gate | The service-role export routes (`datasets/export/{html,pptx,signals-pptx}`, `townhall/sessions/[id]/export/{pptx,route}`) return 404 when a non-admin requests another org's resource; same-org passes | Exports return an entire org's data; a June-2026 sweep found this class unguarded. The test pins the cross-org 404 so the leak can't reappear |
| E2E download | Login → /api/pitch-deck → pptx (env-gated) | Catches cookie/session breakage that unit tests can't see |

## What we deliberately skip

- **Snapshot tests for UI components.** High churn, low signal; they catch design
  changes, not bugs.
- **Exhaustive coverage of `app/api/datasets/*`.** Many routes; the high-leverage
  pieces (rate limiting, RLS, deck gate) are tested separately. Adding tests
  here as bugs are found is fine.
- **AI-provider integration tests.** We mock at the `lib/ai` boundary —
  testing that Anthropic's API works is Anthropic's job.
- **The PPTX exporter for analytics decks.** ~3K lines, low ROI; would require
  fixture management out of proportion to bug-discovery rate.
- **Comprehensive auth-flow e2e.** One golden-path e2e (login → deck) is the
  smoke test; full coverage is Playwright's long-tail and not worth carrying.

## Mocking strategy

Mock at the **module boundary**, not the network:

- `lib/ai` is the wrapper around Anthropic / OpenAI / Azure OpenAI. Tests
  `vi.mock('@/lib/ai', ...)` directly; no MSW needed.
- `lib/supabase/server` is the wrapper around Supabase JS. Tests mock
  `createClient` and `createServiceRoleClient` per-test to inject the
  exact rows / errors the assertion needs.
- `lib/rateLimit` and `lib/contentGuard` are mocked in the `/api/respond`
  test — they're orthogonal to the schema-validation behavior under test.

The service-role key is **never** committed and **never** logged. Tests use
the placeholder string `test-service-role-key`; the `lib/supabase/server`
factory is mocked before any module that calls it is imported.

## Adding a new test

1. Pick the boundary. If you're testing a pure function in `lib/`, write a
   unit test under `tests/unit/`. If you're testing a route handler, write
   an integration test under `tests/integration/` and mock at
   `@/lib/supabase/server` and any other side-effecting modules.
2. Mock with `vi.mock()` **before** the dynamic `import('@/...')` of the
   module under test. Static `import` lines hoist; dynamic imports give
   you mock-ordering control when a mock value depends on `beforeEach`.
3. Assert observable behavior, not implementation. Status codes, response
   shape, and "did the side-effect fire?" — not "was this private helper
   called with these args?".
4. Each test file must run independently. No shared mutable fixtures across
   files.

## Workflow DevKit tests

The recordings pipeline is a Workflow DevKit run (`workflows/recordings.ts`).
For these:

- **Unit-test the steps directly.** Each `"use step"` is just an async
  function — the directive is a no-op without the compiler. Import and
  call them under `tests/unit/recordings/` with mocked Supabase + libs.
- **For workflow-level orchestration tests** (try/catch behavior,
  step ordering, status transitions), wire `@workflow/vitest` in a
  separate integration config when needed — not installed today; the
  per-step unit tests cover the v1 PM-1 milestone.
- **`scripts/pm1-smoke.ts` is the calibration harness, not a unit test.**
  It calls real Claude (Opus + Sonnet, ~$1/run) against a stored PM-1
  transcript fixture and scores extraction quality vs PDF ground truth.
  Run manually; never invoked from CI.

## Env-gated tests

Six suites need real infrastructure and are **skipped** unless the
environment is configured: four Vitest egress/RLS suites, auth-flows, and
one Playwright e2e. All follow the same prefix/cleanup pattern: test rows
carry a unique `_<name>test_<runId>_` marker so partial failures are
findable and deletable by hand. None run in CI — service-role keys do not
belong in GitHub Actions.

### RLS isolation (`tests/integration/rls-isolation.test.ts`)

Self-contained: the test creates its own test orgs / users / study via the
service role, runs the assertions, then deletes everything. All test rows
are prefixed `_rlstest_<runId>_` so partial failures are easy to find and
delete by hand.

Run it:

```bash
npm run test:rls
```

That sets `RLS_TEST=1` and points at whatever `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are in
`.env.local`. Without `RLS_TEST=1` the suite calls `describe.skip` so it's
visible-but-skipped in default test output.

**Pre-launch (no real customers yet)**: pointing this at the production
Supabase is acceptable. The test data is namespaced and cleaned up; the
risk is one stale row if the test crashes mid-run, which is recoverable
by hand via the `_rlstest_` prefix.

**Once customers exist**: stand up a dedicated Supabase test project and
set `NEXT_PUBLIC_SUPABASE_URL`/keys in `.env.local` to that project before
running. Real auth.users rows shouldn't share an instance with paying
customers, regardless of how careful the cleanup is.

### Cross-org data egress (`tests/integration/cross-org-egress.test.ts`)

Where rls-isolation proves "every table has RLS turned on and no policy
is unconditionally `true`," this suite proves the next layer: for each
org-scoped table, the policy actually filters cross-org reads. Seeds one
row per table in Org A; signs in as Org B's anon-key client; asserts no
row leak via either get-by-id or list-by-id scan.

```bash
npm run test:egress
```

Sets `EGRESS_TEST=1`. Same .env.local + pre-launch caveats as RLS. Test
data is prefixed `_egresstest_<runId>_`.

### Auth flows (`tests/integration/auth-flows.test.ts`)

Real Supabase auth round-trips — covers what mocking can't: that
`signInWithPassword` actually mints a JWT that decodes back to the same
user, that `admin.createUser` (the invite-flow path) produces a user who
can immediately sign in, and that `resetPasswordForEmail` / `signInWithOtp`
/ `signOut` wire through. Email-sending paths tolerate
`over_email_send_rate_limit` since the throttler firing isn't a wiring
failure.

```bash
npm run test:auth-flows
```

Sets `AUTH_FLOWS_TEST=1`. Test users prefixed `_authflowtest_<runId>_`
and deleted in afterAll. Test emails use Gmail `+suffix` aliasing on a
mailbox the owner controls (`got2surf2+authflowtest_<runId>_*@gmail.com`)
so that the two paths which actually send mail (`resetPasswordForEmail`,
`signInWithOtp`) deliver instead of NXDOMAIN-bouncing back to the
project's configured sender.

### Campaign route egress (`tests/integration/campaign-routes-egress.test.ts`)

RLS doesn't apply to service-role queries, so handler-level org_id gates
on the `/api/campaigns/[id]/*` family need their own safety net. This
suite mocks `@/lib/supabase/server` to return real signed-in clients
(Org B for `createClient`, service-role for `createServiceRoleClient`),
then drives the route handlers in-process to assert that a cross-org
caller receives 404 and that the owning org receives 200.

```bash
npm run test:campaign-egress
```

Sets `CAMPAIGN_EGRESS_TEST=1`. Test data prefixed `_campaignroute_<runId>_`.

### Dataset / regulations / org route egress (`tests/integration/dataset-routes-egress.test.ts`)

Sister suite to campaign-egress, covering the service-role routes that
mutate datasets, regulations downloads, and org-level state. Locks the
W19-audit "bare-id lookup" pattern on four route handlers:

- `POST /api/datasets/[datasetId]/sync`
- `POST /api/datasets/[datasetId]/auto-setup`
- `POST /api/regulations-sources/download-comments` (batch + finalize)
- `DELETE /api/org/logo`

Each route is asserted to 404/403 for a cross-org caller and to NOT-404
for the owning org (control). The control assertions are loose on
purpose — sync/auto-setup may legitimately 400 on a test study with an
empty config; what matters is that the wrong code path doesn't fire.

```bash
npm run test:dataset-egress
```

Sets `DATASET_EGRESS_TEST=1`. Test data prefixed `_datasetroute_<runId>_`.

### Playwright e2e (`tests/e2e/deck-download.spec.ts`)

Requires an admin login on a running instance:

```bash
E2E_ADMIN_EMAIL=...
E2E_ADMIN_PASSWORD=...
E2E_BASE_URL=http://localhost:3000   # optional — Playwright will start `npm run dev` if unset
npm run test:e2e
```

When the env vars are not set, the test calls `test.skip(...)` and the
suite reports the reason inline.

## Load testing (Town Hall)

PulseIQ (`/pi/[guid]`) is the highest-throughput public surface — a venue
of N participants can fire chat messages, joins, and response submissions
at full LLM rate. Two parallel load drivers live in `tests/loadtest/`:

- `townhall.k6.js` — k6 hits `/api/townhall/join`, `/api/townhall/chat`,
  and `/api/townhall/responses` as raw HTTP. Tunable via `VUS`,
  `ITERATIONS_PER_VU`, `RAMP_UP_S`. Exercises the per-participant 20/min
  chat cap, the per-IP 600/min backstop, and Anthropic provider limits.
- `townhall.spec.ts` — Playwright drives N real Chromium browsers against
  `/pi/[guid]`, mirroring the actual participant journey (visit, type,
  send via Enter). Catches UI-layer breakage that HTTP-only load can't.
- `playwright.config.ts` — a load-specific Playwright config (separate
  from the e2e config) with no built-in webServer and tunable workers.

Run:

```bash
SESSION_ID=<uuid-or-slug> TARGET=http://localhost:3000 npm run loadtest:k6
SESSION_ID=<uuid-or-slug> TARGET_BASE_URL=http://localhost:3000 BROWSERS=5 \
  npm run loadtest:browsers
```

Neither runs in CI — they cost real Anthropic spend and real DB writes.
Both refuse to start without `SESSION_ID`, which must be a Town Hall
session you've already created via the UI and clearly named (e.g.
"Load Test — DO NOT USE").

## Bot regression scripts (Sarina)

The NOWOCATS Sarina agent has a 22-scenario regression script — Arjun's
2026-05-17 test suite encoded as machine-checkable assertions. Same data
backs three runner surfaces:

- `app/admin/sarina-regression/tests.ts` — single source of truth: per
  scenario, `turns[]` (1-3 user turns to send), `mustInclude` regex
  array, `mustNotInclude` regex array, `expectedFromDoc` narrative.
- `app/admin/sarina-regression/` — admin UI button-driven runner.
  Sends each scenario to `/api/bots/[id]/chat` with `debug:true`,
  surfaces per-test reply + transcript + RAG debug + per-pattern
  pass/fail. Re-runnable after any KB or system-prompt change.
- `scripts/sarina-regression-run.ts` — terminal-driven equivalent
  (committed; replaces the older `_run_sarina_regression.ts` local
  variant). Hits any base URL (default https://sentimetrx.com) against
  the same chat endpoint; prints pass/partial/fail per row plus a
  by-category breakdown, and dumps the full JSON to `/tmp/sarina-
  regression-<timestamp>.json`. Usage: `tsx scripts/sarina-regression-
  run.ts <botId> [baseUrl]`. Used as the regression gate for the
  convergence Phase 2 `lib/` extractions (see `docs/CONVERGENCE.md`)
  — captured a baseline against live Sarina at the start of Phase 2;
  each extraction commit re-runs against the same bot and compares
  pass/partial/fail counts to baseline before merging.
- `scripts/_generate_sarina_regression_doc.ts` — one-off generator that
  writes a Word doc to `~/Downloads/` comparing Arjun's original log
  with the latest run side-by-side. Uses the `docx` npm package; output
  matches the Calibri 11pt look of Arjun's NOWOCATS handoff doc.
- `scripts/_test_sarina_anchor_regression.ts` — focused regression test
  for the anchor-re-ask incident (`bs_mpdjyxz9_lfem0e`, 2026-05-20).
  Walks Sarina through a 13-turn feedback-path conversation that
  crosses the 12-message compression threshold. Verifies neither
  anchor (A1 User Type, A2 Priority Category) is asked twice. Returns
  exit code 1 if either anchor is re-asked — suitable for CI later
  once we have a sandbox bot id (running it against live is fine for
  manual one-offs but costs ~$0.30/run in model calls). Passes after
  the two-layer fix in commit `83daff5` (prompt rule
  ANCHOR-ASKS-ARE-ONE-AND-DONE + chat-route summarizer that preserves
  must-have fields and emits a machine-readable ANSWERED ASKS line).

Neither runner runs in CI — both cost real model calls against the
live bot. Run after any change that touches Sarina's prompt, intents,
guardrails, or knowledge base. Target ~$1–$3 per full pass.

## CI

`.github/workflows/ci.yml` runs typecheck + Vitest on push to `main` and
on every PR. Playwright is not in CI (real Supabase + login + dev server)
— it's a manual local check. README has the badge.

## Tracked test gaps

The weekly audit (`docs/weekly-reports/YYYY-WXX.md`) has flagged
"route handlers and React components remain largely untested" in every
audit from W19 onward. The Tests score has been pinned at 4/10 (15%
weight) by the test-files-to-source-files ratio (~0.044 in W21).

**Queued route-handler test additions (highest leverage)**:

- `/api/respond` — status enum transitions (in_progress → complete),
  partial-save persistence across resumes, retry idempotency. Extends
  `tests/integration/respond.test.ts` or new file.
- `/api/bots/[id]/chat` — input validation (missing session_id,
  oversize message, malformed JSON), rate-limit bucket exhaustion +
  reset, inactive-agent → 404, CORS preflight, session_id regex.
  New `tests/integration/bot-chat-validation.test.ts`. Highest-traffic
  public endpoint.
- `/api/townhall/*` participant routes — `join/[sessionId]` GET+POST
  (bad slug, status-gate, participant-id mint), `live/[sessionId]` GET
  (active-only), `themes/[id]` POST + `themes/custom` POST (input
  shape, content-filter). Covers both legacy `townhall_*` substrate
  and phase-3 `town_halls` (via `lib/townHallAdapter.ts`).

Each surfaces 8–15 cases / file, adds a test file (lifts the
file-count ratio), and exercises real route logic (closes the audit's
narrative). Queued in the open-work-queue memory as the highest-ROI
next-session items after the W22 push lands.
