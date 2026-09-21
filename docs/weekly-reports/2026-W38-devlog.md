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

## 2026-09-14 — Coverage week, batch 5: agentStudyHtml (statements 49.43 → 49.84)

**Correction:** batch 5 did NOT cross 50% statements — it landed 49.84 (lines
already 50.76). Batch 6 (safeFetch) was the one that crossed, to 50.04. The
commit-message subject for batch 5 overstated this.

**Why**: the full-suite measure after batch 4 sat at 49.43% statements / 50.76%
lines — lines already cleared the Tests-band 50% bar, statements were ~0.6pp
short. `lib/agentStudyHtml.ts` (the sandboxed shared Agent Study bake, 186
uncovered, a pure string builder like outletReportPdf) closes it in one suite.

**What**: `tests/unit/agentStudyHtml.test.ts` — one rich AgentStudy through
`renderAgentStudyHtml` exercising every section and its conditionals
(health-dot title text, KPI gating on beacon coverage + answer rate, the
recorded-sessions reconciliation note, activity chart, focuses with samples +
per-focus entities, commentary + KB via the real sub-renderers, intents with
the zero-detection filter, languages, attribution incl. the untagged row, open
questions with depth chips + before/after context, insights, methodology,
footer) plus a minimal study pinning the omitted sections; 11 tests, ~100% of
the file. Fixture-only first-pass fixes (recorded-count arithmetic, the
lowercase language badge, the always-present "Open Questions" KPI label).

## 2026-09-14 — Coverage week, batch 6: safeFetch (SSRF guard) — statements clear 50%

**Why**: batch 5 left statements at 49.84% (lines 51.21, functions 54.08
already ≥50). Rather than pad with another deck, the last nudge went to a
security-worth-testing target: `lib/safeFetch.ts`, the SSRF guard every
user-URL fetch (bot training, crawl, research) goes through — it was at 1%.

**What**: `tests/unit/safeFetch.test.ts` — the full block surface: scheme
rejection, every private/reserved IPv4 range + the metadata address as
literal hosts (no DNS), the IPv6 table (loopback / ULA / link-local /
multicast / IPv4-mapped) driven through resolved records, DNS-rebinding
(reject if ANY record is private), resolution-failure paths, and the manual
per-hop redirect revalidation (the classic metadata-via-redirect bypass, no
Location, malformed Location → 502, the redirect cap, relative Location). 12
tests. Two findings about the code's real shape surfaced while writing:
`new URL('http://256.1.1.1')` throws (WHATWG rejects an out-of-range final
label before any IP check), and `URL.hostname` keeps the brackets on an IPv6
literal so the literal-v6 branch is only reachable via resolved records — the
tests exercise the block table through the realistic DNS path.

## 2026-09-14 — SECURITY item 2 closed: Dependabot + CodeQL

**Why**: the npm-audit gate (earlier today) was one of three halves of the
oldest open SECURITY.md item. W38's `next` RCE showed the cost of relying on a
weekly human cadence; the other two halves are the automated layer.

**What**: `.github/dependabot.yml` — Monday 02:00 ET (before the 04:00 ET
governance run), grouped minor+patch PRs for production and development
deps, 7-day cooldown (supply-chain: a bad release is usually pulled before it
reaches us), majors individually, framework + jsdom/dompurify majors ignored
by design, plus a github-actions group. Dependabot **alerts** switched on via
the API. `.github/workflows/codeql.yml` — `javascript-typescript` + `actions`
on push/PR to main and weekly; tests + scripts/oneoff excluded; alerts only,
NOT a deploy gate until the first-run backlog is triaged. `vercel.json`
`git.deploymentEnabled` gains `dependabot/**: false` so a bot PR never costs
a preview build. The governance rubric now reads both alert feeds via
`gh api` (Security + Dependencies bands).

