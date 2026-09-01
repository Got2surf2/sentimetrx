# 2026-W36 devlog

---

## 2026-09-01 — Fix the parseCSV interior-quote-dropping bug (W36 audit item #1)

**Why**: the W36 governance audit's top progression item, live in production
since the ANES load: the upload parser in `UploadClient.tsx` toggled `inQ` on
every `"` and never emitted one, so interior quote marks were silently dropped —
2,796 of 125,897 prod ANES rows had verbatim text mangled. It also split on
newlines BEFORE parsing fields, so a quoted field containing a line break broke
its row apart entirely (a second defect of the same class, found while fixing
the first).

**What**: extracted all upload parsing into `lib/csv.ts` — a single-pass RFC4180
parser (`parseCSVRecords`) that treats `""` as a literal quote and separators
inside quotes as data, plus `parseCSV`, `parseTSV`, `isSurveyMonkeyCSV`, and
`parseSurveyMonkeyCSV` ported onto it. `UploadClient.tsx` now imports from
`lib/csv`. Moving the code into `lib/` also puts it inside the vitest coverage
surface (`lib/**` + `app/api/**`) — part of the W36 plan to raise actual
coverage with tests that matter.

**Verification**: 24 unit tests in `tests/unit/csv.test.ts` (escaped quotes,
embedded newlines/commas, CRLF, BOM, blank lines, SurveyMonkey header merging);
full suite 1,840 green; and the real browser flow against the TEST project — a
CSV with `""` escapes and an embedded newline uploaded via `/analyze/new`,
stored rows read back byte-identical (quotes and newline intact, 3 rows not 4).
The old dead "Check 4" (`dataLike`, computed but never used) in
`isSurveyMonkeyCSV` was dropped in the port.

**Not done here**: re-running the ANES loader to repair the 2,796 mangled prod
rows (the server-side loader already parses correctly; repair is a separate,
owner-timed operation). The campaigns respondent uploader
(`CampaignDetailClient.tsx`) handles `""` correctly but still line-splits first;
the content-guard admin harness uses a naive `split(',')` — both noted, left
untouched.

## 2026-09-01 — chatCore turn tests (4% → 27%) + coverage floor ratchet

**Why**: week plan item #2 from the W36 coverage work. `lib/chatCore.ts` is the
designated only chat engine (docs/CONVERGENCE.md) and sat at 4% statement
coverage — 979 uncovered statements, the single largest untested `lib/` file.
The audit rubric scores Tests on the ENFORCED floor tracking actual coverage,
so every suite that lands also ratchets `vitest.config.ts`.

**What**: `tests/unit/chatCoreTurn.test.ts` — 13 turn-level tests with
`callAI`/embeddings/usage mocked and a permissive Proxy-based fake service
client (documented in TESTING.md as the harness to extend). Covers the
silence-probe fast path exhaustively, the org AI-off gate, byo-anthropic key
propagation, the standard 1200-char input cap, and turn persistence numbering
(plain T0/T1 and askName+greeting T0–T4). chatCore statements 4% → 26.9%.

**Ratchet**: overall coverage measured 32.16 st / 25.41 br / 35.17 fn /
32.78 ln (was 31.41/24.64/34.69/31.95 before today's two suites); floors raised
30/23/33/30 → **31/24/34/31**, staying ~1pp under actual so environment
variance can't redden CI while regressions still trip it.

## 2026-09-01 — Aux route org-scoping gates (7 untested routes)

**Why**: week plan item #3, and the W36 audit's route-auth finding ("132
routes without auth references… no systematic audit of unauthenticated routes
was done"). Route-handler org filters are not covered by RLS tests (CLAUDE.md
invariant), and these seven handlers — including `filter-options`, shipped
only last week with sql/194 — had zero route tests.

**What**: `tests/integration/dataset-bot-aux-routes-gate.test.ts` — 26 tests
in the established gate pattern (401 / cross-org 404-or-403 / admin bypass +
one cheap post-gate status proving the gate passed) over datasets
search·filter-options·taxonomy-rows and bots crawl-job·batches·workbook·probes.
The batches listing additionally asserts the service-role `question_batches`
read stays paired with the agent's org. All gates already held — no defects
found, now locked in. Lines floor 31 → 32 (actual 33.23).

## 2026-09-01 — Internal deck generators out of the coverage surface

**Why**: owner decision — no standalone deck ever reaches a client; they are
internal consumption only, and their generation code "should not be subject to
the audit rules." (A repo split was considered and rejected: the deck routes
read live app data through the app's DB clients, so they can't run outside
the repo; the coverage `include` is the audit-facing boundary we control.)

