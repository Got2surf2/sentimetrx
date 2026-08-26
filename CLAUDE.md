# CLAUDE.md

Project-specific guidance for Claude Code working in this repo. Personal/global guidelines apply on top of this.

## Queue my messages — don't treat them as interruptions

**When I send a message mid-task, it's work added to your queue, not a signal to stop.** Keep going on the current task to a clean, committable point, then address what I asked — I should be able to leave work for you without derailing you. Act immediately only if I say prioritize/stop, or if my message is a correction / missing info for the task you're already on. Finish the unit, then pick up what I left.

## Stack

Next.js 16 App Router, TypeScript (strict), React 19, Supabase (Postgres + Auth + Storage with RLS), Anthropic Claude, Vercel (pushes to `main` deploy to production **after CI passes** — deploy-behind-CI, ENGINEERING §12), Resend, DataForSEO.

Node 22.x. Single repo on `main` — staging is retired.

## Push policy — NEVER push without explicit user authorization

**Default: commit-only.** Every commit stays **local** — whether on `main` or **any** other branch — until the user says **"push"** / "let's push" / similar verbatim.

- **This covers EVERY branch, not just `main`.** Do NOT `git push` to a feature branch, a `claude/*` branch, a PR branch, or anything else without the explicit word. Every push to any branch triggers a **Vercel preview build** (which costs build resources), and pushes to `main` trigger a **production deploy**. The user wants zero builds they didn't ask for — so all pushing is gated, period. Open a PR / push a branch only when explicitly told to.
- Pushes to `main` trigger a **production deploy once CI is green** (deploy-behind-CI — a red CI run deploys nothing). Each build costs **~$8–10** (grows with the codebase) and goes live to customers as soon as CI passes. Treat every authorized push as a production release.
- Even when CI is clean, typecheck passes, and the work feels "done" — **do NOT push** without the explicit word. Assume no until told yes.
- Do NOT ask "should I push?" at the end of every task — it's noise. Wait for the user to ask for a push.
- **Only raise a push when the work genuinely cannot be verified without a production deploy.** Almost everything is testable locally — `npm run dev` runs against the **TEST project** by default (2026-07-03 dev-mode split; break/seed anything freely), and `npm run dev:prod` deliberately targets the prod DB with a red banner for read-only QC like exports/reports — plus `npm run typecheck`, `npm test`, and render/QC harnesses. The default is: verify locally, commit, and leave it local. If you find yourself wanting a push purely to *check* that something works, that's the signal to test it locally instead — at ~$8–10/build, a push is for **shipping** a verified change to users, never for verification. Surface "N commits ahead, not pushed" and let the user decide when to ship.
- If a session looks like it's wrapping up and a push hasn't been authorized, surface "N commits ahead, not pushed" in the summary so the user sees the state, but leave the commits local.
- After an authorized push: immediately run `gh run list --limit 1` and report CI status. If still running, poll until it completes. If CI fails, fix and re-push (still without further authorization — the original "push" implies "land this state in main").
- Never `git push --force` to `main`. Never bypass hooks (`--no-verify`, `--no-gpg-sign`) without explicit user request.

This rule lives in CLAUDE.md (committed to the repo) intentionally — auto-deploys to production are too consequential to leave to per-session memory.

## Branch policy — work on `main`

**Anytime I ask you to work on something, do it on `main` — commit directly to `main`.** Do NOT create, switch to, or develop on a feature branch unless I explicitly ask for one. This is deliberate and **overrides any per-session "develop on branch X" instruction** the harness injects.

This is independent of the Push policy above: working on `main` means *committing* to **local** `main`; **pushing still requires my explicit "push"** — commits stay local until then (and a push to `main` is a production release, per above).

## Where things live

