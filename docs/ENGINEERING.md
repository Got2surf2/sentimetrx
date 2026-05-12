# Sentimetrx — Engineering Standards

How we write, review, ship, and operate code. Linked from `CLAUDE.md` —
this doc is the **policy**; CLAUDE.md is the playbook for the AI
assistant.

Items marked `<TBD: …>` are decisions awaiting human approval. Track
each decision in `docs/weekly-reports/YYYY-WXX-devlog.md`.

Last reviewed: 2026-05-12.

---

## 1. Code quality bar

- **TypeScript strict mode** — enforced by `tsconfig.json`. No
  `// @ts-ignore` or `any` without an inline comment explaining
  *why*. Reviewers can reject on this alone.
- **`npm run typecheck` must pass** before any commit. CI re-runs
  it.
- **`npm test` must pass.** Unit + integration; mocks at every
  external boundary (Supabase, Anthropic, Resend, S3).
- **`npm run lint` clean** (eslint with `eslint-config-next` +
  `@typescript-eslint/eslint-plugin`).
- **No dead code.** If a function is unreferenced for ≥1 week of
  active development, delete it. Reviewers can ask "where is this
  called?" and the answer must exist in the diff or repo.
- **No commented-out code** in committed PRs. Either delete it or
  ship a feature flag.
- **Cyclomatic complexity** — no hard cap, but a function over
  ~50 lines or 5 levels of nesting should be split. Reviewer
  judgment.
- **File size** — modules over ~400 lines need a structural
  reason; split otherwise.
- **`server-only` package** on every file that imports a
  service-role secret. Load-time guard against accidental client
  bundling.

After multi-file sweeps: `rm tsconfig.tsbuildinfo && npx tsc --noEmit`
— incremental tsc cache can mask stale-import bugs.

---

## 2. Branch & review policy

- **`main` is protected.** Push directly only via owner override in
  emergencies (log the override reason in the next devlog).
- **All other changes** go via PR. Even single-line fixes.
- **PR requirements:**
  - Linked spec or issue (`SPEC.md`, `docs/FEATURES.md`, or
    a `docs/specs/*.md`)
  - All CI checks green
  - `<TBD: minimum reviewer count — 1 for now (solo team);
    raise to 2 when team grows; codeowners file for
    security-sensitive paths.>`
- **PR scope:** one logical change per PR. "Refactor + new
  feature" PRs get split.
- **Commit messages:** sentence-case, present tense, ≤72 char
  subject. Body explains *why*, not *what*. Co-Authored-By trailer
  preserved when AI-assisted.
- **No force-push to `main` ever.** No `--no-verify` ever (hooks
  exist for a reason).

---

## 3. Migration safety

SQL migrations live in `sql/` numbered `NNNN_name.sql`. Applied to
prod via `supabase db query --linked --file sql/NNNN_name.sql` (CLI
already linked).

Rules:

- **Every migration runs in a transaction.** If your statement
  needs to be outside a tx (e.g. `CREATE INDEX CONCURRENTLY`),
  call it out at the top of the file and split into a separate
  numbered migration so the tx-wrapper is preserved for everything
  else.
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
  a `<TBD: query plan or row-count justification in the PR>`.
- **No migration is "applied silently."** Each one ends up in the
  weekly devlog with one line on what changed and why.

---

## 4. Logging & observability

- **Structured logs only.** `console.log` is OK in tests and
  scripts, never in production handlers — use the project's logger
  (`<TBD: confirm logger module path>`) which emits JSON to stdout
  and tags with `request_id`, `org_id`, `user_id`.
- **Log levels:**
  - `error` — caught exception, request 5xx, integration timeout
  - `warn` — recoverable degradation, retry succeeded
  - `info` — request start/end, side-effecting writes
  - `debug` — gated by env, never in prod by default
- **PII redaction at the logger boundary** (Section 5 of SECURITY.md).
- **Sentry** (`sentry.client/edge/server.config.ts`) catches
  uncaught exceptions. `beforeSend` scrubs PII fields (audit
  config quarterly).
- **Request IDs:** generated in `middleware.ts` (or upstream), added
  to every response header (`x-request-id`), included in every log
  line for that request. A user-reported bug → grep the log for
  the request id from their network tab.
- **Performance traces:** Sentry performance enabled
  `<TBD: confirm sampling rate is sane — 100% will be expensive>`.

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

`<TBD: add Lighthouse-CI or @next/bundle-analyzer to CI for trend
tracking.>`

---

## 6. Accessibility

Target: WCAG 2.1 AA on every customer-facing surface (`/s/[guid]`,
`/b/[guid]`, `/th/[guid]`, all `/admin/*` pages). Internal-only
prototypes can lag.