**What**: `vitest.config.ts` coverage `exclude` now drops every top-level
`app/api/*-deck/**` route (22 of them) and the 11 `lib/pptx` builders only
those routes import. The rule is structural (documented in TESTING.md
"Coverage surface" + the audit rubric's Category 5) so future decks inherit
it without name-by-name judgment. Customer-facing PPTX stays in scope:
shared/slideRenderer/styles, the dataset-scoped deck routes, and the
dataset/agent/recording/collection export builders. Denominator 44,205 →
39,538 statements; measured 33.76 st / 25.82 br / 35.85 fn / 34.69 ln;
floors ratcheted **31/24/34/32 → 32/25/35/33**. Noticed in passing:
`lib/pptx/diligenceDeck.ts` is imported by nothing (pre-existing dead code,
left in place).

**Follow-up (same day, owner: "delete it")**: `lib/pptx/diligenceDeck.ts`
removed. It was runtime-dead but not source-dead — `operationalReviewDeck.ts`
imported its `DiligenceOpts` type, so the 6-line interface moved there (the
operational deck already carried the copied slide logic; its header notes the
origin). Coverage exclude entry dropped; fresh-cache `tsc` + full suite green.

## 2026-09-01 — chatCore RAG / super / town-hall scenarios (27% → 34%)

**Why**: continue week plan item #2 — the RAG injection block, the super
tool-loop stream path, and the town-hall entry were the biggest untested
branches left in the engine after the morning suite.

**What**: 8 more tests on the same harness (now with an `rpc` handler + call
recorder on the fake service): confidence bands (>85% answer-only framing /
mid honest-answer / <5% skip), negative-only → deflect instruction, semantic
RPC failure → keyword fallback with rank→confidence normalization (the D1
KB-suppression regression), contrast_mode opponent injection, super capability
(multi-query rewrite hits retrieval twice, stream path with 1200-token knob,
`chat_super` + `query_rewrite` usage rows, never plain `chat`), and a
town-hall turn with no topics (facilitation skips; the mirror is awaited with
the townHallId). chatCore 26.9% → 34.2% statements / 38.3% lines. Overall
33.95/26.05/36.05/34.90; floors → **33/25/35/34**.

## 2026-09-01 — outletReport tests (0% → 73%)

**Why**: `lib/outletReport.ts` was the largest 0% PRODUCT file (589
statements) — it computes every figure on the outlet report, leaderboard, and
the outlet PDF/deck exports, and several of its behaviors encode hard-won
rules (the verbatim-premise guard, the never-rank-thin-samples floors, the
"dirty soda" classifier noise filter).

**What**: `tests/unit/outletReport.test.ts` — 11 tests driving
`computeOutletReport`/`computeOutletLeaderboard` over a synthetic 2-outlet
chain, faking only the service client; lexicon + verbatim guard + delta math
run real. Pins: options ordering + location-name resolution (brand-only name
falls back to City, State), rank/percentile/narrative, Service strength and
weakness with premise-supporting quotes, Food held under MIN_N_CHAIN on every
surface, snapshot distribution/owner-band/theme verdicts (STRENGTH and FIX
bands), fleet null under 200 reviews, leaderboard ranking + floors, and the
DIRTY_NOISE clean:neg filter — fixture sized (24 assertions, 12/outlet) so
the filter, not the floors, is what keeps Clean off the board. 0% → 73%
statements. Overall 35.03/26.82/37.63/35.95; floors → **34/26/36/35**.
Remaining gap: the predictor + hierarchy entry points (960–1107).

## 2026-09-01 — Advanced Analytics: persisted scan cache + loading states (PERF §8 fixes 1+2)

**Why**: The owner demoed the Cheddar's dataset and every Advanced Analytics
option switch froze for ~3.4s. Diagnosis (PERFORMANCE_REVIEW.md §8, measured on
prod read-only): all three Advanced pages are `force-dynamic` and every view
re-ran `scanDataset` — paging the ENTIRE dataset's JSONB (20.5MB / 20 serial
round-trips on 19.7K rows) with zero caching and no loading state. IO/network
bound, not CPU (the theme regex pass is ~60ms); O(N) per click with no sampling
doctrine protecting it — a 500K-row brand would take 80s+ per click.

