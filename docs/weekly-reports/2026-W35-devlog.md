# 2026-W35 devlog

---

## 2026-08-24 — Close the two W35 audit findings

**Why**: the W35 governance audit scored 80.0/100, down 1.0 from W34. Every
category held except **Documentation, 9 → 8**, on a single spec-drift finding.
Both items below come straight from that report.

### 1. `docs/MCO_AGENT.md` spec drift — the doc had become factually wrong

Commit `8767a919` converted the four MCO logo `<img>` tags to `next/image`.
`scripts/specMap.ts:332` maps `app/demo/mco/**` → `docs/MCO_AGENT.md`, two of the
four call sites live there, and the commit staged only the devlog — so the
pre-commit spec check fired, was bypassed with `SKIP_SPEC_CHECK=1`, and the
bypass was **never justified in the commit message**, which CLAUDE.md requires.

This was not a pedantic mapping hit. §3 of MCO_AGENT.md carried an "Image
rendering (2026-08-16)" note ending: *"The MCO logo marks (`CanvasShell`,
`WelcomeCard`) are static local assets where `next/image` would be correct; they
remain on the lint ratchet as real debt rather than being suppressed."* After
`8767a919` that sentence described the opposite of the shipped code. The mapping
did exactly its job; the bypass is what broke.

The note now records the conversion, and keeps two things a future editor needs:
that every call site sizes by **CSS height with `width:auto`** (the intrinsic
275×120 is passed only so `next/image` can reserve an aspect ratio), and the QC
trap that `.avatar-mco img` uses `object-fit: contain`, so its rendered box ratio
never matched the asset and a ratio assertion there fails while looking exactly
like conversion distortion. The QR and indoor-map exceptions are unchanged and
still correct — verified both still carry their scoped disables.

### 2. The outlet-reporting backfill now has a numbered migration

`sql/193_outlet_reporting_grandfather.sql`. The audit's point was that
`cd84dedf` changed production state through a script invocation only, so the
`schema_migrations` ledger doesn't reflect it and a buyer's DD can't reconstruct
it from the git trail without asking a human.

The migration reproduces the grandfather rule in SQL — `google_reviews` +
`active` + ≥ 5 `review_source_locations` + a non-null `schema_config` — and is
idempotent by construction: the WHERE clause excludes rows already carrying the
flag. **Verified against production read-only before committing: 12 datasets
qualify, all 12 already flagged, 0 rows would be written, 0 skipped for a missing
`schema_config`.** So it is a true no-op there, and the set matches `cd84dedf`'s
commit message exactly:

> BareBurger · Capital Grille · Capital Grille (demo) · Ruth's Chris · Zuma ·
> Flemings (demo) · Eddie V's · Tabla · Nobu · Cheddar's · US National Park ·
> Rubio's Coastal Grill

It deliberately skips datasets with a NULL `schema_config`, for the same reason
the original script did: writing a bare `{"outletReporting":true}` there would
invent a `schema_config` the rest of the app then treats as authoritative for
field types and hierarchy levels. Prod has none, but the guard belongs in the
file rather than in someone's memory.

Being a DATA migration, there is no DDL and `docs/db/schema.sql` does not move.

### What this week's drop actually says about the rubric

Worth writing down, because the instinct was that a heavy docs week should have
pushed the score up. It can't. The spec-drift companion credits the work — 10
specs updated in range, `ANALYTICS.md` 18 edits alongside 18 code commits,
`TESTING.md` 17 alongside 17 — and the report says it plainly: those changes
*"don't move the score up on their own but keep it from moving down."*
Documentation sat at 9/10, joint-highest in the repo. Keeping specs in sync is
the baseline expectation, not a bonus; **drift is the only lever that moves that
number, and it only moves down.** One unjustified bypass therefore costs a full
point that no amount of good docs work can earn back in the same week.

---

## 2026-08-26 — A dropped socket deleted an in-progress dataset