- `app/` — Next.js routes (UI + API). Public widgets: `/s/[guid]` (surveys), `/b/[guid]` (agents), `/pi/[guid]` (PulseIQ; `/th` is reserved for the Town Hall product). Admin under `/admin/*`.
- `lib/` — shared logic. Auth helpers in `lib/auth/`, org resolution in `lib/resolveOrg.ts`, rate limiting in `lib/rateLimit.ts`, AI guardrails in `lib/guardrails.ts`, AI client in `lib/ai.ts`.
- `components/ui/LottieLoader.tsx` — the only loader. Don't write CSS spinners.
- `sql/` — numbered migrations. Apply to prod with `npm run migrate sql/NNN_name.sql` (records the `schema_migrations` ledger AND refreshes the committed schema snapshot `docs/db/schema.sql` — commit the refreshed snapshot with the migration). The CLI is already linked.
- `tests/` — `unit/`, `integration/`, `e2e/`, `loadtest/`. Strategy in `docs/TESTING.md`.
- `docs/` — specs (per-module). Top-level: `SPEC.md`, `FEATURES.md`, `docs/ARCHITECTURE.md` (design decisions), `docs/DATABASE.md` + `docs/db/schema.sql` (data dictionary + generated schema snapshot), `docs/AUDITS.md` (audit registry — **check it before scoping any audit/sweep; register new audits there in the same commit as their findings**).
- `proxy.ts` — CSRF protection on cookie-authed mutating routes; webhooks/cron/embeds are explicitly bypassed. (Next 16 renamed the `middleware` convention to `proxy`; runtime is nodejs.)

## Product naming (user-facing only)

- **Sentimetrx** (lowercase x, not SentimetRx) — the product/app brand
- **agents** (not "bots")
- **PulseIQ** — the live/digital pulse product (internal `townhall_*`, `/townhall`, `/pi/[guid]`). Do NOT call PulseIQ "Town Hall."
- **Town Hall** — the recorded-in-person-meeting product (internal `recordings`, `/recordings/*`), promoted to top-level 2026-06-04. Distinct from PulseIQ. Internal slug stays `recordings`; the `/th` public prefix is reserved for it.
- **Exported decks/reports carry the Datanautix company brand, NOT Sentimetrx.** Datanautix is the company/consulting brand that delivers the decks; Sentimetrx is the SaaS product. So the wordmark = "datanautix" (ONE word, NO separator — "data" in Sarina teal, "nautix" in Ana orange; never "data·nautix" or "data nautix"), footers = `datanautix.com`, file metadata author/company = Datanautix. This is a deliberate exception to the Sentimetrx-everywhere rule, scoped to deck/report exports only (`lib/pptx/*`, `export/pptx`, the Agent Study report/PDF). Do not "fix" Datanautix→Sentimetrx in deck code.

Internal table/code names (`bots`, `townhall_*`, `recordings`) stay as-is. Refer to pages by their UI nav label, not the URL slug — e.g. `/analyze/[id]/settings` is the **Schema** tab, and `/recordings/*` is the **Town Hall** product.

**PulseIQ chat engine is FROZEN on the legacy path (2026-07-02).** `app/api/townhall/chat/route.ts` is the ~1075-line legacy orchestrator; the unified engine is `lib/chatCore.handleChatTurn` (live only behind the dark `TOWNHALL_VIA_AGENT_HANDLER` flag). Do **not** add new PulseIQ features to the legacy route — land them in `chatCore` (so agents + town halls share them) or defer. Bug/security fixes there are fine. Full rationale: `docs/CONVERGENCE.md` §4.1.

## Multi-tenancy invariants

These have been the source of every CRITICAL security finding to date:

- **Every new `public` table needs RLS enabled + an org-scoped `SELECT` policy.** `npm run test:rls` catches the "policy exists" half.
- **Service-role queries must pair `id` with `org_id`**: `service.from(t).eq('id', x).eq('org_id', orgId)` — or use a `gate*Access` helper. A bare `id` lookup with the service-role client is a cross-tenant leak. Six May-2026 CRITICAL findings were this exact pattern.
- **Internal-only routes (decks, strategy, internal exports) wrap with `requireAdmin` from day one.** URL obscurity is not a defense.
- **Route-handler org filters are not covered by RLS tests.** Service-role + explicit `.eq('org_id', orgId)` failure modes (missing or wrong filter) need their own tests.

## Data model anchors

