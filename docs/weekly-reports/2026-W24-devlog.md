# 2026-W24 — Dev log (Week of Jun 8 to Jun 14)

## 2026-06-09 — Fix: Town Hall report PDF 500s in prod (Chromium bin/ not traced)

**Why**: Owner reported the Town Hall report **Download PDF** failing in production. Captured the real prod error off the function logs (the route only logs it server-side, returns a generic "PDF render failed"): `The input directory "/var/task/node_modules/@sparticuz/chromium/bin" does not exist`. Confirmed the code path is sound — rendered PDFs locally against both real complete recordings (NOWOCATS TEST RUN + Meeting 2), with and without transcript, all succeeded. The failure was serverless-bundling only.

**What changed**: `next.config.js` `outputFileTracingIncludes` — added `./node_modules/@sparticuz/chromium/bin/**` for the three headless-Chrome PDF routes (`/api/recordings/[id]/report/pdf`, `/api/recordings/[id]/report/send`, `/api/bots/[id]/study/pdf`). `serverExternalPackages` keeps the package's JS from being relocated, but @sparticuz/chromium loads its brotli-packed binary + fonts + swiftshader from `bin/` via a runtime-computed path the static tracer can't follow, so those ~70MB of assets were left out of the function. This ships them. The Agent Study PDF route (same engine) had the identical latent bug — fixed in the same pass.

**Verify**: `node --check next.config.js` clean; local render harness proved the data/HTML/render logic before the change. The fix only takes effect on a prod build/deploy (output tracing is a build-time step — not reproducible locally), so the real confirmation is the owner re-clicking Download PDF after the next deploy. Local-only commit.

## 2026-06-08 — Security-audit remediation: Claude Code agent-workspace hardening hooks

**Why**: The 2026-06-08 `/security-audit` scored the workspace 80/100 (Grade B); the only gap was Phase-5 Claude-Code security hooks (0/15) — the harness had no guard against a confused/hijacked agent running catastrophic or exfil-shaped Bash, nor any scanner for secrets surfacing in tool output. This is pure config/agent hardening (defense-in-depth), distinct from the app-level multi-tenancy work (which scores under `/audit-codebase`).

**What changed**: Two new hooks wired in `.claude/settings.json`, modelled on the dangerous-pattern + `secrets:` blocks of `.claude/resources/threat-db.yaml`. (1) `PreToolUse` `security-pretooluse.sh` (matcher `Bash`) blocks reverse shells (`/dev/tcp`, `nc -e`, `mkfifo`+nc), remote-exec pipes (`curl|sh`, `base64 -d|sh`), fork bombs, recursive-force deletes of `/`/`~`/`$HOME`/`/*`, and private-key reads (SSH/AWS/cloud) — exit 2 with a reason fed back to the agent; `.env`/`.env.local` reads stay allowed (gitignored, dev loop needs them). (2) `PostToolUse` `security-posttooluse.sh` (matcher `Bash|Read`) scans output for secret-shaped values (Anthropic/OpenAI/GitHub/GitLab/AWS/Slack/Google/Sentry/Stripe tokens, private-key blocks, Supabase service-role JWTs) and alerts so a secret is never echoed/committed/sent off-platform. Hooks guard only the agent — a human in the terminal is unaffected. Documented in SECURITY.md §9 alongside the PostCSS-advisory posture (2 moderate, build-time-only, do NOT `npm audit fix --force` = absurd next@9.3.3 downgrade). Also pruned 8 stale `~/Documents/GitHub/sentimetrx/...` allowlist entries from the (gitignored) `settings.local.json` — checkout moved to `~/Developer/`.

**Verify**: Both hooks unit-tested via stdin fixtures — 11 dangerous commands blocked + 7 benign allowed (PreToolUse); 6 secret shapes flagged + benign/placeholder/threat-db-self-read passing (PostToolUse). `jq empty` clean on both settings files. Local-only, no app code touched.

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

## 2026-06-08 — Phase 1 route-gate campaign, batch 5: external-ingest sources + social alert rules

**Why**: Continue the Phase-1 sweep over the external-ingest source-creation/download routes (substack, regulations.gov) and the social alert/DM-template rule routes — where a cross-org leak would let one tenant write rows into / trigger paid pulls on another tenant's dataset, or read/mutate another org's alert rules.

**What changed**: new `tests/integration/external-source-routes-gate.test.ts` (24 tests) over substack-sources (create / download-comments / fetch-posts), regulations-sources (create / download-comments / search), social/alerts (GET/POST/PATCH/DELETE), social/dm-templates (GET/POST). Asserts 401 / 403 (no analyze feature or no org) / 404 cross-org, with `.eq('org_id', callerOrg)` recorded on the dataset/rule lookups, `org_id` recorded on the create inserts, and the social/alerts PATCH field-whitelist rejecting an `org_id`-only body (the documented org-escape guard). **All 8 routes verified correctly gated — no new vulns in this batch.** regulations/download-comments already carries an explicit cross-org JS gate (with the attack documented in-comment from a prior fix); admin-bypass path asserted too. External libs (substack, regulations, analyticsCompute) mocked. Added to TESTING.md layout.

**Verify**: `npx vitest run external-source-routes-gate` 24/24; full suite 671 pass; `tsc --noEmit` clean. Local-only.

**Phase 1 running total**: ~30 of ~80 mutating service-role routes now gate-tested. 3 cross-org write vulns found + fixed (all in batches 1–4; batches 3+5 = test-only, no new vulns).

## 2026-06-08 — Phase 1 route-gate campaign, batch 6: dataset lifecycle mutations

**Why**: Continue the Phase-1 sweep over the highest-blast-radius dataset routes — the ones that delete a dataset, wipe + re-import all its rows (`sync?full=true`), trim rows by date, or overwrite the analysis state. A cross-org leak here would let one tenant destroy or corrupt another tenant's dataset.

**What changed**: new `tests/integration/dataset-mutation-routes-gate.test.ts` (19 tests) over `datasets/[datasetId]` GET/PATCH/DELETE, `/state` GET/PUT/PATCH, `/trim` POST, `/sync` POST, `/refresh-schema` POST. Asserts 401 / 401-no-analyze / 403 cross-org (PATCH) / 404 cross-org (GET/DELETE/state/trim/sync/refresh) **before any service-role write**, with `.eq('org_id', callerOrg)` recorded on the GET/DELETE lookups, the DELETE per-creator 403, the state PATCH field-whitelist (`hacker:1` → 400), and admin-bypass on PATCH. **All five route groups verified correctly gated — no new vulns.** Each already resolves the caller org via `getOrgAndCheck` / `getCallerOrgContext` / a users lookup and refuses a cross-org dataset; sync + trim additionally audit cross-org admin destructive ops. Heavy libs (orgAccess, orgTransfer, analyticsCompute, collectionRecompute) mocked. Added to TESTING.md layout.

