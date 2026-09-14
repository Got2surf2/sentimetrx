# 2026-W38 devlog

---

## 2026-09-14 — W38 governance: report verified, critical Next advisory patched (npm audit 8 → 2)

**Why**: the W38 report (PR #36) was the first run on the corrected routine
prompt, so it was checked twice — for whether the routine's fixes took, and for
what it asked. The fixes took: it read `2026-W37-devlog.md` (the COVERED week,
not the run week), honored the documented `image-size` acceptance, and credited
last week's remediations by sha. Its new findings were verified against a fresh
`npm audit --json`, not trusted: four real new roots, including `next` 16.3.1's
CRITICAL unauthenticated RCE in the Image Optimization API — the exact class
that matters for a public Vercel app. One cosmetic error in the report: its
correlation table calls last week's `collectionRecompute` finding CRITICAL (it
was MEDIUM).

**What**: `npm audit fix` (non-force) → `next` 16.3.5, `sharp` 0.35.4,
`js-yaml` 4.3.2; explicit `vitest`/`@vitest/coverage-v8` 4.1.11 (audit fix
skipped it although `^4.1.5` allowed it). Lockfile delta reviewed — `pptxgenjs`
untouched. Verified: tsc clean; 2,203 tests green on the OLD runner, then again
on the NEW one; a real `next build --webpack` on 16.3.5 (36 pages, proxy
compiled). Audit back to the 2 documented highs. PR #36 merged (docs-only —
gate skipped the build, as the new annotation now says in words).

**Not done, by design**: progression #2 (a CI `npm audit --audit-level=high`
gate) is SECURITY.md TBD #2 — an owner policy call, though this week is the
argument for it; progression #3 (coverage ratchet) waits for a measured
`coverage-summary.json`, per the rule the audit itself now carries. PR #33 (the
W36 report) is still open and unmerged.

## 2026-09-14 — CI dependency audit gate (W38 progression #2; SECURITY TBD #2, npm half)

**Why**: the W38 report asked for `npm audit --audit-level=high` in CI. Taken
literally that would have failed every push forever — the two documented,
verified-unreachable `image-size` highs have no in-major fix. And an audit count
is not a finding list: most flagged packages are collateral of one root. So the
gate encodes the rules this repo already lives by instead of the raw flag.

**What**: `scripts/audit-gate.ts` (`npm run audit:gate`, step right after
`npm ci` in the CI `test` job) fails on any high/critical ROOT advisory (an
object in `via[]`; string-only collateral is ignored) unless
`audit-allowlist.json` carries an entry for that GHSA *and* package with an
unexpired `reviewBy` date — an acceptance is a decision with a shelf life, so
the two image-size entries expire 2027-03-01 and the gate goes red until
someone re-verifies. Reads `npm audit --json` from the error path too (npm
exits non-zero whenever anything is flagged). 8 unit tests pin roots vs
collateral, the severity floor, package-scoped allowlisting, and expiry
(inclusive on the date). Live run on this tree: PASS, 2 allowlisted, pptxgenjs
reported as collateral. Consequence stated in ENGINEERING.md: a new upstream
advisory can turn `main` red with no code change — that is the point.

**Also**: PR #33 (W36 report) CLOSED, not merged — `main` already held the
better copy (`a3dbd6db`, 83.0, correct devlog); the PR was a second run that
scored 80.0 on a false "zero commits" premise and carried a lockfile rewrite.
Dependabot weekly + CodeQL remain the open half of SECURITY item 2.

## 2026-09-14 — Coverage floors ratcheted 37/28/39/38 → 40/30/42/41 (W38 progression #3)

**Why**: the report asked for a floor ratchet "after the next large test
addition" and, per the rule the audit now carries, only a measured
`coverage-summary.json` can justify it. Measured on this tree (vitest 4.1.11,
2,211 tests): statements 41.02 · branches 31.71 · functions 43.92 · lines 42.27
— the floors sat 3–5pp under actual, which is the "decoration, not a gate"
condition the 8/16 raise was written against. Part of the rise since the 9/01
baseline (38.32/29.18/40.55/39.55) is the prior week's Ask Ana / digest /
collection suites; part may be v8 accounting differences on the new runner —
the floor tracks the measurement either way.

**What**: `vitest.config.ts` thresholds → **40/30/42/41** (same rule as every
prior raise: ~1pp under measured, rounded down). TESTING.md floor history
updated. Not re-run end-to-end after the edit — the floors are ≥1pp under the
numbers measured minutes earlier on the same tree; CI enforces them on the next
push. Not done: chasing the report's "50%+" — that is a test-writing target,
not a ratchet, and would be scoped as its own coverage week.

