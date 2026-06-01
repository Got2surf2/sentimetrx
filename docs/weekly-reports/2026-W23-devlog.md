# 2026-W23 — Dev log (Week of Jun 1 to Jun 7)

## 2026-06-01 — Recordings pipeline brought live end-to-end (pilot wiring) + feature/accounting/UX

**Why**: First real run of the productized recordings pipeline against NOWOCATS meeting video surfaced a chain of blockers (the pipeline had never been exercised with a real upload). Fixed each to get upload → extract → transcribe → analyze → report working, and reworked feature gating, extraction quality, accounting, and the list/delete UX per pilot feedback.

**Fixes (sequential pipeline blockers)**:
- **`getUserContext` selected a non-existent `users.is_admin` column** → PostgREST errored → every recordings page bounced to `/login`. Now derives `isAdmin` from `org.is_admin_org` (matches sibling pages). (`lib/userContext.ts`)
- **ffmpeg not in the Vercel Sandbox** — `dnf install ffmpeg --skip-broken` exited 0 without installing (not in Amazon Linux repos). Now downloads a static ffmpeg/ffprobe build, installs `xz` (needed to unpack `.tar.xz`), and verifies with `ffmpeg -version` (fails loudly otherwise). (`lib/recordings/extract.ts`)
- **Analyze timed out** — `callAI` defaults to a 15s timeout (fine for chat); Opus extracting Q&A from a full transcript needs minutes. Added `timeoutMs` (10 min Opus / 5 min Sonnet). (`lib/recordings/analyze.ts`, `regenerate.ts`)
- **Recordings list showed 0** — the list query embedded `users:created_by`, but `recordings.created_by → auth.users` isn't PostgREST-embeddable. Now looks owner names up from `public.users` separately. (`app/recordings/page.tsx`)
- **Supabase upload 413** for 175–251 MB files — project-level Storage upload limit (not the 20 GB bucket limit). Raised in the Supabase dashboard (ops, not code).

**Feature gating reworked**: recordings is now a normal **`ModuleFeatures` toggle** (sub-feature of Analytics) instead of the bespoke `org_features`/`user_features` quota system. **Analytics is the parent** — `googleReviews`, `reddit`, `substack`, `recordings` are forced off when `analyze` is off, enforced centrally in `effectiveFeatures` and reflected in the org toggle UI (children indented + disabled when Analytics is off). The generic `org_features`/`user_features` tables + `assertFeatureAllowed` remain as unused infra (sql/089). (`lib/types.ts`, `lib/resolveOrg.ts`, `lib/userContext.ts`, `components/analyze/OrgFeatureToggles.tsx`, recording page/API gates)

**Extraction quality — decouple recall from the agenda**: the old prompt used the agenda as both a recall anchor AND a fixed taxonomy ("use ONLY agenda topics"), so an empty/short agenda tanked recall. Now Opus extracts **every** audience Q&A comprehensively with a free-form topic label, and the Sonnet curator pass **clusters them into emergent topics** (agenda is an optional naming hint). Confirmed against the manual PM-1 baseline: the 7-vs-15 gap was mostly display (7 "ask" in the Q&A tab + 5 in the Appendix = 12) plus 4 genuinely-missed audience questions that the topic-anchoring had dropped. (`lib/recordings/prompts/qa.ts`, `lib/recordings/analyze.ts`)

**Accounting for recordings**: added `usage_logs.cost_cents` (sql/092, applied to prod) for non-token costs; the ASR/transcription vendor charge now logs to `usage_logs` (was invisible there); recording AI calls re-tagged `resource_type: 'recording'` (were hiding under "TextMine"/`dataset`); `/admin/usage` adds a **Recordings** label and folds `cost_cents` into cost totals. (`lib/usageLog.ts`, `lib/ai.ts`, `transcribe.ts`, `analyze.ts`, `regenerate.ts`, `app/api/admin/usage/route.ts`, `app/admin/usage/UsageClient.tsx`)

