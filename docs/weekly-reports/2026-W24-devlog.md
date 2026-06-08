# 2026-W24 — Dev log (Week of Jun 8 to Jun 14)

## 2026-06-08 — Add REO gold-set generator (one-off analysis artifact)

**Why**: REO (Restaurant Experience Ontology) taxonomy-robustness work — a human-reviewable gold-set of Ruth's Chris reviews labeled at observation grain (Domain › Aspect + Sentiment) to evaluate/replace the keyword-only Dimensions classifier. Cross-session work; see memory `project_reo_taxonomy_robustness`. Committed here to clear the working tree (its `scripts/` path tripped the devlog hook on a GitHub Desktop commit).

**What changed**: `scripts/gen-reo-goldset.py` — generates a multi-label gold-set CSV from real reviews (read-only from `dataset_rows_flat`), one row per observation with the review text repeated per row for spreadsheet review. NOT production code — a one-off artifact. Also commits incidental `supabase/.temp/cli-latest` churn.

**Verify**: n/a (generator/analysis script, not wired into the app).

## 2026-06-08 — Kill all Vercel preview builds + harden the push policy to every branch

**Why**: Owner saw a flood of Vercel preview builds — every commit on every branch (a `claude/brainstorm…` feature branch + the weekly `spec-drift` routine) auto-deploys a preview. Decision: **no preview builds at all**, and **no pushing to any branch** without an explicit say-so.

**What changed**:
- `scripts/vercel-ignore-build.sh` — a Vercel "Ignored Build Step" (exit 0 = skip, exit 1 = build). **Only Production builds; every Preview is skipped.** So branch/PR pushes never burn a build; the only way to deploy is an authorized push to `main`.
- `CLAUDE.md` push policy hardened: the commit-only default now explicitly covers **every** branch, not just `main` — no `git push` to feature/`claude/*`/PR branches without the explicit word (each triggers a preview build).

**Activation (one-time, dashboard — owner)**: Vercel project → Settings → Git → **Ignored Build Step** → `bash scripts/vercel-ignore-build.sh`. Version-controlled, so it applies regardless of which session pushes.

**Verify**: tested locally — production→build (exit 1), preview→skip (exit 0), no-env→skip. **Local-only, not pushed** (pushing it is itself one production build, and it only takes effect once the dashboard Ignored Build Step is set).

## 2026-06-08 — Publish a coverage number in CI + ratcheting floor (Tests-score Batch 1)

