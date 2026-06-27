# Sentimetrx — Engineering Standards

How we write, review, ship, and operate code. Linked from `CLAUDE.md` —
this doc is the **policy**; CLAUDE.md is the playbook for the AI
assistant.

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
- **`npm run lint` — toolchain migration pending (Next 16).** Next 16
  **removed the `next lint` command**, so the `"lint": "next lint"`
  script is stale and the eslint 8→9 + flat-config migration
  (`eslint-config-next`@16 peer-requires eslint ≥9) is deferred — Open
  `<TBD>` item 10, expanded. Lint is **not in CI** (CI = typecheck +
  `npm test`) and no git hook runs it, so nothing is gated meanwhile.
  Also note Next 16's `next build` **no longer runs ESLint**, so the
  2026-05-12 failure mode (374 pre-existing violations breaking deploys
  when `no-floating-promises` / `no-misused-promises` were briefly
  `error`) can no longer occur via build. Prior config was
  `next/core-web-vitals` + `@typescript-eslint` with those rules at
  `warn`; the flat-config migration should re-establish them, then fix
  the 374 violations and promote back to `error`.
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

- **`main` is protected.** Push directly only via owner override in
  emergencies (log the override reason in the next devlog).
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

SQL migrations live in `sql/` numbered `NNNN_name.sql`. Applied to
prod via `supabase db query --linked --file sql/NNNN_name.sql` (CLI
already linked).

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

- **Structured payloads, even without a logger.** No `lib/log.ts`
  module exists today (SECURITY.md Open `<TBD>` item 12). The
  *target* state is that prod handlers call `console.warn` /
  `console.error` with a **single object argument** — never an
  interpolated string — so the Vercel log viewer can parse and
  grep on fields:

  ```ts
  console.warn({
    event: 'rate_limit_hit',
    request_id, org_id, user_id,
    route: '/api/datasets/[datasetId]/search',
  });
  ```

  Today's reality: nearly every prod handler still uses the
  `console.error('[trim] error:', err)` interpolated-string form
  (>95 occurrences in `app/api/**` at last audit). Migrating those
  is Open `<TBD>` item 20. `console.log` is OK in tests and
  scripts, never in prod handlers.
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
- **Request IDs:** *target* state — generated in `proxy.ts`
  (or upstream), added to every response header (`x-request-id`),
  included in every log payload's `request_id` field for that
  request. Today `proxy.ts` only enforces CSRF; no request
  ID is generated or propagated. Vercel adds its own `x-vercel-id`
  header upstream, which is the de facto correlation key until
  Open `<TBD>` item 21 lands.
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
  `lib/email/provider.ts`). The cron emails `CREDITS_ALERT_TO` (falls
  back to `SENTRY_ALERT_TO`) when any service is low/critical/error,
  throttled to ~once/day per service. Built after a DataForSEO HTTP 402
  silently stalled a review load (Rubio's, 2026-06-16). All monitor
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

---

## 6. Accessibility

Target: WCAG 2.1 AA on every customer-facing surface (`/s/[guid]`,
`/b/[guid]`, `/th/[guid]`, all `/admin/*` pages). Internal-only
prototypes can lag.

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

Today: push to `main` → Vercel auto-deploys to production.

Constraints:

- **Every push to `main` IS a release.** No "let me try this and
  see" pushes — every commit ends up serving traffic.
- **Pushing is gated on EVERY branch, not just `main`** (CLAUDE.md
  push policy). No `git push` to a feature / `claude/*` / PR branch
  without explicit human say-so — each one triggered a Vercel build.
- **Preview builds are disabled.** `scripts/vercel-ignore-build.sh`
  is wired as the project's **Ignored Build Step** (Settings → Git):
  only Production deployments build; every Preview build is skipped
  (exit 0). So branch/PR pushes no longer burn builds — the only way
  to deploy is an authorized push to `main`. (Flip the script's
  per-env logic if preview QA is ever wanted again.)
  - **Docs-only production deploys also skip** (added 2026-06-16): a
    merge to `main` whose `HEAD^..HEAD` range touches only `docs/`
    (markdown specs + the weekly governance files) exits 0, so the
    weekly devlog / spec-drift PRs don't each cost a production build.
    Defaults to BUILD if `HEAD^` is unreachable (shallow clone).
- **Rollback:** `vercel rollback <previous-deployment-url>`.
  Instant. Use it instead of a hotfix when the issue is "previous
  version was fine, current is broken."
- **Database migrations and code releases are coupled** — a
  migration that adds a column ships in the same commit as the
  code that reads/writes it.
- **Manual gate for risky changes (post first paying customer):**
  introduce a `deploy: manual` label on risky PRs that holds the
  Vercel auto-deploy until owner approves on the preview URL.
  Today the solo-team scale doesn't justify the friction.
  Open `<TBD>` item 19.

**How we verify:** every push to `main` produces a Vercel
deployment; rollback is one CLI command if the post-deploy smoke
check fails. The "manual gate" check is on the honor system until
item 19 lands.

### Build command — Turbopack opt-out (Next 16)

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
- **`rollup.ts`** — `rollupAgentEntitiesToBrand(service, {agentId, orgId, brandTag?})` promotes an agent's curated `entity_catalog` (scope='bot') into its **brand collection's** catalog (scope='collection') so the brand glossary is authoritative across products. Additive/non-destructive (pure core `mergeBotEntitiesIntoBrand`: first-canonical-wins, aliases union, sample_count accumulate, never trample a manual/hidden brand row). The bot→brand link is `agents.brand_tag` (`sql/136`); fired on entity extract/curate. (Phase 3, 2026-06-27 — BOTS.md §9.y.2b.)

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
consumer reads. Still siloed: Town Hall's pair-shaped polish (`polishQaPairs` —
Q&A pairs vs flat verbatims) and the survey pipeline (Phase 4).

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
