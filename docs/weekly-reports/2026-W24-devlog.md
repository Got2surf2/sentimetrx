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