**UX**: `/recordings` now renders **cards** (matching dataset cards) instead of a table; added a **🎙️ Recordings** entry button in the Analyze header (the list was previously unreachable via UI); each card has a **delete** with a confirmation modal that cascades **storage files + derived dataset/rows + recording (→ files/transcripts/extractions)** via new `DELETE /api/recordings/[id]`; the full re-extract is now a clear **"↻ Re-extract all"** button (was a cryptic "⋯ More"). Status-page active-step loader switched to `LottieLoader`. (`app/recordings/RecordingsListClient.tsx`, `AnalyzeClient.tsx`, `ReportClient.tsx`, `StatusClient.tsx`)

**DD doc fix**: `docs/DATA_FLOW.md` storage drift corrected — uploaded media/PDFs are Supabase Storage; PPTX decks / HTML shares / nightly backups are AWS S3; encryption table no longer mislabels backups as Supabase-managed.

**Verification**: clean `rm -rf .next/types tsconfig.tsbuildinfo && npx tsc --noEmit` throughout. Pipeline validated live to the Analyze stage against NOWOCATS video; full end-to-end + re-extract being validated by the user.

**Production follow-ups (not blockers for local)**: bake a Vercel Sandbox snapshot with ffmpeg pre-installed (`FFMPEG_SANDBOX_SNAPSHOT_ID`) to skip the per-cold-boot download; raise the `runAnalyze` function `maxDuration` (default 300s may be tight for Opus).

**Gate 1 — analysis is now on-demand (2026-06-01)**: the pipeline no longer auto-runs the expensive Opus + Sonnet extraction. `processRecordingWorkflow` runs extract → transcribe and **pauses at a new `status='transcribed'`**; the user reviews the transcript, refines the agenda / panel roster, and adds an optional steer, then explicitly hits **"Generate Q&A pairs"** which starts the new `analyzeRecordingWorkflow` (analyzing → complete) via `POST /api/recordings/[id]/analyze`. WHY: the analyst wants to make adjustments before spending ~$1/meeting and before the report exists — extraction quality is steered by the agenda/roster, so letting them fix those pre-analysis is the highest-leverage moment. Gate 2 (the formatted report/PDF deliverable, § 4.5) is on-demand by design already (separate export route, never auto-fired). Status-page Retry now routes a post-transcription failure to `/analyze` (retry just the AI pass, no re-transcribe) instead of re-running the whole pipeline. (`sql/093`, `lib/recordings/types.ts`, `workflows/recordings.ts`, `app/api/recordings/[id]/analyze/route.ts`, `app/api/recordings/route.ts`, `app/analyze/new/recording/[id]/status/StatusClient.tsx`, `app/recordings/RecordingsListClient.tsx`, `docs/RECORDINGS.md`)

**Audio modal player wired (2026-06-01)**: the "▶ Play this segment" stub on Q&A/appendix cards is now a real shared `AudioModal`, and every transcript segment gained a "▶ Play from here" button. WHY: PM-1 review wanted to verify a pair against the actual audio in one click. New `GET /api/recordings/[id]/audio` mints a short-TTL (1h) signed URL for the stitched mp3 (org-gated, source files never exposed). The modal seeks to the pair's `start_sec` and autoplays, with a ≥48px play/pause, scrubber + time labels, ±15/±30s skip, playback speed (0.75–2×), Esc/×-close, and a synced transcript that highlights + auto-scrolls the segment under the playhead (click to seek). Removed the orphaned `StubButton`. (`app/api/recordings/[id]/audio/route.ts`, `app/analyze/[datasetId]/report/ReportClient.tsx`, `docs/RECORDINGS.md`)

## 2026-06-01 — W22 governance score-lift: CI green + CVE remediation + recordings tests + agent-page org gate