**Decisions**: no auto-merge — ENGINEERING.md had floated "auto-merge on
patch", which is an unattended production deploy; dropped, every Dependabot
PR is merged by a human. **Found while verifying**: the repo is PUBLIC (hence
free CodeQL) with secret scanning + push protection off — flagged to the owner
in SECURITY.md item 2 (b), not changed. **Sequencing**: Dependabot *security
updates* stay off until the preview gate is on origin/main (item 2 (a)); CI on
Dependabot PRs needs the `SUPABASE_TEST_*` creds mirrored into the Dependabot
secrets store (Dependabot-triggered runs cannot read Actions secrets) — owner
step.

## 2026-09-14 — SECURITY.md open items 5–13: eight of nine moved

**Why**: with items 1, 2, 4 and 14 closed and the W38 report scoring 83, the
remaining `<TBD>` list (some entries from May) was the oldest open governance
debt — and two of them (7, 11) sit exactly on the pattern behind every
CRITICAL finding to date: a service-role query that widened past its org.

**Landed (code)**
- **#11 one resource gate** — `lib/auth/gate.ts`: `gateResourceForUser` /
  `gateResourceAccess` for agent · dataset · collection · study · campaign ·
  pulseiq_session (id or slug) · conversation (agent, or response → study);
  cross-org and non-existent return the SAME 404 + message. Six of nine
  `gate*` functions collapsed (share — all 6 target types — both
  `gateBotAccess`, `gateSessionAccess`, both `gateCollection`); share's
  cross-org answer moved 403 → 404 to match. 12 unit tests; the five
  route-gate suites stayed green after three fixtures learned that the gate
  reads `users`/`organizations` through the service client.
- **#7 prompt guard** — `lib/aiOrgGuard.ts`: `assertDatasetsBelongToOrg`
  at every collection fan-out that feeds a Claude call (dataset search, Data
  Story, entity discovery, project report) and `assertSingleOrg` for
  org-bearing row sets; `CrossOrgPromptError` = 500 + Sentry. A stale
  (unknown) member is ignored — it contributes no rows; a FOREIGN one refuses.
- **#5 write-path egress** — Org B DELETEs every Org A row across 13 tables
  and the row must survive; FK dry-runs: dataset delete cascades to rows +
  state, org delete is BLOCKED while a collection exists (RESTRICT by design,
  `lib/orgDelete.ts` erases per-table first). Ran against Sentimetrx-Test:
  42/42. New `scripts/test-isolation-local.sh` re-points the isolation suites
  at TEST the way `dev.sh test` does — never prod.
- **#12 logger** — `logInfo` added; 189 `console.*` calls in `app/api` (61
  files) + `lib` (30 files) migrated by AST codemod; `no-console` is an ESLint
  error for both trees. Every lib file was checked against the real import
  graph (madge BFS from 212 client roots) before importing the server-only
  logger. Three tests that spied on `console` now assert the structured
  payload (`at`, `err`) after the awaited request-id lookup.
- **#9 (2 of 3)** — `docs/postmortems/TEMPLATE.md` + `README.md`; gitleaks
  in CI (`secret scan` job, deploy waits on it) with `.gitleaks.toml`
  allowlisting the 11 verified non-secrets from a 3,248-commit history scan
  (flymco's public site key/token, test fixtures, a build cache committed
  once in 2026-04). Status page stays for the first paying customer.
- **#13 (tooling)** — `scripts/dr-audit.ts` (read-only: S3 versioning /
  encryption / lifecycle, snapshot continuity, Supabase backups + PITR; exits
  non-zero on FAIL) + `docs/runbooks/dr-restore-drill.md`. First drill is
  owner-run and NOT yet performed — the classifier blocks this session from
  reading the backup credentials, which is the right boundary.