- **Keyboard navigation** must work for every interactive element.
  Tab order is logical; focus-visible styles are present.
- **Color contrast** ≥ 4.5:1 for normal text; 3:1 for ≥18pt.
- **Form fields** have `<label>` (visible or `aria-label`).
- **Error messages** are programmatically associated with the
  invalid field via `aria-describedby`.
- **Images** have `alt` (descriptive or `""` if decorative).
- **The `LottieLoader` component is the ONLY loader.** It already
  carries the right ARIA semantics; don't write a CSS spinner.

`<TBD: add automated a11y check (axe-core via Playwright) to the
e2e suite.>`

---

## 7. Feature flags

We don't have a flagging service today. When a change is risky
enough to want a kill-switch:

- **Approach 1 (pilot stage):** environment-variable gates —
  `process.env.ENABLE_<FEATURE> === 'true'`. Document each in a
  `docs/feature-flags.md` `<TBD: create>` so they don't rot.
- **Approach 2 (post first customer):** introduce `<TBD: choose —
  Unleash / Vercel Edge Config / Supabase row-based flag table>`.
- **Lifecycle:** every flag has an owner + a kill-by date in the
  flag registry. Quarterly review removes dead flags.

---

## 8. Idempotency & replay safety

Routes that get retried by external callers (webhooks, cron,
client-initiated background jobs) must be safe to call twice.

- **Webhooks** (Resend, Stripe `<TBD>`, future): require an
  `idempotency_key` from the caller OR derive a deterministic
  one from the payload. Persist a `webhook_events` row on first
  receipt; on retry, look up and short-circuit.
- **Cron jobs:** scoped to small batches; if interrupted, the next
  run picks up where the last left off. No "did this whole job
  finish?" required.
- **AI tool calls:** Claude can retry — every tool handler must be
  idempotent or check-then-write. Document the idempotency strategy
  inline.

---

## 9. AI usage discipline

We use Anthropic Claude across multiple flows: analysis generation,
agent conversations, deck/strategy output. Rules:

- **Scoped tool definitions only.** No "execute arbitrary SQL" tool;
  no "make any HTTP request" tool. Each tool is a narrow function
  with a typed schema.
- **Single-org prompts.** Never include data from more than one
  `org_id` in a single prompt — protects against accidental
  cross-tenant leak via model context.
- **Input guard:** every free-text user input that goes into a
  Claude prompt passes through `lib/guardrails.ts` for length,
  profanity, URL injection, role-prompt patterns.
- **Output sanitize:** Claude output is treated as untrusted —
  DOMPurify for HTML, manual URL allowlist for any tappable link.
- **Tool result auditing:** every tool call's input is persisted
  in a structured table so we can replay / audit.
- **No PII into prompts unless the org opted in.** `<TBD: confirm
  current org-level opt-in surface and default.>`
- **Cost guardrails:** `<TBD: add a daily org-level token budget
  in usage_accounting.>`

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
- **`<TBD: enable Dependabot or Renovate weekly. Auto-merge patch
  bumps, hand-review minor and major.>`**
- **`<TBD: add `npm audit --audit-level=high` as a CI step that
  fails on a new high-severity CVE.>`**
- **`xlsx` is pinned to a SheetJS CDN tarball** — known posture
  decision (npm version has CVE history). Document and review
  annually.

---

## 12. Release process

Today: push to `main` → Vercel auto-deploys to production.

Constraints:

- **Every push to `main` IS a release.** No "let me try this and
  see" pushes — every commit ends up serving traffic.
- **Preview deploys** run for every PR. Use them for manual QA
  before merging.
- **Rollback:** `vercel rollback <previous-deployment-url>`.
  Instant. Use it instead of a hotfix when the issue is "previous
  version was fine, current is broken."
- **Database migrations and code releases are coupled** — a
  migration that adds a column ships in the same commit as the
  code that reads/writes it.
- **Manual gate for risky changes:** `<TBD: introduce a deploy
  manifest / promote-from-preview flow once customers are paying.
  Today the solo-team scale doesn't justify it.>`

---

## Open `<TBD>` items as of 2026-05-12

Snapshot of decisions still needed:

1. Confirm logger module path; ensure it's used in every prod handler
2. Validate Sentry sample rates (cost / signal balance)
3. Add Lighthouse-CI or @next/bundle-analyzer to CI
4. Add axe-core a11y check to Playwright e2e
5. Pick a feature-flag approach for the post-customer phase
6. Confirm webhook idempotency-key pattern, add tests
7. Define org-level opt-in for PII-into-prompts
8. Add daily org-level token budget in usage_accounting
9. Enable Dependabot + npm audit in CI
10. Define a manual-promote step for "risky" deploys post-paying-customer