## 2026-09-14 — Governance rubric made measurable; Structure/Security checks pointed at this repo

**Why**: the routine's prompt scored **Documentation** and **Maintainability**,
but `audit-codebase.md` defined **Imports** and **AI Patterns** — 30% of the
weekly score had no written bands and was improvised each run (the "~5pt noise
floor"). Two other checks measured the wrong thing: Structure ran `madge` on a
non-existent `src/` (never saw a cycle) and counted App Router nesting as
complexity; Security deducted for env-gated suites "skipped in this clone" —
an environment fact, since CI runs them on every push.

**What**: categories 6–7 rewritten as Documentation (spec-drift count, COVERED-
week devlog, AUDITS registry, policy-doc TBD moves) and Maintainability (tsc,
`no-explicit-any` = error, lint ceiling held and its DIRECTION, runtime cycles,
scoped `eslint-disable`s, oversized modules; CLAUDE.md/hooks/commands as
guardrails — a `.claude/agents` directory is explicitly NOT maturity). Weights
formula and output table renamed to match. Structure: madge over
`lib app components` with a committed `.madgerc` that skips type-only and async
edges; depth check exempts `app/`. Security: read the latest `main` CI
isolation job via `gh` instead of running suites that will skip. Routine prompt
updated live: score strictly against the written bands and quote the measured
number; a methodology note is required in the Trend section on the first run
under the new bands (a movement there is not a codebase change); commit ONLY
the two report files (the W36 PR carried a lockfile rewrite); one PR per run.

## 2026-09-14 — The two real runtime import cycles, fixed

**Why**: with type-only and lazy edges skipped, `madge` found 2 static cycles
(down from the 6 it reported naïvely): `serviceHealth → serviceAlerts →
email/provider → serviceHealth` (the credit monitor imported by the very
provider it monitors) and `SurveyWidget → useSurveyEngine → SurveyWidget`
(the hook imported `pickBrandColor` from the component that renders it).

**What**: `recordCreditError` now `await import()`s `serviceAlerts` — the pager
path only runs on an actual credit error, so nothing is lost by resolving it
there (same pattern the file already used for `dataforseo`). `pickBrandColor`
moved verbatim to `components/survey/brandColor.ts`; both files import it.
Behavior unchanged; `useSurveyEngine`'s declaration order (TDZ-load-bearing)
untouched — only an import specifier changed. madge: **0 cycles**. tsc, lint,
and the serviceHealth / serviceAlerts / surveyEngineFlow / aiProviderGuard
suites green.

## 2026-09-14 — Coverage week, batch 1: dataforseo · statsUtils narratives · mcoLiveContext · studyDesignPptx

**Why**: Tests scores 8-9 only with an enforced floor ≥50%; measured 41.02%
→ +3,835 covered statements needed. Batch 1 takes the pure / fetch-mocked
modules where one suite covers most of a file.

**What**: `tests/unit/dataforseo.test.ts` (fetch stubbed with a response
queue; polling loops on fake timers — Google + Tripadvisor task submit/poll,
402 → credit monitor, address parsing fallbacks, search volume trends, SERP;
95.7%). `tests/unit/statsUtilsNarrative.test.ts` (probit/Shapiro-Wilk/F/VIF/
pruneCollinear, formatters, every bottom-line narrative in both voices, all
branches). `tests/unit/mcoLiveContext.test.ts` (only the three GOAA fetchers
mocked; intent detection, follow-up carry, time windows, checkpoint mapping and
prep math real; 95.5%). `tests/unit/studyDesignPptx.test.ts` (REAL pptxgenjs
render opened with jszip — every section, overflow "(cont.)" pages, null-config
defaults, Datanautix metadata, §6 OOXML tripwire; 97.7%). 62 tests. One source
fix found by pinning output: `regrBL` printed a double space before
"Significant predictors" — now single. Six first-pass expectations were mine to
fix, not the code's (e.g. `formatPValue(0.001)` is `p = 0.001`, the footer
names the FLIGHT PREP section, a destination keyword filters arrivals by
arrivalAirport).

## 2026-09-14 — Coverage week, batch 2: agentStudy · agentReadout · share/analytics route (+ a filter-honoring fake Supabase)

**Why**: the next three largest uncovered product paths are loaders whose
QUERY SHAPES are the behavior — which rows an `.eq('bot_id')` excludes, what a
head-count returns, how a collection fans out. A fake that ignores filters
proves nothing there.