**Why**: The W22 governance report (PR #9) dropped to 71.0/100 and its CI went red. The red CI was *not* a code failure — `npm ci` rejected the lockfile because CI pins **Node 20** (npm 10, stricter *and* deprecated) while the committed lockfile resolves cleanly only on the dev environment's npm 11. The score drags were Dependencies (8 HIGH CVEs from the recordings packages) and Tests (recordings shipped with zero tests). Addressed all of it on a branch so CI proves green before reaching prod.

**What changed**:
- **CI: Node 20 → 24** (`.github/workflows/ci.yml`). Matches the dev environment where `npm ci` passes against the existing lockfile, and clears the Node-20-deprecation warning. Surgical — zero production-dependency churn (a clean lockfile regen was a 882-package, ~20k-line rewrite; rejected as too risky for a prod merge).
- **CVE overrides** (`package.json` `overrides`): pinned `undici` → 7.27.0 and `devalue` → 5.8.1 (the patched versions; the `@workflow/*` packages vendored vulnerable transitives). `npm audit` HIGH **8 → 1** (total 18 → 2); the lone remaining HIGH is `next` (needs a 14→16 major upgrade, scoped separately). Lockfile diff: 6 insertions / 24 deletions.
- **Recordings unit tests** (Tests dimension): `tests/unit/recordingsCoverage.test.ts` (pure `computeCoverage` — per-topic flagging, ≥5-min gap detection incl. leading/tail, confidence histogram) and `tests/unit/recordingsAnalyze.test.ts` (the PM-1-critical Opus/Sonnet parse + flag-merge: curator-flag precedence over low-confidence, emergent-topic override, markdown-fence tolerance, two-pass cost). +20 tests; suite 322 → 342.
- **Agent-page org gate** (`app/bots/[id]/{history,entities,questions}/page.tsx`): the service-role agent lookup now pairs `id` with `org_id` for non-admins (CLAUDE.md multi-tenancy invariant); admins still load any org's agent. The pre-existing redirect already closed the live access risk — this satisfies the invariant in the query itself. Regression test: `tests/unit/auth/botPageOrgGate.test.ts`.
- **`sql/091` tx-wrap** (`sql/091_recordings_storage_bucket.sql`): wrapped in `BEGIN; … COMMIT;` — it was the lone migration >70 missing the wrapper, which would have failed CI's `check:sql-tx` step once the npm-ci fix let CI progress. Not yet applied to prod, so safe.

**Verification**: clean `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm ci`, `npm run check:sql-tx`, and `npm test` (342 passed / 54 skipped) all green locally — i.e. every CI step passes before push.

**Scoped, not done — Next 14→16**: the remaining HIGH (`next`: Image-Optimizer remotePatterns DoS + RSC request-deserialization DoS) needs a two-major upgrade. Surface: `next ^14.2.35` (but `eslint-config-next` already `^15.5.18`), no `next/image` usage, middleware uses a matcher, `next.config.js` carries `experimental.{serverActions.bodySizeLimit,instrumentationHook,outputFileTracingIncludes}` (some now stable/relocated in 15) + the Sentry webpack plugin (16 defaults to Turbopack). Realistic as a dedicated 1–2 day spike (codemods → async `cookies()/headers()/params` → caching-default audit → Turbopack/webpack reconciliation → full regression). Deliberately kept off this branch.

## 2026-06-01 — Audit score push 1–3: recordings route tests, cross-org export-leak sweep, secrets verify

**Why**: Continuing the W22 governance score-lift (Tests + Security being the lowest dimensions). Picked the three highest-leverage remaining items.

**1) Recordings API route tests** (`tests/integration/recordings-routes.test.ts`, 22 tests): gate + validation coverage for all 8 recordings route files — auth (401), feature gate (403), org scoping (404 cross-tenant with id+org_id pairing asserted), and input validation (instructions length, scope enum, file dupes, status filter). Supabase boundary + getUserContext/getAuthUser + Workflow DevKit triggers mocked. Closes the "8 routes, 0 tests" gap.