**What**: ① `Scan` now carries a ~30B/row digest (`ScanRow`) instead of raw
rows — `recentTrend`, the monthly trend, `outletPaths`, and the predictor's
review matrix all consume the digest (`deriveReviewMatrix` shared by both
paths so they cannot drift). ② `lib/outletScanCache.ts` serializes the scan
(v1, 1.8MB for Cheddar's vs 20.5MB raw) into `dataset_state.outlet_scan_cache`
(sql/195, TEST-applied, PROD MIGRATE ON PUSH), keyed by a sql/194-style
fingerprint: row_count : last_synced_at : theme model : hierarchy designations
: taxonomy rollup updatedAts. ③ `loadScan` = compute-on-miss orchestrator; all
9 scan entry points (3 pages incl. hierarchy drills, action-plan route, 3 deck
GETs) funnel through it; cache read/write failures degrade to a plain scan.
④ `loading.tsx` (LottieLoader) on all three routes. Verified in-browser on
TEST (same Cheddar's dataset): warm views ~1.3s dev (≈ cheap-page baseline
0.44s), BareBurger hierarchy drill 6.7s cold → 0.75s warm, invalidation
observed live on a last_synced_at bump, loading state caught mid-rebuild.
9 new tests (tests/unit/outletScanCache.test.ts): cold/warm byte-parity across
every entry point, zero row reads warm, 5 fingerprint invalidation arms,
unknown-version → miss. All 1,907 tests pass.

## 2026-09-01 — slideRenderer rendered for real (every slide type) → floors 36/27/38/37

**Why**: `lib/pptx/slideRenderer.ts` (18% covered, 652 uncovered statements)
renders every customer-facing PPTX export. The ENGINEERING §6 incident showed
mocks and LibreOffice can both pass a deck that real PowerPoint declares
corrupt — so the useful test renders for real and validates the artifact.

**What**: `tests/unit/pptxSlideRenderer.test.ts` — renderDeck through the REAL
pptxgenjs over a deck with all 18 slide types plus an unknown-type fallback,
then the .pptx opened with jszip: slide count (title + N), every spec title and
representative content present in the slide XML, Datanautix (never Sentimetrx)
in docProps, and the §6 tripwire on every slide — no 9+-digit OOXML attribute
values (`idx="4294967295"` excluded: a legitimate unsigned-int placeholder
index, found while calibrating the check). Also pins `fmtWallClock` bands.
Overall 36.84 st / 27.65 br / 39.16 fn / 38.02 ln; floors → **36/27/38/37**.

## 2026-09-01 — aggregate route op semantics (6% → covered)

**Why**: POST /datasets/[id]/aggregate serves every chart on the Charts/Stats
tabs; its gate was tested but none of its op behavior was — including two
deploy-order safety nets (the sql/169 p_row_ids and sql/164 p_field_key
PGRST202 retries) that only fire against an un-migrated DB, i.e. exactly when
nothing else would catch a regression.

**What**: `tests/integration/aggregate-route-ops.test.ts` — 18 tests: grid /
series / stats reshaping per op ((blank) buckets, null avg preserved), the
sampled path gating on row_count > AGG_SAMPLE_CAP with throw → exact-RPC
fallback, rowIds sanitization + both PGRST202 retries, numeric_stats' honest
n:0 on an empty sampled scan vs 404 on a truly empty dataset, taxonomy axis
validation + axisIsRow reshaping, and the collection fan-out (per-member RPCs,
counts summed, `_collection_label` stamped from member labels). Overall
37.28 st / 28.12 br / 39.38 fn / 38.51 ln; floors 36/27/38/37 already within
~1.3pp — no ratchet this commit.

## 2026-09-01 — analyticsCompute tests (0% → 91%)

**Why**: `lib/analyticsCompute.ts` computes every per-field summary behind
dataset sync/compute/trim and collection recompute — 248 statements at 0%.

**What**: `tests/unit/analyticsCompute.test.ts` — 12 tests. Pure path:
categorical counts/topN/uniqueRatio with blank-skipping, exact numeric stats
with the discrete (≤20 distinct) per-value profile vs continuous histogram,
min==max single-bucket collapse, empty-field zeroing, open-ended word/char
stats, date normalization to YYYY-MM-DD, id sampling — plus a streaming-
equivalence invariant (chunked `pushRows` ≡ one in-memory pass, the contract
collection recompute depends on). SQL path (fake service + rpc):
categorical/discrete-numeric/date summaries from the RPCs, empty-numeric
zeroing, and the sql/161 comma-safe non-empty count for open-ended fields
(SQL count wins over the 20-row sample; sampled fallback when it throws).
0% → 91% statements. Floors: functions 38 → 39, lines 37 → 38
(measured 37.85/28.52/40.01/39.07).

## 2026-09-01 — PulseIQ facilitation policy tests (chatCore 34% → 51%)

**Why**: the facilitation policy is the largest remaining untested chatCore
block, and it encodes the convergence work's hardest-won behavior: counting
rules enforced in code that BIND the model (clarifier caps, dynamic topic
caps, disengagement detection, checkout) — regressions here change how every
PulseIQ participant is treated.

**What**: 7 scenarios on the turn harness, seeding `conversation_turns` and
asserting the decision that reached the system prompt plus the stored
assistant turn's source: curt answer → binding clarifier (source=clarifier,
sql/154 counter bumped for the picked topic); substantive answer → stay on
topic with the follow-up angles (the 2026-07-03 "bipolar conversation" owner
finding); move-on signal → rotation to the least-covered topic with the
no-dismissal tone rule verbatim; three curt answers → chill standby
(source=standby, no further questions); all topics covered → graceful
close-out; opening response → AI topic classification threads onto the
matched topic (topic_match usage logged); and the response-count
theme-detection trigger fires at the threshold in auto mode and never in
manual (the 414-topic balloon guard). chatCore 34% → 50.6% statements /
54.8% lines on the day (4% at start). Overall 38.32/29.18/40.55/39.55;
floors → **37/28/39/38**.

