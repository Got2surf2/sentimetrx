# Testing strategy

This is a deliberately small, high-leverage test suite. Its job is to prove the
non-negotiable pieces work — the parts that PE / technical-diligence reviewers
care about — without the upkeep cost of comprehensive coverage.

## How to run

```bash
npm run typecheck      # tsc --noEmit (strict)
npm test               # unit + integration via Vitest
npm run test:watch     # local TDD loop
npm run test:coverage  # v8 coverage report
npm run test:e2e       # Playwright (requires running app + admin creds)
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
│   ├── decks.test.ts     # 4 admin-only deck routes × {anon, admin}
│   ├── respond.test.ts   # public survey-response endpoint
│   └── rls-isolation.test.ts  # env-gated, real Supabase
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
| RLS isolation | Cross-org read returns null (env-gated) | The single biggest multi-tenancy risk |
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

Two suites need real infrastructure and are **skipped** unless the
environment is configured:

### RLS isolation (`tests/integration/rls-isolation.test.ts`)

Requires a separate Supabase project (NEVER point this at production):

```bash
TEST_SUPABASE_URL=...
TEST_SUPABASE_ANON_KEY=...
TEST_SUPABASE_SERVICE_ROLE_KEY=...
TEST_ORG_A_USER_EMAIL=...
TEST_ORG_A_USER_PASSWORD=...
TEST_ORG_B_USER_EMAIL=...
TEST_ORG_B_USER_PASSWORD=...
TEST_ORG_A_STUDY_ID=...   # a real study row owned by Org A in the test project
```

Setup steps:

1. Create a fresh Supabase project.
2. Apply the schema and RLS migrations from `sql/`.
3. Create two organizations and one user per organization.
4. Create one study row owned by Org A; set `TEST_ORG_A_STUDY_ID`.
5. Run `npm test -- rls-isolation`.

When the env vars are not set, the suite calls `describe.skip` so it's
visible-but-skipped in test output rather than silently passing.

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