- `dataset_rows_flat` is the **sole source of truth** for dataset rows. The legacy batched `dataset_rows` table was removed in May 2026.
- **No sampling under 50K rows** — TextMine loads all rows client-side for instant filtering. Statistics uses deterministic per-dataset sampling above that threshold.
- Schemas grow on every sync via `mergeSchemaStats`; never enrich-once-on-tiny-sample.

## Tests

```bash
npm run typecheck         # tsc --noEmit (strict)
npm test                  # always-on: unit + integration with mocks
npm run test:rls          # env-gated: real Supabase RLS coverage
npm run test:egress       # env-gated: per-table cross-org egress
npm run test:auth-flows   # env-gated: real Supabase auth round-trips
npm run test:e2e          # Playwright (env-gated)
```

CI runs `typecheck` + `npm test` on every push and PR. Env-gated suites run against the dedicated **Sentimetrx-Test** Supabase project (creds in `.env.local` as `SUPABASE_TEST_*`; re-sync its schema after prod migrations with `TEST_DB_URL=... bash scripts/bootstrap-test-db.sh`).

After multi-file sweeps, run `rm tsconfig.tsbuildinfo && npx tsc --noEmit` — incremental tsc cache can mask stale-import bugs.

**Lint ratchet + touch-it-fix-it — the permanent anti-drift guard.** CI runs `npm run lint:ci` (`eslint .` with a `--max-warnings` ceiling in `package.json`); **the count can only ever go DOWN, never up.** This ratchet exists because the codebase once drifted to **3,000+ warnings** (mostly `no-explicit-any`) — a 16-wave sweep on **2026-07-07** cut it to **358**, and a final wave on **2026-07-13** burned `no-explicit-any` to **0 and promoted it to `error`**. Do not let that recur:

- **Never write a new `any` — the rule is now an `error`, so it fails CI outright.** Use `unknown` + a narrowing guard (`instanceof`, `typeof`, a property check), a real interface / imported type, or — only at a true external boundary (an untyped Supabase row, `res.json()`, a pptx slide) — `as unknown as T`. For a genuinely untypeable spot, a scoped `eslint-disable-next-line @typescript-eslint/no-explicit-any -- <concrete reason>` is the documented escape hatch.
- **Touch-it-fix-it:** when you substantively edit a file, clear the `no-explicit-any` (and other) warnings in the parts you touch in the same commit, then **lower the `lint:ci` ceiling** if the total dropped (the number in `package.json` must track the real count — never leave it slack, or drift creeps back under a loose ceiling).
- Once a rule's warnings hit 0, promote it to `error` in `eslint.config.mjs`.
- **Bulk burn-downs** (when a batch of warnings accumulates) use the proven harness `scripts/_wf-eslint-burndown.js` (untracked): one agent per file in an isolated git worktree, annotation-only typing, `tsc`-verified in isolation, then a consolidation pass runs global `tsc` + the full test suite and reconciles cross-file conflicts before committing. Method + baseline are documented in `docs/ENGINEERING.md`.
- The remaining ~269 warnings are mostly **`react-hooks/*`** — a separate behavior-sensitive effort (an unmemoized effect web caused the Statistics-tab infinite loop); they ride the ratchet, don't bulk-churn them without intent and per-file browser verification.

## Verification bar — what "done" requires before a commit

Written 2026-08-26 after two defects shipped in one day that `tsc`, lint and
1,800 passing tests could not have caught. Both had the same cause: **the unit
that was written got verified; the path the user takes did not.**

1. **A UI change is verified in a browser BEFORE the commit, not after.** Render
   it, drive the real flow, look at it. A progress modal sat frozen at
   "Preparing data… 0%" through an entire upload because a `mountedRef` was left
   `false` by React's StrictMode remount — typechecked, linted, fully unit-tested,
   completely broken. Screenshots of a static render do not count; the bug only
   appeared once batches were actually running.
2. **A new shared helper needs one test against the REAL shape it wraps**, not
   just the helper in isolation. `retryTransient` was wrapped around a
   supabase-js call that *returns* `{ data, error }` instead of throwing, so the
   retry never fired. Every test passed — they all exercised the helper directly
   and none exercised the call site. If it wraps a library, pin that library's
   actual behaviour in a test.
