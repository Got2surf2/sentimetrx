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

## 2026-06-08 — REO gold-set review tooling (Dimensions robustness track)

**Why**: Evaluating the Restaurant Experience Ontology (REO) to make the Dimensions/taxonomy classifier more robust. Owner chose the LEAN CUT (Domain›Aspect+Sentiment; defer the ~150 Concepts + Emotion/Journey). The gate before any classifier work is a labeled gold set — you can't prove REO beats today's keyword-only classifier (LLM tier is dormant, no eval harness) without ground truth. Owner asked for a UI to review/guide the labeling instead of editing a CSV.

**What changed**: `lib/reoVocabulary.ts` (lean REO closed vocab, separate from legacy 7-axis); `sql/121_reo_gold_set.sql` (`reo_gold_review` table, RLS on, admin-only writes — APPLIED to prod); `scripts/seed-reo-goldset.ts` + `reo-goldset-seed-data.json` (30 real Ruth's Chris reviews / 122 proposed observations, seeded into Datanautix admin org); `/admin/reo-gold-set` page + `GoldSetClient` (one-review-at-a-time stepper: fix/add/delete Domain›Aspect›Sentiment, severity flag, guidance notes) + `app/api/admin/reo-gold-set` (requireAdmin, closed-vocab validated, id+org_id paired writes); admin-hub link. Both `proposed` and `gold` stored so the set doubles as the eval harness later.

**Verify**: `npx tsc --noEmit` exit 0; migration applied (`relrowsecurity=true`); seed = 30 reviews/122 obs, all pending. Local-only (no Vercel push). NEXT: owner reviews in the UI; coverage gap = zero Access/Digital examples in steakhouse data (targeted-sample before scaling to ~300–500).

## 2026-06-08 — Phase 1 route-gate campaign, batch 1: social-comment actions (+ TWO cross-org vulns found)

**Why**: Enterprise/DD readiness — 187 of 259 API routes use the service-role client (the pattern behind every past CRITICAL), and only ~9 were gate-tested. Phase 1 systematically adds org-scoping gate tests to mutating tenant routes, prioritized by blast radius.

**What changed**: new `tests/integration/social-comment-routes-gate.test.ts` (18 tests) over the 6 social-comment action routes (delete/hide/reply/ai-reply/dm/bulk) — these POST to external platforms on behalf of an org's connected account, so a cross-org leak lets one tenant act on another's social presence. The mock **records `.eq(col, val)` calls** so each test asserts the comment lookup is paired with `.eq('org_id', callerOrg)` — a real check that the org filter is applied, not a simulated null. All 6 verified correctly gated.

**SECURITY FINDINGS (flagged, NOT yet fixed — awaiting owner decision)**: the same read of sibling routes surfaced two genuine cross-org write holes:
1. **`POST /api/townhall/themes/[id]` — CRITICAL.** Authenticates the user but never checks the caller's org. Fetches the topic by bare id (service role) and pairs the UPDATE with the *topic's own* `org_id` (tautological), and the legacy `townhall_themes` fallback has no org filter at all. Any logged-in user from any org can approve/dismiss/pause/close/reopen another tenant's town-hall topics by id. Textbook violation of the CLAUDE.md "pair id with org_id" invariant.
2. **`POST /api/townhall/sessions/[id]/duplicate` — MEDIUM.** Fetches the source session by bare id with no caller-org check and inserts a copy into `source.org_id`. A logged-in user can force an unauthorized duplicate row into another tenant's org and confirm a session id exists (the copy lands in the victim org, so no direct data read). Missing org gate.

Proposed fix for both: fetch the caller's org (sibling routes already do) and require `row.org_id === callerOrg || isAdmin`, returning 404 otherwise — then add the secure-behavior tests. Not applied yet; surfaced to owner.

**Verify**: `npx vitest run social-comment-routes-gate` 18/18; full suite 593 pass. Local-only.

## 2026-06-08 — FIX the two cross-org town-hall write holes (owner authorized)

**Why**: The Phase-1 gate campaign surfaced two genuine cross-org write vulnerabilities (see the batch-1 entry above). Owner authorized fixing both now, strictly same-org with a platform-admin bypass.

**What changed**:
- `app/api/townhall/themes/[id]/route.ts` — now resolves the caller's `org_id`+`is_admin_org` after auth. The new-substrate `town_hall_topics` branch requires `topic.org_id === callerOrg || isAdmin` (404 otherwise) before the update. The legacy `townhall_themes` branch (no `org_id` column) now fetches the row joined to `townhall_sessions(org_id)` and gates on the parent session's org — previously it was a bare-id update with no org filter.
- `app/api/townhall/sessions/[id]/duplicate/route.ts` — resolves caller org+admin and requires `source.org_id === callerOrg || isAdmin` (404 otherwise) before duplicating.
- `tests/integration/townhall-mutation-gate.test.ts` (10 tests) — asserts the secure contract for both: 401 no-auth, 401 no-org, cross-org non-admin → 404 (both substrates for themes), owning-org allowed, admin bypass allowed.
- `docs/TOWNHALL.md` Auth Model — documented the fix.

**Verify**: `npx vitest run townhall-mutation-gate` 10/10; full suite 603 pass; `tsc --noEmit` clean. Local-only — these are behavior changes to live routes; first prod exercise is whatever town-hall moderation flow the owner runs after deploy (admin bypass preserved so the Datanautix admin org is unaffected).

## 2026-06-08 — Phase 1 route-gate campaign, batch 3: data-source mutations

**Why**: Continue the Phase-1 sweep (org-scoping gate tests on mutating service-role routes). This batch = paid/external data-pull + connection-delete routes, where a cross-org leak would let one tenant trigger another's paid pulls or delete their connected account.

**What changed**: new `tests/integration/data-source-routes-gate.test.ts` (14 tests) over review-sources `[sourceId]` DELETE/PATCH + `/sync`, reddit-sources `/sync` + `/download-thread`, and social/connections `[id]` DELETE. Asserts 401 / 403 (no analyze feature or no org) / 404 cross-org, with `.eq('org_id', callerOrg)` recorded on the source lookup and on the connection delete. **All five routes verified correctly gated — no new vulns in this batch** (unlike the town-hall batch). Heavy pull libs (reviewSync, reddit, analyticsCompute) mocked. Added to TESTING.md layout.

**Verify**: `npx vitest run data-source-routes-gate` 14/14; full suite 617 pass. Local-only.

**Phase 1 running total**: ~15 of ~80 mutating service-role routes now gate-tested (social comments 6, agent routes from Batch 3, town-hall 2 [fixed], data sources 5). 2 cross-org write vulns found + fixed so far.

## 2026-06-08 — Town Hall: fix the upload-stuck brick (status='uploading' could never re-attach)

**Why**: Owner hit *"cannot attach media to a project in 'uploading'"* uploading audio to a Town Hall (`NOWOCATS TEST RUN`). Root cause: a prior attach added a file and flipped the recording to `uploading`, but the upload never completed (stray/wrong file). The attach endpoint only accepted `awaiting_media`/`draft`, so every retry 409'd — the recording was permanently bricked with no UI path out.

**What changed**:
- `app/api/recordings/[id]/files/route.ts` — attach now also accepts `uploading` as a recovery state, and deletes the stale (not-yet-processed) `recording_files` rows before inserting the fresh set. Safe because nothing past `uploading` has run (process() flips it to `queued`), so no file can be `extracted`.
- `app/recordings/[id]/status/StatusClient.tsx` — `isSetup` now includes `uploading`, so a page reload while stuck shows the "Add recording" pane (recovery) instead of stranding the user on the progress ladder.

**Verify**: `tsc --noEmit` clean; full suite 617 pass. Local-only. The stuck prod recording auto-recovers on the next "Upload & process" (the prod-DB reset was declined by the safety classifier; the code fix clears the stale row itself).

## 2026-06-08 — Town Hall: org-wide visibility (transferred recordings were invisible to the recipient org)

**Why**: Owner transferred `NOWOCATS Meeting 2` to the Arjun Pilots org; Arjun (the org **owner**) couldn't see it on his Town Hall dashboard. The transfer was correct (recording `org_id` = Arjun Pilots, audit-logged). The bug was the list scoping: Town Hall used a 3-tier model (`isAdminOrg` → all orgs, `isAdmin` → own org, regular → `created_by=self`), but `userContext.isAdmin === is_admin_org`, so the middle tier is **dead** for client orgs — every client-org user (even an owner) fell to `created_by=self`. A transferred recording keeps its original creator, so it never matched. RLS policy `recordings_org_read` is already org-wide, so this was purely an app-layer service-role filter, and it diverged from how datasets/agents/studies already work (org-wide for all members).

**What changed** (org-wide, matching the rest of the platform; decided with owner):
- `app/recordings/page.tsx` + `app/api/recordings/route.ts` (§4.8) — list scoping dropped the `created_by` filter; non-admin-org users see all recordings in their org.
- `app/api/recordings/[id]/route.ts` — DELETE + PATCH gates changed from `created_by===self` to org-membership (`isAdminOrg || rec.org_id===orgId`); the fetch is already org-scoped. GET detail now returns `share.token` to any org member (share management is org-wide; fetch is id+org_id-scoped so no cross-tenant leak).
- `app/api/recordings/[id]/share/route.ts` + `report/send/route.ts` — dropped the owner-only gate; any org member (or admin) may toggle the public link / send the report (the existing org check is the gate). Transfer stays platform-admin-only (unchanged).
- Tests: `recordings-routes.test.ts` (list asserts org-only scope, no `created_by`; DELETE 403 reframed to cross-org defensive) + `export-org-gate.test.ts` (same-org non-creator CAN now enable sharing → 200). `docs/RECORDINGS.md` §4.7/4.7a/4.8 updated.

**Verify**: `npx vitest run recordings-routes export-org-gate recording-transfer-gate` 45/45; full suite 617 pass; `tsc --noEmit` clean. Local-only. Fixes Arjun's access (he's the org owner); also fixes any future transfer-into-org case for all members.