**Why**: "failed on loading". Vercel runtime errors showed two failures eight
minutes apart, both `TypeError: fetch failed` / `SocketError: other side closed
(UND_ERR_SOCKET)` against Supabase — one a **500** at `datasets.rows.insert`,
one a **401** raised inside `supabase.auth.getUser()`. The same deployment
logged **587 successful `201`s** in that window, so the upload was working: one
batch out of ~590 hit a stale pooled keep-alive socket.

Two things turned a blip into a disaster.

**The 401 was a lie.** `getCallerOrgContext` destructured only `data` from
`getUser()` and threw the `error` away, so a dead socket and "not signed in"
were the same thing. The user gets logged out mid-upload for a network hiccup.

**The rollback is nuclear.** `analyze/new/UploadClient` treats any `!res.ok` as
fatal: it deletes every uploaded batch *and the dataset itself*. That is why
both dataset ids from the logs — `7e131ffe` and `d037f7f8` — no longer exist in
production. One dropped connection destroyed the whole load.

**Fix, in two layers.** `lib/retryTransient.ts` draws the boundary: retry
transport failures, never application errors. A constraint violation or a
statement timeout is a real answer and repeating it is just load — there are
tests pinning both directions, including the `57014` statement timeout that
must *not* retry. Detection walks the `cause` chain, because undici reports a
bare `TypeError: fetch failed` whose cause carries `UND_ERR_SOCKET`; matching
the top-level message alone misses every one of them.

Server side, the insert is wrapped, and so is the auth call — which benefits all
~83 `getCallerOrgContext` callers without changing anyone's semantics, since the
retry usually just succeeds. Escalating an exhausted retry to a *throw* is
opt-in (`requireReachable`): public surfaces legitimately treat "no user" as a
valid state and should degrade, not error. The rows POST opts in and answers
**503 + Retry-After** rather than 401.

Client side, `lib/postJsonWithRetry.ts` retries 429/502/503/504 and network
rejections, honouring `Retry-After`. Both upload flows use it — `UploadClient`
and `SettingsClient` had the same batch loop, which is the second occurrence
that earns a shared helper rather than a third copy.

**Note on getting here**: the Sentry credentials are marked *sensitive* in
Vercel, which makes them write-only — the CLI returns `[SENSITIVE]` and there is
no read path, so Sentry was unreachable. Vercel's own runtime-error API had the
same data. Also had to upgrade the Vercel CLI (53.1.1 → 59.5.0): the old version
silently wrote **empty values** for all 57 env vars on `env pull`, which looks
exactly like "the vars aren't set".

---

## 2026-08-26 — The audit's Tests metric was measuring the build directory

**Why**: Documentation dropped a point in W35 and Tests had been stuck at 7 since
W34 despite the suite growing every week. Asking *why* we had a file-count ratio
at all turned up something worse than miscalibration.

**The metric was non-deterministic.** `audit-codebase.md` Category 5 excluded
`node_modules`, `.git` and `dist` from the source count — but not `.next`. Run it
with a build present and the ratio is **0.05**; without one, **0.21**. Both the
W34 (0.22) and W35 (0.17) reports noticed the number moving and each wrote it off
as a "counting discrepancy" without identifying the cause. Neither figure
described the codebase.

Three more problems underneath. It counted **files, not test cases**, so the
1,646 cases in 179 files scored worse than the same tests split across 1,646
stub files — it rewarded fragmentation. Its denominator swept in `scripts/`
one-offs, config and pages that are not unit-testable, so it measured repo shape.
And its coverage fallback **never fired**: the rubric reads
`coverage/coverage-summary.json`, but `vitest.config.ts` emitted only `text` and
`html`, so the auditor had no coverage data whatsoever and scored on the broken
ratio alone. By the rubric's own bands, 0.17 sits in **1-3** — we were scored 7,
which means the number wasn't driving the score at all. The auditor was
overriding its own rubric on judgment, and judgment is exactly why it wobbled.