**Closed on review (docs)**: **#10** was stale — ESLint 9 flat config, the
promise rules and `no-explicit-any` at `error`, `lint:ci` in CI all already
true. **#6** is built (org `ai_key_mode='off'` ceiling + per-user
`users.ai_enabled` with `ai_consent_audit`), so the item now names the two
real gaps: the default is opt-OUT for new orgs, and 42 `callAI` sites pass
no `usage` context and bypass the switch.

**Owner decisions queued**: **#8** MFA + admin session policy (ratification
text + enforcement plan written into the item); **#7b** a real
`security@sentimetrx.ai` mailbox before publishing it; **#9c** status page;
**#13** run the first drill.

## 2026-09-15 — Push + CodeQL first-run triage

**Shipped**: the 17-commit W38 stack (`db3e4650..4ced49eb`) — CI green on
every job incl. the new `secret scan`, production deployed. The Next 16.3.1
critical RCE fix is live. Dependabot security updates switched on once the
`dependabot/**` preview gate was on `origin/main` (item 2(a) done).

**CodeQL's first analysis**: 70 alerts (5 critical · 56 high · 9 medium).
Triage, with the reasoning recorded on each dismissal:
- **1 real critical** — `lib/substack.ts`: `resolveBaseUrl` accepts any pasted
  URL (custom-domain publications), and `substackGet` fetched it with plain
  `fetch` + follow-redirects. Now goes through `lib/safeFetch` (SSRF guard,
  per-hop revalidation). This was reachable from the substack-sources routes.
- **4 false-positive criticals** dismissed: `safeFetch`'s own fetch (it IS the
  guard); reddit ×2 and the Meta webhook — hosts are hardcoded, only path
  segments were user-controlled; those are now `encodeURIComponent`'d and the
  Reddit permalink is shape-validated before the request line.
- **5 medium** `missing-workflow-permissions` → `permissions: contents: read`
  at the top of ci.yml (gitleaks PR comments off — summary + red check suffice).
- **8 alerts in `prototype/`** (static design mocks with CDN scripts /
  Math.random ids, never shipped) → excluded from analysis.
- **1 high** won't-fix: the TEST seed script prints the throwaway password it
  just generated — that is its job.
- **~50 high remain for triage** (next governance cycle): `double-escaping` /
  `incomplete-multi-character-sanitization` (HTML-stripping regexes in
  crawlText, documentText, regulations, fetch-url, research — 22),
  `insecure-randomness` (Math.random ids in client chat UIs — 15, mostly
  not security-relevant), `polynomial-redos`/`redos` (12), `xss-through-dom`
  (5, admin/demo clients). Once that backlog is worked, make CodeQL a required
  check (SECURITY.md §9).

## 2026-09-15 — CodeQL high backlog worked (45 alerts → 3 shared helpers + 10 rewrites)

**Why**: the first-run backlog was the only thing between CodeQL and a
required check. Each alert was read against the code, not the rule name.

**What**
- **HTML stripping / entity decoding (16 alerts)** — fourteen inline
  single-pass `.replace(/<[^>]+>/g,'')` strips and `&amp;`-first decodes,
  across crawl/fetch-url/research/documentText/regulations/temple-events
  and five client parsers, now go through `lib/htmlStrip.ts`: `stripTags`
  reaches a fixed point (a split `<scr<b>ipt>` cannot reassemble),
  `removeElements` tolerates `</script >`, `decodeEntities` decodes `&amp;`
  LAST so `&amp;lt;` stays `&lt;`. None of those outputs is rendered as HTML
  today — this is defence in depth, in one place. The townhall search's
  two-layer `\` escape is intentional (ILIKE metas + PostgREST `or()`
  quoting) and was dismissed with that reasoning.
- **Insecure randomness (13)** — every hit was a chat/visitor **session id**
  minted with `Math.random()` and sent to the server (the agent widget reads
  `/session/<id>/turns` by it). `lib/clientId.randomId()` (WebCrypto
  `randomUUID`, `getRandomValues` fallback, throws rather than degrade)
  replaces all nine generators; the `Math.random() < 0.7` simulated-answer
  lines were the same taint path and clear with them.
- **ReDoS (12)** — bounded email regexes + a 320-char cap (invite,
  respondents); `^_+|_+$` trims became `^_`/`_$` (after the preceding
  collapse there is at most one separator — same output); trailing-run trims
  became linear walks (botProbeGuards, substack); the docket-id regex got
  bounded quantifiers + a length cap; the exponential `URL_ONLY_RE` used in
  two places is now `lib/urlOnly.isUrlOnly`, a token walk (tested at 50k
  adversarial chars < 200 ms).
- **XSS through DOM (5)** — `HelpWidget` rendered `<a href>` from model text
  with no scheme check: `javascript:` was clickable; http(s) only now, else
  plain text. `ChatPane`/`MobileChat` already constrain the URL to
  `https?://` in the link regex (dismissed as such); the two admin `<Link>`s
  encode their DB ids (dismissed: internal path, admin-only).
