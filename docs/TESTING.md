# Testing strategy

This is a deliberately small, high-leverage test suite. Its job is to prove the
non-negotiable pieces work — the parts that PE / technical-diligence reviewers
care about — without the upkeep cost of comprehensive coverage.

## How to run

```bash
npm run typecheck         # tsc --noEmit (strict)
npm test                  # unit + integration via Vitest
npm run test:watch        # local TDD loop
npm run test:coverage     # v8 coverage report
npm run test:e2e          # Playwright (requires running app + admin creds)
npm run test:rls          # env-gated: cross-org RLS isolation (real Supabase)
npm run test:egress       # env-gated: cross-org data egress per table (real Supabase)
npm run test:auth-flows   # env-gated: real Supabase auth round-trips
```

CI runs the first two on every push and PR.

## Layout

```
tests/
├── setup.ts              # global setup (env stubs, next/headers shim)
├── unit/                 # pure functions + mocked-boundary tests
│   ├── auth/             # requireAdmin, logDeckDownload
│   ├── guardrails.test.ts
│   ├── personaExtractor.test.ts
│   ├── rateLimit.test.ts
│   └── usageLog.test.ts
├── integration/          # route handlers with mocked Supabase
│   ├── decks.test.ts                # 4 admin-only deck routes × {anon, admin}
│   ├── respond.test.ts              # public survey-response endpoint
│   ├── high-traffic-routes.test.ts  # clara/nora/bot/townhall chat + study/[guid]
│   ├── rls-isolation.test.ts        # env-gated, real Supabase — RLS coverage
│   ├── cross-org-egress.test.ts     # env-gated, real Supabase — per-table egress
│   └── auth-flows.test.ts           # env-gated, real Supabase — auth round-trips
└── e2e/
    └── deck-download.spec.ts  # Playwright, env-gated
```

We chose `tests/` at repo root rather than colocated `__tests__/` directories.
The repo is large; centralizing tests keeps the application tree clean and
makes the suite easy to reason about as a unit.

## What we test

| Area | Test | Why it matters |
| --- | --- | --- |
| Admin-only gate | `requireAdmin` returns 404 unauth, null for admin | Internal decks must not leak to anon |
| Audit logging | `logDeckDownload` is fire-and-forget | A logging failure must never block a download |
| AI input/output guardrails | `guardrails` profanity, refusal detection, output validity | Public survey + town-hall input/output are user-facing; bad output is brand risk |
| Rate limiting | `rateLimit` bucket exhaustion + reset | Public endpoints (respond) need real protection |
| Persona extraction | `personaExtractor` shape + missing fields + AI failure | We mock the LLM at `lib/ai`'s boundary; we want the parser robust to garbage |
| Usage logging | `usageLog` non-blocking | Usage logging must never crash a paid AI call |
| Deck routes | `/api/{pitch,architecture,engineering-reality,rollup}-deck` × {anon, admin} | Confirms each route both calls `requireAdmin` AND emits a real PPTX |
| Public survey endpoint | `/api/respond` happy + missing-field + invalid-JSON + inactive-study + 404 | This endpoint accepts traffic from anywhere — its validation is load-bearing |
| High-traffic chat + study routes | clara/nora/bot/townhall chat (validation + rate-limit) + study/[guid] (404, 403, happy) | These are the most-trafficked public endpoints — validation must reject bad input fast |
| RLS isolation | Cross-org read returns null + every public table has RLS + no `USING(true)` policy outside allowlist (env-gated) | The single biggest multi-tenancy risk |
| Cross-org data egress | Per org-scoped table: Org B cannot read Org A row by id or list scan (env-gated) | Proves policies actually filter, not just that they exist — extends rls-isolation |
| Auth flows | Real Supabase signInWithPassword + OTP + reset + admin-createUser invite shape + signOut (env-gated) | Mocking the auth client only proves wrapper code; this proves the round-trip |
| E2E download | Login → /api/pitch-deck → pptx (env-gated) | Catches cookie/session breakage that unit tests can't see |

## What we deliberately skip

- **Snapshot tests for UI components.** High churn, low signal; they catch design
  changes, not bugs.
- **Exhaustive coverage of `app/api/datasets/*`.** Many routes; the high-leverage
  pieces (rate limiting, RLS, deck gate) are tested separately. Adding tests
  here as bugs are found is fine.
- **AI-provider integration tests.** We mock at the `lib/ai` boundary —
  testing that Anthropic's API works is Anthropic's job.
- **The PPTX exporter for analytics decks.** ~3K lines, low ROI; would require
  fixture management out of proportion to bug-discovery rate.
- **Comprehensive auth-flow e2e.** One golden-path e2e (login → deck) is the
  smoke test; full coverage is Playwright's long-tail and not worth carrying.

