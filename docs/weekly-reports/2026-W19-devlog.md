# Dev Log — 2026-W19 (May 4–10, 2026)

Editorial log of what got worked on this week and **why**. Companion to the weekly governance audit. Append-only — entries reflect intent at time of writing, not later edits.

## 2026-05-10 (Sun, later) — Stop auth-flows test from generating bounce notifications

- **Switched auth-flows test emails from `_authflowtest_<runid>_a@authflowtest.local` → `got2surf2+authflowtest_<runid>_a@gmail.com` (Gmail `+suffix` aliasing).** Why: two test cases (`resetPasswordForEmail`, `signInWithOtp`) cause Supabase to actually send mail. With `.local` the recipient domain doesn't exist, so every run produced NXDOMAIN bounces back to the project's configured sender (`shpatel@datanautix.com`). With `+suffix` aliasing the mail delivers to a real owner-controlled inbox where it can be filtered. No DNS work; tests still all pass against real Supabase.

## 2026-05-10 (Sun, later) — Campaign route-handler egress test

- **`tests/integration/campaign-routes-egress.test.ts` (env-gated, `npm run test:campaign-egress`).** Why: `cross-org-egress` covers RLS — but the just-fixed campaign routes use the service-role client, which bypasses RLS, so RLS-layer tests can't see whether the handler-level `org_id` gates are present. This suite mocks `@/lib/supabase/server` to inject a real signed-in Org B client + real service-role client, then invokes `GET /api/campaigns/[id]/{export,respondents}` against an Org A campaign and asserts 404. A control test invokes the same `/export` handler signed in as Org A's user and asserts 200, so the negative results are anchored to the gate firing rather than an unrelated seed bug. POST/DELETE handlers share the same gate code; intentionally not exercising destructive cross-tenant writes against the prod-linked DB.

## 2026-05-10 (Sun, later) — Cross-tenant fixes on 4 campaign routes

