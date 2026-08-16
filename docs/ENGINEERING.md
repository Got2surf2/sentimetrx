# Sentimetrx — Engineering Standards

How we write, review, ship, and operate code. Linked from `CLAUDE.md` —
this doc is the **policy**; CLAUDE.md is the playbook for the AI
assistant. Sibling policy docs: `docs/SECURITY.md` (security truth) and
`docs/COMPLIANCE.md` (trigger-mapped compliance checklist, added
2026-07-03 — privacy notice, DPAs, SSO, GDPR/DSR, residency).

Items marked `<TBD: …>` are decisions awaiting human approval. Track
each decision in `docs/weekly-reports/YYYY-WXX-devlog.md`.

Each section ends with a **How we verify** line stating the concrete
check (CI step, npm script, manual cadence) that audits it. If the
verification is `<TBD>`, the standard is aspirational, not measurable.

Last reviewed: 2026-05-15.

---

## 1. Code quality bar

- **TypeScript strict mode** — enforced by `tsconfig.json`. No
  `// @ts-ignore` or `any` without an inline comment explaining
  *why*. Reviewers can reject on this alone.
- **`npm run typecheck` must pass** before any commit. CI re-runs
  it.
- **`npm test` must pass.** Unit + integration; mocks at every
  external boundary (Supabase, Anthropic, Resend, S3). CI runs the
  coverage variant (`npm run test:coverage`), which enforces a
  ratcheting coverage floor (`coverage.thresholds` in
  `vitest.config.ts`) — a drop below the floor fails CI. The floor is
  raised as tests are added; see `docs/TESTING.md`.
- **Multi-tenant isolation runs in CI (2026-07-02).** A separate
  `isolation` job runs the env-gated RLS/egress/auth-flow suites
  (`test:rls`, `test:egress`, `test:auth-flows`, `test:campaign-egress`,
  `test:dataset-egress`) against real Supabase creds (`SUPABASE_TEST_*`
  repo secrets). These suites `describe.skip` when creds are absent and
  vitest still exits 0, so the job has a **fail-loud preflight**: it
  hard-fails if the secrets are missing/placeholder, so a green check
  means isolation was actually tested, not silently skipped. Owner
  follow-up: populate the secrets and make the job a required check.