**What**: `tests/helpers/fakeSupabase.ts` — an in-memory client that honors
eq/neq/in/gte/gt/lte/lt/is (dotted paths for embedded joins), order, range,
limit, single/maybeSingle (PGRST116 on zero rows), `{count:'exact',head:true}`
with per-table overrides, and insert/update/upsert/delete that mutate the table
and are recorded. `tests/unit/agentStudy.test.ts` — both turn substrates, the
review gate (human overrides, auto-flags, missing table), exchange shaping,
Tier-1 health incl. every dot state, and the full Tier-2 study with the three AI
passes routed by system prompt: totals reconcile, disabled focuses dropped,
junk entities filtered, language-routing intents excluded, open questions carry
before/after agent lines, cache hit / force / KB-change key (95.0%).
`tests/unit/agentReadout.test.ts` — hybrid theming, label consolidation, Other
bucket, polish + glossary, polish failure → raw, garbage AI → identity labels
(98.5%). `tests/integration/share-analytics-route.test.ts` — token gate codes,
primary/benchmark split, z-test + proportion test, funnel stages, rating-alias
enrichment (study + collection member), non-survey → no funnel, >50K sampler
path + sequential fallback (93.3%). 26 tests; four first-pass expectations were
mine (3-word small talk is substantive; median of [1,2] is the upper element).

## 2026-09-14 — Coverage week, batch 3: projectReportLoad · entityDiscovery · recordingDeck · reviewSync

**Why**: the remaining large uncovered product paths — the collection report
loaders, the entity-catalog write side, the Town Hall deck builder, and the
review sync engine. All four are orchestration over Supabase + one external
boundary, so they ride the filter-honoring fake from batch 2.

**What**: `tests/unit/projectReportLoad.test.ts` — every per-source loader
(town hall with panel filtering + Q&A/commentary split + proceedings →
presentation; agent via the mocked study; reviews with own themes + Dimensions
from the taxonomy RPCs; CSAT), shared-theme scoring from the sampled rows with
monthly ratings, member-theme clustering when the collection has no theme set,
sampler failure → empty rows, and the route-facing gate (404/400/org/409,
community vs compare dispatch, HTML render). `tests/unit/entityDiscovery.test.ts`
— scope resolution REAL (dataset + collection), eligible-field sampling, brand
"do not extract" context, NER parsing/normalisation, canonicalisation merge
(pre-merge names kept as aliases), curated rows never overwritten, hidden rows
never resurfaced, auto-exclude of curated categories, partial/total batch
failure, upsert failure, run logging. `tests/unit/recordingDeck.test.ts` — REAL
pptxgenjs: draft watermark, classification, attribution/objective/sign-off,
meeting overview + detail cards, executive summary KPIs recounted FROM THE
PAIRS (a deliberately stale summary never leaks), sentiment recount, timeline,
theme cards resolved to polished text, actions/decisions overflow caps, appendix
precedence edited → polished → verbatim, and the bare-input skips; §6 tripwire.
`tests/unit/reviewSync.test.ts` — the three phases end to end (drain with date
range + last-known cutoff, submit with estimated/budget-capped depth, stale
refresh), transient vs permanent error handling, dedup (in-batch + already
present, contiguous row_index, count reconciliation), schema build vs merge,
analytics + auto-classify, next-sync scheduling (5-min retry / cadence / manual
parking), Tripadvisor dispatch. 35 tests. First-pass corrections were fixture
facts, not code: the canonicaliser drops <2-char canonicals; a one-row batch
yields no categorical `values` for the schema merge.

## 2026-09-14 — Coverage week, batch 4: share route, outletReportPdf, socialTagging, taxonomyMapping

**Why**: the last of the large uncovered product paths — the share-link
lifecycle route, the three composed outlet PDFs, the social tagging pipeline,
and the legacy taxonomy-label projector.

**What**: `tests/integration/share-route.test.ts` — POST/GET/DELETE with the
tenancy gate (caller-org vs target-org, admin bypass) real over the fake
Supabase (extended with insert-time column defaults for the generated token);
every share type, expiry presets, conversation/agent_study/analytics branches,
the token-resolve payloads, list + revoke authorization. `outletReportPdf` —
the deep-dive / leaderboard / hierarchy documents as strings: every payload
figure lands once, verbatim-guarded quotes, empty-state wording, escaping +
CSS-position clamping, driver-callout tones. `socialTagging` — the full
moderation matrix by sensitivity (regex + AI scores), spam/intent/topic/
off-topic/emotion rules, and the response router's precedence. `taxonomyMapping`
— table-driven over every label family + quarantine bucket + the row
aggregator's dedup (100%). 106 tests. First-pass fixture fixes: the router
flags a topic-less positive comment off_topic before the intent branch (real
precedence), and the leaderboard's chain figure uses an ASCII minus.