**Verify**: `npx vitest run dataset-mutation-routes-gate` 19/19; full suite 690 pass; `tsc --noEmit` clean. Local-only.

**Phase 1 running total**: ~35 of ~80 mutating service-role routes now gate-tested. 3 cross-org write vulns found + fixed (all in batches 1–4; batches 3/5/6 = test-only, no new vulns).

## 2026-06-08 — Phase 1 route-gate campaign, batch 7: dataset entity-catalog + enrichment routes

**Why**: Continue the Phase-1 sweep over the dataset entity-catalog management routes (manual add, edit, hard-delete, reset-discovered, AI discovery) and the enrichment writers (auto-setup overwrites schema, compute writes analytics) — plus the two AI-helper routes (merge-themes, expand-keywords).

**What changed**: new `tests/integration/entity-enrichment-routes-gate.test.ts` (17 tests) over entities GET/POST, entities/[slug] PATCH/DELETE, entities/reset-discovered POST, discover-entities POST, auto-setup POST, compute POST, merge-themes POST, expand-keywords POST. Asserts 401 (no auth / no org) and 404 cross-org, with `.eq('org_id', callerOrg)` recorded on the POST + `[slug]` + reset-discovered lookups (the paired id+org_id service-role pattern). **All routes verified correctly gated — no new vulns.** The data-mutating routes resolve the caller org and refuse a cross-org dataset before any write (paired lookup or JS org check); auto-setup + discover-entities carry explicit documented cross-org gates. merge-themes / expand-keywords are auth-only AI helpers that read no tenant rows — inputs come from the body and the dataset existence check is RLS-bound (merge-themes uses the anon client). Heavy libs (entityFilter, entityDiscovery, ai, analyticsCompute, collectionRecompute, brandRules) mocked. Added to TESTING.md layout.

**Verify**: `npx vitest run entity-enrichment-routes-gate` 17/17; full suite 707 pass; `tsc --noEmit` clean. Local-only.

**Phase 1 running total**: ~43 of ~80 mutating service-role routes now gate-tested. 3 cross-org write vulns found + fixed (all in batches 1–4; batches 3/5/6/7 = test-only, no new vulns).

## 2026-06-08 — Phase 1 route-gate campaign, batch 8: dataset query-POST routes (+ 3 cross-org READ leaks fixed)

**Why**: The dataset "query POST" routes read tenant rows from a request body (chart aggregates, comment filters, theme counts, regressions, signal stats), so a missing org filter is a cross-org READ leak. Audited 8; 5 were correctly gated, 3 were holes (owner authorized fixing all three).

**Holes found + FIXED**:
- `app/api/datasets/[datasetId]/theme-counts/route.ts` (LIVE leak) — only `getAuthUser`, then fetched the dataset by bare id and ran `count_theme_matches` / `theme_dimension_counts` + **topical-word extraction** over `dataset_rows_flat`. Any authed user could mine another tenant's theme counts, co-occurrence, dimensions, and **actual topical words from their review text** by id. Now resolves `getCallerOrgContext` and gates `dataset.org_id === callerOrg || isAdmin` (404 else) before any read.
- `app/api/datasets/signal-stats-batch/route.ts` (LIVE leak) — only `getAuthUser`, then `computeSignalStats` over an arbitrary `ids[]` from the body. Now filters the requested ids to those the caller's org owns (admin = all); cross-org ids drop out → empty stats.
- `app/api/datasets/[datasetId]/theme-impact/route.ts` (LATENT) — same missing gate, but reads the removed `dataset_rows` table so it currently returns "not enough rows". Gated for defense-in-depth.

**What else changed**: new `tests/integration/dataset-query-routes-gate.test.ts` (19 tests) — regression for the three fixes (401 / 404 cross-org / owning-org allowed / signal-stats ids filtered) plus the five already-gated routes (aggregate, rows GET/POST/DELETE, comments, taxonomy GET/POST, export/html/share). Docs: SECURITY.md § 2 (added the campaign findings to the cross-org reference), ANALYTICS.md (org-gate note on the signal-stats/theme routes), TESTING.md layout. Heavy libs mocked.

**Verify**: `npx vitest run dataset-query-routes-gate` 19/19; full suite 726 pass; `rm tsconfig.tsbuildinfo && tsc --noEmit` clean. Local-only — three behavior changes to live read routes; admin-org bypass preserved so the Datanautix admin org is unaffected.