- **Closed 6 cross-tenant leaks across 4 campaign routes** (`/api/campaigns/[id]/{export,respondents,send,clone}`). Why: each handler used the service-role client and looked up the campaign by `id` only, with no `org_id` check — exact same pattern as the six May-2026 CRITICAL findings. `respondents` POST/DELETE and `send` POST were destructive write leaks (a logged-in user from any org could insert/delete respondents or trigger a send on another org's campaign). `export` GET and `respondents` GET were read leaks. `clone` POST was a read-leak via clone (clone lands in original org, but exposes config). All fixed by adding `users.org_id` resolution + `campaign.org_id !== userData.org_id` → 404. The Explore agent originally flagged 2 of these routes; audit found the other 2.

## 2026-05-10 (Sun, later) — Repo-root CLAUDE.md

- **Added `CLAUDE.md` at repo root.** Why: closes the last documentation gap from the W19 audit's progression list. Project-specific guidance for Claude Code — naming conventions (Sentimetrx / agents / PulseIQ), multi-tenancy invariants (every public table needs RLS, service-role queries must pair `id` with `org_id`), data model anchors (`dataset_rows_flat` sole source, 50K sampling threshold), test commands, and content rules (no fabricated market data / addresses). Excludes personal interaction style — that lives in user memory.

## 2026-05-10 (Sun, late) — Pushed everything

- **Pushed all 13 unpushed commits + a 14th** (`9159b86` "Some basic changes" — committed `.claude/hooks/session-start-load-queue.sh`, `.claude/hooks/stop-queue-prompt.sh`, and `.claude/settings.json` so the hook scripts are now shared in the repo). HEAD == origin/main. Why: until pushed, the Monday governance routine clones origin/main and re-flags every fixed finding; after push, W20's run will be the first to reflect the full week's work. SessionStart hook to auto-load `project_open_work_queue.md` is wired locally in `.claude/settings.local.json` (untracked).

## 2026-05-10 (Sun) — Findings from the new tests + 3 fixes

The new test suites surfaced four real findings; three got fixed in the same session.

- **Drift fix: `dataset_rows_flat` policy.** Why: the live policy state (verified via `supabase db query --linked`) showed only the org-scoped SELECT policy from sql/032; the `Service role full access ... USING(true)` policy declared in `sql/phase4_flat_rows.sql` never made it to prod. Source was more permissive than reality. Removed it from source so a fresh re-apply can't reintroduce an unconditional anon-readable policy. All write paths use service-role anyway, which bypasses RLS.
- **Schema fix: `public.users.id → auth.users.id` FK with ON DELETE CASCADE.** Why: the "MUST match" comment was documentation-only; no FK existed, so a `public.users` insert with a fabricated UUID succeeded (the auth-flows test caught it). Migration `sql/046_users_auth_fk.sql` gates itself with an orphan pre-flight raise. One orphan was found (own test data from the dropped FK assertion), cleaned by hand, then migration applied to linked Supabase.
- **Auth surface fix: magic-link enumeration vector.** Why: the browser-side `signInWithOtp` call returned 200 for known emails and 422 "Signups not allowed for otp" for unknown ones — visible in the network tab. New `/api/auth/magic-link` route calls Supabase server-side and always returns `{ ok: true }` regardless of outcome (rate-limited, throw, missing email, 422 — all 200). LoginForm uses the wrapper. Six new uniform-response tests lock the contract.
- **Punted (not auto-fixed): the recipient_guid NOT NULL surprise from the egress test seed.** Already corrected in the test itself; no schema action needed.

## 2026-05-10 (Sun) — Test-suite expansion (3 new integration suites)

- **Cross-org data egress test** (`tests/integration/cross-org-egress.test.ts`, env-gated). Why: the existing rls-isolation test proves "policies exist on every public table"; this proves they actually filter. Seeds one row per org-scoped table in Org A (studies, responses, datasets, dataset_rows_flat, dataset_state, campaigns, campaign_respondents, bots, collections, collection_members, townhall_sessions, townhall_themes, townhall_turns), signs in as Org B, asserts no read leak via either get-by-id or list-by-id. Run with `npm run test:egress`. 27 tests, all green against linked Supabase.
- **Auth flows test** (`tests/integration/auth-flows.test.ts`, env-gated). Why: previously only `requireAdmin` (the gate) was tested, not the flows themselves. Real Supabase auth round-trips for signInWithPassword (success + wrong password + JWT round-trip via getUser), the invite-flow shape (admin.createUser + matching public.users insert + immediate sign-in), resetPasswordForEmail, signInWithOtp, and signOut. Email-sending paths tolerate `over_email_send_rate_limit`. Run with `npm run test:auth-flows`.
- **High-traffic API routes test** (`tests/integration/high-traffic-routes.test.ts`, always-on, mocked). Why: the most-trafficked public endpoints (clara/nora/bot chat, townhall/chat, study/[guid]) had no validation/rate-limit coverage. Mocks at the module boundary (rateLimit, ai, contentGuard, supabase/server) following the respond.test.ts pattern. 22 new tests run in `npm test`.
- **Decision: hybrid Supabase strategy.** Reconsidered the four test-infra options from scratch. Picked D (prod-linked + prefix-namespaced cleanup) for the real-Supabase work, A (mocks) for pure validation paths. Zero new infra; deferred B (paid dedicated test project) and C (local Supabase via Docker) until paying customers exist or we want PR-gating CI for these tests.

## 2026-05-09 (Sat) — AI governance controls + audit-driven fixes

- **Stood up the weekly governance audit routine.** Why: Sentimetrx is developed primarily with Claude — we need recurring evidence of AI-generated code being reviewed. Built around `/audit-codebase`, `/security-check`, `/security-audit` slash commands installed at `.claude/commands/`. Routine runs Monday 4am ET, opens a PR for human review (the merge is the governance signal). First test-run scored **55.0 / 100** — baseline established.
- **Fixed CRITICAL XSS the audit flagged in `useSurveyEngine.ts`.** Why: 6 `innerHTML` sites in the customer-facing survey embed mixed AI/study-creator content into HTML. Wrapped with DOMPurify (`isomorphic-dompurify`).
- **Fixed related XSS in `public/clara-widget.js` + `nora-widget.js`.** Why: caught while sweeping for the same class of bug. Auto-linker in `fmt()` allowed attribute-injection via URLs containing `"`. Surgical fix (extend escape pass), no DOMPurify on customer-facing widget.
- **Bumped `eslint-config-next` 14.2.5 → 15.5.18.** Why: closes 6 of 8 `npm audit` findings. Stayed within 15.x to keep ESLint 8 compatibility — 16.x requires ESLint 9 (separate project).
- **Made `npm run lint` actually work.** Why: pre-existing — no `.eslintrc` ever existed. Added one. **3 real `react-hooks/rules-of-hooks` bugs surfaced** (`RegulationsDownloadBanner`, `TextMineModule`'s `CompareTab`, `WordCloud`) where hooks were called after early returns — fixed each. Audit-driven cleanup paid for itself.
- **Decision: not pushing the above commits yet.** Why: still pre-customer; no point spending money on production push cycles until launch.

## 2026-05-09 (Sat) — Pre-customer security sprint (commits before today's session)

- **8-sprint security sweep ahead of customer onboarding.** Why: bringing the codebase to a defensible posture before any production traffic. Sprints covered: cross-tenant route gating, auth hardening, account takeover, webhook signing, share-page iframe, cron auth, mass-assignment, formatHtml XSS, SSRF + PostgREST `.or()` hardening, CSRF middleware, RLS migration, requireAdmin sweep, secrets-in-headers, server-only checks, materialized-view RLS, rate limits, magic-link strict-check, function `search_path` pinning, xlsx dependency swap, SSR bump, CORS note.
- **Generated full-codebase security review report** (`docs/security-review-2026-05-09.md`) — kicked off the sprint sequence.

## 2026-05-08 (Fri) — Foundational testing + load infrastructure

- **Foundational test suite + CI wired up.** Why: prerequisite for the SOC 2 / "use of funds" investor narrative. Tests now run in CI on every push.
- **RLS isolation test** + **assert every public table has RLS enabled.** Why: cross-tenant leak is the single highest-risk class of bug for a multi-tenant SaaS. These tests fail loudly if a new table ships without RLS.
- **Town Hall load simulator (k6 + Playwright hybrid).** Why: need confidence Town Hall holds up under typical event traffic before customer events. Hybrid because k6 is fast for raw HTTP load, Playwright simulates real browser behavior including chat flow.
- **Town Hall: prompt-cached static system prompts.** Why: the static portions of the system prompt re-cost tokens on every turn. Caching them cuts per-turn cost meaningfully for high-volume sessions.
- **Town Hall chat: rate-limit per `participant_id`, IP as backstop.** Why: `participant_id` is the right identity unit (one human per id); IP is fallback for shared-IP scenarios.
- **Engineering Reality Check deck.** Why: investor narrative — "what got built, with the math behind it" — to back the use-of-funds slide.

## 2026-05-07 (Thu) — Admin sweep + Town Hall + decks

- **Phase E admin sweep**: admins can now read/edit/delete other-org bots, conversations, town halls, datasets, studies. Org filter on `/bots`, `/analyze`, `/townhall`. Why: support ops were blocked without cross-org visibility.
- **Standardized cross-org transfer**: active-only targets, audit log. Why: prior transfer flow was inconsistent and untraced.
- **Bot share links: rich Open Graph unfurl with bot name + branded card.** Why: shared bot links in Slack/Twitter looked unbranded — bad first impression for prospects.
- **Bot editor: TopNav consistency + sticky save/cancel + dirty gate.** Why: bot editor was an outlier UI-wise; users could navigate away with unsaved changes.
- **Migrated legacy bots (Nora, Clara, Datanautix Assistant) to dynamic pipeline.** Why: legacy bots ran on a separate code path — maintenance burden.
- **Auth: switch routes to cookie-only auth.** Why: hitting Supabase rate limits on bearer-token verification.
- **Password reset: route through `/auth/callback` so user lands on reset form.** Why: reset emails were dropping users on a generic logged-in page instead of the reset form.
- **Performance**: P1-P5 — collapsed N+1 queries, memoized TextMine filtered-row chain, lazy-loaded TextMine modal, ISR on `/b/<slug>`, pushed bot session-count dedup into Postgres.
- **Security**: S1-S2 — public-endpoint rate limiting moved to Postgres, validate Phase E `?org=` filter as UUID.
- **Multiple investor decks added/updated**: architecture deck + AI-at-the-Center hub-and-spoke diagram, /admin/decks one-click download page, roll-up deck (Before/After Sentimetrx, competitive landscape, origin story), insights deck quote validation.
- **Sentry error tracking + admin/health card.** Why: needed visibility into prod errors before any customer launch.

## 2026-05-06 (Wed) — TextMine depth + admin tooling + RLS migration

- **RLS migration**: enabled RLS on every public table + auth-client policies. Why: foundational. Some tables had `USING(true)` policies which caused a leak — those were dropped. Materialized view (`study_response_stats`) was handled via `REVOKE` rather than RLS (MV semantics).
- **Spec docs**: BOTS.md, USAGE_ACCOUNTING.md, DATA_SOURCES.md, SEARCH.md, SOCIAL.md. Why: build-from-scratch reference for each module — useful for onboarding, due diligence, and as a forcing function to surface inconsistencies.
- **TextMine deep work**: Insights tabs, modal calculations, theme/word % canonical formula, drill-down on insight values, opinion miner per-occurrence negation, AFINN negation valence-shifter, smart-bucket time-series, frequency-by-week chart on OpinionPopover.
- **Trending words / PulseIQ live strip + dataset top-words modal.** Why: makes TextMine's signal visible without requiring users to open each modal.
- **AI Usage and Cost Estimator** surfaced on admin panel + cog menu. Why: cost transparency for ops.
- **Per-user login tracking** for engagement / churn signals. Why: foundation for retention reporting.
- **Admin user transfer between orgs** + **disable-user-login flow.** Why: ops capabilities for support handoffs.

## 2026-05-05 (Mon) — TextMine search + week start

- **Full-text search across TextMine datasets** + **AI re-ranking layer**. Why: keyword search alone returned poor results on multi-concern queries; AI re-rank with `ts_rank`-ordered pre-filter is the right hybrid.
- **Search moved to dataset header modal** — available from all tabs. Why: prior placement was tab-specific.
- **Dropped dual-write to `dataset_rows`; flat is the only source of truth.** Why: cleanup from the prior dual-write migration; reduces a class of inconsistency bugs.
- **Deterministic per-dataset sampling on rows-endpoint.** Why: reproducible analytics — same dataset always returns the same sample.

---

## How to use this file

- **Append, don't rewrite.** Editorial entries reflect intent at time of writing.
- **Group by date (newest first).** Each entry: 1-2 sentences with the **why**.
- **The Monday 4am governance routine reads this file** for the week's narrative summary; falls back to git log if the file isn't present.