## Mocking strategy

Mock at the **module boundary**, not the network:

- `lib/ai` is the wrapper around Anthropic / OpenAI / Azure OpenAI. Tests
  `vi.mock('@/lib/ai', ...)` directly; no MSW needed.
- `lib/supabase/server` is the wrapper around Supabase JS. Tests mock
  `createClient` and `createServiceRoleClient` per-test to inject the
  exact rows / errors the assertion needs.
- `lib/rateLimit` and `lib/contentGuard` are mocked in the `/api/respond`
  test — they're orthogonal to the schema-validation behavior under test.

The service-role key is **never** committed and **never** logged. Tests use
the placeholder string `test-service-role-key`; the `lib/supabase/server`
factory is mocked before any module that calls it is imported.

## Adding a new test

1. Pick the boundary. If you're testing a pure function in `lib/`, write a
   unit test under `tests/unit/`. If you're testing a route handler, write
   an integration test under `tests/integration/` and mock at
   `@/lib/supabase/server` and any other side-effecting modules.
2. Mock with `vi.mock()` **before** the dynamic `import('@/...')` of the
   module under test. Static `import` lines hoist; dynamic imports give
   you mock-ordering control when a mock value depends on `beforeEach`.
3. Assert observable behavior, not implementation. Status codes, response
   shape, and "did the side-effect fire?" — not "was this private helper
   called with these args?".
4. Each test file must run independently. No shared mutable fixtures across
   files.

## Env-gated tests

Four suites need real infrastructure and are **skipped** unless the
environment is configured. All four follow the same prefix/cleanup pattern:
test rows carry a unique `_<name>test_<runId>_` marker so partial failures
are findable and deletable by hand. None run in CI — service-role keys do
not belong in GitHub Actions.

### RLS isolation (`tests/integration/rls-isolation.test.ts`)

Self-contained: the test creates its own test orgs / users / study via the
service role, runs the assertions, then deletes everything. All test rows
are prefixed `_rlstest_<runId>_` so partial failures are easy to find and
delete by hand.

Run it:

```bash
npm run test:rls
```

That sets `RLS_TEST=1` and points at whatever `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are in
`.env.local`. Without `RLS_TEST=1` the suite calls `describe.skip` so it's
visible-but-skipped in default test output.

**Pre-launch (no real customers yet)**: pointing this at the production
Supabase is acceptable. The test data is namespaced and cleaned up; the
risk is one stale row if the test crashes mid-run, which is recoverable
by hand via the `_rlstest_` prefix.

**Once customers exist**: stand up a dedicated Supabase test project and
set `NEXT_PUBLIC_SUPABASE_URL`/keys in `.env.local` to that project before
running. Real auth.users rows shouldn't share an instance with paying
customers, regardless of how careful the cleanup is.

### Cross-org data egress (`tests/integration/cross-org-egress.test.ts`)

Where rls-isolation proves "every table has RLS turned on and no policy
is unconditionally `true`," this suite proves the next layer: for each
org-scoped table, the policy actually filters cross-org reads. Seeds one
row per table in Org A; signs in as Org B's anon-key client; asserts no
row leak via either get-by-id or list-by-id scan.

```bash
npm run test:egress
```

Sets `EGRESS_TEST=1`. Same .env.local + pre-launch caveats as RLS. Test
data is prefixed `_egresstest_<runId>_`.

### Auth flows (`tests/integration/auth-flows.test.ts`)

Real Supabase auth round-trips — covers what mocking can't: that
`signInWithPassword` actually mints a JWT that decodes back to the same
user, that `admin.createUser` (the invite-flow path) produces a user who
can immediately sign in, and that `resetPasswordForEmail` / `signInWithOtp`
/ `signOut` wire through. Email-sending paths tolerate
`over_email_send_rate_limit` since the throttler firing isn't a wiring
failure.

```bash
npm run test:auth-flows
```

Sets `AUTH_FLOWS_TEST=1`. Test users prefixed `_authflowtest_<runId>_`
and deleted in afterAll.

### Playwright e2e (`tests/e2e/deck-download.spec.ts`)

Requires an admin login on a running instance:

```bash
E2E_ADMIN_EMAIL=...
E2E_ADMIN_PASSWORD=...
E2E_BASE_URL=http://localhost:3000   # optional — Playwright will start `npm run dev` if unset
npm run test:e2e
```

When the env vars are not set, the test calls `test.skip(...)` and the
suite reports the reason inline.

## CI

`.github/workflows/ci.yml` runs typecheck + Vitest on push to `main` and
on every PR. Playwright is not in CI (real Supabase + login + dev server)
— it's a manual local check. README has the badge.