**Phase 1 running total**: ~51 of ~140 mutating/read service-role routes now gate-tested (the real denominator is ~140, not the ~80 I'd been quoting). **6 cross-org vulns found + fixed total** (3 write in batches 1–4, 3 read in batch 8).

## 2026-06-08 — Phase 1 route-gate campaign, batch 9: agent (bot) action + study routes

**Why**: Cover the agent action/study routes not already in bot-routes-gate — conversation→dataset sync, KB entity extract/edit/delete, question triage, conversation review, Agent Study PDF/PPTX exports, and ask-ana (AI Q&A over a dataset).

**What changed**: new `tests/integration/bot-action-routes-gate.test.ts` (21 tests) over bots POST/import (create), bots/[id]/{analyze, entities/extract, entities/[entityId] PATCH+DELETE, questions/[questionId] PATCH, conversations/[sessionId]/review, study/pdf, study/pptx}, and ask-ana. Asserts 401 (no auth / no org) + 404 cross-org on the agent org gate (ask-ana 403 on the body datasetId). **All verified correctly gated — no new vulns.** Every [id] route resolves the caller org via getCallerOrgContext and gates the agent's org_id before any service-role read/write; entity/question rows are additionally paired by scope/bot_id; create routes write into the caller's own org. Heavy libs (botEntityExtraction, agentStudy, pptx renderer, entityFilter) mocked.

**Verify**: `npx vitest run bot-action-routes-gate` 21/21; full suite pass; tsc clean. Local-only.

**Phase 1 running total**: ~61 of ~140 mutating/read service-role routes now gate-tested. 6 cross-org vulns found + fixed (none new in batch 9).

## 2026-06-08 — Phase 1 route-gate campaign, batch 10: Town Hall (recordings) + PulseIQ routes

**Why**: Cover the recordings/townhall routes not already in recordings-routes.test.ts (which gate-tests 10 of them). Remaining: the live-capture, report-export, sign-off, version, and setup-extract routes plus the PulseIQ `townhall_sessions/[id]` CRUD + analyze.

**What changed**: new `tests/integration/recordings-townhall-routes-gate.test.ts` (33 tests) over recordings/[id]/{files, live-summary, live-token, live-transcript, report/pdf, report/send, signoff POST+DELETE, versions GET+POST}, recordings/extract-setup, townhall/sessions/[id] GET/PATCH/DELETE, townhall/sessions/[id]/analyze. Asserts 401 (no auth), 403 (extract-setup no recordings feature), and 404 cross-org — paired id+org_id lookups (404 on null) plus dedicated cross-org-row tests for the JS `org_id !==` routes (report/pdf, report/send, townhall/sessions/[id], analyze). **All verified correctly gated — no new vulns.** Heavy/external libs (deepgram, reportPdf/puppeteer, reportEmail/resend, setupExtract/vision, ai, townHallAdapter) mocked.

**Verify**: `npx vitest run recordings-townhall-routes-gate` 33/33; full suite 780 pass; tsc clean. Local-only.

**Phase 1 running total**: ~72 of ~140 mutating/read service-role routes now gate-tested. 6 cross-org vulns found + fixed (none new in batch 10).

## 2026-06-08 — Phase 1 route-gate campaign, batch 11: sources + misc tenant routes (Area 1 complete)

**Why**: Finish Area 1 of the campaign (tenant mutations needing gate tests) — the remaining data-source creators, social config/export, study analyze/responses, team/profile/org settings, invites, favorites, and share.

**What changed**: new `tests/integration/sources-misc-routes-gate.test.ts` (28 tests) over review-sources (create + `[sourceId]/locations` + `user-locations`), reddit-sources, social/auto-config + export-dataset, collections/datasets create, studies/[id]/analyze + responses (GET/DELETE), settings/team/disable, org/logo, invite + `[id]` + `[id]/resend`, favorites, share. Asserts 401, cross-org 404, and role/owner 403 — every route validates the id/org_id taken from input against the caller's org (and role where required). **All verified correctly gated — no new vulns.** Notable patterns confirmed: studies/responses gates the study through the RLS user client (404 cross-org); org/logo + invite validate the body `org_id` against the caller's owner-of-that-org; share routes through `gateShareTarget` (403 cross-org); studies/responses DELETE authenticates via `userClient.auth.getUser()` (mocked).

**Verify**: `npx vitest run sources-misc-routes-gate` 28/28; full suite 808 pass; tsc clean. Local-only.

**Phase 1 — Area 1 (tenant mutations) COMPLETE**: ~83 of ~140 mutating/read service-role routes gate-tested across 11 batches. **6 cross-org vulns found + fixed** (3 write, 3 read). Remaining work is two *different* kinds: (a) ~13 `admin/*` routes — assert `requireAdmin`; (b) ~15 genuinely-public participant/webhook routes — no-leak assertions + SECURITY.md notes (not org-gate tests).

## 2026-06-08 — Phase 1 route-gate campaign, batch 12: admin/* platform-admin gate

**Why**: Close out Area 2 — assert every internal admin/* route rejects a non-admin caller (CLAUDE.md/SECURITY.md: "internal-only routes wrap requireAdmin from day one; URL obscurity is not a defense").

**What changed**: new `tests/integration/admin-routes-gate.test.ts` (46 tests = 23 route+verb combos × {unauthenticated, non-admin authed}) over admin/{agent-tester, bulk-invite, clients, clients/[id], invite-preview, org-snapshots/[orgId], org-snapshots/[orgId]/restore, orgs/[id], orgs/[id]/ai-key, orgs/[id]/features, reo-gold-set, users/[id], users/[id]/features}. Drives the real `requireAdmin()` (which reads `supabase.auth.getUser()` + `organizations.is_admin_org` and returns **404** to hide existence) via the mock; the two inline-gated routes (bulk-invite, invite-preview) reject with 401/403. **Contract asserted: a non-admin caller — authed or not — never gets a 2xx (status ∈ {401,403,404}).** All 23 verified gated. Heavy libs (aiKey, backupS3, orgSnapshot, email, guardrails) mocked.

**Verify**: `npx vitest run admin-routes-gate` 46/46; full suite pass; tsc clean. Local-only.

## 2026-06-08 — Phase 1 route-gate campaign, batch 13: public surface (no-leak) — CAMPAIGN COMPLETE

**Why**: Close out the last category — the ~15 intentionally-unauthenticated routes (participant widgets, webhooks, embeds, demo kiosk). These aren't org-gated; the right work is confirming each carries a safety mechanism that prevents cross-tenant leak/forgery, then documenting the public surface for DD.

**What changed**: audited all 15 — every one is safe by design (Svix/Meta HMAC on webhooks, `session.status='active'` + token on participant routes, participant-validated self-writes, unguessable-guid/token capabilities, random-code pickup, rate-limit + self-data-only on the AI helpers). `POST /api/translate` is actually authenticated (public-shaped but requires a caller). New `tests/integration/public-routes-noleak.test.ts` (7 tests) asserting the testable guard contracts: resend webhook rejects absent/bogus Svix signature (401), social webhook rejects a request without a valid Meta HMAC, townhall/responses 400-missing + 404-unknown-session (no blind cross-session write), translate-responses english short-circuit + 10K size cap. New `docs/SECURITY.md` § 3 "Public (unauthenticated) surface" — a table cataloguing all 12 public routes + why each is safe (the bounded, deliberate public surface a buyer will ask about). TESTING.md layout updated.

**Verify**: `npx vitest run public-routes-noleak` 7/7; full suite pass; tsc clean. Local-only.

**🏁 PHASE 1 ROUTE-GATE CAMPAIGN COMPLETE.** 13 batches: Area 1 (tenant mutations, 11 batches), Area 2 (admin/* gate, batch 12), Area 3 (public surface, batch 13). ~90 of ~140 mutating/read service-role routes now carry explicit gate tests (the rest were already covered by pre-existing suites — recordings-routes, bot-routes, tenant-routes, export-org-gate, etc.). **6 cross-org vulns found + fixed** (3 write, 3 read) — all owner-authorized, all with regression coverage. Every admin route proven to reject non-admins; the public surface catalogued + guard-tested. 13 commits this campaign remain LOCAL (batch 8 carries 3 live security fixes) — surface "N commits ahead, not pushed" to the owner; do not push without the explicit word.

---

## 2026-06-08 — Agent combined client workbook (single .xlsx, 4 tabs)

**Why**: NOWOCATS' client (Sarina agent) wants the conversation data as one Excel file to hand off. The data already existed across separate downloads (Q&A pairs, unanswered questions CSV) but not bundled. Owner picked: Summary + Q&A Pairs + Unanswered + Full Transcript as four tabs, unanswered as the **raw** open-queue list (the Agent Study doesn't already cluster it, and a fresh AI cluster pass was out of scope).

**What changed**: New `GET /api/bots/[id]/workbook?format=xlsx` assembling the four sheets — Summary from the cache-first `getAgentStudy` (no new AI), Q&A Pairs via the shared review-gated pairing, Unanswered from `logged_questions status='open'` (plain-English type labels, PII-redacted by default), Full Transcript one-row-per-turn. Extracted `lib/agentExport.ts` (`loadExportTurns`/`turnsSheet`/`pairsSheet`/`redactPII`) and refactored the existing `/conversations/export` route onto it so the turn-load + pairing + redaction have one implementation. "Excel workbook" button added to the Transcripts page (xlsx-only — multi-sheet). BOTS.md §export updated.

**Verify**: `npx tsc --noEmit` clean (after cache clear); full suite 861 pass / 54 skip; 4-tab xlsx round-trip confirmed via XLSX read-back harness. Local-only — not pushed.

### 2026-06-08 (follow-up) — Q&A pairs: lead-in column for context

**Why**: Owner reviewing the workbook hit cryptic one-word "questions" (e.g. "Ye") with an answer but no way to tell what was being answered.

**What changed**: `lib/agentExport.pairsSheet` now emits the agent line immediately *before* each user turn as a new **Lead-in (agent said before)** column, and renames Question→**User said** (a one-word reply isn't a question). Shared, so both the workbook's Q&A Pairs tab and the standalone `/conversations/export?shape=pairs` download get it. BOTS.md updated.

**Verify**: tsc clean; lead-in round-trips correctly in the xlsx harness.

## 2026-06-08 — REO gold-set: guided tap-to-judge UI

**Why**: Owner reviewed the 30 seeded reviews (22 approved, 8 edited) but flagged they "may not have tagged correctly" — the edits added a `FoodBeverage>Menu` label whose evidence pointed at the dish itself, not the menu offering. Root cause is task design: a 50-aspect palette with no definitions in front of the labeler makes construction unreliable. Fix is to (a) put definitions inline and (b) shift from *constructing* labels to *judging* proposed ones.

**What changed**: `lib/reoVocabulary.ts` gains `REO_ASPECT_DEF` (one-line definition + example for all ~50 Domain›Aspect pairs, wording chosen to disambiguate Taste/Quality/Preparation and clarify Menu = the offering, not a dish) + `aspectDef()`. `GoldSetClient` reworked to tap-to-judge: each proposed label is a card with a keep/drop (✓/✗) toggle and its definition shown inline; "Save my judgments" persists only kept labels; "All correct" approves as-is. Reset the 8 edited reviews back to pending (gold/note cleared) so they re-surface with the better tooling; the 22 approved are untouched.

**Verify**: `npx tsc --noEmit` exit 0; DB now 22 approved / 8 pending. Local-only (no push).

### 2026-06-08 (follow-up 2) — "Unanswered" tab was misleading → "Low-Confidence Answers"

**Why**: Owner saw questions that clearly got a reply (in Q&A Pairs) ALSO sitting in the "Unanswered Questions" tab. Verified in `lib/logQuestion.ts`: `kb_miss`/`ai_uncertain` fire on the agent's REPLY being thin/hedged, not on a missing reply; `status='open'` only means untriaged on the Questions page. So "unanswered" was wrong — these all have replies.

**What changed** (owner decisions): (a) renamed the tab **"Low-Confidence Answers"**; (b) **excluded deflects** (`.in('classification', ['kb_miss','ai_uncertain'])`) — off-topic redirects aren't gaps; (c) added an **"Agent replied"** column (assistant line following each flagged question, matched by normalized text) so an answer is visibly present; (d) Summary line relabeled "Low-confidence answers (flagged for review)" and recomputed off the same filtered count so the two tabs reconcile. BOTS.md updated.

**Verify**: tsc clean; reply-lookup matches the following assistant turn by session+normalized message.

## 2026-06-08 — REO gold-set: completion screen + fix double-count on re-save

**Why**: Two UX bugs reported reviewing the set: (1) finishing review 30 dead-ended — the last card just stayed, no "done" state; (2) clicking "Save my judgments" on the last review kept incrementing the status count each time.

**What changed**: `GoldSetClient` — counts are now derived (`tally`) from the `reviews` array (the source of truth) instead of a separately-incremented `counts` state, so re-saving the same review just re-sets its status (no double-count). Added a `done` completion screen (shown when no review is left pending) with the final breakdown + "revisit skipped"/"browse from start" actions. Next-pending search now scans the whole list (not just forward), so a review left pending earlier is caught. `goTo()` clears the done state when jumping back in via a dot/prev/next.

**Verify**: `npx tsc --noEmit` exit 0. Local-only (no push).

### 2026-06-08 (follow-up 3) — personify export columns + drop internal KB column

**Why**: Owner — generated files should use the agent's NAME, not the word "agent" (the product personifies the tech to feel accessible). Also questioned the "Suggested answer / KB note" column on the Low-Confidence tab.

**What changed**: `pairsSheet`/`lowConfidenceSheet` now thread the agent's display name into response column headers (`Sarina said (before)`, `Sarina's answer`) via a `who` param; workbook filename `…_Agent_Export` → `…_Export`. Dropped the `suggested_kb_addition` ("KB note") column from the client-facing Low-Confidence tab — it's an internal team-curation field, near-always empty. New memory `feedback_personify_agent_in_files`.

**Verify**: tsc clean.

### 2026-06-08 (follow-up 4) — client-grade styling (exceljs)

**Why**: Owner wants the workbook to look polished for a client. The SheetJS community build can't write cell styles (bold/fill/border/wrap) — that's a paid feature.

**What changed**: New `lib/styledWorkbook.ts` (exceljs 4.4.0, added dep) takes the same `{name,headers,rows}` Sheet shape and renders bold teal frozen+filterable headers, content-fit column widths, wrapped text, zebra rows; Summary tab styled as a titled cover page (value column left-aligned so numbers line up with text). Workbook route now returns the exceljs buffer instead of the SheetJS `dataResponse`. Scoped to this one deliverable — the other xlsx exports stay on the lightweight SheetJS path. QC'd by rendering a dummy-data sample → PDF → PNG via LibreOffice (header fill, zebra, borders, personified columns all confirmed).

**Verify**: tsc clean; visual render inspected. Local-only.

### 2026-06-08 (follow-up 5) — Lottie loader on the Excel workbook button

**Why**: The workbook build can take a few seconds (Summary recompute); the button was a plain navigation with no feedback.

**What changed**: Switched the Excel-workbook button to a fetch→blob download (parses Content-Disposition for the filename) and added a full-screen `LottieLoader` "Preparing {Agent}'s Excel file…" overlay while it builds; button label flips to "Preparing…" and disables. Uses the canonical `components/ui/LottieLoader` (no CSS spinner). BOTS.md updated.

**Verify**: tsc clean. Local-only.

## 2026-06-08 — REO gold-set scale-up to ~520 (LLM-drafted, owner spot-check)

**Why**: Gold set v1 (30, owner-validated) proved the draft labels are structurally reliable; the one refined rule is sentiment calibration. To give the eval statistical weight, scale to ~500 via LLM drafting against the validated standard, and close the Access/Digital coverage gap (zero examples in steakhouse data).

**What changed**: `lib/reoExtractor.ts` — REO LLM classifier (Haiku 4.5 fast tier, cached system prompt encoding the validated rules: closed vocab, sentiment calibration "neutral mention != Positive", Menu = offering-not-dish, evidence-required, cooked→Preparation / wrong-item→Accuracy, outcome→Loyalty+Reputation). `scripts/draft-reo-goldset.ts` + `reo-draft-sample.json` (~400 general + 120 Access/Digital-targeted from Olive Garden/Cheddar's/BareBurger). Seeded 490 distinct reviews / 2,352 observations as `pending`. All 10 domains now covered (Access 65, Digital 12). NOTE: run server-only scripts with `node --conditions=react-server --import tsx`.

**Eval signal**: drafts skew Positive (1684/573/88 = ~72% Pos, ~4% Neutral) — model over-calls neutral mentions despite the prompt; owner spot-check quantifies, then few-shot/calibration fix. Owner-verified slice = gold eval set; rest = silver.

**Verify**: smoke test on 2 reviews correct (incl. Access>Parking, Digital>MobileApp); 519 classified / 0 failed; `npx tsc --noEmit` exit 0. Local-only (no push).

### 2026-06-09 — Public Comments record (make the agent's "I'll capture this" promise real)

**Why**: Owner spotted Sarina telling a resident "I'll make sure this is captured in the official PM-2 record" — but no mechanism backed it. The comment only lived in the raw transcript, and a *statement* (not a question) never hits `logged_questions`, so it's invisible in every gap-based export. Owner chose to build a real capture (option 2) over softening the wording (option 1).

**What changed**: `getAgentStudy` now extracts `publicComments[]` — substantive resident feedback (observation/concern/suggestion about the project), distinct from questions + chit-chat. Folded into the existing `classifyExchanges` pass (new `comment` field on prompt + ExchangeTag) → **zero added AI calls**, full coverage; each entry = `{quote verbatim, focus, sentiment, sessionId, createdAt}`. Cache `STUDY_SCHEMA_VERSION` v4→v5. Surfaced as a new **Public Comments** tab in the agent workbook (2nd tab; Date/Topic/Sentiment/Comment/Session, PII-redacted) + a "Public comments captured" Summary line. No new table/migration — rides the cached study JSONB. Report/deck UI don't render it yet (object-additive, backward-safe).

**Verify**: tsc clean (cache cleared); full suite 861 pass. Live extraction quality not yet eyeballed against real Sarina data — owner to spot-check the tab. Local-only.

## 2026-06-09 — REO robustness arc: session wrap + state

**Why**: Consolidating record of the REO (Restaurant Experience Ontology) robustness track for governance/handoff. Goal: make the Dimensions classifier more robust. Diagnosis found production is keyword-only (the `lib/taxonomyExtractor.ts` LLM tier is dormant, no eval harness, fixed-0.85 confidence). Owner chose the LEAN CUT (Domain›Aspect+Sentiment; defer Concepts; Emotion/Journey → experimental v2), restaurant-only for now.

**What now exists (all LOCAL, not pushed)**:
- `lib/reoVocabulary.ts` — lean REO closed vocab (10 domains, ~50 aspects) + `REO_ASPECT_DEF` inline definitions.
- `lib/reoExtractor.ts` — Haiku-4.5 REO LLM classifier with validated rules in a cached system prompt (becomes the production classifier once REO ships).
- `sql/121_reo_gold_set.sql` — `reo_gold_review` (proposed vs gold; RLS; admin-only writes). APPLIED to prod.
- `/admin/reo-gold-set` — guided tap-to-judge review UI (keep/drop per label, inline definitions, completion screen), under the Quality & Testing hub.
- Seed/draft scripts → 30 owner-validated + 490 LLM-drafted reviews (2,352 obs) in the DB. All 10 domains covered (Access/Digital gap closed).

**Findings**: (1) draft labels are structurally reliable (~100% Domain›Aspect agreement after definitions) → no dish/product field needed; (2) the one refined rule is sentiment calibration; (3) eval signal — LLM drafts skew Positive (~72%, Neutral ~4%), over-calling neutral mentions.

**Next**: owner spot-checks ~40–60 of the 490 → compute agreement (first REO accuracy number) → fix the Positive-skew (few-shot from the gold slice) → wire the LLM tier into the live classifier path to prove REO beats keyword-only. Commits this arc: 82eaecb0, d3482d3f, 4ac1f13d, 39e8127d (+ this docs commit). Nothing pushed; migration + 520 seeded rows live on the DB only.

---

### 2026-06-09 — Town Hall: stereo per-mic speaker separation (RØDE split)

**Why**: First live town hall with the new RØDE Wireless PRO mics came back with *every* segment tagged S1 — two distinct voices (different genders) collapsed to one speaker. Root cause (verified against the "Test" recording, all 20 segments S1): the live recorder pinned `getUserMedia` to `channelCount:1`, summing both transmitters into a mono mix *before* Deepgram saw it; Deepgram then voice-clusters a 44s mono blend and gives up at one speaker. Diarization ran — it just had nothing to separate. The RØDE RX is a true 2-channel device (Audio MIDI: "2 ch", Front Left/Right) set to Split, so the hardware was doing the right thing; we were throwing the split away.

**What**: Channel-aware path, auto-detected from the audio (no manual flag), serving both live capture and uploads:
- `extract.ts` ffprobes channel count and, for 2-channel sources, measures L−R energy to reject **dual-mono** (phones/cameras that duplicate one mix across both channels) → only genuine stereo is preserved (`-ac 2` @ 64k); everything else stays mono. Writes `recordings.audio_channels` (sql/122).
- `deepgram.ts` uses `multichannel=true` when stereo → **channel = speaker** (deterministic per-mic), else `diarize=true` as before. Each segment now carries `channel` (0=L/1=R) alongside `speaker`; utterances sorted by start across channels.
- `transcribe.ts` switches mode on `audio_channels`; `hybrid.ts` propagates the channel onto the aligned Whisper segment.
- Live recorder requests `channelCount:{ideal:2}` (RØDE→2ch, laptop mic→1ch), shows a "Stereo — 2 mics detected" badge, and the PCM worklet downmixes to mono so live captions still hear both mics.
- Report transcript shows the source mic ("Mic 1 · L") next to the speaker tag.

**Verify**: typecheck clean; 458 unit + 3 new hybrid-channel tests pass. End-to-end needs a real 2-channel RØDE capture in a browser (can't be done headless) — owner to do one ~30s two-person test recording and confirm S1 **and** S2 appear. sql/122 applied to prod DB. Commit local, not pushed.

---

### 2026-06-09 — Town Hall: Q&A extraction is optional (close out without it)

**Why**: Not every town hall is a Q&A. Some are open listening sessions — community members venting, no question/answer structure — where forcing the Opus/Sonnet Q&A pass produces noise and a ~$50 charge for nothing. Owner wants to close out the recording on the transcript alone and have Q&A labeled optional in the flow.

**What**: `analyzeRecordingWorkflow`/`runAnalyze` gain a `skipQa` flag; the `/analyze` route accepts `skip_qa:true`. Skip path bypasses Q&A extraction + dataset mirror + coverage + synthesis, still builds the presentation summary when a deck phase exists, and completes (analyzing→complete) with the transcript as the deliverable. GeneratePanel reframed: heading now "Transcript ready", copy states Q&A is optional, primary "Generate Q&A pairs" + secondary "Finish without Q&A" (confirm dialog). Report defaults to the Transcript tab when there are no Q&A pairs (was Coverage → empty). Refactored the presentation-summary block into a shared `maybeSummarizePresentation` helper used by both paths.

**Verify**: typecheck clean; 461 unit tests pass. End-to-end (a real transcribed recording → "Finish without Q&A" → report) is a UI/workflow path — owner to spot-check. No schema change. Local, not pushed.

---

### 2026-06-09 — Town Hall: Mic check pre-flight panel (self-contained mic test + adjust)

**Why**: Owner wanted mic selection + testing fully inside our tool (no Audio MIDI Setup), with as many in-browser adjustments as the platform allows — so a meeting isn't recorded on a misconfigured/too-quiet mic, and the RØDE stereo split can be confirmed before hitting record.

**What**: New `app/recordings/[id]/live/MicCheck.tsx` (controlled component) replaces the bare dropdown+AGC on the live idle screen:
- **Test microphone** opens a preview getUserMedia stream → ChannelSplitter → per-channel AnalyserNodes → live **L/R level meters** (single bar for mono), peak-smoothed, with **too-quiet (amber) / good (green) / clipping (red)** zones + guidance. The L/R meters double as in-tool split verification (speak into one mic, only its channel moves).
- Adjustments the browser exposes: **AGC**, **echo-cancellation**, **noise-suppression** toggles + a **software gain boost** (1×–4×). Gain applies live to the preview; on record, when gain≠1 the recorder records the output of a WebAudio gain graph (unity = raw stream, zero-risk default; graph preserves stereo so the per-mic split survives the boost). Honest note in-UI that hardware gain lives on the device/RØDE Central.
- `buildAudioConstraints(MicSettings)` centralizes the getUserMedia constraints (device + the three toggles + channelCount ideal:2), shared by the test and the real capture so they're identical. LiveClient now holds one `micSettings` object; added `gainCtxRef` (closed in teardown). Preview auto-restarts on device/toggle change, releases on record start/unmount.

**Verify**: typecheck clean; 461 unit tests pass; live route compiles (307 auth-redirect, no build error). In-browser real-mic exercise (meters move, L/R split, gain audible) needs the owner + RØDE. Local, not pushed.

---

### 2026-06-09 — MCO: "Listening to Your Guests" client teaser deck

**Why**: 30-min first meeting with MCO's (Orlando International / GOAA) small-business development program. They need a high-level leave-behind to take to internal guest-experience stakeholders and earn a second meeting. Datanautix engaged MCO 2015–2020 (website-feedback + Sprout Social social listening + quarterly peer benchmarking + on-demand guest studies, all powered by open-ended text analytics); engagement paused at COVID. Deck recaps that history and pitches a path forward: continuous Voice-of-Guest analytics, reimagined peer benchmarking, and the agentic MCO Concierge prototype (`/b/mco`).

**What**: New admin deck route `app/api/mco-listening-deck/route.ts` (requireAdmin + logDeckDownload), builder `lib/pptx/mcoListeningDeck.ts` (`buildMcoListeningDeck(pptx)` — shared by the route and a local QC harness), and `lib/pptx/mcoLogo.ts` (the MCO sunburst mark base64-inlined as a data URI — the PNG is white-backed/opaque, so it's placed on white co-brand chips; inlined to dodge the public/ file-tracing gotcha on Vercel). 14 main slides + appendix: title → 5yr history → 4 channels → "Listening" methodology (Capture→Understand→Benchmark→Act→Close) → channel map → analytics → two-sided benchmarking → agentic leap → MCO Concierge → two-wins → small-business tie-in → phased path → the ask → close (MCO × datanautix lockup). Appendix carries **clearly-labeled ILLUSTRATIVE** sample outputs (VoG sentiment dashboard + two benchmarking bars), built to swap with real review data when the owner supplies a peer set — no fabricated data presented as real MCO findings. Registered in `app/admin/decks/{DecksClient.tsx,page.tsx}`. QC harness: `scripts/_mco_listening_deck_qc.ts`.

**Verify**: typecheck clean; rendered to PPTX → PDF → PNG (LibreOffice + pdftoppm) and visually inspected all 19 pages; fixed two bottom captions that collided with the footer. Logo renders cleanly on white chips. Local, not pushed. (Note: a concurrent Town Hall session left `MicCheck.tsx` modified in the tree — not part of this commit.)

---

### 2026-06-09 — Town Hall: Mic check becomes a full dress rehearsal (captions + clip + live monitor)

**Why**: Owner wanted the mic test to prove the whole capture chain, not just show meters — hear it, transcribe it, and A/B the processing settings by ear before committing to a meeting.

**What** (extends MicCheck.tsx, same preview graph — every node hangs off one gain stage):
- **Live captions during the test**: reuses the real recorder's path (POST /live-token → Deepgram WS via `['bearer',token]` → `pcm16-worklet` PCM, opening-frames buffered until ws.onopen). Best-effort; failure shows a notice, mic test continues. MicCheck now takes `recordingId` + `language`.
- **Record a test clip & play back**: MediaRecorder on a gain-applied MediaStreamDestination → local Blob → object URL → `<audio controls>`. Never uploaded; 30s auto-cap; object URL revoked on restart/stop/unmount.
- **Live monitor ("🎧 Listen")**: a monitor GainNode (gain → monitorGain → ctx.destination; 0=muted) routes the processed mic to the speakers so toggling AGC/echo-cancel/noise-suppress/gain is audible in real time. Off by default with a headphones/feedback warning (open mic + speakers = howl). Monitor + gain apply live; AGC/echo/noise re-open the preview (constraintKey effect) preserving monitor state via a ref.

**Verify**: typecheck clean; 461 unit tests pass; live route compiles (307 auth-redirect). In-browser exercise (captions stream, clip playback, monitor A/B, with the RØDE) needs the owner. Local, not pushed. NOTE: live captions in the test consume a little Deepgram live usage per test, and need `DEEPGRAM_GRANT_KEY` in Vercel env on deploy (same gotcha as the live recorder).

---

### 2026-06-09 — Town Hall: color-code the two mics (report transcript + live test)

**Why**: With a stereo split-mic transcript, a flat list of S1/S2 is hard to scan. Color/italicize each line by source mic so the two speakers are separable at a glance — in the report AND in the mic test (so a 2-mic setup can be verified live).

**What**:
- Report transcript (`TranscriptTab`): when segments carry `channel`, Mic 1·L stays plain dark, Mic 2·R is indigo + italic (layered with the existing Q/A bold/italic role overlay — color is the channel signal so it never clashes with role styling). Added a stereo legend; mic-label tag colored to match.
- Mic test captions (`MicCheck`): refactored single mono caption stream → **per-channel** — for a stereo device it opens TWO Deepgram live streams off the meters' ChannelSplitter (L=output 0, R=output 1), each its own colored lane (matches the report). Mono stays one stream. Caption state re-keyed `{mono|L|R}`.

**Verify**: typecheck clean; 461 tests pass; live route compiles. In-browser per-mic captions need the owner + RØDE. Local, not pushed. (Note: stereo test = two live Deepgram streams = ~2× the small per-test caption usage.)

---

### 2026-06-09 — Town Hall: Mic check recommends settings after a test

**Why**: Owner wanted the test to not just show levels but tell them what to set — gain + toggles — so a non-technical user gets a one-click correct configuration.

**What** (MicCheck.tsx): the test tracks peak level + whether it ever clipped (refs updated in the meter draw loop). On an explicit "Stop test", `computeReco(maxLevel, clipped, channels, settings)` produces a plain-English recommendation + a suggested MicSettings: clipping → lower gain (or back off hardware); low signal → raise software gain to ~target (with the dB shown); good → say so; echo-cancel/noise-suppress → off for room capture; stereo + AGC → AGC off (fights per-mic levels). An **Apply recommended** button writes the suggested settings via onChange; Dismiss closes it. Metrics read from refs (incl. channelsRef) so stopTest stays identity-stable and a constraint-change re-open/unmount never pops the card.

**Verify**: typecheck clean; 461 tests pass; live route compiles. In-browser reco accuracy needs the owner + RØDE. Local, not pushed.

---

### 2026-06-09 — Town Hall: Mic check — stereo/mono clip playback + Auto-tune sweep

**Why**: Owner wanted (1) a choice of stereo vs mono test-clip playback, and (2) the recommendation to actually *evaluate* setting combinations rather than only heuristically infer them.

**What** (MicCheck.tsx):
- **Stereo/mono playback toggle**: the test clip records the gain-applied (stereo) stream as before; a Stereo/Mono switch (only shown for a 2-ch source) plays either the original or a mono downmix derived on first switch (`decodeAudioData` → `OfflineAudioContext(1,…)` → `encodeWavMono` → object URL). Both URLs revoked on re-record/stop/unmount.
- **Auto-tune sweep** (opt-in, instructed): on Start it sequentially opens the mic under each of 4 combos (AGC×noise-suppress; echo-cancel held off), records ~3s each, and `measureCombo` collects peak, clip fraction, and an SNR estimate (10th vs 90th-pct frame RMS). `scoreCombo` = SNR − clipping/level penalties; the winner becomes a Reco (winning toggles + a gain suggestion) shown in the existing Apply card. Intro panel tells the user exactly what to do (keep talking ~15s); running panel shows progress + a Cancel; `cancelAutoRef` aborts and is tripped on unmount. Honest limits documented in-UI: objective metrics only, needs consistent speech, can't see a silent 2nd speaker — monitor + clip playback remain the human check.

**Verify**: typecheck clean; 461 tests pass; live route compiles. In-browser sweep accuracy + mono downmix need the owner + RØDE. Local, not pushed.

---

### 2026-06-09 — Town Hall: fix intermittent stereo (split mics not always recorded as 2 channels)

**Why**: Owner reported the RØDE split was *detected* but only *occasionally* recorded as separate channels. Two independent gaps between "track is 2-channel" and "audio_channels=2":

**What**:
1. **Recording layer** (LiveClient): MediaRecorder preserves a 2-channel track only inconsistently. When the captured track is stereo we now record the output of a WebAudio graph with an explicit 2-channel MediaStreamAudioDestinationNode (`channelCount=2, channelCountMode='explicit'`), not the raw track — the blob is guaranteed 2-channel. Unity-gain mono still records the raw stream. `recordedStereoRef` carries the intent to the process call.
2. **Extract layer**: the L−R dual-mono guard is content-dependent and could collapse a genuine 2-mic recording when the channels correlate. The recorder now sets `recordings.capture_stereo` (sql/123) via `POST …/process { stereo_capture:true }`; `extract.ts` (`loadCaptureStereo` → `detectTrueStereo(..., trustStereo)`) preserves stereo whenever the file has ≥2 channels and **skips the guard** for deliberate captures. Uploads keep auto-detect + guard. Still ffprobe-gated, so a truly-mono blob stays mono (no phantom 2nd speaker).

**Verify**: sql/123 applied to prod; typecheck clean; 461 tests pass; live route compiles. Real-device consistency needs the owner + RØDE (record a few times, confirm S1/S2 every time). Local, not pushed.

---

### 2026-06-09 — Town Hall: stereo root cause = browser AGC forces mono; live dual-mono detection

**Why**: Owner's screenshot showed identical L/R meters AND identical transcription on both mics — the two channels carried the same audio. Root cause: Chrome's audio processing module (AGC/echo/noise) runs in MONO; with AGC on (our default), getUserMedia returns a 2-channel track that's one channel duplicated. True stereo needs all processing off.

**What**:
- **Live dual-mono detection** in MicCheck: the meter draw loop now computes the L−R difference-energy ratio vs signal; when 2 channels + real signal + ratio<0.06 it flags identical channels and shows a warning + one-click "Turn off processing for true stereo" (sets AGC/echo/noise off → constraintKey re-opens the preview). If processing is already off and still identical, it points at the device (RØDE Split).
- **Corrected yesterday's over-reach**: reverted the `capture_stereo` "skip the dual-mono guard" path — that would let an AGC dual-mono recording through as fake stereo (the exact identical-S1/S2 bug). The guard in extract.ts now ALWAYS runs (keeps distinct channels, collapses identical). `capture_stereo` is kept as a write-only diagnostic (intent vs detected audio_channels) to pinpoint a lost split.
- Kept the recording-layer fix (force a 2-channel MediaStreamAudioDestinationNode when the track is stereo).

**Verify**: typecheck clean; 461 tests pass; live route compiles. Owner to re-test: turn AGC off (or click the new button) → L/R meters and per-mic captions should diverge. Local, not pushed.

---

### 2026-06-09 — Town Hall: AGC defaults OFF (stereo-safe) + prominent processing warning

**Why**: Owner confirmed turning AGC off fixed the dual-mono, and flagged that "turning AGC on disables stereo" must not be something a user stumbles onto. Decision: default all processing OFF rather than adaptive on-for-mono/off-for-stereo — the AGC-on-when-stereo failure is silent and catastrophic; AGC-off-when-mono is mild and recoverable (meters + software gain + recommendation). Asymmetric risk → default to the stereo-safe side, and we can't know it's stereo until after a capture anyway, so adaptive still leaves the footgun on the first recording.

**What**:
- `LiveClient` initial MicSettings: `agc: false` (echo/noise were already off).
- MicCheck: once a test confirms a 2-channel device (`stereoDevice`, persists after the test, cleared on device change), a prominent banner on the processing controls — RED with "Turn all off for stereo" when any processing is on, GREEN confirmation when off. Toggle hints rewritten to say each forces stereo→mono.
- Recommendation: stereo → recommend all processing off; mono + low level → suggest AGC *on*.

**Verify**: typecheck clean; 461 tests pass; live route compiles. Local, not pushed.

---

### 2026-06-09 — Town Hall: mic-test captions → single multichannel socket (fixes R lane)

**Why**: Owner tested by speaking directly into the right mic and its caption lane stayed blank. Root cause: the test opened one Deepgram live socket per channel; the second (R) silently failed (concurrency/token). 

**What**: Replaced the two-socket per-channel approach with ONE socket using Deepgram `multichannel=true&channels=2`. New `public/worklets/pcm16-stereo-worklet.js` interleaves L/R into int16 PCM (mono input duplicated); MicCheck routes each result to its lane ('L'/'R') by `channel_index`. Caption refs collapsed from a per-key map to a single ws/queue/finals model. One connection = reliable + half the cost. (Live split-window feature dropped per owner — font styling suffices; the deliverable is the batch pass.)

**Verify**: typecheck clean; 461 tests pass; live route compiles. Owner to re-test the R lane. Local, not pushed.

---

### 2026-06-09 — Town Hall: Auto-tune shows an interesting-facts passage to read aloud

**Why**: Auto-tune needs ~15s of continuous speech; "keep talking" is awkward. Give the user something genuinely interesting to read, fresh each run.

**What**: `lib/recordings/readingPassages.ts` — an internal store of ~80-word true-fact paragraphs (octopus hearts, honey never spoiling, Venus days, etc.) + `pickReadingPassage(exclude)` (random, no immediate repeat). MicCheck picks one when the Auto-tune intro opens and shows it in the intro + running panels to read aloud. Add more passages freely.

**Verify**: typecheck clean; 461 tests pass. Local, not pushed.

---

### 2026-06-09 — Town Hall: mark speaker-collision (crosstalk) spots in the transcript

**Why**: With two open mics, simultaneous speech is transcribed on both channels and can read as garbled/duplicated. Owner: mark where the collision happens so the reader knows WHY it's garbled.

**What** (ReportClient TranscriptTab): a time-sweep over the per-channel segments (`collisions` useMemo, O(n)) flags segments whose time range overlaps a *different-channel* segment. Those lines get a **wavy amber underline** + a tooltip ("both mics were speaking at once — crosstalk") and a legend line when any exist. Only for stereo transcripts; mono unaffected.

**Verify**: typecheck clean; 461 tests pass. Local, not pushed.

---

### 2026-06-09 — Town Hall: Auto-tune paced to the passage + live karaoke reading progress

**Why**: The sweep was a fixed ~12s but the factoid takes ~30s to read — it ended early (owner: "troubled when it ended early!"). And it'd be cool to transcribe + show progress as they read.

**What** (MicCheck):
- `sweepTiming(passage)` paces per-combo capture so the whole sweep ≈ the read time (~150 wpm, clamped 24–48s total). Longer captures also give better SNR estimates. Intro/copy now passage-based.
- Live reading progress: ONE best-effort Deepgram socket runs across all combos (opened lazily on the first combo's ctx for sample_rate, mono pcm16-worklet attached to each combo stream via a new `onStream` hook on `measureCombo`; survives the per-combo re-opens). Final results bump a spoken-word counter → the running panel highlights the passage **karaoke-style** (read words bold/dark, unread grey) with a progress bar + "N / M words read". Best-effort: no token/socket → sweep still runs, progress just doesn't advance.

**Verify**: typecheck clean; 461 tests pass; live route compiles. In-browser karaoke needs owner + mic. Local, not pushed.

---

### 2026-06-09 — Town Hall: name the L/R channels of a stereo capture

**Why**: With split mics, "Mic 1·L / Mic 2·R" is generic — owner wants to label the channels (e.g. Facilitator / Audience) so the report reads naturally.

**What**: Mic check shows two optional name inputs once a 2-channel device is confirmed (`stereoDevice`). LiveClient holds `channelNames`, sends them with the process call when stereo + non-empty → `POST …/process { channel_labels:[left,right] }` → `recordings.channel_labels` (sql/124, applied). ReportClient TranscriptTab shows the name in place of S1/Mic-label on each line (keeps the L/R mic tag underneath; legend uses names). Unnamed falls back to Mic 1·L / Mic 2·R.

**Verify**: sql/124 applied; typecheck clean; 461 tests pass; live route compiles. Local, not pushed.

---

### 2026-06-09 — Town Hall: speak-to-identify the mic when naming channels

**Why**: When naming L/R channels, the user needs to know which physical mic is which. Owner: speak into a mic, pick the louder one, animate its name box.

**What**: MicCheck derives `activeMic` from the live per-channel meters during a test (clearly-louder channel: max>0.1 and |L−R|>0.04). The matching name input pulses an emerald ring + the label shows "🔊 speaking". The naming hint adapts ("speak into a mic" while testing; "press Test microphone" otherwise).

**Verify**: typecheck clean; 461 tests pass. Local, not pushed.

---

### 2026-06-09 — Town Hall: full-width record-start layout

**Why**: The live record-start screen wasted horizontal space (everything in a narrow centered column).

**What**: live page widened max-w-4xl→6xl; the idle screen is now a 2-column grid — left = intro + Start + recovery/error, right = the Mic check panel — instead of a single centered max-w-md stack.

**Verify**: typecheck clean; live route compiles. Local, not pushed.

---

### 2026-06-09 — Town Hall: Duplicate a project (inherit setup, not media/results)

**Why**: Recurring town halls (same panel/agenda/config) shouldn't be re-set-up each time. Owner wants to duplicate one, inheriting all project setup but starting fresh on media.

**What**: `POST /api/recordings/[id]/duplicate` clones only the setup/config columns (name+" (Copy)", session_type, setup_inputs, meeting_profile, brand/agent, analysts, objectives, confidentiality, etc.) into a new `awaiting_media` recording — no files/transcripts/extractions/config-versions/dataset/analysis/share/signoff. Org-gated via getUserContext. "Duplicate" added to the recordings-list ⋯ menu → routes to the copy's status page to add media.

**Verify**: typecheck clean. (Creates a row → verify via UI, not a prod-mutating script.) Local, not pushed.