**2) Service-role bare-`id` sweep → found a real cross-tenant leak CLASS in the export routes.** The W22 audit only flagged the bot *pages* (fixed last session). Sweeping `createServiceRoleClient().…eq('id', …)` lookups surfaced that the **dataset + town-hall export routes fetched a tenant resource by bare id with only an existence check** — any authed user could export another org's data by id. Fixed 5 routes to gate via the canonical `getCallerOrgContext` helper (`if (!isAdmin && row.org_id !== orgId) return 404`; admin-org may export any, Phase E):
- `app/api/datasets/[datasetId]/export/{signals-pptx,html,pptx}/route.ts`
- `app/api/townhall/sessions/[id]/export/{pptx,route}.ts` (CSV route captures org_id across both substrates)
- (`datasets/export/html/share` was already correctly gated — the reference pattern.)
- Regression test `tests/integration/export-org-gate.test.ts` (6 tests): non-admin in orgA → 404 for an orgB resource on every fixed route; same-org caller passes the gate.
- The other ~30 grep candidates were triaged as safe: admin-cross-org by design, public endpoints, session-client (RLS), id derived from an already-org-verified parent, or org-scoped mutations.

**3) Secrets quick win — already mitigated, verified.** The W22 LOW finding (`lib/meridian.ts` hardcoded JWT) already uses the env-override-with-public-fallback pattern (`process.env.MERIDIAN_TOKEN || PUBLIC_MERIDIAN_TOKEN`) and is documented as a public flymco.com bundle token. `.gitignore` already carries `*.pem`/`*.key`/`*.p12`. A scan of tracked source found **no real hardcoded secrets** (no `sk-ant`/`sk-`/AWS/private keys; the only JWT literal is the documented-public meridian token; `service_role` hits are SQL GRANTs). No code change warranted.

**Verification**: clean `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 370 passed / 54 skipped (+28); `check:sql-tx` green.

## 2026-06-01 — Fix: stale signal-stats cache (Coalition Donor count mismatch)

**Why**: User reported the Coalition Donor Survey Collection showed irreconcilable counts on one screen — TextMine toolbar "67 records" vs Themes panel "80 responses/comments" for a single field ("Familiarity Follow-up"), which is impossible (a field can't have more answers than records in scope). Investigated against live prod (read-only): the collection's two member studies (Active 53 + Inactive 55 = 108 rows) had **exactly 67** non-empty `experience_followup` rows as of **2026-05-13** — the timestamp on the cached `signal_stats` blob — then **13 more responses arrived** (newest 2026-05-21) → **80** now. So 80 (live, correct) vs 67 (stale cache); the 108 top-right is correct.

**Root cause**: `lib/signalStats.ts` cached the toolbar stats in `dataset_state.analytics.signal_stats` keyed **only** on the theme-model hash. The hash flips on theme edits but is blind to rows added by a sync, so the strip froze at the 5/13 snapshot while the live Themes panel counted the new rows. The `invalidateSignalStats()` helper meant to cover this was **never called anywhere** (the docstring's "downstream sync routes call it" was false) — dead code.

**Fix**: pair the cache key with the **current row count**. `computeSignalStats` now resolves the underlying dataset IDs (extracted a shared `resolveDatasetIds` helper, reused by the compute path so both count the same rows) + a cheap `totalRowCount` head-count, stores `row_count` in the cache, and serves the cache only when hash AND row_count both match. A sync that changes the count forces a recompute on next read. Legacy caches (no `row_count`) never match → self-heal on next view — including the Coalition collection, which will recompute 67→80 with no manual cache clear. Edits that fill a previously-empty field without changing row count remain undetected (rare; re-mining forces recompute). Fixed the misleading docstring; `invalidateSignalStats` retained as an optional eager-drop but no longer load-bearing.

**Tests**: `tests/unit/signalStats.test.ts` (3) — cache hit when hash+count match (no recompute), recompute when row_count changes under a stable hash (the Coalition case, 67→80), recompute for a legacy cache missing `row_count`.

**Verification**: `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 373 passed / 54 skipped (+3). Diagnosis confirmed by live read-only counts, not asserted. ANALYTICS.md § "Signal-stats toolbar" documents the keying + the intentional records-vs-responses denominator difference.

## 2026-06-01 — Audit push (DOMPurify, .env.example, test batch); Next 14→16 scoped