## 2026-09-02 — PERF §8 long-tail: share-analytics cap, PulseIQ list N+1, live-poll cache

**Why**: Large-client readiness sweep — three known software loose ends from
PERFORMANCE_REVIEW §8 (everything else scale-critical was already fixed).

**What**: ① `/api/share/analytics` — the last fully-uncapped `dataset_rows_flat`
scan on a public route now follows the pptx-export doctrine: ≤50K exact,
>50K deterministic block sample (`pageSampledRows` + proportional
`allocateSampleShares` for collections, sequential fallback); response carries
`sampled`/`totalSourceRows` and the shared page labels sampled figures.
Verified live against TEST Cheddar's via a seeded share link (figures
reconcile: mean 4.139 = the app's 4.14★; link deleted after). ② PulseIQ list —
`listTownHallsAsLegacy` ran `computeBasicStats` per hall serially (up to 50K
turn rows each); the list needs two numbers, so it now does a small link-row
read (distinct participants) + an indexed head COUNT (turns), concurrently
across halls. Verified: 262/513 on the NOWOCATS hall match SQL ground truth.
③ `/api/townhall/live` — polled every 10s by EVERY viewer, each poll re-read
up to 20K turns; added an 8s module-level payload cache (same pattern as the
route's own trending cache) so N viewers cost one compute per cycle. Measured:
4.9s cold → 0.13s cached, payload identical. All 1,949 tests pass.

## 2026-09-02 — repeat-open rows cache + parallel-fetch rejection; prod DB → Small

**Why**: Owner: large-dataset loads feel slow. Measured: 50K sample of a 128K
survey = 10 serial RPC pages (11.8s DB) + 86MB JSON to the browser.

**What**: ① IndexedDB repeat-open cache (`lib/rowsCache.ts` + RowsContext/
DatasetShell wiring): the processed bulk payload persists client-side keyed by
row_count:last_synced_at:schema-hash; reopening a dataset = zero bulk fetch
(verified in-browser: no /rows request, full TextMine render ~3s). 4 tests on
the invalidation contract. ② Parallel block-group fetch: built, MEASURED,
REJECTED — 12.7s vs 11.8s serial; the cost is DB CPU (jsonb+gzip ~9MB/page on
2 shared cores), wire already gzip 11:1. Reverted; recorded in ANALYTICS.md so
it isn't re-attempted. ③ Prod Supabase compute bumped Micro → Small (owner-run
Management API call after classifier block; verified ci_small ACTIVE_HEALTHY,
425ms probe) — 2GB RAM / 174MB/s baseline IO for the 598K-row working set.

## 2026-09-02 — server-side upload pipeline (owner: "upload to staging, do everything on the back end")

**Why**: Large-file uploads ran entirely in the browser: client-side parse,
then ~630 serial 200-row POSTs (126K rows) with the tab load-bearing
throughout and a rollback path that a single flaky request could trigger.

**What**: Direct-to-Storage upload + background ingest. ① `POST
/api/datasets/upload-url` mints a signed URL under the caller's org prefix
(private `dataset-uploads` bucket, created lazily — note: Supabase's missing-
bucket error is "The related resource does not exist", caught broadly).
② The browser PUTs the raw file (XHR for upload progress), creates the
dataset, and kicks ③ `POST /api/datasets/[id]/ingest` → 202 + `waitUntil`
worker (`lib/datasetIngest.ts`): same lib/csv parse as the client preview,
column filter, autoDetectSchema + aliases, 500-row inserts, progress
checkpoints in `analytics.ingest`, compute, file cleanup. Poller drives
pause/continue for >250s files; resume trusts max(row_index) so no double
writes. UploadClient loses splitChunks/batching (uploadChunking.test.ts
retired with it). 7 new worker tests (RFC4180 parity, filtering, alias
labels, pause→resume, stale-checkpoint resume, error arms). Browser-verified
E2E on TEST: 30K-row CSV → ~25s total incl. compute, live "Processing rows —
8,000 of 30,000 / you can safely close this tab", row 1 quotes intact,
row_count/schema/cleanup all reconciled, test dataset deleted after.