- New tests: `tests/unit/htmlStrip.test.ts` (fixed point, whitespace in
  closing tags, decode order, out-of-range numeric refs, `isUrlOnly`,
  `randomId`).

Next `main` analysis should leave CodeQL at ~0 open; then make it a
required check (SECURITY.md §9).

## 2026-09-15 — SECURITY item 8 ratified

Owner ratified the §3 defaults as proposed: MFA required for platform
admins, optional for customer org admins, off for regular users until the
first paying customer; platform-admin sessions 30 min idle / 24 h max
(app-enforced — Supabase JWT expiry is project-wide). Item 8 becomes an
enforcement item: idle timeout first (no enrollment dependency), then the
`aal2` check in `requireAdmin` behind a TOTP enrollment screen with a grace
window. The §10 on-call escalation policy still awaits a second operator.

## 2026-09-15 — Admin session policy enforced (item 8 (ii))

Hours after ratification: `lib/auth/adminSession.ts` — a signed HttpOnly
activity stamp (`start.seen.hmac`, HMAC keyed from the existing server
secret; no new env, no migration) refreshed by `requireAdmin` on every admin
API call and by `proxy.ts` on every page navigation; `app/admin/layout.tsx`
checks hard loads. 30 min idle / 24 h max → 401 `{reason}` on APIs, redirect
to `/login?reason=idle|max` on pages (LoginForm ends the Supabase session and
says why). The design point that matters: no stamp or a tampered one falls
back to Supabase's `last_sign_in_at`, so deleting the cookie can only force a
re-login, never extend a session; a newer sign-in supersedes an old stamp.
proxy.ts's matcher now covers pages too (skipping `_next/`, files, favicon).
12 unit tests on the evaluator, 4 on `requireAdmin`. **Verified live** against
the dev server (TEST project): expired-idle and expired-max stamps → 401
`{reason}` on an admin API; expired stamp on `/admin` → 307 to
`/login?reason=idle` with the cookie cleared; a fresh stamp is re-issued with
`seen` advanced and `start` preserved; non-admin traffic untouched; the
`/login` notice renders (browser check — it is client-rendered under
Suspense, so curl never shows it; the first pass had placed it in the
magic-link form, fixed). Item 8 (i) — the `aal2` MFA check behind an
enrollment screen with a grace window — remains.

## 2026-09-20 — Admin-session verify harness committed

`docs/TESTING.md` already tells the reader to run
`bash scripts/_adminSessionVerify.sh`, but the script was only staged and its
stamp generator (`scripts/_adminStampGen.ts`) was gitignored by the
underscore rule — a documented command that could not run from a clean
checkout. Both are now tracked (the generator force-added; it prints stamps,
never the key), and the script's hardcoded home-directory `cd` is now
relative to the script. No app behavior change.

## 2026-09-20 — Post-push alert cleanup: usage-link encoding, devalue pin, Tailwind 4 held

