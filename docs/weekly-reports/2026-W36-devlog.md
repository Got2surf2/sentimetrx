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

## 2026-09-02 — TextMine consistency: dimension drills → shared Comments, evidence highlighted

**Why**: Owner: "in themes if I pick a word I go to a view where the terms I
picked are highlighted — same thing does not happen from dimensions — the
comments view should actually be shared so there is only one."

**What**: ① sql/196 (TEST-applied, PROD MIGRATE ON PUSH): get_rows_by_filters
returns per-row `dim_evidence` (matched assertions' evidence windows; _tx
stays stripped; DROP+CREATE + the mandatory sql/190 REVOKE block).
② FilteredCommentsPanel highlights evidence as anchor-free phrases (windows
cut mid-word; 5 tests). ③ TaxonomyModule gets onDrillDimension/onDrillAxis —
embedded in TextMine, sub cards/chips and the axis "Read all comments" land in
the SHARED Comments view like every other lens; alerts + the standalone
taxonomy page keep the internal drill. ④ Found+fixed: the Comments
dimension-facet loader hit /taxonomy without fields= and got zero axes — the
facet picker and the active-dimension chips had silently never rendered.
Browser-verified on TEST Cheddar's: counts reconcile (743 card = 743
comments; axis = 4,184), evidence highlighted incl. mid-word windows, chips
removable, themes/entities paths unchanged. 1,962 tests pass.

## 2026-09-02 — clause-scoped sentiment: "the manager was nice" now reads as nice

**Why**: Owner: when the word is "manager" and the comment is "the manager was
nice", the manager mention must carry the "nice". It didn't: who-type phrases
are dictionary-neutral, the only context logic was a negation flip, so the
"nice" landed on an unrelated attribute sub and who-type cards showed "No
sentiment signal · by rating".

**What**: `taxonomyKeywordMatcher` — a `neu`-polarity hit now adopts its
CLAUSE's lexicon sentiment (lexiconScore, negation-aware); clause bounds =
sentence delimiters + contrast conjunctions so "food was great but the manager
was rude" yields manager=neg, and sentiment-free mentions stay neu (by-rating
fallback preserved). 7 tests pin the exact owner case + the leak/negation/
isolation traps. Verified end-to-end: full TEST Cheddar's re-classify (12,340
rows, 49s, keyword tier) flipped every "who served you" card from "No
sentiment signal" to real polarised shares (Server 79%, Manager 51% positive —
rank-consistent with by-rating). Existing datasets keep stored verdicts until
their next classify. All 1,969 tests pass.

## 2026-09-02 — print-to-PDF retired: leaderboard + hierarchy rung get composed PDFs

**Why**: Owner: any PDF option using print-to-PDF must become a high-quality
generated document — "the print version looks tacky."

**What**: Inventoried print surfaces — exactly two remained (Outlet
Leaderboard, hierarchy rung view). Extracted the deep-dive's stylesheet to a
shared DOC_CSS; added buildLeaderboardHtml (top-K/bottom-K per item, gap-vs-
chain bold figures, at the K the page shows) and buildHierarchyRungHtml
(snapshot KPIs, distribution with peer markers, theme verdicts, praise,
children/locations tables) to lib/outletReportPdf.ts. Two POST routes with
payload validators (outletPdfPayload), outletReportingOn gates, and the
mandatory chromium outputFileTracingIncludes entries. PrintButton deleted.
Pixel-QC'd both documents from real TEST data (branded chrome, keep-together
cards; 60-DPI header cramming ruled out at 150 DPI); both page buttons
verified E2E (POST 200 → download). 1,969 tests pass.

## 2026-09-01 — Ask Ana queries the data instead of skimming a sample

**Why**: Owner: Ana "only works on a very small subset of the dataset — probably
not even statistically significant; convert the requests into queries without
tossing data to an LLM every single time." Every Ana number was an impression
from a ≤500-row dump that couldn't reconcile with the tabs.