- **Lint is live in CI (2026-07-02, Open `<TBD>` item 10 CLOSED).**
  Migrated to **eslint 9 flat config** (`eslint.config.mjs`, replacing
  `.eslintrc.json`): `eslint-config-next@16`'s native flat config +
  `typescript-eslint@8` with type-aware parsing (`projectService`), same
  rules as before at `warn` (`no-floating-promises`, `no-misused-
  promises`, `no-explicit-any`, `consistent-type-imports`). `next lint`
  is gone; `npm run lint` = `eslint .`. **CI runs `npm run lint:ci`
  (`eslint . --max-warnings 269` as of 2026-07-13)** — a **warn-only
  ratchet**: 0 errors, and the ceiling fails CI only if new code pushes
  the count UP. Burn the number down (edit the `lint:ci` ceiling in
  `package.json` as warnings are fixed), same as the coverage floor; once
  a rule's warnings hit 0, promote it to `error`.
  **`no-explicit-any` burn-down — COMPLETE, rule promoted to `error`
  (2026-07-13).** A 16-wave multi-agent sweep (2026-07-07) took total
  warnings **3,060 → 358** and `no-explicit-any` specifically
  **2,787 → 83** (−97%); a final wave (2026-07-13) resolved the residual
  77 (recounted) with real derived types — discriminated unions,
  chatCore `agent`/`body`, plotly shim — leaving exactly **one** scoped
  justified `eslint-disable` (`lib/townHallAdapter.ts` legacy payload
  return read by a stale verify script). All annotation-only (no runtime
  change), each wave `tsc`-clean + tests green, ceiling lowered every
  wave. Method (reusable — `scripts/_wf-eslint-burndown.js`, untracked):
  one agent per file in an isolated git worktree types the file with
  real interfaces/imports, verifies `tsc` in isolation, returns the
  file; a consolidation pass applies them, runs global `tsc` + tests,
  and reconciles the cross-file conflicts the isolated agents can't see
  (prop-type cascades, index-signature mismatches). The remaining ~269
  warnings are `react-hooks/*` (a separate, behavior-sensitive effort)
  plus a handful of `no-img-element`/misc.
  Note: `eslint-plugin-react-hooks@6` (bundled with next 16) ships new
  ERROR-level rules (`set-state-in-effect`, `purity`, …) — demoted to
  `warn` in the flat config so they ride the ratchet rather than hard-
  fail on the god-components. (Next 16's `next build` doesn't run ESLint,
  so lint gates via CI only.)
  Lint-ignored by design (2026-07-03): `scripts/_*` (active one-off
  scratch scripts, untracked convention) and `scripts/oneoff/**` (the
  committed one-off provenance archive — see its README; not operating
  code, so it doesn't gate the promoted-to-error rules).
  **`no-explicit-any` is now an `error` (2026-07-13)** — a new `any`
  fails CI outright, no ratchet slack. **Use `unknown` + a narrowing
  guard, a real interface/imported type, or `as unknown as T` only at a
  genuine external boundary (untyped DB row, `res.json()`).** A scoped
  `eslint-disable-next-line … -- <reason>` is the escape hatch for a
  genuinely untypeable spot, and the reason must be concrete.
  Touch-it-fix-it (2026-07-02) still applies to the remaining warn-level
  rules: clear the warnings in the parts you touch, then lower the
  `lint:ci` ceiling if the total dropped.
- **No dead code.** If a function is unreferenced for ≥1 week of
  active development, delete it. Reviewers can ask "where is this
  called?" and the answer must exist in the diff or repo.
- **No commented-out code** in committed PRs. Either delete it or
  ship a feature flag.
- **Cyclomatic complexity** — heuristic, not a hard rule. A
  function over ~50 lines or 5 levels of nesting is a smell;
  reviewer judges whether to split.
- **File size** — modules over ~400 lines are a smell; reviewer
  judges whether a structural reason justifies it.
- **`server-only` package** on every file that imports a
  service-role secret. Load-time guard against accidental client
  bundling.

After multi-file sweeps: `rm tsconfig.tsbuildinfo && npx tsc --noEmit`
— incremental tsc cache can mask stale-import bugs.

**How we verify:** `npm run typecheck` + `npm test` + `npm run lint`
on every push (CI). CI runs on **Node 24** (`actions/setup-node`),
matching the dev environment so `npm ci` resolves the committed
lockfile identically — a Node-version skew between local (npm 11)
and CI (npm 10) silently rejected an otherwise-valid lockfile in
W22. The complexity / file-size heuristics are reviewer-enforced;
`server-only` placement is reviewer-enforced on any PR adding a
service-role import.

---

## 2. Branch & review policy

- **`main` is protected — ENFORCED 2026-07-03.** GitHub branch
  protection on `main`: required status checks `typecheck + tests` and
  `multi-tenant isolation (RLS + egress)`, force-pushes and deletion
  blocked for everyone. `enforce_admins` is OFF — the owner-authorized
  direct push (the documented solo-operator flow) bypasses the check
  requirement; CI still runs on every push and a red run is fixed
  forward immediately. Flip `enforce_admins` on when the team grows or
  an enterprise DD requires it (COMPLIANCE.md T3).
- **All other changes** go via PR. Even single-line fixes.
- **AI-agent sessions are an owner-directed exception** (see `CLAUDE.md`
  → "Branch policy"): Claude Code sessions commit **directly to local
  `main`** (no feature branch) so the owner can test locally without
  branch juggling. The protection above still holds for the *remote* —
  the **owner-authorized push is the review gate** (the owner diff-reads
  before authorizing the push, satisfying the solo-founder self-review
  requirement; pushes still never use `--force` or `--no-verify`).
- **PR requirements:**
  - Linked spec or issue (`SPEC.md`, `docs/FEATURES.md`, or
    a `docs/specs/*.md`)
  - All CI checks green
  - **Reviewer policy (pilot stage):** solo founder self-reviews
    via diff-read before merge. **At team-of-two:** 1 reviewer
    required on every PR. **At team-of-four:** 2 reviewers on
    security-sensitive paths, 1 on the rest, with a `CODEOWNERS`
    file pinning `lib/auth/`, `proxy.ts`, `sql/`, and
    `lib/guardrails.ts`.
- **PR scope:** one logical change per PR. "Refactor + new
  feature" PRs get split.
- **Commit messages:** sentence-case, present tense, ≤72 char
  subject. Body explains *why*, not *what*. Co-Authored-By trailer
  preserved when AI-assisted.
- **No force-push to `main` ever.** No `--no-verify` ever (hooks
  exist for a reason).
- **Spec-drift pre-commit hook.** `.githooks/pre-commit` runs
  `scripts/check-spec-drift-staged.ts`, which uses `scripts/specMap.ts`
  to flag staged code that maps to a spec doc that isn't also staged.
  Installed automatically by the `postinstall` script
  (`git config core.hooksPath .githooks`). Bypass with
  `SKIP_SPEC_CHECK=1 git commit ...` when the change is genuinely
  doc-irrelevant (pure refactor, formatting). The Monday spec-drift
  routine still runs as a weekly safety net.
- **Devlog-drift pre-commit hook.** Same hook also runs
  `scripts/check-devlog-drift-staged.ts`. Blocks the commit when any
  staged file under `app/`, `lib/`, `sql/`, `components/`, `scripts/`,
  `proxy.ts`, `next.config.*`, or `vercel.json` is present and
  no `docs/weekly-reports/YYYY-WXX-devlog.md` file is also staged.
  Bypass: `SKIP_DEVLOG_CHECK=1 git commit ...` for genuinely trivial
  commits (typos, whitespace, package-lock churn, dep bumps with no
  behavior change). The rule exists because every meaningful change
  should leave a traceable WHY in the same commit — a one-person-shop
  buyer-DD posture can't rely on tribal knowledge.

**How we verify:** GitHub branch protection rules on `main` +
`gh pr view --json reviewers` audit at quarterly cadence.

---

## 3. Migration safety

SQL migrations live in `sql/` numbered `NNNN_name.sql`. Apply with
**`npm run migrate sql/NNNN_name.sql`** (`scripts/apply-migration.ts`) —
it runs the file against the linked project, **records it in the
`schema_migrations` ledger** (sql/147) so "applied to prod but not
committed" (or vice-versa) is detectable, **and refreshes the committed
schema snapshot `docs/db/schema.sql`** (2026-07-03 — the repo's
recreate-from-nothing artifact; commit the refreshed snapshot with the
migration; `npm run schema:snapshot` regenerates on demand, and
`docs/DATABASE.md` is the human data dictionary over it). The bare
`supabase db query --linked --file …` still works but skips both —
prefer `npm run migrate`.

- **Applied-state ledger (`schema_migrations`, added 2026-07-02).**
  `npm run migrate:status` (`scripts/migrations-status.ts`) diffs the
  `sql/NNN_*.sql` files against the ledger and reports drift: committed-
  but-not-applied, sha-changed-since-apply, and applied-but-file-gone.
  **One-time bootstrap (owner):** apply `sql/147`, then
  `tsx scripts/migrations-status.ts --backfill` to seed the ledger with
  every current file marked applied. After that, `migrate:status` is a
  candidate CI step.

Rules:

- **Migrations should run in a transaction where practical.**
  Explicit `BEGIN; … COMMIT;` is the safest pattern; about a third
  of `sql/NNN_*.sql` files do this today (`061_brand_backfill`,
  `062_brand_tag_trigger`, `066_brand_rules_and_schema`, etc.) and
  the rest rely on the per-statement implicit transaction the
  Postgres driver gives each statement. If your statement needs
  to be outside a tx (e.g. `CREATE INDEX CONCURRENTLY`), call it
  out at the top of the file and split into a separate numbered
  migration. Promoting "every file is explicitly wrapped" from
  practice to enforced rule is Open `<TBD>` item 24.
- **Backwards-compatible changes first.** A column rename = add
  new + backfill + ship code reading both + remove old in a later
  migration. Never a single-step rename in a deployment that's
  serving traffic.
- **Destructive changes (DROP COLUMN, DROP TABLE, TYPE change)
  require an explicit reviewer check** — the PR description must
  call out the destructive operation and confirm:
  1. The dropped surface is no longer read or written anywhere
     in the codebase (grep evidence in the PR)
  2. A backup exists immediately before the migration runs
  3. The rollback plan is documented in the PR
- **Every new `public` table:** RLS + policy + RLS test (see
  `SECURITY.md` §2).
- **Indexes:** added in their own migration where reasonable, with
  query-plan or row-count justification in the PR description.
- **No migration is "applied silently."** Each one ends up in the
  weekly devlog with one line on what changed and why.

**How we verify:** PR template requires the migration checklist
(transaction, backwards-compat plan, RLS+test for new tables);
quarterly governance routine grep-checks every `sql/NNN_*.sql`
file landed in the prior quarter against the weekly devlog for
its corresponding entry.

---

## 4. Logging & observability

- **Structured payloads.** `lib/log.ts` is the logger (landed
  2026-07-02 — see below). Where a raw `console.warn` /
  `console.error` is still justified, use a **single object
  argument** — never an interpolated string — so the Vercel log
  viewer can parse and grep on fields:

  ```ts
  console.warn({
    event: 'rate_limit_hit',
    request_id, org_id, user_id,
    route: '/api/datasets/[datasetId]/search',
  });
  ```

  Catch-sites and Supabase-error branches in `app/api/**` now route
  through `serverError`/`logError` (2026-07-02 sweep); remaining
  interpolated-string `console.error`s are non-response diagnostics —
  migrate opportunistically (Open `<TBD>` item 20). `console.log` is
  OK in tests and scripts, never in prod handlers.
- **Log levels:**
  - `error` — caught exception, request 5xx, integration timeout
  - `warn` — recoverable degradation, retry succeeded
  - `info` — request start/end, side-effecting writes (use
    `console.warn` today until the logger lands and gives us a
    real `info` level)
  - `debug` — gated by env, never in prod by default
- **PII redaction** is the caller's responsibility today
  (Section 5 of SECURITY.md). When the logger lands, redaction
  moves to the logger boundary.
- **Sentry** (`sentry.client/edge/server.config.ts`) catches
  uncaught exceptions. All three configs wire `beforeSend` to
  `lib/sentryScrub.ts`, which redacts `request.{data,body,cookies}`
  + auth/cookie headers, removes PII key names (email, phone,
  password, token, secret, …) from `extra` / `contexts` / `tags`,
  reduces `user` to `{id}` only, and pattern-scrubs email + phone
  strings in breadcrumb messages. Also drops the Microsoft Office
  "Object Not Found Matching Id…" content-script false positive.
  SECURITY.md Open `<TBD>` item 1 is closed.
- **`/admin/sentry` triage (`components/admin/SentryDigest.tsx`, added
  2026-07-09):** the digest page lists live unresolved issues (read via
  `fetchUnresolvedIssues`) and now lets an admin **Resolve** or **Archive**
  each one in place. The mutation goes through `POST /api/admin/sentry/issues`
  (`requireAdmin`-gated, validates `status ∈ {resolved,ignored,unresolved}`)
  → `updateIssueStatus` in `lib/sentry.ts`, which PUTs Sentry's project-scoped
  issues endpoint server-side so the encrypted `SENTRY_AUTH_TOKEN` never
  reaches the browser. "Archive" maps to Sentry's API status `ignored`.
  Resolving is safe-by-default: Sentry auto-reopens a resolved issue on the
  next event, so a wrong call resurfaces as new signal rather than hiding a
  live bug. The token/org/project are only set in prod (encrypted Vercel env),
  so the write is exercised in production; `tests/unit/sentryUpdate.test.ts`
  locks the request shape + ok/non-ok/unconfigured branches via a mocked fetch.
- **`serverError()` is the standard 500 (`lib/apiError.ts`, added
  2026-07-02).** Route handlers catch their own errors and return
  JSON, so those errors never reach Sentry's auto-instrumentation
  (which only sees UNhandled throws) — and returning `{ error:
  err.message }` leaks raw Postgres/driver strings to clients. Use
  `return serverError(err, 'where.tag', {extra})` at every
  Supabase-error branch and catch-site instead: it `captureException`s
  the real error (with a `where` tag) + `console.error`s it, and
  returns a generic `{ error: 'Internal server error' }`. **Adopted
  across all of `app/api/**` (2026-07-02 sweep, ~250 conversions)** —
  no route ships a raw caught-exception/driver message in a 5xx body
  anymore. Known intentional exceptions: BYO-API-key routes that
  forward upstream Anthropic auth/quota errors (insights,
  expand-keywords, merge-themes, mine-themes), the SSRF-guard copy in
  `bots/fetch-url`, cron diagnostic bodies (`org-snapshot`), and the
  admin erasure-incomplete table list. New routes must use
  `serverError` from day one.
- **`lib/log.ts` — structured logger (2026-07-02, Open `<TBD>` item 12).**
  `logError(where, err, {orgId, ...})` emits one structured console line
  AND captures to Sentry tagged with `where` / `request_id` / `org_id`,
  so a tenant's `x-request-id` joins to both the logs and the Sentry
  event. Best-effort, never throws; safe to call un-awaited
  (`void logError(...)`) at fire-and-forget sites. **`serverError` now
  routes through it** (it's `async` — `return serverError(...)` inside an
  async handler is transparent), so every `serverError` call site gets
  the request/org tags for free. Use `logError` at the `if (error)`
  branches that currently swallow a Supabase error and return a
  plausible-but-wrong 200. **All of `lib/` is captured (2026-07-02
  sweep)** — every `{data}`-only Supabase read in `lib/**` now
  destructures `error` and fire-and-forgets `logError`, with zero
  control-flow change. Route-level `{data}`-only reads in `app/api/**`
  (~600) remain opportunistic — capture when touching a route; new
  code must not discard `error` silently. **Title carries `where`
  (2026-07-10):** a plain-object error (Supabase/fetch shape) whose
  message is empty serializes to a context-free `{"message":""}` — a
  useless Sentry title that groups unrelated failures. `logError` now
  prefixes the synthesized `Error` with `where`
  (`signalStats.resolveDatasetIds: {"message":""}`), so distinct
  operations get distinct issues; real `Error` instances keep their own
  message + stack. Pass the identifying id (e.g. `{datasetId}`) in
  `fields` so the specific failing row rides along in Sentry extra data —
  `lib/signalStats.ts` does this at all six `logError` sites.
- **Request IDs (DONE, corrects an earlier stale note):** `proxy.ts`
  stamps `x-request-id` on **every** inbound request (generating one if
  the client didn't send it) and echoes it on the response;
  `lib/requestContext.getRequestId()` reads it and `lib/log` injects it
  into logs + Sentry tags. (The prior "proxy.ts only enforces CSRF"
  claim was wrong.) Open `<TBD>` item 21 is closed.
- **CSRF bypass allowlist (`proxy.ts`):** grew by one public,
  no-cookie route on 2026-06-03 — the agent widget-open beacon
  `/api/bots/[id]/impression` (pattern-matched, wildcard CORS,
  rate-limited). Every addition stays documented inline in
  `proxy.ts` and in SECURITY.md's CSRF section.
- **Performance traces:** Sentry performance — **ratified default:
  10% prod sample, 100% on errors.** Revisit if cost > $X/month
  or if signal is too sparse.
- **Service-credit monitor** (`lib/serviceHealth.ts`, `service_health`
  table `sql/126`, added 2026-06-16): single source of truth for
  "are we out of credits on any vendor". Two tiers — **tier 1** polls a
  balance API (DataForSEO, Deepgram, Twilio) on a 6h cron
  (`/api/cron/service-balance`) and on `/admin/health` load; **tier 2**
  has no balance API (Anthropic, OpenAI, Resend, Google Places) so the
  client error paths call `recordCreditError()` on a 402/429/credit
  failure (`lib/ai.ts`, `lib/dataforseo.ts`, `lib/places.ts`,
  `lib/email/provider.ts`). **Alerting (`lib/serviceAlerts.ts`,
  2026-07-12):** emails `CREDITS_ALERT_TO` (falls back to
  `SENTRY_ALERT_TO`) on TWO paths — the 6h cron (backstop; `low` =
  "close to the limit" re-alerts ~every 3 days, critical/error ~daily —
  the cron had only ever sent critical/error despite its header) and a
  REAL-TIME path: `recordCreditError()` now emails the moment a
  credit/quota failure lands (claim-then-send on `last_alerted_at`, so
  a burst of concurrent 402s yields one email; same ~daily throttle).
  The `/admin/health` Claude credit probe feeds the same path, so
  exhaustion alerts even on a zero-traffic day. Built after a DataForSEO
  HTTP 402 silently stalled a review load (Rubio's, 2026-06-16). All monitor
  writes are best-effort and never throw — they must not break the path
  they observe.

**How we verify:** spot-check Vercel logs at each quarterly audit
— look for any interpolated-string log line in a prod handler;
flag those PRs. Sentry sample rate is reviewed in the same audit
against billing.

---

## 5. Performance budgets

Targets (not yet automated — reviewer-enforced):

| Metric | Target | Justification |
|---|---|---|
| Initial JS bundle, route-segment | <300 KB gzipped | Mobile parity |
| LCP (Largest Contentful Paint), prod p75 | <2.5s | Core Web Vital |
| Server route p95 latency | <600ms (excl. AI calls) | UX |
| Server route p95 latency w/ Claude call | <8s | AI-aware UX |
| DB query p95 (single statement) | <100ms | Index hygiene |

Watch list:

- **No `select *` in hot paths.** Always project the columns you'll
  use.
- **`dataset_rows_flat` reads are paginated or rows-bounded.** The
  "no sampling under 50K rows" rule is for read-once analytics — UI
  list pages still paginate.
- **Plotly bundle** is the biggest single chunk; only import on the
  charts page (`'plotly.js-dist-min'` via dynamic import).

**How we verify (interim — automation tracked as Open `<TBD>` 14):**
- Bundle size: run `npm run build` and inspect the chunk table
  any time a PR touches client-component imports under
  `app/` or `components/`. Flag if any single chunk crosses
  300 KB gzipped.
- Server latency: Sentry performance dashboard, reviewed at each
  quarterly audit against the table above.
- DB query latency: `EXPLAIN ANALYZE` on any new query touching
  > 1000 rows in dev; result pasted into the PR description.

**Audit registry (2026-07-13).** Every audit/review/sweep is registered in
`docs/AUDITS.md` — scope, where its findings live, and its re-run trigger.
Check the registry before scoping a new audit (don't re-run what exists);
register a new audit in the same commit as its findings doc. Point-in-time
governance questions ("audit-ready?") still require a FRESH tool run — the
registry prevents duplicate scoping, not stale answers.

---

## 6. Accessibility

Target: WCAG 2.1 AA on every customer-facing surface (`/s/[guid]`,
`/b/[guid]`, `/th/[guid]`, all `/admin/*` pages). Internal-only
prototypes can lag.

### PDF template standard (owner directive, 2026-06-28)

Every new PDF template/export MUST, from the start:
1. **Keep sections intact** — a section title must never sit alone at a page bottom with its content on the next page. Wrap each heading WITH its first content block in a `.keep` container (`break-inside:avoid;page-break-inside:avoid`) and give headings `break-after:avoid`. `break-after:avoid` alone is not reliable enough.
2. **Brand name in the top-right running header** of every page.
3. **Confidentiality statement + datanautix references in the bottom footer** of every page (`Confidential…` · datanautix wordmark + datanautix.com · `Page X of Y`).

Use the shared `brandedPdfChrome({ brand, confidentiality })` in `lib/htmlToPdf.ts` (returns the `page.pdf` header/footer templates + the margins that reserve the bands) and the `.keep` CSS pattern in the renderer. Legacy PDFs (recordings `reportPdf`, agent study) predate this — bring them onto the standard when next touched.

### PPTX deck generation — pptxgenjs gotchas (2026-07-15)

1. **NEVER use the `shadow` option on `addText` (or shapes).** Our pptxgenjs version serializes it with out-of-range OOXML values (`dir`, `dist`, `blurRad`, `alpha` all over-multiplied) AND mutates the passed options object, so the corruption **compounds on every slide that reuses the object**. LibreOffice tolerates the file (so PDF conversion + pixel-QC look fine), but **PowerPoint declares the file corrupt, "repairs" it, and strips shapes** — found via the PPFL proposal deck, where slide 3 went blank after repair. For a hard "sticker" text shadow, draw the text twice: a black copy offset ~0.045" behind the real one (see `shadowText()` in `scripts/oneoff/_ppfl_proposal_deck.ts`).
2. **Pixel-QC via LibreOffice is NOT a file-validity check.** Before shipping a deck built with new pptxgenjs features, validate the archive: `unzip` the .pptx and `grep -o '[a-zA-Z]*="[0-9]\{9,\}"' ppt/slides/*.xml` — any 9+-digit attribute value is a corruption red flag (legal alpha max is 100000; angles max 21600000). Ideally also open once in real PowerPoint.

- **Keyboard navigation** must work for every interactive element.
  Tab order is logical; focus-visible styles are present.
- **Color contrast** ≥ 4.5:1 for normal text; 3:1 for ≥18pt.
- **Form fields** have `<label>` (visible or `aria-label`).
- **Typeable inputs render at ≥16px on mobile.** Every
  `<input type="text|email|tel|search|password|number">` and
  every `<textarea>` needs `fontSize: '16px'` (inline) or
  `text-base` (Tailwind) at minimum. iOS Safari auto-zooms the
  page on focus when the input's computed font-size is below
  16px, which shifts Send buttons off-screen and visually
  balloons auto-growing textareas. Already hit `ChatBot` (now
  `fontSize: '16px'`) and the kiosk chat input. Larger is fine
  (OTP-style fields are routinely larger). Doesn't apply to
  `type="file"`, `checkbox`, `radio`, or hidden inputs.
- **Error messages** are programmatically associated with the
  invalid field via `aria-describedby`.
- **Images** have `alt` (descriptive or `""` if decorative).
- **The `LottieLoader` component is the ONLY loader** for
  customer-facing surfaces — it already carries the right ARIA
  semantics; don't write a CSS spinner. **Narrow exception:**
  inline button-busy indicators (≤ 16px, rendered alongside a
  visible "Saving…" / "Publishing…" text label) may use a plain
  CSS spinner because (a) the Lottie JSON loads async and would
  flicker, and (b) the morphing-particle animation has no useful
  rendering at that size. The spinner element must carry
  `aria-hidden="true"` — the adjacent text is the accessible
  status. See `components/creator/CreatorNav.tsx` and
  `components/townhall/THCreatorNav.tsx`.

**How we verify (interim):**
- Manual keyboard-only walkthrough of any customer-facing page
  the PR touches. Reviewer asks "tab through it" in the PR
  description.
- Color contrast: design tokens already constrain palette;
  one-off colors get a contrast-check note in the PR.
- Open `<TBD>` item 15: add axe-core via Playwright to the e2e
  suite for automated coverage.

---

## 7. Feature flags

We don't have a flagging service today. When a change is risky
enough to want a kill-switch:

- **Approach 1 (pilot stage, in force today):** environment-variable
  gates — `process.env.ENABLE_<FEATURE> === 'true'`. Every new flag
  gets a line in `docs/feature-flags.md` (Open `<TBD>` item 16:
  create the file when the first flag lands) with owner + kill-by
  date.
- **Approach 2 (post first customer):** Vercel Edge Config —
  zero-cold-start reads, owned and rotated through the same
  Vercel project surface, no extra vendor. Open `<TBD>` item 16
  ratifies on first customer.
- **Lifecycle:** every flag has an owner + a kill-by date in the
  flag registry. Quarterly review removes dead flags.

**How we verify:** `grep -rn "process.env.ENABLE_" app/ lib/`
listed in the quarterly governance routine — every match must
appear in `docs/feature-flags.md` with a non-expired kill-by date.

---

## 8. Idempotency & replay safety

Routes that get retried by external callers (webhooks, cron,
client-initiated background jobs) must be safe to call twice.

- **Webhooks** (Resend; Stripe and others when they land): the
  *target* state is to require an `idempotency_key` from the caller
  OR derive a deterministic one from the payload, then persist a
  `webhook_events` row on first receipt and short-circuit on
  retry. Today the Resend handler
  (`app/api/campaigns/webhooks/resend/route.ts`) does **not**
  dedupe — it relies on Resend not retrying successful deliveries
  and on the downstream write being effectively idempotent.
  Building the `webhook_events` table + dedupe wrapper is Open
  `<TBD>` item 23.
- **Cron jobs:** scoped to small batches; if interrupted, the next
  run picks up where the last left off. No "did this whole job
  finish?" required.
- **AI tool calls:** Claude can retry — every tool handler must be
  idempotent or check-then-write. Document the idempotency strategy
  inline.

**How we verify:** every new webhook handler PR includes a
"call-twice-with-same-payload" unit test in
`tests/integration/webhooks-*.test.ts` (Open `<TBD>` item 17:
extend the test pattern as new webhook surfaces land).

---

## 9. AI usage discipline

We use Anthropic Claude across multiple flows: analysis generation,
agent conversations, deck/strategy output. Rules:

- **Scoped tool definitions only.** No "execute arbitrary SQL" tool;
  no "make any HTTP request" tool. Each tool is a narrow function
  with a typed schema. (Current state: no Claude tool-use is wired
  in production — every chat flow runs as plain text completions
  through `lib/ai.ts`. This rule is the gate for when tool use is
  introduced.)
- **Single-org prompts.** Never include data from more than one
  `org_id` in a single prompt — protects against accidental
  cross-tenant leak via model context.
- **Input guard:** every free-text user input that goes into a
  Claude prompt passes through `lib/guardrails.ts` for length,
  profanity, URL injection, role-prompt patterns.
- **Output sanitize:** Claude output is treated as untrusted —
  DOMPurify for HTML, manual URL allowlist for any tappable link.
- **Tool result auditing (target):** when tool use lands, every
  tool call's input must be persisted in a structured table
  (planned: the `audit_events` table from SECURITY.md §6) so we
  can replay / audit. Today there is nothing to audit because no
  tools are defined.
- **No PII into prompts unless the org opted in.** Current opt-in
  is implicit-at-onboarding (orgs are walked through the AI
  flow); explicit org-level toggle is SECURITY.md Open `<TBD>`
  item 6.
- **Cost guardrails:** **proposed default — 1M tokens / org / day**
  (alert at 80%, hard-stop at 100%). Implementation tracked as
  Open `<TBD>` item 18: add a `usage_accounting.daily_token_budget`
  column and a pre-call check in `lib/ai.ts`.

**How we verify:** `lib/guardrails.ts` unit tests cover input
checks. Tool-call audit will live in `audit_events` (SECURITY.md
§6) once the table ships AND the first tool-use flow lands —
neither exists today.

---

## 10. Deprecation path

When a feature, table, or function gets removed:

1. **Announce in the devlog** for the week the deprecation begins.
2. **Stop adding callers.** Add a `// @deprecated: <reason, sunset
   date>` comment.
3. **Add usage telemetry** so we can see when the last call
   happened.
4. **Stop emitting new rows** (for tables).
5. **Wait one release cycle minimum (or until telemetry says zero
   calls).**
6. **Hard remove** — code + table — in a single PR. Linked back to
   the deprecation announcement.

Never "delete now, fix the broken caller next week." That's how
we get the 11pm pages.

---

## 11. Dependency hygiene

- **Adding a new dep requires:**
  - License compatibility check (MIT / Apache 2 / BSD = fine; AGPL
    / GPL / SSPL = case-by-case; "custom" license = case-by-case)
  - Maintenance signal — last commit within 12 months, >1
    contributor, no unanswered CVEs
  - Smaller is better — prefer a 30-line copy-paste over a 500KB
    dep
- **Lockfile is the source of truth.** Never edit
  `package-lock.json` by hand; let `npm install` regenerate.
- **Dependabot + `npm audit`:** SECURITY.md Open `<TBD>` item 2
  tracks landing both as CI steps — Dependabot weekly with
  auto-merge on patch bumps, hand-review on minor/major;
  `npm audit --audit-level=high` failing CI on new high-severity
  CVEs.
- **`xlsx` is pinned to a SheetJS CDN tarball** — known posture
  decision (npm version has CVE history). Document and review
  annually (next: 2027-05).

**How we verify:** once item 2 lands, Dependabot PRs in the GitHub
queue + the CI `npm audit` step are the live signal. Until then,
manual `npm audit` is part of the quarterly governance routine.

### `next.config.js` wrap order

Two third-party wrappers compose around the base `nextConfig` object,
and the order matters:

```js
const withWdk = withWorkflow(nextConfig)
module.exports = sentryDsnSet ? withSentryConfig(withWdk, {...}) : withWdk
```

- **`workflow/next` (`withWorkflow`)** — installs the Workflow DevKit
  runtime + the internal `/.well-known/workflow/v1/*` route handler.
  Required for `"use workflow"` / `"use step"` directives to compile.
  Lives inside the Sentry wrap so Sentry instruments the WDK paths.
- **`@sentry/nextjs` (`withSentryConfig`)** — outermost wrapper;
  conditionally applied only when `NEXT_PUBLIC_SENTRY_DSN` is set so
  local dev startup stays fast.

When adding a new wrapper, place it between `nextConfig` and the
Sentry wrap unless the wrapper itself documents a Sentry-outside
requirement.

### Security response headers

`next.config.js → headers()` sends a baseline set on every route (HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) plus
clickjacking headers (`X-Frame-Options`, CSP `frame-ancestors 'none'`) on
the root + authed path prefixes.

`Permissions-Policy` is `camera=(), microphone=(self), geolocation=(),
interest-cohort=()`. **`microphone=(self)`** (not `()`) is deliberate: the
Town Hall live-capture page (`/recordings/[id]/live`) calls `getUserMedia`,
and `microphone=()` hard-blocks it for *all* origins including ours (→
`NotAllowedError` regardless of OS/browser permission). `self` permits the
first-party origin to request the mic (the user still sees the browser
prompt) while cross-origin iframes remain blocked; camera + geolocation
stay fully disabled. A change here is build-time — it needs a dev-server
restart locally and a deploy to reach prod.

---

## 12. Release process

Today: push to `main` → CI (typecheck, lint ratchet, unit +
integration, RLS/egress isolation, **e2e browser smoke vs a
production build** — self-seeded throwaway login on the TEST
project, 2026-07-13; see TESTING.md) → on all-green, the CI
`deploy` job fires a Vercel deploy hook → production build + deploy
(**deploy-behind-CI**, 2026-07-04).

Constraints:

- **Every push to `main` IS a release** — but it no longer races
  CI. `vercel.json` sets `git.deploymentEnabled: { main: false }`,
  so pushes never auto-build; the ONLY production trigger is the
  CI `deploy` job (fires the `VERCEL_DEPLOY_HOOK_MAIN` repo-secret
  hook after every check passes). A red typecheck/test/isolation
  run now means NO deploy, instead of a broken build going live
  while CI ran.
- **Pushing is gated on EVERY branch, not just `main`** (CLAUDE.md
  push policy). No `git push` to a feature / `claude/*` / PR branch
  without explicit human say-so.
- **Preview builds are disabled.** `scripts/vercel-ignore-build.sh`
  is wired as the project's **Ignored Build Step** (Settings → Git):
  every Preview build is skipped (exit 0); Production (which by
  construction arrives via the CI hook) always builds. So branch/PR
  pushes never burn builds. (Flip the script's per-env logic if
  preview QA is ever wanted again.)
- **Docs-only pushes still deploy nothing** — the CI deploy job
  diffs the FULL push range (`github.event.before..HEAD`) against
  `:(exclude)docs` and skips the hook when only `docs/` changed.
  (This decision used to live in the ignore script as a
  `HEAD^..HEAD` diff, which mis-classified a multi-commit push that
  merely *ended* in a docs commit — the range fix is why it moved
  to CI.) Defaults to DEPLOY when the range is unknowable
  (force-push, first push).
- **Manual fallback:** if the hook path is ever broken,
  `vercel deploy --prod` from an authorized laptop deploys
  independently of the git integration.
- **Rollback:** `vercel rollback <previous-deployment-url>`.
  Instant. Use it instead of a hotfix when the issue is "previous
  version was fine, current is broken."
- **Database migrations and code releases are coupled** — a
  migration that adds a column ships in the same commit as the
  code that reads/writes it.
- **Manual gate for risky changes (post first paying customer):**
  introduce a `deploy: manual` label on risky PRs that holds the
  deploy until owner approves on the preview URL.
  Today the solo-team scale doesn't justify the friction.
  Open `<TBD>` item 19.

**How we verify:** every code push to `main` with green CI produces
exactly one Vercel deployment (visible as the deploy-hook build in
the Vercel dashboard); a red CI run produces none. Rollback is one
CLI command if the post-deploy smoke check fails. The "manual gate"
check is on the honor system until item 19 lands.

### Promoting configured entities test → prod

Code releases ship via git push; *configuration* built on the test
project (an agent, a PulseIQ session, a survey) ships via the
promotion framework (`lib/promotion.ts` + `scripts/promote.ts`;
docs/ARCHITECTURE.md D13):

```bash
npm run promote -- export agent <slug>        # test → promotions/*.json
# review the manifest JSON, then:
npm run promote -- import promotions/<file>.json --org <prod-org-uuid> --yes
```

Manifests are versioned, config-only (no responses / conversations /
topics / embeddings), and land dormant — agents and surveys as
`draft`, a PulseIQ session as `draft` with its dedicated facilitator
agent `paused` — so nothing serves traffic until activated in the UI.
Surveys get a fresh guid; slug collisions append `-copy[N]`. A prod
import without `--yes` exits before any prod connection. The agent
manifest is the same `bot_export_version: 1` format the
`/api/bots/[id]/export` route downloads, so both interoperate.
`promotions/` is gitignored — manifests can carry client prompts.

Next 16 makes **Turbopack the default** for `next build` / `next dev`,
and a Turbopack build **fails** when a `webpack` key is present in the
resolved config. Ours injects one via both `withSentryConfig`
(source-map upload) and `withWorkflow`, so we opt out with `--webpack`:
the `build` / `dev` scripts carry the flag, and — critically —
`vercel.json` pins `"buildCommand": "next build --webpack"`. That pin is
load-bearing: the Vercel project's build-command setting was `null`, so
the cloud ran the framework-default `next build` and **ignored** the
flag in the package.json script (`vercel pull` surfaces the resolved
setting). Turbopack adoption is deferred to its own evaluation — it
would require migrating Sentry + Workflow off the webpack plugin. See
`### next.config.js wrap order`.

### Runtime file tracing for `docs/weekly-reports/*.md`

Both `lib/governanceReports.ts` and `lib/specDriftReports.ts`
read markdown files at request time via `fs.readdir` +
`fs.readFile` from `path.join(process.cwd(), 'docs', 'weekly-reports')`.
Next.js' static tracer cannot infer files reached via a dynamic
`readdir`, so without an explicit hint, fresh weekly reports
silently fail to bundle into the serverless function and the
admin Control Reports pages render empty even though the file
is on `main`.

The hint lives in `next.config.js → experimental.outputFileTracingIncludes`:

```js
outputFileTracingIncludes: {
  '/admin/control-reports':            ['./docs/weekly-reports/*.md'],
  '/admin/control-reports/governance': ['./docs/weekly-reports/*.md'],
  '/admin/control-reports/spec-drift': ['./docs/weekly-reports/*.md'],
}
```

If a new admin surface starts reading from `docs/weekly-reports/`,
add its route here too.

The same hint covers runtime-loaded **native binaries**, not just
markdown. `@sparticuz/chromium` (headless-Chrome PDF rendering) is
listed in `serverExternalPackages` so its JS isn't relocated by the
bundler — but it loads its real payload (the brotli-packed Chromium
binary + fonts + swiftshader, ~70MB under `bin/`) at request time via
a computed path the tracer can't follow. Without a trace hint the
function dies at runtime with `input directory ".../@sparticuz/chromium/bin"
does not exist`. Every route that renders a PDF with headless Chrome
needs `'./node_modules/@sparticuz/chromium/bin/**'` traced in:

```js
'/api/recordings/[id]/report/pdf':  ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/recordings/[id]/report/send': ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/bots/[id]/study/pdf':         ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/bots/[id]/readout/pdf':       ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/collections/[id]/project-report/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/datasets/[datasetId]/ad-hoc-report':  ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/community-feedback-deck':     ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/pitch-deck-v2':               ['./node_modules/@sparticuz/chromium/bin/**'],
'/api/pitch-deck-v3':               ['./node_modules/@sparticuz/chromium/bin/**'],
```

When you add a new headless-Chrome PDF route, add its path here too —
it works locally (installed Chrome) but 500s in prod without the hint.

### Shared correction layer (`lib/correction/`)

Product-agnostic verbatim correction, so Town Hall, agent reports (What We
Heard), and surveys all clean text through ONE code path instead of siloed
copies. Three pieces:

- **`normalize.ts`** — pure/client-safe deterministic variant→canonical
  spelling replacement (`buildReplacements`/`normalizeText`) from a
  `{canonical, aliases, category?}[]` glossary. Not an AI rewrite; only listed
  mis-spellings change. (Generalizes the original `lib/recordings/normalize.ts`,
  which now delegates to it.)
- **`glossary.ts`** — `resolveBrandGlossary(service, {orgId, brandTag?, collectionId?, agentId?, datasetId?})` unions the curated `entity_catalog` across the relevant scopes (brand collection ∪ bot ∪ dataset) into one `{canonical, aliases, category?}[]` (the optional `category` is carried through for typed consumers like Town Hall's entity map). `glossaryTerms()` extracts the canonical strings for the polish prompt. (Generalizes `lib/recordings/brandGlossary.fetchBrandEntities`, which now delegates to it.)
- **`polish.ts`** — `polishVerbatims(texts, {glossary, usage})` (Sonnet, glossary-injected, strict no-fabrication) faithfully cleans typos/grammar/mis-hearings; returns an array aligned with input (`null` per item on failure → caller shows raw). (Generalizes Town Hall's `polishQaPairs`.)
- **Brand-glossary editor (Phase 5, 2026-06-27)** — the brand collection's catalog (scope='collection'), once populated only by discovery + rollup, is now hand-editable at `/collections/[id]/glossary` (`BrandGlossaryClient`) via `/api/collections/[id]/entities` (GET/POST) + `/api/collections/[id]/entities/[entityId]` (PATCH/DELETE) + `/api/collections/[id]/entities/refresh` (POST = "Pull from agents" → fans `rollupAgentEntitiesToBrand` over every agent whose `brand_tag` resolves to this collection). Manual add/edit stamps `source='manual'` (authoritative). The editor shows each entity's authority (official vs corroborating, from provenance). Reached via a "Manage brand glossary →" link on the agent Entities page when the agent is brand-tagged. Org-gated by `collections.org_id` pairing.
- **`rollup.ts`** — `rollupAgentEntitiesToBrand(service, {agentId, orgId, brandTag?})` promotes an agent's curated `entity_catalog` (scope='bot') into its **brand collection's** catalog (scope='collection') so the brand glossary is authoritative across products. Additive/non-destructive (pure core `mergeBotEntitiesIntoBrand`: authority-aware canonical via `chooseCanonical`, aliases union, sample_count accumulate, provenance merge, never trample a manual/hidden brand row). The bot→brand link is `agents.brand_tag` (`sql/136`); fired on entity extract/curate. (Phase 3, 2026-06-27 — BOTS.md §9.y.2b.)
- **`provenance.ts`** — entity-catalog source authority + provenance (owner requirement, 2026-06-27). Every catalog row traces to a valid SOURCE, and a **canonical spelling must come from an OFFICIAL record** (crawl / uploaded document) or a human (manual). Conversations / survey responses / ASR transcripts are CORROBORATING — they add aliases + mentions but **never define or override an authoritative canonical** (`canSetCanonical`/`chooseCanonical`, strict). `SourceKind` authority tiers: manual(100) › document(80) › crawl(70) [authoritative ≥ crawl] › transcript(30) › conversation(20) › survey(20) › review(10) › discovered(10). `entity_catalog.source` (widened, `sql/137`) = the kind that OWNS the canonical; `entity_catalog.provenance` (jsonb, `sql/137`) = the per-row source trail `{ "<kind>": {count, refs[]} }`. **Dual-purpose caveat:** the catalog also feeds TextMine analysis, which needs ALL entities (incl. UGC-discovered) — so authority gates the *canonical ownership* + the *correction glossary*, NOT which entities exist. Writers (agent KB extract, dataset/collection discovery, the rollup, manual routes) stamp source+provenance; the correction glossary keeps only authoritative-sourced canonicals (`hasAuthoritativeSource`).

**Invariant:** the raw source is NEVER mutated — correction is a derived/display
layer (Town Hall stores `polished_*` + a corrected-view overlay; the agent
readout polishes only the sample strings in its regenerable cache). Convergence
plan: Town Hall (`lib/recordings/*`) and the survey pipeline migrate onto this
module; bot entities roll up to the brand `entity_catalog` so one brand glossary
serves every product. Consumers: the What We Heard readout (`lib/agentReadout.ts`,
2026-06-27); Town Hall (`lib/recordings/normalize.ts` + `brandGlossary.fetchBrandEntities`
now thin adapters over the shared layer — Phase 2, 2026-06-27, output verified
byte-identical via the recordings unit suite). Phase 3 (2026-06-27) wired the
bot→brand rollup (`rollup.ts`) so agent curation feeds the brand catalog every
consumer reads. Phase 4 (2026-06-27) made **surveys** consume-only: a
`config.brandTag` resolves the brand glossary and deterministically normalizes
exported open-ended verbatims (`/api/studies/[id]/responses?export=` — raw
`responses.payload` never mutated). AI polish is deliberately NOT applied inline
in the survey export (a file download must stay instant; unlike the readout,
which is a cached compute) — it would need a cached/async pass. Still siloed:
Town Hall's pair-shaped polish (`polishQaPairs` — Q&A pairs vs flat verbatims).

### Claude Code push discipline

Codified in `CLAUDE.md` "Push policy" — committed to the repo so it
survives session resets. Summary:

- Claude **never pushes to `main` without an explicit "push" /
  "let's push" from the operator.** Default is commit-only.
- Every push triggers an automatic production deploy on Vercel
  (**~$8–10 build cost**, grows with the codebase, customer-facing
  immediately).
- **Claude only raises a push when the change genuinely can't be
  verified without a production deploy.** Almost everything is
  testable locally — `npm run dev` against the linked prod DB
  (read-only ops like exports cost nothing and mutate nothing),
  `npm run typecheck`, `npm test`, render/QC harnesses. A push is
  for *shipping a verified change*, never to *check that it works*.
- Claude does not ask "should I push?" at the end of every task —
  it surfaces `N commits ahead, not pushed` and waits.
- After an authorized push, Claude runs `gh run list --limit 1`,
  polls if CI is in-flight, and fixes + re-pushes if CI fails (the
  original "push" is treated as authorization for the whole
  intended state landing in `main`).
- No `git push --force` to `main` and no `--no-verify` hook
  bypasses without an explicit ask.

This rule exists because past sessions occasionally drifted into
"the work is clean, may as well push" mode, which conflicted with
the operator's preference to batch-commit + only deploy when
ready. CLAUDE.md is the durable place for it.

---

## Open `<TBD>` items as of 2026-05-15

Renumbered to match in-line references in this doc and to extend
SECURITY.md's numbering (so cross-references work). Items 1-13
are in `SECURITY.md`.

14. **Bundle / latency automation:** add `@next/bundle-analyzer`
    and a CI script that prints chunk deltas on every PR; revisit
    Lighthouse-CI when traffic justifies the runner cost.
15. **a11y automation:** add axe-core via Playwright to the e2e
    suite, gating customer-facing pages on a baseline pass.
16. **Flag registry:** create `docs/feature-flags.md` when the
    first env-var flag lands; ratify Vercel Edge Config as the
    Approach-2 vendor at first paying customer.
17. **Webhook idempotency test pattern:** add the
    `tests/integration/webhooks-*.test.ts` series as new
    webhook surfaces land (Resend events, eventual Stripe).
18. **Daily org token budget:** add
    `usage_accounting.daily_token_budget` (default 1M) + a
    pre-call check in `lib/ai.ts`.
19. **Risky-deploy manual gate:** wire a `deploy: manual` label
    that holds Vercel auto-deploy until owner approves on the
    preview URL. Land at first paying customer.
20. ~~**Structured-logging migration:**~~ DONE 2026-05-16. All 85
    `console.error('[label] ...', err)` sites in `app/api/**` now
    use the single-object form `console.error({ at, msg, err })`.
    Codemod handled 71 mechanical sites; 14 multi-arg sites were
    hand-fixed. `lib/log.ts` (item 12) can swap `console.error`
    for a structured emitter without touching call sites.
21. ~~**Request-ID middleware:**~~ DONE 2026-05-16.
    `proxy.ts` now stamps every /api/* request with an
    `x-request-id` (preserved if the caller supplied one, else a
    fresh `crypto.randomUUID()`). The ID is echoed on the response
    and forwarded into the request scope so handlers can read it
    via `lib/requestContext.ts:getRequestId()`. Used `headers()`
    instead of AsyncLocalStorage because `next/headers` is already
    request-scoped — equivalent ergonomics without a runtime split.
    (Under Next 16 the `proxy` now runs in the **nodejs** runtime,
    where AsyncLocalStorage is fully supported; the headers-based
    approach is retained — it still works and avoids churn.)
    When `lib/log.ts` lands (item 12), it can call `getRequestId()`
    inline. Matcher unchanged (/api/*); expand if/when a server
    component log call site needs it.
22. ~~**CSS spinner cleanup:**~~ DONE 2026-05-16 — formalized as
    "inline button-busy indicator" exception in the a11y rule
    above. `CreatorNav.tsx` and `THCreatorNav.tsx` spinners
    annotated with `aria-hidden="true"` + explanatory comment.
23. ~~**Resend webhook idempotency:**~~ DONE 2026-05-16.
    `sql/071_webhook_events.sql` adds `public.webhook_events
    (source, svix_id)` with a unique constraint; the Resend route
    inserts before mutating campaign state and short-circuits
    23505 unique-violation as `{ deduped: true }`. Fail-open on
    other insert errors. See `docs/CAMPAIGNS.md` for the
    handler-side description.
24. ~~**Migration tx-wrap enforcement:**~~ DONE 2026-05-16.
    `scripts/check-sql-tx-wrap.ts` enforces `BEGIN; … COMMIT;` on
    every new `sql/NNN_*.sql` after the SQL_TX_CUTOFF (currently 70 —
    pre-existing files are grandfathered). Wired into CI as
    `npm run check:sql-tx`. `CONCURRENTLY` cases still need a manual
    bypass: bump the cutoff in the script or delete the new file's
    BEGIN/COMMIT requirement deliberately.
25. **Legacy `dataset_rows` read guard:** DONE 2026-07-02.
    `scripts/check-no-legacy-dataset-rows.ts` (CI: `npm run
    check:no-legacy-rows`) fails the build if any `app/` or `lib/`
    code READS the removed legacy `dataset_rows` batch table — it still
    physically exists with stale residue, so a read compiles and
    silently returns wrong data (this left `theme-impact` broken for
    weeks). `.delete()` calls are allowed (teardown purges residue).

### Never write a raw control byte into source (2026-08-16)

A raw C0 control character used as a string delimiter — written as the byte
itself rather than as an escape — makes `file(1)` classify the source as
**binary**, and **`grep` then silently prints nothing for that file**. An empty
grep result is indistinguishable from "the code isn't there", so every
grep-based survey touching the file is quietly wrong, including automated sweeps
and audits.

This has now bitten twice. First `lib/agentStudy.ts` (2026-07-30), where it
produced a confidently wrong claim that a shipped feature was unwired. Then
again on 2026-08-16: a survey for the stratified-sampling conversion reported
that `lib/sampledAggregate.ts` contained **zero** hash-cursor lines. It contains
five, and it holds the shared `pageSample()` loop that every sampled aggregate
and taxonomy twin routes through — the single most important file in that
migration.

**The rule: write the escape, never the byte.** A `\u0000` escape and a literal
NUL are the *same string at runtime*, and only the escape keeps the file
greppable. Same for `\u0001`, `\u001F`, and any other C0/C1 control character.

Sweep for regressions — anything listed that is not a `.json` file is a bug:

```bash
git ls-files '*.ts' '*.tsx' '*.js' '*.mjs' '*.mts' '*.sql' '*.md' \
  | while read -r f; do
      case "$(file -b "$f")" in *text*) ;; *) echo "BINARY-ish: $f";; esac
    done
```

The 2026-08-16 sweep found and fixed nine files: `lib/sampledAggregate.ts`,
`lib/sampledTaxonomy.ts`, `lib/sampledThemeExtras.ts`, `lib/commentaryReport.ts`,
`lib/researchProbes.ts`, `app/api/datasets/[datasetId]/taxonomy/rows/route.ts`,
`scripts/backfill-taxonomy-embed.ts`, `scripts/pilot-rc-keyword-build.ts`, and —
fittingly — `docs/weekly-reports/2026-W31-devlog.md`, the entry that documented
the *first* occurrence.
