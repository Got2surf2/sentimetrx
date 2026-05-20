# CLAUDE.md

Project-specific guidance for Claude Code working in this repo. Personal/global guidelines apply on top of this.

## Stack

Next.js 14 App Router, TypeScript (strict), React 18, Supabase (Postgres + Auth + Storage with RLS), Anthropic Claude, Vercel (pushes to `main` auto-deploy to production), Resend, DataForSEO.

Node ≥ 20. Single repo on `main` — staging is retired.

## Push policy — NEVER push without explicit user authorization

**Default: commit-only.** Every commit stays local on `main` until the user says **"push"** / "let's push" / similar verbatim.

- Pushes to `main` trigger **Vercel auto-deploy to production**. Each build costs ~$3–4 and goes live to customers immediately. Treat every authorized push as a production release.
- Even when CI is clean, typecheck passes, and the work feels "done" — **do NOT push** without the explicit word. Assume no until told yes.
- Do NOT ask "should I push?" at the end of every task — it's noise. Wait for the user to ask for a push.
- If a session looks like it's wrapping up and a push hasn't been authorized, surface "N commits ahead, not pushed" in the summary so the user sees the state, but leave the commits local.
- After an authorized push: immediately run `gh run list --limit 1` and report CI status. If still running, poll until it completes. If CI fails, fix and re-push (still without further authorization — the original "push" implies "land this state in main").
- Never `git push --force` to `main`. Never bypass hooks (`--no-verify`, `--no-gpg-sign`) without explicit user request.

This rule lives in CLAUDE.md (committed to the repo) intentionally — auto-deploys to production are too consequential to leave to per-session memory.

## Where things live

- `app/` — Next.js routes (UI + API). Public widgets: `/s/[guid]` (surveys), `/b/[guid]` (agents), `/th/[guid]` (PulseIQ). Admin under `/admin/*`.
- `lib/` — shared logic. Auth helpers in `lib/auth/`, org resolution in `lib/resolveOrg.ts`, rate limiting in `lib/rateLimit.ts`, AI guardrails in `lib/guardrails.ts`, AI client in `lib/ai.ts`.
- `components/ui/LottieLoader.tsx` — the only loader. Don't write CSS spinners.
- `sql/` — numbered migrations. Apply to prod with `supabase db query --linked --file sql/NNN_name.sql` (CLI is already linked).
- `tests/` — `unit/`, `integration/`, `e2e/`, `loadtest/`. Strategy in `docs/TESTING.md`.
- `docs/` — specs (per-module). Top-level: `SPEC.md`, `FEATURES.md`.
- `middleware.ts` — CSRF protection on cookie-authed mutating routes; webhooks/cron/embeds are explicitly bypassed.

## Product naming (user-facing only)

- **Sentimetrx** (lowercase x, not SentimetRx)
- **agents** (not "bots")
- **PulseIQ** (not "Town Hall")

Internal table/code names (`bots`, `townhall_*`) stay as-is. Refer to pages by their UI nav label, not the URL slug — e.g. `/analyze/[id]/settings` is the **Schema** tab.

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

CI runs `typecheck` + `npm test` on every push and PR. Env-gated suites run locally against the linked prod project (with `_<prefix>_<runId>_` namespacing) until a dedicated test project exists.

After multi-file sweeps, run `rm tsconfig.tsbuildinfo && npx tsc --noEmit` — incremental tsc cache can mask stale-import bugs.

## Content rules for shipped UI

- **No fabricated market data.** Don't invent TAM/SAM, segment $, CAGRs, or % statistics. Use qualitative claims, user-provided data, or cited sources only.
- **No invented emails / URLs / phones.** Don't put fabricated support addresses, dashboards, or domain assets into shipped UI — ask for the real value or omit.

## Specs

The repo carries heavy spec docs that must stay in sync with code. When a change affects behavior any of them describe, update the spec in the same commit:

- `SPEC.md` — top-level platform spec
- `FEATURES.md` — feature inventory
- `docs/{TESTING,CAMPAIGNS,BOTS,SURVEYS,TOWNHALL,ANALYTICS,SOCIAL,SEARCH,DATA_SOURCES,USAGE_ACCOUNTING}.md`
- `docs/weekly-reports/YYYY-WXX-devlog.md` — append a brief WHY entry for meaningful commits; the Monday governance routine reads it.

## Policy docs (consolidated for buyer DD readiness)

- `docs/SECURITY.md` — threat model, multi-tenancy invariants, secrets, PII classification, audit logging, incident response, compliance posture. **Read before touching auth, multi-tenancy code, AI prompts, or anything that handles user data.**
- `docs/ENGINEERING.md` — code quality bar, branch/review policy, migration safety, observability, perf budgets, a11y, feature flags, idempotency, deprecation path.

When a change touches an area either doc describes, update the doc in the same commit. Open `<TBD: ...>` items in each doc track decisions awaiting human approval.