**What**: Extracted the charts aggregate route's op dispatcher verbatim into
lib/aggregateOps (route is now a thin auth wrapper) and gave Ana two
server-executed tools in a new agentic tool loop inside the ask-ana SSE stream
(≤6 rounds): query_data → runAggregateOp (same RPCs/gating/fan-out as the tabs,
scoped to the filtered view's row ids sent by the panel) and find_quotes →
rank-ordered full-text search with an exact whole-dataset count and verbatim
quotes. Prompt reframed: the row dump is an orientation sample; every numeric
claim must come from query_data, every quote verbatim from find_quotes. Schema
context now carries data field keys (label-only context made queries silently
match nothing). Panel streams "Counting values…" status lines per round.
Browser-verified on Rubio's (TEST, 9,905 rows): unfiltered star breakdown
matched the dispatcher exactly (…= 9,905); with Anaheim excluded, scoped counts
summed to the header's 9,774 and the complement to the 131 excluded rows.
16 new unit tests; 1,985 total pass.

## 2026-09-02 — "Ana remembers": per-analyst memory + first-visit interview

**Why**: Owner green-lit the Persistent Analyst Phase 2 after the five-state
mockup. First slice = the memory substrate, the confirm-only save loop, the
visible memory panel, and the day-one interview.

**What**: sql/197 analyst_memories (RLS + org-scoped SELECT; service-role
route pairs org+user from auth — body ids ignored). remember_preference is an
ACTION tool → ⭐ Remember confirm chip; the tap is the only write path.
memoryPromptBlock injects active applicable statements with the framing-only
invariant (never the figures — count changes stay with theme tools).
First-visit interview (≤4 questions) seeds memories chip-by-chip; the prompt
carries already-saved statements after a live-caught bug (Ana re-proposed a
captured preference); every reply ends with the next question so chips don't
stall the flow. "What Ana remembers" view: grouped by provenance, inline
edit, instant delete, invariant footer. Browser-verified end-to-end on TEST:
interview → 2 chips → save → generic question answered location-first
("leading with location, as your VP expects"), parking suppressed audibly →
delete works. 11 new tests; 1,996 pass; test:rls green. sql/197 applied to
TEST; prod apply rides the next push batch.

## 2026-09-02 — Ana's briefing + the canvas handoff (Phase 2 complete)

**Why**: The last two surfaces of the owner-approved five-state design: Ana
speaks first when she has memories to work from, and every answer is one tap
from being the real chart behind it.

**What**: Briefing — hidden auto-trigger (once per dataset per session) with
briefing:true → BRIEFING MODE prompt block: unprompted opening read built per
ANALYST MEMORY via query tools, ending with next-step questions. Canvas
handoff — chartConfigForQuery maps each successful query_data call onto the
Charts tab's {chartType, config} (saved-chart shape, __dim_* axes), emitted
as a canvas SSE event → "Open in Charts" chip → sessionStorage +
ana-open-chart event + navigate; ChartsModule applies on mount or live.
Mapping is field-type-aware after a live catch: numeric field_counts →
distribution (bar's category slot rejects numerics → "No data for this
field"). Browser-verified on TEST: auto-briefing (VP-view, location-led, no
visible trigger) and a state-breakdown chip that snapped the canvas to
State × Star Rating with the answer's exact numbers. 3 new mapping tests;
1,999 pass. Test data cleaned; owner gets a fresh first-run.

## 2026-09-02 — Ask Ana opens straight into chat; sampling chooser demoted

**Why**: Owner hit the sampling chooser as the first screen and questioned it —
correctly. It's pre-query-engine messaging ("Ana will analyze a representative
sample") and it buried the interview.

**What**: Panel initial phase is now 'chat' (interview when pending); sampling
defaults silently (200-row orientation sample) and stays tunable via the
header Sampling button, which still opens the full setup incl. "Let Ana help
me decide". Browser-verified: fresh open lands directly on the interview.

## 2026-09-02 — read_comments: the old-Ana reading capability, targeted

**Why**: Owner: "we need to be smart enough to pull a small sample when the
questions are outside the scope [of aggregates] — like the questions the old
Ana used to answer." Query tools count; qualitative synthesis needs reading.

**What**: Third server-executed tool read_comments — topic query → rank-ordered
full-text matches + exact total (in-view first under filters); no query →
evenly-spaced slice of the filtered view's row ids, else deterministic
sample_row_pairs. ≤200 comments / 35K chars, explicit scope line, prompt
mandates an honest reading base. Browser-verified: "what are people saying
about the salsa bar" → "Reading comments about 'salsa bar'…" → themed
good/bad synthesis with attributed verbatims. Interview skip-clause also
verified live (graceful, proposed a fitting memory). 3 new tests; 2,002 pass.

## 2026-09-02 — interview handoff + memory idempotency + guard fix (owner-hit)

**Why**: Owner's live session hit three things at once: a data question
mid-interview looped forever (interview mode has no data access, no exit),
duplicate memories piled up (partly my own test-cleanup racing their live
session and emptying the ALREADY SAVED list — owned + repaired), and the
respondent content guard scolded "bite me in the butt" with "let's keep
things respectful."

**What**: Interview prompt answers data questions with exactly
[[interview-done]]; the panel catches it, ends the interview, and re-sends
the question through normal mode. Memory POST is idempotent on statement
text (case-insensitive, escaped-wildcard ilike). Ask Ana's guard drops
profanity/insult/spam tiers (keeps slurs/threats/sexual + self-harm net) —
false positive reproduced and re-tested green. Owner's data repaired:
duplicates removed, the wiped first preference restored, interview marked
done. 2,003 tests pass.

## 2026-09-02 — tool-loop discipline + model-flagged chart chip (owner: "what a mess")

**Why**: "What are people most upset about?" returned pure process narration
and no answer (one tool per round → cap hit mid-gathering), leaked tool
names, ran rounds' text together — and the auto chart chip offered a
rating × city heatmap that "in no way answers anything useful."

**What**: Guaranteed synthesis turn (budget-exhausted note + tool_choice:
none on the final round; cap 6→8); prompt mandates batched queries and bans
narration/tool names; paragraph breaks between rounds. Chart chip is now
Ana-flagged (chart:true on the ONE answer-shaped query) instead of
last-query-wins. Re-verified on the same question: complete risk-led answer,
"de-emphasizing positives-first per your standing preferences" said out
loud, no chip where none belongs. 2,003 tests pass.

## 2026-09-02 — ask-ana resilience: upstream retry + silent briefing failure

**Why**: Owner hit "Internal server error" twice on Tabla (both the
auto-briefing and a question) — most likely my live edits hot-reloading
under them (lesson repeated: don't edit the route while the owner is in the
panel) or a transient upstream blip; the same flow reproduced clean minutes
later with a full risk-first briefing.

**What**: The first Anthropic call retries once after 1.2s on
408/429/5xx/529 (a momentary 529 surfaced as "Internal server error"). A
failed briefing now disappears silently instead of leaving an unprompted
error bubble (session flag stays set — one attempt per visit). 2,003 pass.

## 2026-09-02 — interim narration suppressed structurally

**Why**: Prompt bans didn't stop the play-by-play ("The multi-word queries
are too restrictive… let me try single-term searches") littering final
transcripts — owner pasted a great answer wrapped in process noise.

**What**: Continuation rounds' text is buffered server-side: interim rounds
(more tool calls follow) render their text only as the transient status
line; the final round's text is flushed into the bubble. Round 0 streams
live. Browser-verified on Tabla: the bubble opens directly with the finding,
thinking shows only transiently. 2,003 pass.

## 2026-09-02 — one-thought status, "Show my logic", expand, recreatability

**Why**: Owner, three directives: thinking should show one thought at a time
(old one disappears); answers need a "Show me your logic" option proving
they're grounded, not guessed; findings must be recreatable by a human using
the platform — no logic applied that the platform doesn't offer.

**What**: `demote` event moves round-0 lead-in into the transient status
slot (bubble = final answer only; statuses already replace one another).
`logic` SSE events build a per-answer work trail — every query with target
and result counts, interim reasoning incl. dead ends — behind a
"🧠 Show my logic (N steps)" toggle; each line names the tab to redo it in
(Charts/Statistics/Search) and the prompt bans non-platform logic (missing
signals get named, never proxied). ⤢ expand toggles the panel to
min(940px, 92vw). Browser-verified on Tabla: 14-step trail incl. zero-match
searches and her pivot; answer honestly flags "no day-of-week field exists
in this dataset". 2,003 pass.

## 2026-09-02 — inline charts in Ana's answers + lone-surrogate 500 fix

**Why**: Owner: "make the responses richer — draw charts instead of tables
where appropriate." And Tabla surfaced a latent crash: emoji-rich reviews
truncated mid-surrogate-pair made the upstream API reject the entire request
("no low surrogate in string") — a whole answer 500ing over half an emoji.

**What**: Ana emits fenced ```chart blocks (constrained JSON: bar ≤12 rows /
line ≤60 points, verbatim tool numbers, ≤2 per answer); lib/anaChartSpec
parses (malformed → visible text; unterminated → "drawing chart…"), the
panel renders the product idiom (orange bars on tracks, tabular values; 2px
SVG trend line with tooltips). lib/jsonSafe.jsonStringifySafe scrubs
unpaired surrogates at stringify time — wired into ask-ana AND the shared
lib/ai client (sweep the class). Browser-verified on Tabla: 10-location
ranking rendered as a real inline bar chart, table kept for mixed columns.
6+ new tests; 2,009 pass.

## 2026-09-02 — Ana works the current view; sample demoted to last resort

**Why**: Owner (testing prod): Ana "still sampled 200 comments — that should
be a path of last option" and "uses the default verbatim column even though I
selected another — we need to be sure Ask Ana is working against the current
view."

**What**: ACTIVE VIEW block in the prompt names the selected text column
(themeFieldKey) and mandates targeting it; read_comments/find_quotes gain a
field param (column-scoped quotes with per-row fallback); orientation sample
default 200→60 (route + panel; Sampling button still raises); quoting or
synthesizing from the sample banned — every quote now traceable to a logged
tool step. Browser-verified on Rubio's with Owner Response selected: the
tone question came back as an owner-response-only analysis (two boilerplate
scripts + usage counts, verbatim). 2,010 pass.

## 2026-09-02 — branded PDF take-away from Ana's answers

**Why**: Owner: "when Ana generates a response (or a thread), generate a PDF
with the findings as a take-away or send-away — pretty sophisticated."

**What**: POST /api/ana/export-pdf (client posts the content it has — no
recompute) + lib/anaPdf composer: masthead "Analyst Findings · Prepared by
Ana", question banners, markdown→print HTML incl. real tables and chart
blocks re-rendered for print, teal pull-quotes, per-question "How this was
computed" appendix (logic trail + recreate-in-tab pointers), brandedPdfChrome
datanautix footer. Chromium tracing entry added (mandatory per PDF route).
Panel buttons: "PDF" per exchange + "PDF · whole thread". Pixel-QC'd via the
real pipeline (2 clean pages); route smoke 200 application/pdf. 4 new tests;
2,014 pass.

## 2026-09-02 — set_view: Ana offers to configure the canvas herself

**Why**: Owner caught Ana replying "use the platform's filter to set
Age ≤ 35, then open the field in the analysis tab directly" — a to-do list.
"Should she just offer to do that instead of having the user do it?"

**What**: set_view ACTION tool → "SET UP THIS VIEW" confirmation chip
(summary + what it applies). On approval: lib/anaViewSpec converts the
constrained filter specs to the live Filters shape; ana-set-view-filters →
DatasetShell merges into useFilters (all tabs follow); ana-set-text-field +
sessionStorage handshake → TextMine adopts the column (mounted or not);
router navigates. Prompt bans go-do-it-yourself instructions. Zero net lint
warnings (stash-verified per file). Browser-verified: "set me up to dig into
1-star Arizona reviews" → one tap → 134 of 9,905 rows, State: Arizona +
Star Rating 1–1 chips, TextMine filtered. 2 new tests; 2,016 pass.

## 2026-09-02 — reads return the response text, never metadata strings

**Why**: Owner (prod, ANES-style corpus): read_comments/find_quotes returned
"truncated metadata strings, not readable quotes" — Ana honestly refused to
synthesize, three exchanges in a row. Cause: full-text matches on rows where
the target column is EMPTY fell into the join-all-fields fallback, which on
a wide survey row prints demographics first.

**What**: Field-scoped reads exclude empty-column rows (counted as
rowsWithoutThisField; zero-coverage pulls return a check-coverage hint) —
never padded from other fields. Field resolution is label-tolerant
(label→key map) and defaults to the ACTIVE VIEW column. The no-field
fallback prefers substantive text (longest fields first). 3 rewritten/new
tests pin the exact transcript failure modes; 2,018 pass.

## 2026-09-02 — fill-to-limit reads + representativeness drift alerts

**Why**: Owner: "samples feel really small — a sample of 500 should actually
have 500 verbatims; and track drift between the dataset demos and the pulled
demos, alerting on significant mismatches."

**What**: read_comments now fills to the limit with REAL verbatims on every
path (paged search offsets, evenly-spaced passes over the filtered view,
over-fetched representative samples; max 400, 60K-char budget). Reads ≥30
verbatims tally the pull's mix on schema `demographic` categorical fields vs
the dataset's exact field_counts (filter-scoped); shifts ≥15pts on values
≥5% surface as representativenessDrift, and the prompt mandates telling the
user. 2 new tests (sparse-column fill, 100%-Male-vs-50/50 flag); 2,020 pass.

## 2026-09-02 — incremental prompt caching across Ana's tool rounds

**Why**: Owner asked whether context is a concern with the bigger reads.
Window-wise no (worst case ~100-120K of 200K, hard-capped), but every tool
round re-sends the whole growing conversation — a 400-verbatim read (~15K
tokens) was re-billed on each subsequent round.

**What**: callAnthropic marks the LAST block of the latest message as a
cache breakpoint each round (older markers stripped; one message breakpoint
+ the cached system block, within the 4-max). Next round reads the shared
prefix from cache at ~10× cheaper input. Smoke-verified live: multi-round
read question streams to completion. 2,020 pass.

## 2026-09-02 — Data Story proof + /api/story viewer route

**Why**: owner wants engine-backed narrative visualizations ("Data Story" /
StoryTime evolution) shareable as a plain link — platform-hosted, expirable,
revocable, no login. Proof ran end-to-end: the EA football corpus (12,174
Steam reviews from a claude.ai one-off artifact) ingested via the new storage
pipeline, themed by Mine-with-AI (7 themes; found PC Platform Neglect, 1,702
comments, which the hand-rolled chat version missed), then a standalone
narrative HTML built from the ENGINE's numbers (recountThemes over the full
corpus — byte-identical to the TextMine UI; verbatimGuard-checked quotes;
dataviz-validated palette) and uploaded to the `report-exports` bucket.

**Found**: Supabase Storage deliberately serves text/html objects as
text/plain on *.supabase.co (anti-phishing) — a signed storage URL shows page
SOURCE. This means the existing export/html/share links very likely render as
source too (pre-existing; worth a prod check).

**What**: `app/api/story/[...path]/route.ts` — public viewer on OUR domain
that streams a `report-exports/reports/**` object with real text/html.
Capability model unchanged: caller must present the storage signed-URL token;
Supabase verifies signature + expiry (7d default). Expiry = token exp;
revocation = delete the object (link dies instantly, 410/404). CSP locked to
inline-only + Google fonts, noindex, no-store, DENY framing. Verified in the
browser on TEST end-to-end. Harnesses `scripts/_ea_story_data.ts` +
`_upload_story.mts` untracked KEEP.

## 2026-09-02 — Ana tables: real rendering in the panel, aligned columns in the PDF
**Why:** Owner feedback while testing prod. The Ask Ana chat panel showed markdown pipe tables as raw `| … |` text ("quite hideous"), and in the findings PDF the numeric columns floated mid-row against wrapping text. Panel now renders pipe-table runs as real tables (plus `*italics*`, `---` rules, and styled blockquote verbatims — all previously literal); numeric columns are detected per-column (decoration-tolerant, so "⭐ 4.57" counts) and centered *with their header*, cells top-aligned. Narrow-panel fit solved structurally: the bubble's inherited `word-break: break-word` was letter-stacking table cells — reset inside tables; prose columns absorb width via `overflow-wrap: anywhere`. PDF (`lib/anaPdf`) gets the same column model: `vertical-align: top`, centered numeric columns incl. headers. Browser-verified end-to-end on TEST (Rubio's, live Ana answer, narrow + expanded panel) and PDF QC re-rendered.

## 2026-09-02 — Data Story is a product feature (Reports ▾ → Data Story)

**Why**: owner, verbatim: "i see no way from the local system to generate that
story report" — the proof was session-mediated. Now it's one click in the app.

**What**:
- `lib/dataStory.ts` — pure payload builder + renderer. Every theme figure is
  `recountThemes` over the substantive base; rating-field name heuristic adds
  "what moves the score"; a 2–6-value categorical (≥60% coverage, ≥30
  substantive rows/segment) adds per-segment profiles; quotes are
  sentence-level, keyword-anchored, `verbatimSupports`-gated (neutral themes
  get none). Datanautix-branded, dataviz-validated palette, escaped, noindex.
- `POST /api/datasets/[datasetId]/story` — org-gated; requires a theme model;
  ≤50K rows (evenSample past the cap, disclosed in the method note); AI writes
  narrative PROSE only over the computed facts (usage `data_story`), with a
  deterministic fallback so the story never blocks on the model; uploads to
  `report-exports`, returns the `/api/story/...?token=` share link (7-day
  expiry; revoke = delete the object).
- Reports picker: new one-click `data-story` type (`lib/reportCatalog.ts`,
  datasets with AI on) → header opens the story in a tab + copies the link.
  Found & fixed in browser verification: `window.open` AFTER the POST's await
  has lost the user activation and is popup-blocked — the tab now opens
  synchronously at click time and is pointed at the story when the build lands.

**Verification**: 14 unit tests (`tests/unit/dataStory.test.ts` — engine-
figure equality, premise-gated quotes, segment thresholds, escaping, section
gating) + reportCatalog tests updated; full suite 2,033 green; and the real
flow driven in the browser on TEST: Reports ▾ → Data Story → generated in-app
(AI narrative correctly reads the CF27 42% game-modes divergence) → opened at
/api/story with the token link on the clipboard.

## 2026-09-02 — Logic trail renamed "Provenance — how this analysis and report was derived"
**Why:** Owner naming decision: the path-of-analysis is called PROVENANCE in the PDF and every user-facing view ("derived", not "computed" — owner word choice). PDF appendix title, panel toggle ("Provenance — how this analysis and report was derived (N steps)" / "Hide provenance"), and a new uppercase header inside the expanded trail all renamed; spec + test updated.

**Follow-up (owner hit it live)**: the story tab sat on bare `about:blank` for
the 30–90s dev-mode build and read as broken. The tab now paints a branded
"Building your Data Story…" screen at click time via document.write, then
navigates when the link lands. Backend confirmed healthy in the same session
(direct POST → 200 + fresh link in ~30s).

**Polish (owner feedback on a real Cheddar's story)**: the lede was capped at
660px while the headline spanned the page — cap removed, column widened
920→1040px. Also the h1 read "…Reviews Reviews": storyTitle() now collapses a
stuttered trailing word and adapts the suffix ("what the reviews say" when a
trailing "Reviews" is stripped; "what the text says" otherwise) — unit-tested.

**Prod hotfix (owner hit it)**: the first prod Data Story 500'd at upload —
the prod `report-exports` bucket has `allowed_mime_types: [text/html,
application/octet-stream]` and Supabase matches the string VERBATIM, so
`text/html; charset=utf-8` is rejected (415). Both the story route AND the
pre-existing export/html/share route sent the suffixed form — meaning HTML
share has been silently broken on prod since the allowlist was set (May 12).
Both now send exactly `text/html` (the /api/story viewer re-adds the charset
on serve). Verified against the REAL prod bucket: suffixed → 415, plain →
accepted, test object deleted.

## 2026-09-02 — Data Story short links (sql/198)

**Why**: owner ("how do we enable short urls… do it now") — the v1 link was a
340-char signed-token URL: unsendable-looking, and its expiry is baked into
the signature so a sent link could never be extended or revoked individually.

**What**: `sql/198_data_stories.sql` — slug (crypto base62 ×12, the
capability; `question_batches.share_token` trust model), storage_path,
editable `expires_at`, `revoked_at`; RLS org-scoped SELECT, no write policy.
Public viewer `GET /story/[slug]` checks both lifecycle columns per request
and streams from the bucket (410 revoked/expired with distinct copy, 404
unknown/malformed/object-deleted). Generation mints the slug and returns
`/story/<slug>`; on insert failure it falls back to the signed-token link —
deploy-order safe for a prod that hasn't run 198. 6 route tests. Applied to
TEST via :6543 (RLS + policy verified); **prod apply = owner-run Management
API script (sql/198), snapshot regenerates at that `npm run migrate`.**
Verified live on TEST: `/story/NSd8V7meXoKX` renders the EA story.

**Polish (owner idea)**: the building screen now rotates "factoids" every 9s
while the ~30–90s build runs. Deliberately NOT trivia — every line is a TRUE
claim about what the pipeline is doing to THIS dataset (full-corpus vs
50K-sample read, quotes premise-checked, AI writes prose never numbers, CVD-
validated palette, 7-day revocable link, snapshots) — the no-fabricated-facts
content rule applies to loading screens too, and the rotation doubles as
feature education. Rotation mechanics verified in-browser.

**Revision (owner: real fun facts, sciencefocus.com spirit, random/15s)**: the
building screen's rotation is now 18 general-audience science facts under a
"Did you know?" kicker — each REWRITTEN in our own words (facts are free; a
publisher's wording/curation is not, so nothing is quoted or scraped) and only
well-documented ones included (no goldfish-memory-tier myths). Random order,
15s interval, no immediate repeats.

## 2026-09-02 — Data Story: benchmark-grade upgrade (taken over from the story session)
**Why:** Owner benchmarked the generated story against a bespoke interactive piece (ea-football-explorer.html) and said "take it over". The generator now argues instead of inventorying: AI thesis H1 + findings-led section heads (deterministic numbered fallbacks always exist), and three new deterministic analytics — theme-share/rating timeline (week/month/quarter), numeric-band quartile cross-cut (quartiles from rows, not the stored analytics percentiles — those were degenerate on ea_football), segment drift — plus a % recommended score derivation for recommend-style datasets and an embedded 360-excerpt verbatim explorer with vanilla-JS filters. All figures stay engine-computed; AI writes prose only. Browser-verified on TEST (ea_football, 3 generations): launch-window troughs visible in the timeline, low-hours band 19pts below, explorer filters live. 19 unit tests.

**Revision 2 (owner: "there were 151 on that site — use as many as you can")**:
the pool moves to `lib/funFacts.ts` — **138 facts**, each written in our own
words (a publisher's exact wording/curated list is copyright even when the
facts are free, so nothing was transcribed) and each well-documented (famous
myths excluded by test). The building screen samples a random 40 per build and
rotates every 15s. `tests/unit/funFacts.test.ts` guards size ≥100, uniqueness,
one-liner shape, no markup, and the myth exclusions.

## 2026-09-03 — Ask Ana: 120s Vercel timeout killed long ANES questions
**Why:** Owner's prod question (theme × time × party on 125K-row ANES) ran 19 tool steps and Vercel killed the function at the route's 120s maxDuration before the synthesis turn — the panel showed a provenance trail with an empty bubble and no error (confirmed in Vercel runtime logs: "Task timed out after 120 seconds"). Fix: maxDuration 120→300 (same ceiling as project-report) + the panel renders an honest "ran out of time" message when a stream ends with no text and no actions. The unpushed round-caching commit also shortens these runs materially.

## 2026-09-03 — Ask Ana waits rotate fun facts (owner: reuse the story factoids)
**Why:** Multi-round questions on big datasets can take a minute+; the owner asked for the Data Story building screen's factoid treatment so it "doesn't feel like an infinite wait". New WorkingFactoid in AskAnaPanel: lib/funFacts pool, first fact at 7s (quick answers never see it), 12s rotation with fade, muted styling below the one-at-a-time status line, cleared when answer text streams. Browser-verified on TEST.

**Layout tweak (owner)**: the fun fact is now the building screen's
centerpiece — clamp(22px,3.2vw,30px) bold, dead center of the viewport under
the "Did you know?" kicker — with the build status compacted into a strip at
the top. Verified visually.

**Consistency (owner)**: the building screen adopts Ask Ana's wait-state
rhythm exactly — first fact only after 7s (a fast build never flashes trivia),
then a new random fact every 12s with a soft fade. Both surfaces draw from the
same lib/funFacts pool.

**Pacing (owner: "12s seems long — industry standards?")**: rotation drops to
**8s** on BOTH fact surfaces (story build screen + Ask Ana wait-state). Basis:
adult non-fiction reading ~238wpm (Brysbaert 2019 meta-analysis), subtitle
standards 160–180wpm (7–9s for our longest facts), NN/g ~5–7s/frame for short
rotating text. 8s = one relaxed read + a beat; 7s first-fact delay unchanged.

## 2026-09-03 — Standing rule: American English for all LLM output (owner)
**Why:** British spellings were leaking into product text (funFacts shipped "centimetres"/"grey"). Enforced structurally, not per-prompt: AMERICAN_ENGLISH_RULE in lib/ai.ts is appended to every system prompt inside the central renderers (after cache breakpoints, so cached prefixes are unaffected); ask-ana's own Anthropic client includes it too. funFacts swept (16 Briticisms fixed). Rule recorded in CLAUDE.md content rules.

## 2026-09-03 — American English output-side backstop + muted story tone (owner)
**Why:** Owner found "penalised" in the EA story's AI prose — the prompt rule asks, it doesn't guarantee ("not just prompts"). New lib/americanize.ts: explicit-pair British→American converter (no suffix heuristics — franchise/hour/tour class stays safe), applied to the story narrative at render; verbatim quotes and explorer excerpts pass through untouched (test-pinned). Same pass: story headline register muted to consultant-memo tone (owner: "not like a Fox News headline") in narrativePrompt.

**Spec sync (owner: "update spec and devlog and memory")**: FEATURES.md Data
Story entry brought current (findings-led sections incl. timeline/bands/
explorer, sql/198 short links with editable lifecycle, the building screen)
and ANALYTICS.md's building-screen paragraph corrected to the shipped
behavior (centerpiece fact, 7s delay, 8s rotation, pool shared with Ask Ana).

## 2026-09-03 — Story score drivers (logit) + what-if modeler; factoids at 3s (owner)
**Why:** Owner: the themes narrative restated the chart; the story should tie recommendation back to themes via the logit and add a scenario modeler — findings in PLAIN ENGLISH. buildDrivers reuses lib/statsUtils.logisticRegression (the Statistics driver engine): AMEs reported as "reviews that mention X are N points less likely to recommend, other themes held equal"; stats vocabulary banned on the page (test-pinned); suppressed on separation/non-convergence. Diverging driver bars + embedded what-if sliders (linear-in-AME, labeled directional). Verified live on EA: −25pts Technical driver, modeler math reconciles (30% × 25pts ≈ +7.4 shown), reset exact. Robustness found live: owner retyped "recommended" categorical→numeric in Schema and every score section silently vanished — rating pick now validates values not declared type, derivation is type-agnostic. Factoid first-appearance 7s→3s on both surfaces; narrative budget 1200→2000 (12-field JSON was truncating → full deterministic fallback shipped).

## 2026-09-03 — Story number credibility pass + navigation (owner, live-testing round)
**Why:** Owner caught three denominator/precision problems and a chart defect in one pass. (1) Percent-typed scores now render as whole percents everywhere ("17% vs 49% overall" — was "17.5 vs 49.49"); 1–5 scales get one decimal (fmtScoreValue; percent payloads rounded at build so AI prose inherits). (2) Modeler baseline (38%) vs overall (49%) now RECONCILED on-page: driver analysis runs on written reviews only, writers skew critical — stated under the modeler; sliders gained "today" tick marks. (3) Timeline trend figures were a third denominator (mean of monthly means) — now POOLED over the underlying rated rows so they bracket the overall figure; % axis + per-point-vs-pooled caption. (4) Drivers chart: dynamic zero axis (negative/positive ranges split the full plot width), value labels move INSIDE long bars — no more label overlap; −0 sign artifact fixed. Owner asked about tabs → recommendation: keep the narrative scroll, added a sticky section jump-nav (pills, smooth scroll) instead. All verified on a live EA generation.

## 2026-09-03 — Story: collapsible sections + score denominator ladder (owner round 2)
**Why:** Owner requests while live-testing. Sections now collapse on their headings (expanded by default so the narrative reads and prints whole; jump-nav re-expands its target). KPI tiles centered and extended into the denominator ladder: 49% recommend all responses → 38% written → 27% when the text carries a theme signal, + 2.9 signals per written response (69% carry ≥1) — the "which base is this rate on" question answered at the top of the page. Score values feed the narrative AI pre-formatted ("49%") so the % sign renders in headlines; drivers chart reserves flank headroom so outside value labels never bleed past the box.

## 2026-09-03 — Building screen centering, no-repeat factoids, one-line tiles (owner round 3)
**Why:** Owner live-testing. (1) Building screen's factoid sat low with dead space above — cause was quirks mode (document.write without DOCTYPE); now DOCTYPE + fact centered against the full viewport (fixed-inset grid), status strip absolute at top. (2) Same factoid could repeat within a session — rotation was random-with-replacement; both surfaces now walk a shuffled order sequentially (no repeat until the pool cycles). (3) KPI tiles forced to a single row (grid-auto-flow:column; 2-col fallback under 760px) with tightened captions — seven tiles fit one line.

## 2026-09-03 — Story PDF export + CI ratchet fix
**Why:** Owner: high-quality PDF from the story HTML, WITHOUT the what-if modeler/explorer/nav (interactive stays on the web). New GET /story/[slug]/pdf: same slug-capability checks as the viewer, storyPdfHtml (lib/dataStory) strips interactive sections + forces everything open, rendered via the shared chromium pipeline with Datanautix chrome; tracing entry added (mandatory per PDF route). Viewer injects a floating Download PDF button (print-hidden). Verified live: 12-page PDF, 0 interactive artifacts (pdftotext-checked), driver chart clean. Also: CI went red at 173/172 lint warnings — the new one was Math.random in DatasetHeader component scope (react-hooks purity); extracted sampleFunFacts to module scope, file 3→1 warnings, repo back under the ceiling. Ceiling NOT raised.

## 2026-09-03 — Complaint-signal tile: pinned definition (owner decision)
**Why:** The "with a theme signal" tile swung 27%↔37% on identical data because its definition floated with the theme model's polarity mix (local re-mine at 9:06pm ET dropped the positive theme; prod still has one — root-caused via TEST DB updated_at + the mine's own summary "the 350 reviews are overwhelmingly negative"). Now pinned: signal = matches a NEGATIVE/MIXED theme's keywords ("articulated a complaint the model recognizes"); positive-only models hide the tile. Facts renamed so the AI narrates it as a complaint signal; timeline facts carry the score metric name (one run had called % recommended "the average rating"). Test-pinned: positive-only model → null figures; only complaint matches count. Related bigger fix QUEUED: stratified mining sample + K-run consensus mining with stability metrics (the 350-sample negative skew is the underlying disease; this tile fix is symptom control).

## 2026-09-03 — Ask Ana composer + user bubble sizing (owner report)
**Why:** Owner: input font too big, user bubble too small. Composer font moved to globals.css (`.ask-ana-input`): 16px default (iOS floor — Safari auto-zooms below 16), 14px on fine-pointer (desktop). User bubble bumped to 15px / 10x16 padding — and the real "too small" cause fixed: the message column's `alignItems:flex-end` shrink-wrapped the row, so the bubble's `maxWidth:80%` resolved against its own content width and broke words mid-word ("conti/nue"); row now takes full width. Browser-verified on TEST EA Football (computed 14px, one-line bubble).

## 2026-09-03 — Dimensions tab hidden unless the dataset enables it (owner report)
**Why:** Owner: "if dimensions are not enabled the dimensions option on text mine should not be visible — but it is." Cause: TextMine/Charts/Stats pages passed `taxonomyEnabled = orgTaxonomyEnabled(org) || dataset.taxonomy_enabled`, so the org capability alone lit Dimensions UI on every dataset — including EA Football (upload, taxonomy_enabled=false, taxonomy_suppressed=true). Dropped the org leg on all three pages (sweep-the-class): visibility is now dataset flag OR unsuppressed google_reviews (that tab hosts the one-click Enable screen). Org capability still picks the full restaurant tier server-side in the classify route; Settings copy + TAXONOMY/ANALYTICS specs updated. Verified on TEST: EA Football tab gone, BFG_GuestLens (flag on) keeps it.

## 2026-09-03 — Stratified + consensus theme mining (owner-directed: "run several theme models until we get some form of validity")
**Why:** A single AI mine is one draw of a stochastic process — the 9/03 EA failure lost the positive theme on a corpus where ~half the reviews recommend the game. Now every AI mine = K=3 parallel mines on DISJOINT stratified samples (rating-bucket × time-quartile, proportional, deterministic; `lib/consensusMining`), themes matched across runs (strongest of keyword/description/name signals — max, not weighted average, after a measured average-dilution failure), only ≥2-run themes kept. Theme cards carry "✓ 2/3 runs" badges; model stores `consensus` + per-theme `stability`; summary states the validity claim. Three measured fixes during verification on TEST EA Football (6 generations): (1) route timeoutMs 60s→100s — at 60s exactly one of the three parallel calls timed out in 3 straight generations, silently shrinking consensus to 2 runs; (2) description-token similarity added after a 3/3-stable crash theme failed to re-match; (3) composition note now requires a theme for EACH side when both satisfied and dissatisfied voices appear — complaint-specificity bias otherwise drops the positive theme even from balanced stratified samples. Final gen: 3/3 runs, positive theme stable at 2/3. 17 unit tests; falls back to classic single mine for small corpora.

## 2026-09-03 — Real p25/p75 in the analytics snapshot (sql/199)
**Why:** The degenerate-percentiles bug banked on 9/02 (ea_football stored p25 = median = p75). Cause: `numeric_field_stats` only computed percentile_cont(0.5) and `computeAnalyticsSQL` copied median_val into both quartiles ("approximate"). sql/199 DROP+recreates the function with p25_val/p75_val from the same WITHIN GROUP pass (sql/190 REVOKE block re-applied; extra columns inert for the other named-field callers), and the TS reads them with a median fallback so pre-199 DBs keep old behavior (deploy-order safe). Applied to TEST + recomputed ea_football: hours_played now 6.4/18.9/56 (was median×3); grants verified anon=f/auth=f/service=t. ⏭ PROD APPLY PENDING (owner-run management API); stored prod snapshots stay degenerate until each dataset's next compute/sync. Snapshot regen rides the next `npm run migrate`. Note: `recommended`-style aliased numeric fields still hit the RPC's empty branch (0/0/0) — pre-existing, separate path (field_aliased_avg).

## 2026-09-03 — Data Story link management in the Share modal
**Why:** The last unbuilt Data Story piece (queued since sql/198): links could be minted but never managed. The Share Analytics modal now carries a "Data Story links" section (new `DataStoryLinks` component via a ShareModal `extra` slot — one optional prop, other share surfaces untouched): Copy, +7d (extends a live link's expiry; REVIVES an expired one from now), × revoke (row grays, public link 410s). Backing GET (list) + PATCH (revoke/extend, days clamped 1–90) on the existing story route; every `data_stories` query pairs dataset_id + org_id per the service-role invariant, pinned in 7 new integration tests (incl. cross-org 404s and the extend-from-now revival). Browser-verified on TEST EA Football: extend 7d→14d, revoke → "Revoked Sep 3" + live 410 "revoked by the publisher". Section hides itself on datasets with no stories and on a pre-198 DB.

## 2026-09-03 — Compare-periods control on the Time Series chart (owner ask, queued 9/02)
**Why:** Owner: "same quarter last year", "vs last month" had no user-facing UI. New `lib/periodCompare` (pure, 11 tests): observed buckets are gap-FILLED into a complete calendar sequence, then split — prev = equal halves of the span, yoy = trailing ≤1-year window vs the same calendar window a year back — so sparse data can't shift alignment; delta = count totals or count-weighted metric averages. TimeSeriesInner gains a Compare select (single-line mode; hour/year buckets and breakdowns excluded; smoothing suspended while comparing), overlay traces (current solid accent, prior dashed gray with true prior-bucket hover labels), a delta line (teal/rose per CVD rule), and an honest "not enough history" note. Browser-verified on TEST EA: yoy 6,721 vs 4,462 ▲50.6%, prev "4 quarters", metric mode 59.23 vs 67.61 avg ▼12.4%.

## 2026-09-03 — Context tab: Related concepts (owner ask, queued 9/02)
**Why:** Owner wanted related CONCEPTS, not just co-occurring words. New `lib/contextConcepts` (5 tests): maps the target term's comment subset onto themes (product matcher), dimensions (read from per-row `_tx` verdicts — never recomputed), and catalog entities; 3-comment floor, top 6 per kind, subset-only scans (the never-re-tokenize-the-corpus rule). ContextCloud leads with the concepts section and demotes the raw word cloud; chips are tooltip-explained and non-drilling so the chip==drill invariant can't break; the theme modal excludes its own theme. Browser-verified on TEST EA ("enjoy": 5 theme chips with counts + 6 entity mentions; dimensions correctly hidden under the floor).

## 2026-09-03 — Help KB: Dimensions article updated + TEST re-seed (Sherpa gap)
**Why:** Banked 8/16 QC gap: Sherpa claimed Dimensions have "no toggle" (deployed KB predated the article). The dimensions-and-emotion article's "If you don't see a Dimensions section" now matches TODAY'S gating (section appears only when the dataset enables Dimensions: Google-reviews always eligible · Schema-tab Apply Dimensions toggle · automatic at AI mining time); Americanized 'organisation' across 3 KB articles per the 9/03 standing rule. Re-seeded TEST (22 articles → 106 chunks; verified 'Enable Dimensions' ×2 + mining-time chunk present, 0 British spellings). ⏭ PROD RE-SEED rides the next deploy (`node --conditions=react-server --import tsx scripts/seed-help-agent.mts --prod`) — the article describes the new gate, so seed prod only after the code ships.

## 2026-09-03 — Charts audit fix set (owner: "take a critical look at every single chart type")
**Why:** Full audit of the 13 chart types (registered in docs/AUDITS.md) found five ways charts could misrepresent data; owner green-lit the fix set. (1) Treemap/Bubbles/Waterfall/Funnel sliced top-N AFTER smartOrder — alphabetical for nominal fields — silently dropping the LARGEST categories while the badge said "top N of M"; new shared `topCategoryKeys` picks the subset by count first, display order applies to the subset, and the Average/stacked bars + crosstab (whose rows path was unbounded) now subset by size and disclose the clip. (2) Funnel is always count-desc — Smart Axes used to reorder stages into mid-bulging shapes. (3) Three theme matchers (enrichRows substring, Score Driver's private regex, server SQL) gave three counts for one theme — both client paths now use canonical `themeUtils.buildKwRegex`. (4) The no-histogram Distribution fallback fed [min,avg,median,max] to Plotly AS DATA and let it invent quartiles — now a real box from rows; `__mapped_*` Likert twins get a discrete histogram + real p25/p75. (5) Gauge bands claimed "Bottom 25%/Middle 50%/Top 25%" but were fixed range-quarters — boundaries now sit at real quartiles (sql/199 p25/p75, tax q1/q3, or computed from rows) with the honest "Low/Mid/High range" fallback labels; Gantt's Range slot is numeric-only (dates rendered a silent blank) with palette colors and an empty-state message. Browser-verified on TEST EA Football across bar/funnel/treemap/gauge/distribution/gantt/driver/stacked; 13 chart unit tests incl. a Plotly-mock proof the fallback box gets raw values. Deferred (scoped, in project_charts_audit memory): saved-chart display options, time-series zero-fill, scatter overplotting, module split.

## 2026-09-04 — Comments unification: rich-panel features ported to the server-filtered panel (owner go)
**Why:** The queued "CommentsPanel merge" (flagged ask-first; owner said go). FilteredCommentsPanel — the server-mode panel behind any entity/dimension facet — lacked the rich panel's two signature features. Ported: (1) per-theme colored keyword highlights (`kwPalettes` keyword→palette map threaded from TextMineModule's selectedThemes×themeColors; singular/plural fallback so "bugs"→"bug" keeps its theme color; entity terms + dim evidence stay amber); (2) AI Summary header button — platform-key era, no BYO gate, samples ≤60 filtered rows through the mine-themes summary field, dismissible strip named by the active filters. 2 new highlight tests. Browser-verified on TEST EA (Technical Instability + Disappointment, 118 comments: orange underlined theme keywords vs amber evidence; summary generated and coherent). Full retirement of the themes-only CommentsPanel deferred — data-path flip (client rows → server fetch), separate decision.

## 2026-09-03 — Charts "Compute analytics" recovery CTA + last substring matcher (ANES follow-up)
**Why:** Owner couldn't plot themes on the prod ANES dataset (125K rows, script-uploaded 8/26). Root cause: the analytics compute only fires from the Analyze-button/wizard/append flows, so a scripted upload never got one — the blob held only TextMine caches, `hasData` was false, and EVERY chart dead-ended at "No data loaded." with themes/schema sitting right there in the sidebar. Charts now tells "never computed" (no totalRows AND no fieldSummaries) apart from "computed and empty" and renders a ComputePrompt — cause named, one Compute analytics button → normal compute route → reload. Verified the full click path on TEST EA by degrading its blob to the ANES shape: prompt → click → blob restored (totalRows 12,174, fieldSummaries back, signal_stats/theme_counts/taxonomy survived the merge). Regression test extended to pin the CTA. Same pass: StatsModule's theme enrichment still had a private `text.includes(kw)` matcher — the last copy yesterday's unification missed (sweep-the-class miss, swept repo-wide this time; remaining `includes(` hits are different classes) — now precompiled canonical buildKwRegex. ANES itself: one-off `scripts/_compute_anes.mts` (untracked) ready for owner-run — the classifier blocks the agent from executing prod-mutating scripts.

## 2026-09-04 — Data Story follows the UI's verbatim selection (owner report)
**Why:** Owner: "shouldn't the story be focused on the verbatim we have selected in the UI?" It wasn't — the route used the stored top-level theme model's field binding (the last selection persisted), which lags the on-screen toggle. Now the header reads TextMine's session selection and POSTs `{fields}`; the route resolves that selection's own theme set (`themeSetForField`) and 400s honestly for a never-mined selection. Bodyless callers keep the old behavior. 2 route tests; browser-verified on TEST Carrabba's GSS: with **Liked Most** selected, the built story (/story/bPfcxpwDvJH3) carries all three Liked-Most themes and none of the Liked-Least set.

## 2026-09-04 — Ask Ana: self-composed subgroups + verbatim-column awareness fix (owner report)
**Why:** Owner hit two gaps. (1) "What issues do young black men identify" — Ana had NO way to scope a query or read to age ∧ race ∧ gender herself (crosstab is 2 fields; set_view needs user approval). New `lib/anaSegment` (10 tests): `where` on query_data + read_comments resolves to row ids server-side with applyFilters-identical semantics (blanks excluded), INTERSECTED with active filters; cat conditions via id-only jsonb containment (both string/numeric storage), ranges Node-filter the narrowed set; per-turn memo; prompt teaches field_counts-first for exact values; scoped results carry "subgroup … (N rows) — always report". (2) Verbatim-column blindness root-caused: TextMine dispatches dataset-active-field-changed on ITS mount, before the panel exists — listener missed it; panel now recovers the selection from textMine_<id> session state on mount. CONFIRMED intact: filters DO hold (rowIds scope query_data + read_comments samples; find_quotes labeled). Live-verified TEST Carrabba's: "dissatisfied dine-in guests" → Ana composed satisfaction ∈ [Somewhat/Highly Dissatisfied] (4,167 rows), stated the base, quotes from the subgroup. Suite 2,121 green.

## 2026-09-04 — Ask Ana subgroup values match fuzzily, with the mapping in the provenance (owner asks ×2)
**Why:** Owner: "African American should match Black", and "provenance shows what mapping logic she used." Split by what each layer can know: LEXICAL matching is deterministic in `lib/anaSegment` (requested values resolve against the field's actual stored values — exact → case-insensitive → normalized substring either way, so "black" finds "Black or African American"); SEMANTIC bridging stays with Ana — a zero-overlap value errors WITH the field's actual values listed, and her corrected retry is a logged tool step. Every lexical mapping is recorded (`mappings`) and written into the result's scope note ("value mapping: …" + surface-to-user instruction) which the logic trail captures; the subgroup label reports the stored values that actually ran. Tool descriptions + prompt updated. 13 anaSegment tests (was 10).

## 2026-09-04 — Sentry digest triage: entity-count timeout fallback + classify batch-halving (owner forwarded digest)
**Why:** 9/3 digest, 11 unresolved. Diagnosed via /admin/sentry + Vercel runtime logs (Sentry creds are Vercel-only; `vercel env pull` redacts them as [SENSITIVE]). (1) **FIXED — entityFilter 57014 ×23 + refusing-to-persist-zeros ×3:** the exact `count_entity_terms` path can blow the statement budget UNDER the 50K cap (many terms × slow fields); a failure now falls back to the keyset-paged sampled twins — but an all-zero fallback still refuses to persist (indistinguishable from a scan that never ran; the existing guard tests caught exactly that hole in the first draft). 6 tests. (2) **HARDENED — taxonomy classify 500 ×2 (root-caused to ANES 125K, 1 AM ET, log-confirmed):** apply_taxonomy_verdicts retried timeouts at the SAME 500-row batch size — the same statement dies the same way; a 57014 now halves the batch and recurses (idempotent upsert). Cause-in-route not provable without prod profiling — this removes the sharpest edge. (3) **NO ACTION:** story MIME (1 ev, 14h) predates the deployed 9/2 hotfix — resolve in Sentry; org-snapshot hop failures stopped 2d ago, this morning's run 200 — monitor (per-org detail is IN the Sentry event context); the 6-19d-old signal-stats/rows timeouts have no recent events — resolve-and-watch. Stale memory corrected: the classify id-keyset HAS been indexed since sql/165.

## 2026-09-03 — Compute uses the 50K sampled twins above the cap; RPC errors fail loudly (ANES numeric zeros)
**Why:** After the owner ran the ANES compute (125,897 rows), themes/categoricals populated but ALL 25 numeric fields stored nonNull=0. Measured cause (not guessed): `numeric_field_stats` on that dataset returns "canceling statement due to statement timeout", and computeAnalyticsSQL's `!nr.n` branch silently persisted a fake all-zero summary — a poisoned snapshot that looks computed. Two fixes: (1) above AGG_SAMPLE_CAP the compute now routes through the deterministic sampled block twins with scaling — identical doctrine to /aggregate and the Charts "≈ 50,000-row sample" banner; sampledNumericFieldStats gained real percentile_cont p25/p75 so sql/199 quartiles survive the sampled path. (2) On the exact path an RPC error now THROWS (compute 500s honestly) instead of writing zeros. 3 new unit tests (sampled routing + scaling ×25000, quartiles, throw-on-timeout). ⏭ Owner re-runs `node --conditions=react-server --import tsx scripts/_compute_anes.ts` once to heal the ANES numerics (script imports the fixed lib).

## 2026-09-04 — Collections: adding a member "silently failed" in the admin all-orgs view (owner report, local)
**Why:** Owner: add-member works on prod, not local. Root cause reproduced: on local the owner browses the all-orgs platform-admin view, so ManageMembersModal offered OTHER orgs' datasets as candidates for a collection; the members POST correctly 400s on the same-org tenancy rule — but the error rendered at the TAIL of the scrollable dataset list, below the fold on 50+ rows, so the reject looked like a silent no-op. Fixes: (1) AnalyzeClient carries the collection's org into the modal and filters candidates to SAME-ORG datasets (the tenancy rule stays; the UI can no longer offer a doomed add); (2) the error moved to the always-visible footer in ManageMembersModal AND NewCollectionModal (same buried pattern, swept). Browser-verified on TEST: demo-org collection now lists only demo-org candidates; same-org add (Darden Fine Brands + MVP+) landed in collection_members + row_count, then restored.

## 2026-09-04 — Data Story for collections + PDF format globally (owner ask with screenshot)
**Why:** Collections' Reports menu had no story, and the story's PDF wasn't offered as a format. (1) Catalog: data-story now in the collection branch (AI-gated) and formats html+pdf everywhere — the pdf chip opens the short link's /pdf sibling (token-fallback links open the HTML viewer, which has its own Download PDF). (2) Route: a collection fans out to members (proportional 50K-cap split), tags rows with an injected `__member__` categorical, and `preferSegmentField` makes the members the story's segments; `segmentFieldLabel` now uses the schema LABEL (raw-key headings impossible). (3) Launch flow extracted to `lib/storyLaunch` (second occurrence: header + collection card; card gained the data-story branch it lacked). Verified on TEST Darden Fine Brands: story built with a findings-led cross-member head ("Capital Grille guests mention Return Intent & Loyalty at 30%, three points above Ruth's…"), no raw-key leak, /pdf returns application/pdf, card menu shows Data Story · HTML · PDF. Tests: catalog 15, dataStory 27, story routes 15 — suite 2,128 green.

## 2026-09-04 — Signals defined: themes-per-comment, a signal ratio, and the coverage trio
**Why:** owner asked why some datasets show no signals. Investigation found the concept had drifted: "signals" was dropped from the metric strip on 2026-07-14 (`273bf61d`, the two-count model) and from the listing cards (`f38623a2`), so it survived only in PPTX exports — and the two implementations disagreed on the unit. `themeUtils.snippetCount` counted KEYWORD OCCURRENCES; `signalStats.signals` summed per-theme ROW matches. Owner settled it: **a signal is one theme carried by one comment, and the signal ratio is total signals / total comments.**

**Definitions.** Signals = Σ per-theme comment counts (a 3-theme comment contributes 3). Ratio = signals / substantive comments. Coverage trio = total rows → carry a comment → substantive. Substantive deliberately KEEPS the existing text rule (`isSubstantiveText`) rather than becoming "has ≥1 signal" — the owner chose this after seeing that gating it on theme matching collapses Theme fit to 100% by construction and moves every substantive denominator a second time (they already moved on 8/18).

**The load-bearing change:** signals are now counted on the **substantive base** (`p_substantive_only`, the flag `theme-counts` already sets) instead of over all non-empty rows. The theme cards display those per-theme counts, so a total counted on a different base would be a second denominator for the same data. No extra RPC — the existing per-theme call gains the flag; the sampled path forwards `perThemeSubstantive`, which the RPC already returned in the same pass and `signalStats` was throwing away.

**Found while testing:** `sampled_signal_counts_blocks` marks `theme_counts_substantive` optional (deploy-order safety), and a DB without it accumulated silently to all-zero — which would now publish "0 signals" on a dataset that plainly has them. Added `substantiveAvailable` so the caller falls back to the ungated count instead of an unmeasured zero. Same class as the 8/13 strip guard, so the strip also suppresses the entire signals span when `substantive` is unstamped rather than printing `0 signals · 0.00 per comment`.

**Surfaces.** Strip: `9,482 comments · 80% of 19,133 wrote, 62% substantive · 13,583 signals · 1.43 per comment · Theme fit Tight 87%`. Data Story: trio tiles + a signals total, each share naming its base (`82% of the 1,000 analyzed`) so a sampled story can't be read against the full row count; its `signalsPerComment` was dividing snippets and now divides signals. Listing cards: added the comment share % (free from cached analytics) but **deliberately not** signals/substantive — those need the 1-4s-cold compute that `f38623a2` removed, which on a listing is one cold compute per card and has already hit the statement timeout in prod on one 27K dataset. `STATS_MODEL_VERSION` 3→4 so v3 entries recompute once.

**Verified** (browser + two harnesses vs TEST, not just tsc): strip rendered on Carabbas GSS and matches the harness row-for-row. `_verify_signal_ratio` — 32 datasets, ladder monotonic and ratio exact, 0 failures. `_verify_signal_reconcile` — strip total == sum of the per-theme counts the cards show, 12 datasets **including 4 brand collections** (the first run "failed" 4 of them because the harness queried the collection's own id, which holds no rows — harness bug, fixed with the member fan-out the route does). Tests: signalStats 15, strip 10, suite green.