## 2026-06-08 — Phase 1 route-gate campaign, batch 4: core-entity mutations (+ 3rd cross-org write fix)

**Why**: Continue the Phase-1 sweep over the core-entity mutation routes (studies, collections, campaigns, team, town-hall session/topic creation). Audited 7 routes; 6 were already correctly gated, 1 was a genuine cross-org write hole.

**What changed**:
- **FIX** `app/api/townhall/themes/custom/route.ts` (owner authorized) — the facilitator "push a custom question" route was the same class as the two themes/[id]+duplicate holes fixed earlier today: it looked up `town_halls` by bare `session_id` and inserted a `town_hall_topics` row into *that hall's* org with no caller-org check, and the legacy `townhall_themes` branch had no org filter at all — so any logged-in user could inject a custom question into any tenant's live town hall by id. Now resolves the caller's `org_id`+`is_admin_org`, gates the new-substrate branch on `hall.org_id === callerOrg || isAdmin` and the legacy branch on the parent `townhall_sessions.org_id` (404 otherwise; admin bypass preserved).
- New `tests/integration/core-entity-routes-gate.test.ts` (30 tests) over studies/[id] PATCH+DELETE, collections/[id] GET+DELETE, campaigns/[id]/clone, campaigns/[id]/respondents GET+POST+DELETE, settings/team PATCH+DELETE, townhall/sessions POST, townhall/themes/custom POST. Records `.eq()`/`.insert()` to assert org-paired lookups + that creates land in the caller org (themes/custom + sessions POST).
- **Confirmed with owner**: `studies/[id]` is intentionally gated on per-user `created_by` (only the creator or a platform admin may edit/delete), NOT org-scoped — so its tests assert the `created_by` contract. Not a cross-org leak (created_by is the auth user id); the org-colleague-can't-edit behavior is by design.
- The other 5 routes (collections, campaigns clone + respondents, settings/team, townhall/sessions POST) **verified correctly gated** — no new vulns.
- Docs: TESTING.md layout + TOWNHALL.md Auth Model ("Cross-org write fix #2").

**Verify**: `npx vitest run core-entity-routes-gate` 30/30; full suite 647 pass; `tsc --noEmit` clean. Local-only — themes/custom is a behavior change to a live route; first prod exercise is the next facilitator "add custom question" action after deploy (admin bypass preserved so the Datanautix admin org is unaffected).

**Phase 1 running total**: ~22 of ~80 mutating service-role routes now gate-tested. **3 cross-org write vulns found + fixed** (themes/[id], sessions/[id]/duplicate, themes/custom — all the same bare-id-insert/update class).
