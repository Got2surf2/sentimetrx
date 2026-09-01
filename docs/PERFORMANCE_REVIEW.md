# PERFORMANCE_REVIEW.md — Architectural Performance Review (2026-07-13)

Owner-mandated review: **where does the platform break at multi-million total
rows, single datasets of 1M+ rows, many simultaneous users, and QR-code-on-TV
survey bursts?** Companion to `docs/CAPACITY.md` (provider envelope, k6
baselines, 2026-07-04) — this doc is the scored bottleneck map and the
decisions it implies. Seed evidence: the 2026-07-13 production slowness
incident (785K scale-test dataset → 84.6% cache hit → platform-wide crawl),
whose findings this review verifies and generalizes rather than re-derives.

**Method.** Read-only production measurements (2026-07-13); a ~1.03M-row
dataset seeded on the TEST project (`[PERF TEST] Outback x8`, id
`d1000000-0000-4000-8000-000000001000`) with every dataset surface's DB path
timed over PostgREST — the real app path, honoring the 8s statement timeout
and 1000-row REST caps; a code audit of all 41 dataset routes + collection
paths classifying each as O(1) stored / O(50K sample) / O(N) full-scan.
k6 burst numbers cite CAPACITY.md §3 (2026-07-04) — the submit path is
unchanged since that baseline, so it was not re-run.

---

## 0. Executive summary — the bottleneck map

Ranked by which wall arrives first. "Breaks at" is the estimate for current
prod compute (Supabase **Micro**, 1 GB RAM) unless stated.

| # | Bottleneck | Surface | Breaks at | Fix | Cost |
|---|---|---|---|---|---|
| 1 | **DB working set vs 1 GB RAM** — data outgrowing cache turns EVERY query disk-bound; Micro's 11 MB/s baseline I/O + daily burst budget is the amplifier (proven 2026-07-13) | platform-wide | ~500K–1M total rows of *hot* data (~2–4 GB relation) | **Compute tier bump** — see §1 recommendation | $15–110/mo |
| 2 | **`/aggregate` route: every Charts/Stats server op is an O(N) scan** (crosstab, group stats, date series, taxonomy_*) — no sampling | Charts + Statistics tabs | ~300–600K rows/dataset (8s statement timeout) | Sampled variants over `idx_drf_sample` (sql/162/163 pattern) | ~1–2 sessions |
| 3 | **`filter-options` route: serial per-field full scans** (non-empty count, distinct values, exact numeric stats, date min/max full sorts ×2) | Filters modal (pre-load) | ~300–600K rows/dataset; wide schemas multiply | Same sampling treatment + expression indexes for date min/max; fold into the owner-reported exact-values fix | ~1 session |
| 4 | **`entities` GET: live FTS counts for ~300 terms over all rows** ("not a sample" by design) | Entities panel | risk from ~500K rows/dataset | Sampled counts or stored counts refreshed at classify time | ~1 session |
| 5 | **Org-snapshot cron: single-org dump > 240s has no intra-org continuation** (hit 2026-07-13 at 785K rows) | nightly backup | one org holding ~1M+ rows | Incremental/per-table manifests (named in BACKUPS.md) | ~1–2 sessions |
| 6 | **`study_response_stats` MV refresh scans ALL responses platform-wide**, debounced to 1/30s during submit bursts | survey ingestion at scale | ~1M+ total responses (forward-looking: prod has 191 today) | Replace MV with per-study counter table (trigger or upsert) | ~1 session |
| 7 | **Venue-NAT rate limiting** — `respond: 120/min/IP` (~2 submits/s/venue-WiFi), `clarify: 10/min/IP` (follow-ups silently stop for the whole room) | QR-TV burst | one venue router funneling ≥ ~30 active respondents | Key by session_id + IP hybrid; raise clarify per-IP or key per session | hours |
| 8 | ~~**Ask Ana: filter-blind `ORDER BY random()` fetch**~~ **FIXED 2026-07-13** (sql/167 + loadAnaSample rework, same-day Fable session): filtered sampling over `idx_drf_sample`, exact denominators ≤50K / "~" estimates above, canonical filter semantics (also fixed the silent cat-exclude inversion + ignored daterange). 1M filtered ask: ~4s, was 57014 + error. Verified by `scripts/_verify_ana_filters.mts`. | Ask Ana | — | done | — |
| 9 | **Collection project-report: Node union up to 80K rows/member via deep OFFSET pages** | project report | 1M-row members | `pageSampledRows` (lib/bulkRowSample) like the bulk path | ~half session |
| 10 | **Client main-thread: 50K-row sample = ~35 MB JSON parse + ~6–8 O(N) memo passes per interaction** | TextMine/Stats/Charts in-browser | fine on desktop; tablets/phones strain | keep 50K cap; virtualize long lists as needed; hold the memoization rule (ANALYTICS.md) | doctrine, not a fix |

**Not bottlenecks** (verified): Vercel functions/concurrency, Anthropic Scale
tier, bulk-rows load (O(sample) by design — though heavy at 1M on Micro-class
cache, see §2 caveat), signal-stats
(cached + sampled), taxonomy classify (keyset-chunked), `/state` (2 keyed
reads), theme-counts base path (sampled), Charts CSV (bounded at the 50K
sample — but silently partial on bigger datasets; labeling nit, §2).

---

## 1. Whole-DB scale: multi-million total rows