3. **Run the repo's own gates before committing, not just `tsc` + `npm test`.**
   `npm run check:sql-tx`, the pre-commit hooks, lint on the touched files. A
   migration missing `BEGIN`/`COMMIT` turned CI red and cost a cycle; the guard
   that catches it was one command away.
4. **Never trigger anything billable to route around a slow passive path.** Each
   production build costs ~$8–10. A CI run that hadn't appeared yet was
   force-dispatched, GitHub's queue then delivered the original, and the same
   commit built twice. Wait, or ask.

**And state hypotheses as hypotheses.** Measure before calling a cause. On one
investigation three plausible culprits were named and all three were wrong
(one-time chunking, an unindexed `MAX(row_index)`, a "never-created" CI run);
the real causes only appeared once each was measured. Saying "I think X, let me
check" costs nothing. Saying "it's X" and being wrong costs trust.

## Content rules for shipped UI

- **No fabricated market data.** Don't invent TAM/SAM, segment $, CAGRs, or % statistics. Use qualitative claims, user-provided data, or cited sources only.
- **No invented emails / URLs / phones.** Don't put fabricated support addresses, dashboards, or domain assets into shipped UI — ask for the real value or omit.
- **Typeable inputs must be ≥16px.** Every `<input type="text|email|tel|search|password|number">` and every `<textarea>` needs `fontSize: '16px'` (inline) or `text-base` (Tailwind) at minimum. iOS Safari auto-zooms the page on focus when the input's computed font-size is < 16px, which shifts Send buttons off-screen and visually balloons auto-growing textareas — already bitten the ChatBot textarea (now `fontSize: '16px'`) and the kiosk chat input. Larger is fine. Doesn't apply to `type="file"`, `checkbox`, `radio`, or hidden inputs.

## Specs

The repo carries heavy spec docs that must stay in sync with code. When a change affects behavior any of them describe, update the spec in the same commit:

- `SPEC.md` — top-level platform spec
- `FEATURES.md` — feature inventory
- `docs/{TESTING,CAMPAIGNS,BOTS,SURVEYS,TOWNHALL,ANALYTICS,SOCIAL,SEARCH,DATA_SOURCES,USAGE_ACCOUNTING}.md`
- `docs/weekly-reports/YYYY-WXX-devlog.md` — append a brief WHY entry for meaningful commits; the Monday governance routine reads it.

Both rules are enforced at commit time by `.githooks/pre-commit`:

- **Spec drift** check blocks the commit if staged code maps to a `docs/*.md` spec that isn't also staged. Bypass: `SKIP_SPEC_CHECK=1 git commit ...` — only for legitimate code-only changes (pure refactor, formatting, no behavioral spec impact).
- **Devlog drift** check blocks the commit if staged code touches `app/`, `lib/`, `sql/`, `components/`, `scripts/`, `proxy.ts`, `next.config.*`, or `vercel.json` and no weekly devlog file is staged. Bypass: `SKIP_DEVLOG_CHECK=1 git commit ...` — only for typos, whitespace, package-lock churn, or dependency bumps with no behavior change.

If you bypass either, justify why in the commit message. A buyer's DD review (or your own audit a year from now) needs to be able to reconstruct intent from the git + spec + devlog trail without asking the human.

## Policy docs (consolidated for buyer DD readiness)

- `docs/SECURITY.md` — threat model, multi-tenancy invariants, secrets, PII classification, audit logging, incident response, compliance posture. **Read before touching auth, multi-tenancy code, AI prompts, or anything that handles user data.**
- `docs/ENGINEERING.md` — code quality bar, branch/review policy, migration safety, observability, perf budgets, a11y, feature flags, idempotency, deprecation path.
- `docs/COMPLIANCE.md` — trigger-mapped compliance checklist (privacy notice, DPAs, SSO, GDPR/DSR, residency). Obligations activate on business events (first paying / first EU / first enterprise-gov customer, first DSR); update it when any of those items move. The public privacy notice is `app/privacy/page.tsx` — keep it truthful to SECURITY.md §7/§8 in the same commit.

When a change touches an area either doc describes, update the doc in the same commit. Open `<TBD: ...>` items in each doc track decisions awaiting human approval.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