**Rewritten to measure enforcement, not volume.** The denominator is now scoped
to the surface the project declares coverable (vitest's own `include`), cases are
counted alongside files, and the bands reward an enforced coverage floor that is
*close to actual and rising* — because a suite CI doesn't gate is documentation,
and a floor 10pp under the real number is decoration that will pass a large
regression silently. `json-summary` is now emitted so real coverage is available.

Measured at the rewrite: **31.25 / 24.51 / 34.37 / 31.83** against an enforced
floor of **30 / 23 / 33 / 30** — every metric within ~2pp of its gate, 2.73 cases
per source file. That scores **7**, unchanged, but now for a true reason with a
stated path: raise the floor toward 50%.

**Also constrained the trend block.** W35 opened with "W33: 86.0 / 100
(baseline)" when W33's own table totals **77.0** and W34 names its predecessor
explicitly. That invented figure turned W34's **+4.0** — the biggest gain in the
series — into a narrated "−5.0 regression", and had us hunting a fix for a drop
that never happened. The command template never asked for a trend section at all,
so nothing constrained it. It now does, with the instruction to read the prior
score **out of the file** and never from recall.

---

## 2026-08-26 — A push landed on main and CI never ran, so production never deployed

`ba1773f4..93dbdf34` pushed cleanly and `origin/main` moved. GitHub then created
**no workflow run at all** for that sha — confirmed against the Actions API, not
just `gh run list`. Actions enabled, `ci.yml` triggers on a plain
`push: branches: [main]` with no path filter, and the push immediately before it
(`3176cdd4`) ran fine on identical credentials.

The consequence is the part worth remembering: **this repo deploys behind CI, and
the deploy hook is fired BY the workflow** (`curl -X POST "$VERCEL_DEPLOY_HOOK_MAIN"`,
gated on a non-docs diff). So "CI didn't run" does not mean "CI is pending" — it
means **production silently did not deploy**. Three commits sat on `main` while
prod stayed on the previous build, with nothing failing and nothing red to notice.

`ci.yml` had no `workflow_dispatch`, so there was no way to recover except pushing
another commit. It has one now. If this recurs: run the workflow manually rather
than pushing a no-op.

**Check that catches it:** after any authorised push, confirm a run exists *for
that sha* — `gh api "repos/<owner>/<repo>/actions/runs?head_sha=$(git rev-parse origin/main)" --jq .total_count`.
`gh run list` alone shows the previous run sitting at the top and reads like
success. Use the full sha; an abbreviated or hand-padded one silently returns 0
and looks identical to "no run".

---

## 2026-08-26 — `npm run migrate` can't reach prod: the direct DB host is IPv6-only

**Why**: applying `sql/193` to production failed at connect. The error points at
the wrong thing, which is the part worth recording:

```
LegacyDbConfigConnectTempRoleError: failed to connect as temp role:
failed to connect to postgres: PgClient: Connection timed out
suggestion: set the env var correctly: SUPABASE_DB_PASSWORD
```

That suggestion sends you hunting for a password. The real cause is the network.
`--linked` *does* use the Management API — the CLI is authenticated and
`supabase projects list` works — but it then provisions a **temp role** and
connects to the project's **direct** host to execute the statement.
`db.foubvgcarhwzjqwaxnod.supabase.co` resolves to `2600:1f18:…` and has **no A
record**, so on an IPv4-only network it simply times out. The `TEST_DB_URL`
already in `.env.local` works precisely because it points at the **pooler**
(`aws-0-us-east-1.pooler.supabase.com`), which is IPv4.

**What changed**:
- `scripts/apply-migration.ts` — honours `PROD_DB_URL` (or `SUPABASE_DB_URL`)
  and routes the apply, the ledger insert **and** the schema dump through
  `--db-url`. Previously all three hardcoded `--linked`, so a working connection
  string couldn't be used even if you had one. Also loads `.env.local` itself,
  since `npm run migrate` is a bare `tsx` invocation with no env loading.
- `docs/DATABASE.md` — the gotcha, next to the sql/193 note.

**Safety note**: the failed attempt applied nothing — it died at connect, before
any SQL ran. Verified against prod afterwards rather than assumed: ledger still
tails `192_org_snapshot_runs.sql` / `191_…`, and still exactly 12 datasets carry
`outletReporting`. This is the good case of the ambiguity recorded earlier in the
year, where a **502 mid-apply** left the DDL applied but the ledger unwritten — a
connect-time failure is unambiguous, but it still gets checked.

---

## 2026-08-26 — Upload page jank: O(rows) in the render body × a render per batch

**Why**: typing on the new-dataset page went sporadic during a large upload. The
question was "what race conditions" — there was one, but it wasn't the cause.

`UploadClient` computed `previewRows` (a filtered copy of every row) and then ran
a real `splitChunks()` pass — `JSON.stringify` + `new Blob` per chunk — **in the
component body, unmemoised**. Both existed only to show the batch count on the
summary card. The upload loop then called `setUploadMsg` at the top of each batch
and `setUploadPct` at the bottom, separated by an `await` — different ticks, so
React could not batch them: two renders per chunk.

Measured before changing anything: **78ms per render body at 100K rows × ~4,000
renders ≈ 312s** of blocked main thread. Keystrokes were queuing behind it.

Worth recording that my first guess was **wrong**: I assumed the one-time
`splitChunks` before the upload was the cost. Benchmarked at 76ms for 100K rows —
irrelevant. The damage was that same work running four thousand times.

**What changed**:
- `UploadClient` — deleted both render-body derivations. The count is now
  `Math.ceil(rows / CHUNK_SIZE)`, verified against the real chunker: identical for
  typical reviews and 2KB verbatims, diverging only when one cell is large enough
  to force a byte-split, so the label reads "≈N × up to 50 rows" rather than
  asserting a number that can be 4× off.
- `UploadClient` — one throttled `progress()` helper sets both values together
  (so React batches them) at most ~4×/second, forced at milestones and on the
  final batch.
- `UploadClient` — `mountedRef` guard. The loop had no unmount protection, so
  leaving the page mid-upload kept it calling `setState` on a dead component and
  ran `router.push` at the end, dragging the user back to a page they had left.
  The remaining batches deliberately still FINISH — aborting would strand a
  half-loaded dataset with no rollback — only the UI writes are suppressed.

`SettingsClient`'s append loop was checked and does **not** have this problem: it
sets state only at the start and end, not per batch.

---

## 2026-08-26 — Upload progress modal, and a StrictMode ref bug only a real run could find

**Why**: owner — during a large upload the page showed a spinner and "batch 233
of 2518" and nothing else. No percentage, no sense of remaining time, and it sat
inline low on a long form.

**What changed**: a centred, dimmed, non-dismissable dialog with the current
phase, a percentage, a progress bar and a **time-remaining estimate**. The ETA is
measured, not guessed — mean seconds-per-batch so far × batches remaining —
withheld until 3 batches complete, because the first one or two carry connection
setup and produce a wild figure. `formatEta` rounds on purpose ("about 2
minutes", "about 35 seconds"): a per-second countdown on an estimate that keeps
moving reads as broken. Not dismissable by design — there is no cancel path that
wouldn't strand a half-loaded dataset.

**The bug worth recording.** The guard added earlier the same day —
`useEffect(() => () => { mountedRef.current = false }, [])` — is wrong. React's
dev StrictMode mounts, unmounts, then remounts; the cleanup fires once *before*
the real mount, and nothing ever sets the ref back to `true`. So it stayed
`false` for the component's entire life and every guarded `setState` was silently
skipped. The modal froze at "Preparing data… 0%" for three full minutes while
batches uploaded perfectly well behind it.

`tsc` was clean, lint was clean, and 1,800 unit tests passed. Nothing but
watching an actual upload would have caught it — the first screenshot attempt
caught the modal at 0% and I nearly wrote it off as dev-server slowness. Polling
for three minutes is what turned "slow" into "frozen", which is a different bug.
Fix is one line: assign `mountedRef.current = true` in the effect body. The same
fault would hit production on any genuine remount.

Verified live against the TEST project with a 6,000-row CSV: "Uploading rows —
batch 5 of 120", 4%, bar filling, "about a minute left".

---

## 2026-08-26 — A 125,897-row upload was making 2,518 round trips instead of 630

**Why**: a real upload (ANES 1984–2024, 125,897 rows × 52 columns) was hours in
and barely a third done. Production logs: 207 batches in 30 minutes — **~8.7s per
50-row batch**.

**Measured, not guessed** — and two of my first three hypotheses were wrong,
which is the point of measuring:

- ❌ The one-time `splitChunks` before upload — 76ms at 100K rows. Irrelevant.
- ❌ An unindexed `MAX(row_index)` per batch growing with the table —
  `idx_drf_dataset_idx (dataset_id, row_index)` exists; it's an index scan.
- ✅ **Browser render work**: ~859ms per render at this shape × 2 unbatched
  renders per batch ≈ **1.2 hours of pure browser work** across the upload. Fixed
  earlier the same day but not yet deployed, which the screenshot confirmed.
- ✅ **Insert cost scales with COLUMN COUNT**: 70ms (4 cols) → 174ms (20) →
  **626ms (52)** per 50 rows. `drf_tsv_trigger` loops every JSONB key in plpgsql
  with a regex per value, then two GIN indexes are maintained.
- ✅ **The round-trip count**: `CHUNK_SIZE` was 50 against a server
  `ROWS_PER_BATCH` of 200.

**What changed**: both upload paths now use `ROWS_PER_BATCH` directly — 2,518
batches become 630 for that dataset. Each batch carries ~6 fixed Supabase round
trips no matter its size, so this is the cheapest available win.

It **cannot** go higher without changing the server stride: `row_index =
batch_index * ROWS_PER_BATCH + offset`, and the rollback DELETE spans exactly that
range, so an oversized chunk would collide indices and make a rollback delete
another batch's rows. `tests/unit/uploadChunking.test.ts` pins the invariant.

**Verified in a browser before committing**, per the new rule: a 4,000-row × 52-col
CSV uploaded end to end — 20 batches (was 80), modal reading "batch 4 of 20 · 18% ·
about 25 seconds left". Then checked the thing that actually matters for a stride
change: **4,000 rows stored, 4,000 distinct row_index, 0 duplicates, max 3999** —
contiguous, no collision.

## 2026-08-27 — ANES 1984-2024: rescuing a half-loaded production upload

**Reported as three problems** — "no schema shows up", "AI theme mining is
disabled", "the original file had over 120K records, the dataset has half that."
They were one problem.

The 2026-08-26 upload of `anes_1984_2024_evaluations.csv` into dataset
`7ece9ec9-4854-4bf6-a5e7-92cd902123dc` stopped at **batch 1,337 of 2,518** —
66,850 of 125,897 rows. Crucially there was **no error and no rollback**: the
client rolls back and deletes the dataset when a batch fails, and neither
happened, so the loop did not fail — the browser tab stopped running. At the
~8.7s/batch measured that day, the file is a **~6.1 hour foreground tab**; it
survived ~3.2 hours.

Saving the schema is step 3, *after* every batch. It never ran, so
`dataset_state.schema_config` was still the creation default `{fields: []}` —
and `TextMineModule` derives its open-ended fields from `schema.fields`
(`:1480`), so `canMine` was false and the Mine button was greyed out
(`:2624`). The "AI is disabled" report was a symptom of the truncated upload,
not an AI setting.

One red herring worth recording: stored `row_index` values are **sparse**
(0-49, 200-249, 400-449…). That is not data loss — the server reserves
`ROWS_PER_BATCH` (200) index slots per batch while production's client posts 50.
Prod runs `2e4b28b5`; the 50→200 commit is still local.

**Fix**: `scripts/oneoff/_load_anes_dataset.ts` re-loads the file server-side —
the real `autoDetectSchema()`, the real `stampRowSubstantive()`, the real
`row_index = batch_index * ROWS_PER_BATCH + offset` contract — in **4m39s**
instead of ~6 hours, then verifies and exits non-zero if anything is off. Two
things it had to handle: an unbounded `DELETE` over the partial rows exceeds
PostgREST's statement timeout (walk `row_index` in windows instead), and one
insert hit `TypeError: fetch failed` mid-run and recovered on retry — the exact
transient that has been killing these uploads.

**Two deliberate departures from the UI path, both measured:**

1. `parseCSV()` in `UploadClient.tsx` toggles on every `"` and never emits one,
   so interior quote marks are dropped. On this file that mangles **2,796 of
   125,897 rows** (3,073 fields), all of them in the verbatim columns that are
   the point of the dataset: `I like when Reagan says, "God bless you"` loads as
   `I like when Reagan says, God bless you`. The script uses an RFC4180 splitter.
   Column counts and every other value are identical. **This is a live bug in the
   shipped upload path and is not yet fixed** — see below.
2. `autoDetectSchema` types a column open-ended when it reads as prose
   (`avgWords >= 4`, `datasetUtils.ts:215`). ANES stores full codebook labels
   ("2. No, no one in household belongs to a labor union"), so **nine
   single-choice columns with 2-8 distinct values** were typed open-ended and
   offered as theme-mining targets, with `primaryTextField` landing on
   *Education*. The detector's own categorical rule one line earlier is
   `uniqueArr.length <= 15 && avgWords < 3` — same cardinality test plus a
   word-count gate these labels fail. The script re-applies the cardinality half
   alone and attaches the `values` list. Result: 20 categorical / 26 numeric /
   1 id / **5 open-ended** (the real verbatims), `primaryTextField` = *Like About*.

**Verified in the browser on live production before committing**: Schema tab
renders 52 fields (Rating Scale 26 · ID 1 · Single Select 20 · Open Text 5) with
the nine corrected fields showing their true unique counts; TextMine reaches
"TextMine is ready", 50,000 of 125,897 sampled across 5 open-ended fields, and
**"Mine themes — 5 questions" is enabled**.

**Follow-ups, not done here:** (a) the `parseCSV` quote-dropping bug above;
(b) the upload path has no resume — a dataset stranded mid-load looks "active"
with a silently empty schema and nothing tells the user. A terminal status on
`datasets` set only after step 3 would make this self-evident instead of a
three-symptom bug report.

## 2026-08-28 — Filters modal: 41.5s → instant (sql/194 + cache + prefetch)

**Why:** Owner: "filters take a really long time to come up — should be
instantaneous — check the ANES dataset." Measured the filter-options walk on
ANES (125,897 rows, 51 filterable fields): **41.5s** — the sql/191 RPC's cells
CTE re-parsed each row's jsonb once PER FIELD (~80ms/field per 5K page; 0
fields = 114ms, perfectly field-count-linear).

**What:** (1) sql/194 rewrites the cells CTE to one `jsonb_each_text` parse per
row, hash-joined to the field list. (2) The route caches the computed options in
`dataset_state.filter_options` keyed by a fingerprint (row count +
last_synced_at + fields-signature sha1) — warm requests are one head-count
query. (3) `DatasetShell` prefetches `/filter-options` on mount instead of on
first modal open.

**Verified:** new function's page-1 output matched an independent JS
recomputation of the same stratified sample on all 18 fields (incl. per-value
counts) on the test project's 128K Outback dataset; full 50K walk there:
**4.8s** (was ~40s-shape). Browser-verified on the dev server: prefetch fires on
mount, modal opens instantly, `cached: true` on warm requests, cache row
written with correct fingerprint. Prod v1 baseline for ANES captured
pre-migration for a byte-level diff after `npm run migrate sql/194_...`.

**Prod apply + verification (same day):** `npm run migrate` could not reach prod
from this network — `.env.local`'s `PROD_DB_URL` had the WRONG POOLER HOST
(guessed `aws-0-us-east-1` on 8/27; prod is `aws-1-us-east-1`), and even with
the right host the session pooler (:5432) times out from here (only :6543
connects, which rejects multi-statement files). Applied instead via the
**Supabase Management API** (`POST /v1/projects/{ref}/database/query`,
owner-run `scripts/_apply_194_prod.mjs`, token from the CLI's keychain entry —
go-keyring base64-wraps it). Ledger row recorded; anon still locked out.
**Verified:** the new function's full 10-page ANES walk is **byte-identical**
to the pre-migration v1 baseline (all 51 fields, all pages) and runs in **19s
warm** vs 42.6s (single page 1.4s vs 4s; cost now ~flat in field count). The
deployed route benefits immediately; instant-open (cache + prefetch) ships
with the next push.

## 2026-08-28 — ANES: Year as a breakdown axis, and a 2008 file that would have undone a distinction

`Year` was typed Rating Scale by `autoDetectSchema` (all-numeric column), which
makes it a range control rather than a breakdown axis. Flipped to Single Select.
It had already been flipped by a parallel session but was left half-done —
`sqt` set, no `values` list, and `min`/`max`/`avg` still attached, so Charts
would still have offered a numeric range for a field that no longer had one.
`scripts/oneoff/_set_field_type.ts` mirrors `SchemaEditor.handleTypeChange`
(`:613`) and additionally writes `values` and drops the numeric domain — the UI
skips `values` because the settings page back-fills it from
`analytics.fieldSummaries` at render (`settings/page.tsx:79-88`), which a
server-side flip never gets.

**`anes_2008_evaluations.csv` was NOT loaded, deliberately.** Diffed against the
6,894 2008 rows already in the dataset: same 52 columns, same row order, same
IDs, and **identical in 51 of 52 columns**. The only difference is that it fills
`Top Problem` with a byte-exact copy of `Top Problem - Political` — 6,278 rows,
zero differing. Loading it would have merged 2008's differently-worded question
("most important *political* problem") into the cross-year `Top Problem` series,
which is the opposite of the intent. The separation the owner asked for is
already what's stored: 2008 is the only year with `Top Problem` empty and
`Top Problem - Political` / `- Personal` populated.

Worth recording for anyone reading the year coverage: **2004 has no problem
verbatim at all** (all three columns empty, 1,723 rows), and the file skips
1994, 2002, 2006, 2010, 2014, 2018 and 2022 entirely.

**Theme models are keyed by field, never by year** (`themeModelKey`,
`themeUtils.ts:103` → `theme_model.fields`). A model mined on `Top Problem`
therefore cannot reach 2008, whose rows are blank in that column, and 2008 would
get its own independent vocabulary. To get ONE comparable theme set across all
years, both columns must be selected together in TextMine — `mineThemes()` saves
`fieldNames: effectiveFields` (`TextMineModule.tsx:2140`) and mines a combined
corpus, producing a single model keyed to the pair.

## 2026-08-28 — Driver Simulator JSON export from the Statistics Regression panels

**Why:** owner built a standalone HTML Monte-Carlo Driver Simulator that consumes
a single self-contained JSON model payload (simulator-payload-spec v1.0, linear
`identity` + binary logistic `logit` links); the platform needed to emit it from
the regression pieces of the Statistics page.

**What:** `lib/simulatorExport.ts` builds and asserts the payload (log-odds not
odds ratios, sigma = residual SD identity-only, estimation-sample moments,
dummy sd = √(p(1−p)), PD-checked se+corr, separation blocked); both fitters in
`lib/statsUtils` now return the full coefficient covariance (`vcov`) they
already computed internally; both Model Fit headers gained "Download simulation
model (.json)". The linear panel's estimation sample was factored into ONE
builder shared by fit and export so slider moments can never desync from the
model.

**Verified:** 11 new unit tests incl. the spec's acceptance identities; in the
browser on the dev server both a logistic (Outback, Cleanliness top-box, theme
dummy) and a linear (Truth Social favourites drivers) model exported, and both
files pass a mirror of the simulator's §15 consumer validation
(`scripts/_validate_sim_payload.mjs`, untracked harness — KEEP).