**The 2026-07-13 incident, generalized.** At 3.56 GB of `dataset_rows_flat`
against 1 GB RAM (256 MB shared_buffers / 768 MB effective cache), cache hit
fell to 84.6% and *every* page's auth/org point-lookups paid disk I/O at
Micro's 11 MB/s baseline (the daily burst budget having been drained by an
index build + classify scans). Deleting the 785K scale-test rows restored
sub-ms queries. The mechanism is general:

- All-in cost is **~3.8 KB/row** (heap + indexes + toast + tsv, CAPACITY §1),
  so cache holds roughly **200K hot rows per GB of RAM**.
- Once the hot working set exceeds cache, it is not "the big dataset is slow"
  — it is **every tenant's auth lookup is slow**, because the pooled
  PostgREST backends (§3) queue behind disk-bound scans.

**Read-only prod snapshot (2026-07-13, this review):** DB file 3,129 MB;
`dataset_rows_flat` relation 3,029 MB (heap 2,257 MB) holding only ~274K live
rows (~1 GB of real data) — **~2 GB is post-delete bloat**. Plain VACUUM makes
the space reusable but never returns it; seq-scan-shaped work (backups, MV
refreshes, analyze) still reads the dead extent. Cumulative cache hit reads
69% but includes the incident window; see the delta sample in §6.

### Scale model and compute-tier recommendation

| Tier | RAM (≈cache) | Hot-row budget | Disk baseline | $/mo |
|---|---|---|---|---|
| Micro (today) | 1 GB | ~200K rows | 11 MB/s | in Pro |
| Small | 2 GB | ~400K | 11 MB/s | $15 |
| Medium | 4 GB | ~900K | 11 MB/s | $60 |
| **Large** | **8 GB dedicated** | **~2M** | **79 MB/s** | **$110** |
| XL | 16 GB | ~4M+ | 79+ MB/s | $210 |

(Ladder from CAPACITY §2, verified live 2026-07-04; resize ≈ 2 min downtime,
billed hourly, reversible.)

**Recommendation:**

1. **Now (free):** reclaim the ~2 GB bloat — `pg_repack` 1.5.2 is available
   on the instance (online, no long table lock; `VACUUM FULL` in a quiet
   window is the cruder alternative). This alone puts the live working set
   (~1 GB) back inside Micro's cache with margin, and shrinks nightly
   backup/MV scan cost.
2. **At the first real 500K+ dataset or ~1M total rows:** move to
   **Medium ($60/mo)**. Small ($15) only buys ~400K hot rows — it would be
   outgrown by the very scenario this review models.
3. **If 1M+-row datasets become a sold product scenario** (the owner's
   framing): **Large ($110/mo)** is the honest floor — 8 GB holds a ~2M-row
   working set, dedicated cores stop noisy-neighbor variance, and the 7×
   disk baseline (79 MB/s) makes even the cold-cache case tolerable
   (~3.8 GB dataset scan ≈ 50s at baseline vs ~6 min on Micro).
4. **Standing rule** (banked 7/11, holds): after any bulk load,
   `VACUUM ANALYZE` before judging performance; watch Dashboard → Database
   Health → Disk IO % on heavy days.

Disk-size footnote: Pro includes 8 GB database; ~2M rows ≈ 7.7 GB all-in.
Multi-M rows also means $0.125/GB/mo overage and longer PITR/backup windows —
budget line, not a wall.

### Platform-wide O(all-history) scans to retire