Driven by a fresh `/audit-codebase` run (7.5/10 on the skill's framework). Did the safe wins; scoped the Next upgrade separately.

**DOMPurify on the 3 `dangerouslySetInnerHTML` surfaces** (Security; closes the long-standing SECURITY.md TBD #14): wrapped the rendered HTML in `DOMPurify.sanitize` (existing `isomorphic-dompurify` dep) on `app/bots/[id]/conversations/ConversationsClient.tsx` (conversation message linkify), `components/ui/ChatBot.tsx` (chat bubble formatHtml), and `app/campaigns/[id]/CampaignDetailClient.tsx` (3 email-preview renders). All strip script/on*/javascript: while keeping the safe markup the helpers emit.

**`.env.example`** committed (Secrets 9→10 + onboarding/DD): enumerated all 56 `process.env.*` refs from the code and grouped them (core Supabase, AI providers, email/SMS, data sources, Meta social, AWS backups, recordings infra, secrets/signing, Sentry, URLs, internal flags) with placeholder values — no real credentials. Notes the GOAA/Meridian public-fallback pattern and the build-time-derived vars.

**Test batch** (Tests): `tests/unit/components/BrandTagInput.test.tsx` — the repo's **first component test** (render contract + onChange + `/api/brands` datalist population via mocked fetch). `tests/integration/tenant-routes-gate.test.ts` — gate coverage for campaign-send / social-comment-handle / dataset-route (401 + cross-org 404). Suite +10.

**Deliberately skipped `.claude/rules`** (the audit's AI-Patterns nudge): Claude Code auto-loads `CLAUDE.md`, not a `.claude/rules/` dir, in this repo — creating files there would be non-functional score-gaming. AI-Patterns is already healthy (rich CLAUDE.md + hooks + 4 commands + spec-drift/devlog/governance automation).

**Next 14→16 scoped (not executed):** 0 direct `cookies()`/`headers()` sites and 0 `next/image` (the scariest 15 migrations barely apply), but **235 route handlers + 36 pages** read `params`/`searchParams` (async in 15, codemod-assisted), 62 server-component `fetch()` sites need a caching-default audit, 8 `useSearchParams` need Suspense boundaries, and the config (instrumentationHook/serverActions relocation + Turbopack-default vs the Sentry webpack plugin) + a React 18→19 bump make it a stacked two-major. Estimate ~3–5 day spike + prod canary. Full write-up handed to the user.

**Verification**: `tsc --noEmit` clean; `npm test` 383 passed / 54 skipped.

## 2026-06-01 — StoryTime PPTX: theme-card counts, comments+signals, native entity analysis (catalog-first)

**Why**: User hit three PPTX-export problems on the Coalition Donor deck. (1) The theme-selection cards in the export builder showed `n=0 / 0%` for every theme. (2) A Custom-Builder instruction to "skip text analytics and run entity analysis on the Charities Donated To field" was silently ignored. (3) Wanted the "signals" count woven into every text-analytics slide alongside the comment count.

**1) Theme-card 0% (ExportModal)** — the cards read `count`/`percentage` straight from the saved `theme_model.themes`, which persist both as **0** (real counts are computed live in TextMine, never written back). Fixed by fetching live counts from the existing `/theme-counts` endpoint after load and merging them into the cards.

**2) Comments + signals on text slides (export/pptx route)** — every open-ended/theme slide header now shows `N comments · M signals` (comments = responses with text in the field; signals = sum of per-theme match counts, so a multi-theme response counts >1). Computed per field from `computeFieldThemes` and threaded into `buildOpenEndedSlide`/`buildThemeGridSlides`/`buildThemeSlides` via a `meta` arg + `withCounts()`. Definitions match the TextMine toolbar's "comments/signals" so the deck and app reconcile.

**3) Native entity analysis + skip-text (the real gap)** — the free-text Custom-Builder instruction only ever shaped AI narrative *wording* (`generateNarratives`); it never drove slide composition, and StoryTime had no entity capability at all (that lived in the separate `/api/entity-analysis-deck`). Added: an **Entity Analysis field picker** + a **"Skip theme/verbatim text-analytics slides"** toggle in ExportModal (`body.entityFields`, `body.skipTextAnalytics`); native entity slides in the export route; and `skipTextAnalytics` gates out the OE theme + verbatim sections (categorical/numeric stay). Extracted the entity core into `lib/entityAnalysis.ts` and refactored `/api/entity-analysis-deck` to share it; exported `renderEntityGrid/renderBarChart/renderQuotes` from `lib/pptx/slideRenderer` so StoryTime renders entity slides into its own pptx (same NUMBERED master).