**Why**: W23 governance audit scored Tests 5/10 (15% weight), with an explicit LOW finding: "no code coverage report generated; vitest config present but `--coverage` not in CI." Coverage was being computed by nobody — the real baseline (lib/** + app/api/**) is only ~13% lines / 12.8% statements. Step 1 of the progression plan to 7–8 is making that number visible and non-regressing before adding tests.

**What changed**:
- `.github/workflows/ci.yml` — the test step now runs `npm run test:coverage` instead of `npm test`, so every CI run prints the coverage table and enforces the gate.
- `vitest.config.ts` — added `coverage.thresholds` set just below current baseline (statements 12 / branches 8 / functions 12 / lines 13). A ratcheting floor: unrelated churn won't redden CI, but no regression is allowed. Bump these as each Batch-2 test lands.

**Verify**: `npm run test:coverage` → exit 0, thresholds pass at baseline (12.78% stmts / 8.42% br / 13.18% fn / 13.68% lines). Local-only, not pushed.

## 2026-06-08 — Pure-logic lib unit tests, +5 suites (Tests-score Batch 2)

**Why**: W23 governance Tests = 5/10. Fastest credible lift is unit-testing the deterministic `lib/` logic that sat at ~0% coverage — no mocking, high branch density. Raises the ratcheting coverage floor set in Batch 1.

**What changed**: 5 new suites, 74 tests — `statsUtils` (descriptive/inferential stats, regression, formatters), `themeUtils` (lexicon sentiment, keyword regex, sampling, display helpers), `datasetUtils` (schema detection/merge, payload flatteners, applySchema), `contentGuard` (moderation pipeline: severity tiers, strike escalation, self-harm routing, audit flags — sentiment already covered), `entityFilter` (slugify/query-construction pure helpers). Coverage over `lib/**`+`app/api/**`: lines 13.68%→15.58%, stmts 12.78%→15.43%, funcs 13.18%→17.59%. Ratcheted `vitest.config.ts` thresholds to 15/10/17/15.

**Finding (flagged, NOT fixed)**: `lib/statsUtils.ts normCDF()` returns Φ(z·√2), not the standard-normal Φ(z) — it applies the A&S erf approximation to `z` without the `/√2` argument scaling (verified: code matches Φ(z·√2) to 5dp; Φ(1.96) returns 0.997 vs 0.975). This understates two-tailed p-values routed through it: `mannWhitneyU`, `tDist2p` for df>100, and `shapiroWilk`. The incompleteBeta path (t-tests/correlations with df≤100, ANOVA) is unaffected. Out of scope for a test-only batch and it changes user-visible stat outputs — surfaced for a separate decision. The normCDF test asserts only scaling-invariant CDF properties (0.5 at 0, symmetry, monotonicity, bounds) so it stays honest.

**Verify**: `npm run test:coverage` → exit 0 at the raised floor; `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Local-only.

## 2026-06-08 — Fix statsUtils.normCDF (was Φ(z·√2), now Φ(z))

**Why**: Batch-2 unit tests surfaced that `lib/statsUtils.ts normCDF()` applied the Abramowitz-Stegun erf approximation to `z` directly instead of `z/√2`, so it returned Φ(z·√2), not the standard-normal Φ(z) — Φ(1.96) gave 0.997 instead of 0.975. This understated two-tailed p-values for every caller routed through it: `mannWhitneyU`, `tDist2p` for df>100, and `shapiroWilk` (normality). The `incompleteBeta` path (t-tests/correlations with df≤100, ANOVA) never touches normCDF and was correct.

**What changed**: one-line fix in `normCDF` — erf argument is now `|z|/√2` (`Math.abs(z) / Math.SQRT2`). Statistics-module p-values for the three affected tests are now correct (will read as larger/more-conservative than before the fix). Updated the statsUtils unit test to pin standard z-table reference values (Φ(1)=0.8413, Φ(1.96)=0.975, Φ(2.576)=0.995) as a regression guard.

**Verify**: `npx vitest run statsUtils` 27/27; full suite 546 pass. Local-only.

## 2026-06-08 — Agent-route org-scoping gate tests (Tests-score Batch 3)

**Why**: W23 governance flagged Tests=5/10 with "route handlers largely untested", and the human-review checklist called out bare service-role agent lookups (`bots/[id]/route.ts:70,94,96`). Every past CRITICAL finding was a service-role `id` lookup missing its `org_id` pairing — so route-gate tests lift Tests *and* reinforce Security.

**What changed**: new `tests/integration/bot-routes-gate.test.ts` (13 tests) covering the agent API routes — `bots/[id]` GET/PATCH/DELETE, `entities` GET/POST, `questions` GET, `conversations` GET, `knowledge` GET. Asserts the multi-tenancy gate only: 401 (no auth / no org), cross-org 404 (or 403 for conversations) for non-admins, agent-not-found 404, and admin bypass. Exercises both auth shapes in the codebase — `getCallerOrgContext` (entities/questions) and `getAuthUser`+users (bots/[id]/conversations/knowledge). Supabase boundary + AI/embeddings/usage/audit libs mocked. Added to the TESTING.md layout. Coverage over lib+app/api: lines 15.58%→15.91% (the early-return gate paths); the existing 15/10/17/15 floor already sits below.

**Verify**: `npx vitest run bot-routes-gate` 13/13; full suite 559 pass. Local-only.

## 2026-06-08 — React component smoke tests, +5 (Tests-score Batch 4)

**Why**: The last untouched W23 Tests finding — "React components remain largely untested" (1 of 97 had a test). These close the named gap and lift the test ratio (the coverage `include` is `lib/**`+`app/api/**`, so component tests intentionally don't move the coverage %; they're a separate lever).

**What changed**: 5 jsdom suites (19 tests) over shared UI, following the existing BrandTagInput pattern — `DatanautixAttribution` (guards the CLAUDE.md brand contract: "Sentimetrx is a Datanautix product", datanautix.com link, both variants), `ModulePlaceholder` (module name, thousands-formatted counts, settings deep-link), `HelpHint` (popover open/toggle/Escape-close), `FavoriteStar` (aria-pressed/label state, optimistic toggle + POST /api/favorites body, failure revert, late-hydration re-sync), `LottieLoader` (optional message + custom size; lottie-web dynamic import stubbed). Component test count 1→6; test files 52→57. Added to the TESTING.md layout.

**Verify**: `npx vitest run tests/unit/components` 20/20; full suite 575 pass; coverage gate exit 0. Local-only.

**Tests-score arc (Batches 1–4) summary**: coverage now runs + gates in CI (was invisible); lib+api lines 13.68%→15.91%; +92 unit/integration tests across statsUtils/themeUtils/datasetUtils/contentGuard/entityFilter + agent-route org-scoping gates + 5 component suites; one real correctness bug fixed (normCDF). Addresses all three named W23 Tests drags (no-coverage-in-CI, low ratio, untested handlers/components). Realistic move: 5 → ~7.