- **`study_response_stats` MV** (§0 #6): refresh is a full GROUP BY over
  `responses` platform-wide, triggered (debounced 30s) by survey submits.
  Today trivial (191 rows); at 1M+ accumulated responses each refresh is a
  multi-second scan re-run every 30s during bursts, competing for the same
  I/O budget that ingestion needs. Replace with a per-study stats table
  maintained by trigger/upsert before response volume becomes real.
- **Nightly org-snapshot** (§0 #5): continuation is *across orgs* only; the
  single-org dump has no cursor, so one org holding a 1M-row dataset
  overruns the 240s budget every night (observed 2026-07-13, 785K). Fix =
  intra-org continuation or incremental manifests (BACKUPS.md names this).
  > **STATUS: FIXED 2026-07-13 (fix-queue item 7, Fable)** — the dump is
  > deadline-aware and checkpoint-resumable (`partial.json` + multi-part
  > table objects + `&resume=<org>` continuation); BACKUPS.md
  > "Time-budgeted continuation" has the full mechanics.

## 2. Single datasets at 1M+ rows

Verdicts from the 41-route code audit, spot-verified by measurement on the
TEST ~1.03M-row dataset over PostgREST (8s statement timeout, identical to
prod; TEST is also Micro-class, so timings are prod-representative).
Headline measurement: **every exact/full-scan RPC hit the 8s statement
timeout (57014) at 1.03M rows — cold AND warm** — while every keyset,
sampled-page, and stored path stayed in the 0.1–0.7s range. The 8s timeout
is the cliff; ~300–600K rows is where full jsonb scans start crossing it
(the 7/11 measurements bracketed the low end).

**SAFE at 1M (verified):**

| Surface | Why | Measured at 1.03M |
|---|---|---|
| Bulk rows / TextMine load | `sample_dataset_rows` index-range-scans exactly the 50K sample (sql/160) — the *index* is flat; heap-fetch locality is not (see caveat below) | 50K in 10 pages: **56s cold / 44s warm; slowest page 6.4s / 5.1s** |
| signal-stats (strip) | cached in `dataset_state.analytics` keyed by theme-hash + row_count; recompute sampled (sql/162/166) | 5K page **4.8s cold / 3.0s warm** → full 50K recompute ~30–48s (then cached until row_count changes) |
| avg rating | sampled (sql/163) | 5K page **130 ms** |
| taxonomy GET | stored rollup; fallback guarded → degrades to empty | code-audit |
| taxonomy POST classify | 10K keyset chunks on `idx_drf_id_keyset` (sql/165), browser-looped | keyset page **83–103 ms** |
| stored row_count / exact count head | `datasets.row_count` (O(1)); count head is index-only | **0.3s / 0.2s** |
| /state | 2 keyed single-row reads | code-audit |
| theme-counts (base) | stored row totals + sampled pass | code-audit |
| theme-impact | hard 10K cap (first-N, biased but bounded) | code-audit |
| Charts CSV export | fetches `rows?all=true` → the 50K sample. **Nit: silently partial above the cap — label it** like the strip's "~" | code-audit |

**SAFE-but-heavy caveat (measured):** at 1.03M rows the 50K sample load
runs ~45–60s with individual 5K pages at 5–6.4s — *one bad I/O day from the
8s timeout*. The index range scan is O(sample), but the 50K heap fetches
scatter across a ~2.6 GB partition that no longer fits Micro-class cache.
Two levers if 1M datasets become real: drop the page size (5000 → 2500,
halves per-statement exposure at the cost of more round trips) and/or the
§1 compute bump (8 GB cache makes the fetches RAM-speed). Same math applies
to the sampled_signal_counts recompute (3–4.8s per 5K page at 1M).

**BREAKS at 1M (times out / unbounded):**

| Surface | Failing op | Measured at 1.03M | Fix |
|---|---|---|---|
| `/aggregate` (all Charts + Statistics server ops) | `crosstab_counts`, `group_numeric_stats`, `date_series_stats`, `count_field_values`, `numeric_field_stats`, `taxonomy_*` — all full jsonb scans | **57014 at 8s** (crosstab + group stats measured, cold and warm) | sampled variants over `idx_drf_sample`, exact below the cap (the proven sql/162 pattern); label "~" |
| `filter-options` | per-field serial: `count_nonempty_rows` + `count_field_values` + exact numeric + **two full sorts** on an unindexed jsonb date expression | **57014 at 8s** — all four op types measured, per field, so a wide schema fails serially for the whole 60s budget | one sampled multi-field pass; date min/max via expression index or stored analytics; merge with the owner-reported exact-values item |
| **Ask Ana** | `sample_row_pairs` = `ORDER BY random()` over the whole partition — full scan + sort just to pick ~600 rows | **57014 at 8.5s** → route returns "No rows found in dataset" | sample via `idx_drf_sample` (the sql/160 machinery already returns deterministic samples cheaply); see filter finding below |
| `entities` GET | `count_entity_terms`: live tsv FTS counts for up to ~300 terms over every row | code-audit (catalog empty on PERF TEST) | store counts at classify/refresh time, or sample |
| theme-counts w/ `cooccurrence`/`topical`/`dimensions` | those three RPCs full-scan | code-audit | sampled variants |
| collections project-report | Node union via OFFSET pages up to 80K rows/member | code-audit | `pageSampledRows` (lib/bulkRowSample), already used by the bulk path |
| org-snapshot (that org) | single-org dump > 240s | observed on prod 7/13 | §1 — **FIXED 7/13**: intra-org checkpoint resume (BACKUPS.md) |

**DEGRADES (bounded but slow/biased at 1M):** `comments` + `search` +
`rows-by-entity` (GIN-backed page fetches are fine; the exact match-count
over all FTS hits grows with data), `export/html` (30K cap via deep OFFSET),
`export/pptx` (50K rows via 50 OFFSET pages + the entities FTS count above).
Acceptable for now; note OFFSET-paging in export paths is the next candidate
for the keyset treatment if exports feel slow at scale.

### Ask Ana: filter compliance (owner question, 2026-07-13)

> **STATUS: all three findings below FIXED same day** — sql/167
> (`sampled_filtered_rows` + `ana_row_matches_filters`) + the
> `loadAnaSample` rework. The fix also surfaced and closed two bugs the
> review had missed: the Node filter treated cat **exclude-mode as
> include** (inverted results) and **ignored daterange filters** entirely.
> Verification: `scripts/_verify_ana_filters.mts` (6-shape JS↔SQL parity
> exact; 1M filtered ask ~4s; exact denominators ≤50K) +
> `tests/unit/anaFilteredSample.test.ts`. Kept below as the record of what
> was wrong.

**Does Ask Ana comply with active filters rather than sampling the full
dataset? Partially — filters are honored, but applied too late in the
pipeline.** Verified in `lib/anaReportContext.ts` (`loadAnaSample`, the
shared ask-ana/report pipeline):

1. **Filters ARE applied** — the panel passes the active `SerializedFilters`,
   the route filters every fetched row against them (cat + range, blanks
   semantics matching the Filters modal) before anything reaches the model,
   and the prompt tells Ana filters are active. No filter is ignored.
2. **But the fetch is filter-blind.** The pipeline fetches a bounded budget
   first — 3× the sample size, so ~600 rows for the default 200 (2,000 max) —
   *then* filters in Node. On a selective filter the sample starves: a 5%
   segment of a 56K dataset yields ~30 analyzed rows; a narrow-enough filter
   yields zero and the route errors "No rows found in dataset" even though
   thousands of matching rows exist. The model's context note ("you are
   seeing N of M total rows") reports survivors-of-the-600 as if it were the
   dataset-wide filtered count — a denominator-credibility violation.
3. **And at ~1M rows the fetch itself breaks** (the `ORDER BY random()`
   timeout above) regardless of filters.

**Fix (one change retires all three):** push the serialized filters into a
sampled SQL fetch — either a filtered variant of the sql/160 sample (keyset
over `idx_drf_sample` with cat/range predicates compiled to jsonb conditions)
or reuse of the `get_rows_by_filters` machinery the comments route already
has — and return the true filtered count for the prompt note.

**The compounding rule:** none of the BREAKS items fail gracefully into the
platform staying healthy — each is a multi-GB scan that (a) 57014s after 8s
*and* (b) evicts the shared cache while trying (§1). Fixing them is not just
per-surface UX; it protects every other tenant.

## 3. Many simultaneous users

The app's only DB path is PostgREST over HTTP (no direct pg connections in
app code — verified). That makes the **PostgREST backend pool, not the
Supavisor 200-client ceiling, the real concurrency choke** on Micro: ~5
pooled backends observed at idle. Every authed API call spends ~3 point
round-trips before real work (auth server + users→organizations join +
resource org check).

- **Healthy cache:** point lookups are sub-ms; ~5 backends × ms-scale
  queries ≈ thousands of queries/s — dozens of concurrent admin users are
  nowhere near the wall. Survey/agent load adds brief holds (§4). Fine.
- **Unhealthy cache or an 8s scan in flight:** the pool queues behind
  disk-bound statements and *everyone* feels it — this, not connection
  exhaustion, is the observed failure mode (7/13). The fix is §1 + §2, not
  connection tuning.
- The CAPACITY ~200-participant PulseIQ ceiling still stands as the
  burst-hold model; its documented mitigation (pre-event compute bump)
  doubles as the pool fix, since bigger tiers get bigger PostgREST pools.
- `/admin/health` SSR still blocks first byte on live vendor probes
  (seconds by design; worse when throttled) — known, deliberate; stream or
  defer if it starts masking real checks.

## 4. QR-code-on-TV survey burst

Scenario: hundreds of respondents scanning within a minute or two.
Per-respondent cost (measured path):

- **Page load** `/s/[guid]`: force-dynamic SSR, ~3–5 point lookups — and
  `findStudy` runs **twice** (page + generateMetadata, no `React.cache()`
  dedup). Cheap fix, halves burst read load.
- **Per question:** one debounced partial save (2s) → `/api/respond` ≈ 4–6
  brief pooled round trips (rate-limit RPC, study lookup, session lookup,
  upsert, MV-debounce RPC).
- **Open-ended answers:** `/api/clarify` = 1 rate-limit RPC + study lookup +
  one fast-tier AI call (≤80 tokens out).

At **500 joins/min** (aggressive for one TV): ~8 page views/s ≈ 30–40 point
lookups/s + ~10–20 respond calls/s ≈ 60–120 brief statements/s. Within the
pool's envelope **provided the cache is healthy** — burst capacity is
downstream of §1, not a separate wall. The k6 baseline (25 concurrent
sustained, p95 748 ms, 0 failures — CAPACITY §3) supports this; the submit
path is unchanged since.

What actually breaks first in the room:

1. **Venue NAT vs per-IP keys.** Cellular scanners each carry their own IP —
   fine. But a venue-WiFi crowd shares one NAT IP: `respond:` at 120/min
   caps the *room* at ~2 saves/s (~1 question-advance/s across everyone),
   and `clarify:` at 10/min means **follow-up probes silently stop for
   everyone on the WiFi** — the survey completes but the room's data is
   shallower, invisibly. Fix: include `session_id` in the respond/clarify
   keys (keep a higher per-IP backstop against abuse), e.g.
   `respond:<ip>:<session_id>` at ~20/min + `respond-ip:<ip>` at ~600/min.
2. **MV refresh under fire** (§1): every 30s during the burst, a
   platform-wide `responses` scan competes with ingestion. Trivial today,
   the counter-table fix retires it.
3. **Device-limit checks** on final submit add 1–2 indexed reads keyed by
   `(study_id, ip_hash)` — at high volume ensure the index exists before a
   flagship event (same pre-event checklist as the compute bump).

**Pre-event checklist (an hour of ops, not an architecture change):** bump
compute for the day (CAPACITY §3's PulseIQ mitigation, applies here too),
confirm rate-limit keying fix is deployed if venue WiFi is expected, avoid
scheduling imports/classifies that day (I/O budget), watch Disk IO %.

## 5. Client main-thread (the browser is a tier too)

- The 50K sample ships ~35 MB of JSON (extrapolated from 27K → 18.5 MB
  measured; 14K → 11 MB measured 7/13) and parses in roughly 0.5–1s on
  desktop, holding a few hundred MB of heap. Admin-only surface: acceptable
  on desktop, strained on tablets. The cap is the protection — hold it.
- Each filter/pill interaction runs ~6–8 memoized O(N) passes over up to
  50K rows in TextMine (recount, entities, substantive-count, etc.) —
  tens of ms each on desktop; acceptable.
- The proven failure class is **unmemoized identity in render-path deps**
  (Statistics-tab infinite loop, fixed 7/13 + caught by e2e; classify-loop
  nav-stomp, fixed 7/13). The rule is banked in ANALYTICS.md: render-path
  `themeSetForField()` (and anything returning fresh objects) MUST memoize.
  The remaining ~269 `react-hooks/*` lint warnings ride the ratchet —
  behavior-sensitive, fix per-file with browser verification, never bulk.

## 6. Delta cache-hit sample (current state, post-785K-delete)

Two samples of `pg_statio_user_tables` heap counters 25 minutes apart
(2026-07-13 ~12:17→12:42 EDT): hit 47,382,673 / read 21,272,922 — **frozen,
zero heap activity in the window** (prod idle at sampling time), so no live
delta was observable. The cumulative 69% figure includes the whole incident
window and should not be read as current health; sub-ms auth/org queries
were verified immediately after the 785K delete (7/13 05:30Z). Re-sample the
delta during an active usage day; healthy is ≥99%.

---

## 7. Implementation briefs (for the non-Fable sessions)

Owner decision 2026-07-13: items #2 (Ask Ana) and #7 (org-snapshot cursor)
in the fix queue run on Fable; **everything below runs on Opus**. These
briefs are written so an Opus session can execute without re-deriving the
review. Rules that apply to EVERY brief:

- **Verification bar:** before committing, compare the new sampled/stored
  path against the exact path on a mid-size TEST dataset (Carrabba's 56K
  `e0b67281-…` or Outback 128K `a1b2c3d4-…-000200`) — results within
  sampling tolerance (±2% on proportions) — AND run the path against the 1M
  `[PERF TEST]` dataset (`d1000000-…-001000`) to confirm no 57014. The
  harness pattern is `scripts/_perf_measure_1m.ts` (untracked, KEEP).
- **Deploy-order safety:** new/changed RPC signatures must not break the
  deployed app. Pattern (used by sql/164/166): route tries the new RPC args,
  catches `PGRST202`, falls back to legacy behavior. Apply new SQL to TEST
  (`psql "$TEST_DB_URL" -f sql/NNN_x.sql`); prod migrate (`npm run migrate
  sql/NNN_x.sql`) happens at push time — record it in the queue memory's
  push recipe. NEVER apply to prod without the owner's push/migrate word.
- **Sampling doctrine (D6):** exact at/below 50K rows; deterministic sample
  (`idx_drf_sample` order) above. Every sampled number shown to a user gets
  the "~" treatment like the metric strip. One denominator per surface.
- Same-commit spec/devlog updates; lint ratchet (never a new `any`); local
  commits only — no push without the owner's explicit word.

### Brief A — pg_repack bloat reclaim (any tier; OWNER-GATED prod op)

Goal: return the ~2 GB dead extent in `dataset_rows_flat` (heap 2,257 MB for
~274K live rows) to the OS. Steps: (1) quiet window (owner confirms; avoid
cron windows — nightly backup 04:00Z); (2) `CREATE EXTENSION pg_repack;` via
`supabase db query --linked`; (3) run the pg_repack CLI (client version must
match server extension 1.5.2) with the direct (non-pooler) connection string
against `-t dataset_rows_flat`, `--no-superuser-check`; (4) verify:
`pg_total_relation_size` before/after (expect ~3,029 MB → ~1.1 GB), row count
unchanged, `\di+` index sizes shrunk; (5) log the result in the queue memory
+ devlog. If the CLI route fails on Supabase's permission model, fallback is
`VACUUM FULL dataset_rows_flat` in an owner-approved downtime window
(~minutes of table lock at current size). No code, no push.

### Brief B — `filter-options` + Filters value lists (fix queue #3)

Two halves, one commit:

1. **Server** (`app/api/datasets/[datasetId]/filter-options/route.ts`):
   today it loops fields serially calling `count_nonempty_rows`,
   `count_field_values`, `numeric_field_stats`, and two PostgREST
   `.order('data->>field')` date probes — every one 57014s at 1M (§2).
   Replace with ONE new RPC `sampled_filter_options(p_dataset_id, p_fields
   jsonb, p_after_hash, p_after_id, p_limit)` that keyset-pages the
   deterministic sample once (sql/162's exact shape — copy its `AS
   MATERIALIZED` gotcha) and per page accumulates, per field: non-empty
   count, distinct values w/ counts (cap 500/field), numeric min/max, date
   (text) min/max. Below the 50K cap the loop naturally scans all rows =
   exact; above, label blanks/counts "~" in the response and let the modal
   show the sampled marker. Keep the legacy per-field path as the PGRST202
   fallback.
2. **Client value lists** (`components/analyze/FiltersModal.tsx:209`): value
   lists fall back to `new Set(rows.map(...))` over the loaded 50K sample —
   this is the owner-reported "missing location values" bug (rare values
   absent from the sample). Fix: for `categorical` fields, prefer the
   server route's `values` (now sampled-but-500-deep, or exact ≤50K) over
   sample-derived; if a field's distinct count hits the 500 cap, surface
   "some rare values may be missing — search to add" instead of silently
   truncating. Do NOT try to return unbounded exact distincts at 1M — a
   full GROUP BY is the thing we're removing.

Verify: modal opens on the 1M dataset without error; on 56K, new values
match the old route exactly; the specific repro = a high-cardinality
location field where a rare value was previously missing. Specs:
ANALYTICS.md (Filters section) + DATABASE.md (new RPC).

### Brief C — `/aggregate` sampled variants (fix queue #4)

`app/api/datasets/[datasetId]/aggregate/route.ts` — every op RPC is a full
scan (its own header says so): `crosstab_counts`, `group_numeric_stats`,
`date_series_stats`, `count_field_values`, `numeric_field_stats`, and the
`taxonomy_*` family. All 57014 at 1M (crosstab + group_numeric measured).

- For each RPC add a `sampled_*` twin: same output shape + `n_scanned` +
  keyset cursor over `idx_drf_sample` (template: sql/162/163/166 — page
  loop lives in a lib helper mirroring `lib/sampledSignalCounts.ts`).
- Route logic: dataset (or collection member) `row_count` ≤ 50K → exact RPC
  unchanged; above → sampled twin, scale counts by `total/scanned`, pass
  `sampled: true` through the aggregation response.
- **UI labeling:** `useAggregation` / ChartsModule / StatsModule surface the
  "~" marker exactly like the metric strip (one shared affordance, not six
  bespoke ones). Statistical caveats: means/proportions scale cleanly;
  medians/stddev report the sample statistic unscaled (they estimate the
  population value directly) — do NOT multiply them.
- taxonomy_* RPCs scan `data->'_tx'`: same keyset treatment, but respect
  `taxonomy_field_or_primary` resolution (sql/164) — don't regress the
  per-question dimension work.
- Do the RPCs in two commits if needed (counts family, then taxonomy
  family) — each verified sampled-vs-exact on 56K/128K per the global bar,
  plus no-57014 on the 1M dataset. Specs: ANALYTICS.md §charts/stats,
  DATABASE.md, TAXONOMY.md if taxonomy_* signatures change.

### Brief D — QR-burst hardening (fix queue #5)

1. `app/api/respond/route.ts:26`: key `'respond:' + ip` (120/min) →
   two-tier: `'respond:' + ip + ':' + (session_id || 'anon')` at 20/min
   PLUS backstop `'respond-ip:' + ip` at 600/min (abuse ceiling). Note
   session_id arrives in the body — parse before the rate check; reject
   bodies > ~100 KB first.
2. `app/api/clarify/route.ts:33`: same split — per-session 6/min +
   per-IP backstop 120/min (a room of 20 on venue WiFi currently exhausts
   10/min instantly and follow-ups silently die).
3. `app/s/[guid]/page.tsx`: wrap `findStudy` in `React.cache()` so page +
   `generateMetadata` share one lookup per request.
4. Tests: unit tests for the new keying (two sessions same IP not
   cross-throttled; per-IP backstop still fires); existing respond tests
   keep passing. Load-check with `tests/loadtest/survey-submit.k6.js`
   against local dev if convenient, else rely on unit tests — the path is
   otherwise unchanged. Specs: SURVEYS.md (rate-limit section), CAPACITY.md
   §3 interpretation note.

### Brief E — long-tail O(N) retirements (fix queue #6)

Order within this brief: (1) **entities GET**
(`app/api/datasets/[datasetId]/entities/route.ts` → `count_entity_terms`
live FTS over all rows for ~300 terms): store per-entity counts on the
catalog row at discovery/classify/refresh time (they already rebuild
then), serve stored counts, background-refresh on sync like signal-stats'
row_count keying. (2) **theme-counts extras**
(`cooccurrence`/`topical`/`dimensions` RPC full scans): sampled twins per
Brief C's template. (3) **project-report Node union**
(`lib/projectReportLoad.ts` `readMemberRows`, OFFSET pages ×80K/member):
swap to `allocateSampleShares` + `pageSampledRows` from
`lib/bulkRowSample.ts` (the bulk-rows collection path already does this —
mirror it). (4) **`study_response_stats` MV** (`sql/phase4_flat_rows.sql`):
new migration creating `study_response_stats_live` table + `AFTER
INSERT/UPDATE` trigger on `responses` doing an upsert delta; readers
(grep `study_response_stats` — `/api/respond` refresh call + stats
consumers) switch to the table; drop the MV + the `refresh` RPC call in
`/api/respond` once readers are moved. Forward-looking — schedule last.

### Brief F — filters-compliance sweep (added 2026-07-13 after the Ask Ana fix)

Motivation: the Ask Ana fix uncovered TWO silent filter bugs in one consumer
(cat exclude-mode inverted; daterange ignored) — sweep the class. The
canonical semantics are `lib/filterUtils.applyFilters` (cat include/exclude +
blanks-by-excludeBlanks; range = parseFloat leading-prefix incl. scientific
notation, NaN passes unless includeBlanks===false; daterange = epoch-ms
bounds, unparseable passes unless includeBlanks===false). The SQL mirror is
`ana_row_matches_filters` (sql/167) with parity proven by
`scripts/_verify_ana_filters.mts`.

Sweep every surface that receives, forwards, or claims to reflect filters.
Known consumer set (grep `SerializedFilters|applyFilters|filters` and follow
the data flow — verify this list, don't trust it):
client (FilterContext, TextMineModule, ChartsModule, StatsModule,
ComparisonStrip, ViewsBar, FiltersModal, DatasetShell), server
(ask-ana ✅ done, ad-hoc-report ✅ done, export/html, export/pptx,
share/analytics), SQL (`get_rows_by_filters` — the comments/facets RPC has
its OWN filter implementation), and the **filters-not-forwarded class**:
does `/aggregate` (Charts/Stats server ops), signal-stats, theme-counts, or
any deck path silently IGNORE active filters while the UI implies otherwise?

For EACH consumer classify: (a) canonical — calls `applyFilters` or the
sql/167 matcher; (b) bespoke copy — line-by-line diff against canonical,
fix by replacing with the canonical path (never by patching the copy);
(c) filters intentionally out of scope — confirm the UI says so (or reports
full-dataset numbers with a label); (d) filters silently dropped — a bug:
report it, and fix only when the fix is mechanical (wire the existing
param through). Deliverable: a table appended to this section
(consumer → class → verdict → action taken), plus fixes committed with
per-fix unit tests. Escalate to a Fable session instead of guessing when:
a consumer needs NEW SQL filter semantics (not a reuse of sql/167), or the
right product behavior for a filters-ignoring surface is unclear — list
those for the owner rather than redesigning. Verification bar per the
global rules; for any SQL touch, extend `_verify_ana_filters.mts` parity
cases rather than writing a new harness.

#### Brief F results (executed 2026-07-13)

Canonical = `lib/filterUtils.applyFilters` + its SQL mirror
`ana_row_matches_filters` (sql/167). Every consumer was traced (four parallel
classification passes, then each (b)/(d) finding re-verified against the code).

| Consumer | Class | Verdict | Action taken |
|---|---|---|---|
| TextMineModule | a | `applyFilters(rows, effectiveFilters)` | none |
| StatsModule (main compute) | a | `applyFilters(rows, filters)` | none |
| StatsModule (dimension tests) | **d** | posted `tax_crosstab`/`tax_group_stats` to `/aggregate` **without** `rowIds` → t-test/ANOVA/chi-square ran over the whole dataset while the sibling Charts tab filtered the same RPCs | **FIXED (mechanical)**: derive `filteredRowIds` from the full loaded sample when filters active (null otherwise = whole dataset), pass to the tax posts — route already accepts `p_row_ids` |
| ChartsModule (raw-row charts) | a | `applyFilters(enriched, effectiveFilters)` | none |
| ChartsModule (taxonomy charts) | a | forwards `filteredRowIds` → `p_row_ids` (the correct pattern) | none |
| ChartsModule (scalar server aggs: crosstab/group_stats/date_series/field_counts/numeric_stats) | **d** | full-dataset numbers under a filtered UI — the 5 scalar RPCs take **no** row-id/filter param | **ESCALATED** (needs new SQL) — see below |
| ComparisonStrip | a | canonical, with its own aligned period ranges layered in | none |
| ViewsBar / FilterContext / FiltersModal | a / c / c | canonical count; state containers; the filter *editor* (out of scope) | none |
| DatasetShell | a | forwards serialized filters to canonical server routes; inline `serializeFilters` is a cosmetic dup of the shared one (behaviorally identical, serializes user filters only — a scope choice, not a semantics bug) | none (noted) |
| export/html, export/pptx | a | `deserializeFilters` + `applyFilters` (caveat: `MAX_ROWS` cap → filters a truncated prefix on datasets past the cap — completeness, not semantics) | none |
| ad-hoc-report | a | `loadAnaSample` → `applyFilters` / `sampled_filtered_rows` (sql/167) | none |
| **share/analytics** | **b** | bespoke `rowMatchesFilter` — faithful today but an independently-maintained copy (drift risk) | **FIXED (mechanical)**: swapped to `deserializeFilters` + `applyFilters`; parity regression test `tests/unit/shareAnalyticsFilterParity.test.ts` |
| projectReportLoad / collection project-report | c | no filter UI in its chain (full-dataset by design; would become (d) if a filter control is ever added) | none (noted) |
| signal-stats (metric strip) | c | intentional all-reviews average ("ratings = all reviews"); no filter context feeds it | none |
| dataset decks (operational-review / improvement-plan / outlet-plan) | c | raw unfiltered sample fed to the LLM; no aggregate RPCs, not a filtered-UI surface | none |
| theme-counts | **d** | theme-prevalence bars ignore active filters (dataset-wide %) under the filtered Charts UI; `count_theme_matches`/`sampledSignalCounts` have no filter param | **ESCALATED** (needs new SQL) — see below |
| `get_rows_by_filters` (TextMine Comments tab) | c | **premise corrected**: this is a theme/entity/dimension *facet* filter, NOT a cat/range/daterange peer of `applyFilters` — nothing to diff, no bug. Its only filter families are keyword/entity/taxonomy facets | none (reclassified) |

**Fixed here (mechanical, 1 commit + tests):** StatsModule dimension-test
`rowIds` forwarding; share/analytics → canonical `applyFilters`.

**⚠️ ESCALATED TO OWNER — needs NEW SQL (Brief C territory), NOT fixed here.**
Two real filters-silently-dropped bugs surface **only on the server aggregate
path** (i.e. large datasets past the client-compute threshold, with active
filters), where numbers render full-dataset under a filtered UI:
1. **`/aggregate` scalar ops** (`crosstab_counts`, `group_numeric_stats`,
   `date_series_stats`, `count_field_values`, `numeric_field_stats`) — the
   clean fix is to add a `p_row_ids` param mirroring the taxonomy family
   (which already does this correctly), then drop the `isTax` gate in
   `ChartsModule.useAggregation` so scalar specs forward `filteredRowIds` too.
2. **`theme-counts`** (`count_theme_matches` / `sampledSignalCounts`) — the
   theme-prevalence bars need a filtered row-id set / filter predicate.
Both are new SQL semantics, so per the Brief F escalation rule they are handed
to the owner rather than guessed. **Recommend folding the `p_row_ids` treatment
into Brief C** (the `/aggregate` sampled-twins rework touches these exact
RPCs). A client-only mitigation exists (force the raw-row client-compute path
when filters are active) but it changes the rendering strategy at scale, so it
is a deliberate product call, not a mechanical wire-through — owner's decision.

---

*Re-run policy: re-verify §2 measurements after any change to the sampling
RPCs or `idx_drf_sample`; re-take the §1 snapshot after a compute resize,
a bloat reclaim, or any dataset crossing 500K real rows. Harness:
`scripts/_perf_measure_1m.ts` (untracked, KEEP) against the TEST
`[PERF TEST] Outback x8` dataset (id `d1000000-0000-4000-8000-000000001000`,
1,028,952 rows — re-seed = copy Outback's rows ×8 with fresh identity ids).*

**Retention decision (owner, 2026-07-13):** the 1M `[PERF TEST]` dataset is
**KEPT on the TEST project until the §7 fix-queue is finished** — it is the
verification target for the still-open briefs (the bar is "no 57014 on the 1M
PERF TEST"): **Brief C Part 3** (taxonomy-family sampled twins) and **Brief E**
(long-tail). It lives on TEST only (no prod/production impact and does not
touch the always-on `npm test`, which is mocked), but at ~2.6 GB it bloats the
Micro-tier TEST DB and can slow the env-gated suites. **Delete + `VACUUM
ANALYZE` once Brief C Part 3 and Brief E land** (re-seed is cheap if needed).

---

## 8. Addendum 2026-09-01 — Advanced Analytics pages (the uncovered O(N) surface)

Owner-reported: demoing the Cheddar's dataset, switching between the Advanced
Analytics options was "extremely laggy". Root cause measured on prod
(read-only), plus a repo-wide sweep for the same shape. The §0 map classified
all 41 **API** routes; these are **server page components** and were not in it.

### Measured (Cheddar's, 19,708 rows, prod 2026-09-01)

- Every Advanced view click — Brand Health / Leaderboard / Outlet Deep-Dive,
  every outlet switch, every hierarchy drill — costs **~3.1–3.6 s of server
  time, identical on repeat** (no caching at any layer) with **no
  `loading.tsx`**, so the old page sits frozen through it.
- The cost is `lib/outletReport.ts scanDataset()` → `pageAll()`: the ENTIRE
  dataset (`id, data` JSONB = **20.5 MB**, of which 5.9 MB is `_tx`) fetched in
  **20 serial 1000-row PostgREST pages**, then aggregated in Node.
- **Bound: DB I/O + network, not CPU.** The full 7-theme regex pass over all
  19,708 reviews is **~60 ms**; from a fast-RTT client the scan still takes
  ~3 s → dominated by Postgres JSONB detoast + PostgREST serialization +
  serial round-trips (~7 MB/s effective). Vercel CPU is negligible.
- O(N) per click: Darden Fine Brands (42K rows) ≈ 2×; a 500K-row brand ≈ 25×
  (→ 80 s+, unusable) — this surface has no sampling doctrine protecting it.

### Sweep: all entry points on the same scan (none cached)

`scanDataset` has **9 callers**: the 3 Advanced pages (`improvement-plan`,
`outlet-leaderboard`, `outlet-report` incl. the hierarchy branch — every
drill-down click is its own full scan), `outlet-action-plan` route (POST-hint
fast path avoids it on cache hits), and 3 **GET deck routes** that re-scan per
download click — `operational-review-deck` is worst: `computeOutletPredictor`
(scan 1) + `computeDiligenceData` (scan 2) + a taxonomy rollup in one GET.
Repo-wide: **zero** `unstable_cache`/`use cache`; one `React.cache` (study
slug); no precomputed outlet snapshot exists in `dataset_state`
(`outlet_action_plans` caches only the LLM narration, not the scan).

Other hot spots surfaced by the sweep (all bounded but worth queueing):
`listTownHallsAsLegacy` N+1 (`computeBasicStats` = up to 55K rows per hall,
serial, on every /pulseiq list load); `/api/townhall/live` 20K-turn read on a
10 s poll per viewer; **`/api/share/analytics` = fully-uncapped
`dataset_rows_flat` scan per collection member on a public route** (the only
uncapped flat scan outside outletReport); `admin/health` count-scan pile-up.

### Fix plan (ranked)

1. **Precompute the outlet snapshot** — persist the scan's aggregates
   (outlets, themeChain, dimChain, predictor inputs, captured examples) to
   `dataset_state` at sync/classify/theme-model-change time (write-path
   precedent: `outletActionPlan.ts` / sql/183); pages read O(1). Makes every
   Advanced click ~fast regardless of dataset size — the huge-scale answer.
2. **`loading.tsx` for the three Advanced routes** — perceived-latency fix,
   ship regardless.
3. Interim if (1) waits: select only needed JSONB keys (~halves the 20 MB),
   fetch pages concurrently (kills the serial-RTT tax), `React.cache` the scan
   per request. ~3.5 s → ~1–1.5 s but still O(N).
4. Cap `/api/share/analytics`; batch `computeBasicStats` on the PulseIQ list;
   revisit the live-poll read size.

### Where the platform is against §0/§1 today

Prod holds **598,130 rows across 65 datasets** (top: ANES 126K, Carrabba's
56K) — at the §1 wall for Micro (~200K hot rows/GB cache). The compute-tier
ladder decision (§1) is now current, not future.

*Method: read-only prod REST measurements (scratchpad harness, 2026-09-01) +
in-browser fetch timing on www.sentimetrx.ai + code sweep. No prod writes.*