**Cost — catalog-first (per user)**: entity slides read the **stored `entity_catalog`** via `getEntitiesWithCounts` (pre-extracted, canonicalised, categorised, live counts) → **zero extra AI**. Only when the catalog is empty does it run `discoverEntities` once, which **stores** the entities for next time (skipped when AI is off). The Coalition collection already has 35 catalog entities, so its deck costs $0 for entities.

**Verification**: `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 388 passed / 54 skipped (+5: `tests/unit/entityAnalysis.test.ts`). Diagnosed against live read-only DB (theme_model persists count:0; q3_response="Charities Donated To" has 85 responses; entity_catalog has 35 rows for the collection scope). Entity renderers QC'd standalone — render into a fresh NUMBERED-master deck without throwing (they're the same renderers already shipped in entity-analysis-deck). ANALYTICS.md + TESTING.md updated.

## 2026-06-01 — Fix: signals-pptx export wrote to server ~/Downloads (prod crash)

CI on PR #11 surfaced a pre-existing bug: `app/api/datasets/[datasetId]/export/signals-pptx/route.ts` called `fs.writeFileSync(os.homedir()/Downloads/...)` server-side after rendering the deck — leftover dev convenience. It ENOENT-crashes on Vercel's serverless filesystem (no `~/Downloads`), and an API route shouldn't write to local disk anyway (it already returns the PPTX as an HTTP attachment). Removed the write; the download response is unchanged. The export-org-gate test's same-org case (which exercises the full route) now passes on CI.

## 2026-06-01 — Next 14 → 15 upgrade (Phase 1 of the 14→16 spike) — branch upgrade/next-15

Executed Phase 1 of the scoped Next upgrade. Branch `upgrade/next-15`, commit-only (not pushed), 3 checkpoint commits. **Bumping to Next 15 clears the last HIGH CVE — `npm audit` now 0 high / 2 moderate.**

**What changed**:
- `next` ^14.2.35 → ^15.5.18 (eslint-config-next already 15).
- **Async request APIs** (the bulk): `lib/supabase/server.ts` `createClient()` is now `async` (`await cookies()`); the ~262 server-side call sites became `await createClient()` (browser-client sites untouched). `tsc` was the worklist — making the wrapper return `Promise` flagged every un-awaited site, so none were missed. `ReturnType<typeof createClient>` refs → `Awaited<...>` (incl. the `createBrowserClient` alias in `lib/auth/orgAccess.ts`, which cascaded to ~30 callers via `getCallerOrgContext`).
- `headers()` async: `lib/requestContext.ts` `getRequestId()` → async; `app/demo/mco/page.tsx` → async.
- `NextRequest.ip` removed in 15: bot/clara/nora chat routes derive the rate-limit key from `x-forwarded-for`.
- **`@next/codemod next-async-request-api`** → 153 files: `params`/`searchParams` now `Promise<>` with `await props.params` in pages + route handlers. `entities/[slug]` local helper typed `Awaited<Params['params']>`. Test call sites wrapped `params` in `Promise.resolve(...)` (30 sites).
- **`next.config.js`**: removed `experimental.instrumentationHook` (stable in 15); moved `outputFileTracingIncludes` out of `experimental` to top-level (keeps the control-reports markdown bundling working).

**Verification**: `tsc --noEmit` clean; `npm test` 388 passed / 54 skipped; `next build` succeeds (only pre-existing ESLint `warn`s — the known 374 — no migration warnings, no invalid-config, no missing-Suspense). fetch-caching default flip (62 server fetches) did not surface in build; app is force-dynamic-heavy so low risk — flagged for the prod canary smoke.

**Not done (Phase 2, separate)**: Next 15 → 16 (Turbopack default vs the Sentry webpack plugin; React 18 → 19). Held for a separate branch + canary. This Phase-1 branch is commit-only pending review.

## 2026-06-01 — Next 15 canary caught a prod-breaker: jsdom ESM require fails on Node 20

Pushed `upgrade/next-15` to a Vercel **preview** (one-time, user-authorized) and smoke-tested. Login ✅, PPTX export ✅, auth redirects ✅, `/demo/mco` (the `await headers()` fix) ✅ — but **`/s/<real-survey>` returned 500** (a fake guid returned 200, so it was the actual-render path).

**Root cause (from Vercel runtime logs):** `ERR_REQUIRE_ESM` — `html-encoding-sniffer/lib/html-encoding-sniffer.js` does `require()` of the ESM `@exodus/bytes/encoding-lite.js`. The chain is `isomorphic-dompurify` (used by Survey/Agent/PulseIQ widgets for SSR sanitization) → `jsdom@29` → its `@exodus/bytes`-based `html-encoding-sniffer@6` / `data-urls@7` / `whatwg-url@16` cluster. These deps are **identical on main** — so it's not a regression from the bump; Next 15 externalizes jsdom to a runtime `require()` (Next 14 bundled it), and the Vercel function runs **Node 20**, where `require()` of ESM is unsupported. It does **not** reproduce locally because local Node is 24 (require-of-ESM is supported in Node 22+).

**Fix:** `engines.node` `">=20.0.0"` → `"22.x"` so Vercel runs the functions on Node 22+ (require-of-ESM supported, matching local). One line. **Caveat:** if the Vercel project has an explicit dashboard Node.js Version pin at 20, that must also be set to 22.x for the engines change to take effect. Fallback if Node can't move: npm `overrides` to force jsdom's WHATWG deps back to their CJS majors (riskier).

**Cannot verify locally** (local Node 24 already passes) — needs a re-push to the preview to confirm the survey/agent/PulseIQ widgets render on Node 22. Commit-only on the branch pending that re-canary.

## 2026-06-01 — Next 15 jsdom ESM blocker SOLVED (downgrade to CJS jsdom), verified locally

The `engines:"22.x"` bump did NOT fix the survey/agent/PulseIQ 500 on the preview (still `ERR_REQUIRE_ESM`) — Vercel either ignored engines or ran a 22.x without `require(ESM)` default (only default in Node 22.12+/24). Relying on the Vercel Node version was too fragile, so switched to a **Node-independent** fix.

**Repro without canary pushes:** `node --no-experimental-require-module` on local Node 24 disables `require(ESM)`, reproducing Vercel's Node-20 behavior exactly. `NODE_OPTIONS=--no-experimental-require-module npm run start` + curl `/s/vindman` → reproduced the 500 locally. This gave a fast fix-loop with zero deploys.

**Root cause:** `isomorphic-dompurify@3.12` → modern **jsdom@29 (ESM)** whose WHATWG deps (`html-encoding-sniffer@6`, `whatwg-url@16`, `data-urls@7`, `@exodus/bytes`) are ESM-only. Next 15 externalizes jsdom to a runtime `require()`, which throws on any Node without `require(ESM)`. (jsdom went ESM at v27; v26 is the last CJS.)

**Fix:** `isomorphic-dompurify` ^3.12 → **^2.26.0** (uses jsdom@^26) and the `jsdom` devDep ^29.1.1 → **^26.1.0** → single **jsdom@26 (CJS)**, `@exodus/bytes` gone. SSR sanitization still works (jsdom@26 supplies the server DOM).

**Verified locally under the Node-20 simulation:** `/s/vindman` → **200** (renders the real survey), 0 `ERR_REQUIRE_ESM`; `tsc` clean; `npm test` 388 passed (vitest jsdom env fine on @26); `next build` green. Node-independent, so it holds regardless of Vercel's Node version. (`engines:"22.x"` kept as hygiene — Node 20 is deprecated — but is no longer load-bearing.)