The push of the 9/15 security work re-ran CodeQL and left two `high`
`js/xss-through-dom` alerts plus one fixable Dependabot alert.

- **`app/admin/usage/UsageClient.tsx:364`** — last week's edit encoded the DB ids
  in the resource `<Link>`, which changed the alert's fingerprint: the dismissed
  #51 came back as a new #71, now tracing the custom-range `from`/`to` date
  inputs into the href unencoded. Both are now `encodeURIComponent`'d, along
  with the two fetch query strings that built the same range (list + detail
  page). For the `YYYY-MM-DD` values the inputs produce, the output is
  byte-identical, so nothing visible changes.
- **`components/ui/HelpWidget.tsx:59`** — no code change. The link regex and the
  explicit `^https?://` test both constrain the scheme; CodeQL does not model a
  regex test as a sanitizer. Dismissed as a false positive with the same written
  reason as the identical renderers #53/#54.
- **`devalue` 5.8.1 → 5.9.2** — our own `overrides` pin held it at the vulnerable
  version, which is also why Dependabot's security-update run failed rather than
  opening a PR (ENGINEERING.md "Dependency overrides age" now records the
  recurrence). Verified: round-trip of Date/Map/BigInt on 5.9.2, full suite,
  audit gate, local production build.
- **Tailwind 4** added to the Dependabot major-ignore list: CSS-first config is a
  migration with a visual pass on every screen, not a bot PR (#42 failed e2e).

Left alone on purpose: the two `image-size` alerts (no upstream fix; allowlisted
with a 2027-03-01 review date) and PR #39, which fails the lint ratchet because
the newer eslint plugins report more `react-hooks` warnings than the ceiling —
the ceiling does not get raised to admit a bot PR.

## 2026-09-20 — Dependabot PR #39 landed by hand: dev-dependency group + `hardNavigate`

**Correction to the entry above:** PR #39 did NOT fail on `react-hooks`
warnings. Measured against the CI logs, every existing rule had the same count
on the PR as on main (167); the 14 extra warnings were all one NEW rule that
`eslint-config-next` 16.3 ships, `@next/next/no-location-assign-relative-destination`.

All 14 sites were intentional full page loads after a server-side mutation
(one carries the comment "full page load to ensure fresh server data"), plus
one navigation-style CSV export. Converting them to `router.push()` would have
changed behavior on 14 flows for a lint bump, so they now call
`lib/hardNavigate.ts` — `window.location.assign(path)` behind a name that says
why. Same browser behavior (checked in Chrome against the local server:
`location.assign('/login?reason=idle')` produced a `navigate`-type document
load and wiped page state). The rule stays on; the ceiling stays at 167.

The twelve dev-dependency bumps from the PR were applied on main rather than
merged, so the code fix and the bump ship as ONE build. Two packages npm
resolved past the PR (autoprefixer 10.6.1, tsx 4.23.15) were under the 7-day
cooldown and are held at the PR's versions (10.5.5, 4.23.13);
`eslint-config-next` 16.3.5 is nine days old and matches `next` 16.3.5.
Verified: clean tsc, 2,471 tests, audit gate, local production build (same two
optional-provider warnings as before), eslint on the ten touched files with
the new plugins — 0 hits on the new rule. Not verified: the signed-in flows
themselves in a browser (the local site needs a login).

## 2026-09-20 — Dependabot #37 + #41 applied on main (CI actions, jest-dom 7)

Both PRs were green on their own CI. Applied by hand so every open Dependabot
PR ships in one build rather than one build per merge. #37: `actions/checkout`
and `actions/setup-node` v4 → v7 (GitHub had been force-running the v4 actions
on Node 24 with a deprecation warning on every job), `gitleaks-action` v2 → v3;
the diff is line-for-line the PR's. #41: `@testing-library/jest-dom` 6 → 7, dev
only, consumed solely by `tests/setup.ts`; full suite green on it.
