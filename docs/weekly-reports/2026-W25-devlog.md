# 2026-W25 — Dev log (Week of Jun 15 to Jun 21)

## 2026-06-16 — Surveys: AI clarifier re-asked detail the respondent already gave on an earlier question

**Why**: A tester rated the experience "good", was asked "what could be done better" and answered "the pacing was slow throughout the meal"; later on the "good, bad and the ugly" open-end they said "Just the slow pacing I mentioned earlier" and the clarifier asked them to expand on it — detail they'd already provided. Root cause was not missing data: the client sent earlier answers as a bare `priorAnswers` map keyed `q1`/`q3` with **no question text**, so the model couldn't tell what each answer was responding to, and an over-eager "always follow up on short answers" rule fired on the back-reference.

**What changed**:
- `components/survey/useSurveyEngine.ts` — record each question's prompt text as it's asked (`questionsAsked` map, captured at likert storage + in `handleOpenEnded`); `buildClarify` now assembles an ordered `priorQA` list of `{ question, answer }` for every earlier answered slot and POSTs that instead of the bare-answer map.
- `app/api/clarify/route.ts` — accepts `priorQA: Array<{question, answer}>`; renders it as labeled `Q: "…" / A: "…"` prior context framed as "already captured — do NOT ask them to repeat or expand on any of it"; added an explicit SKIP rule for answers that only back-reference earlier feedback ("just the slow pacing I mentioned earlier", "same issue as before").
- `app/admin/testing/TestingClient.tsx` — two AI-Tester call sites updated to the new `priorQA: []` shape.

**Verify**: typecheck clean; full suite 864 pass. SURVEYS.md clarifier section updated (priorQA input + back-reference SKIP). Local, not pushed.

## 2026-06-16 — Town Hall: Meeting Notes (presentation half) now in the PDF report and public share link

**Why**: The in-app report and the deck already showed both halves of a meeting (the neutral presentation summary AND the Q&A), but the two surfaces that get forwarded after a meeting — the downloadable PDF and the public `/th` share link — were Q&A-only. With today's pilot on the line, a principal who opens the shared link or the emailed PDF should see the presentation overview too, not just the questions. The data already exists (`proceedings_summary`, generated at analyze time); it just wasn't being rendered on those two surfaces. No new AI calls.

**What changed**:
- `lib/recordings/reportHtml.ts` — new `proceedingsSection` (overview + per-item card: title, slide refs, presenter, what-was-presented, key-figure chips) rendered above the Overview, mirroring the in-app Presentation tab; eyebrow → "Meeting Summary" and exec heading → "Q&A Overview" when notes present; full fallback to the prior Q&A-only layout when `proceedings` is null.
- `lib/recordings/reportPdf.ts` — threads `rec.proceedings_summary` into the renderer (covers both the PDF download and the emailed attachment).
- `app/api/recordings/[id]/report/pdf/route.ts` + `report/send/route.ts` — added `proceedings_summary` to the selects.
- `app/th/[token]/page.tsx` — same Meeting Notes section + conditional eyebrow/heading on the public page (`proceedings_summary` is the neutral summary, safe to share).

**Verify**: typecheck clean; full suite 864 pass; render checks confirmed the section appears (overview, items, "$4.2M" figure chip, "Slides 3, 4", "Meeting Summary"/"Q&A Overview") and falls back correctly with no proceedings. RECORDINGS.md §4.5 + §4.6 updated. Local, not pushed.

## 2026-06-16 — Vercel Ignored Build Step: also skip docs-only production deploys

**Why**: The Ignored Build Step (`scripts/vercel-ignore-build.sh`, added W24) already skips every Preview build — only Production (`main`) builds. But it built *every* production deploy regardless of content, so merging the weekly governance PRs (devlog + spec-drift, which are docs-only) each cost a ~$8-10 production build for zero code change. Owner asked to stop that.

**What changed**:
- `scripts/vercel-ignore-build.sh` — in the `VERCEL_ENV=production` branch, before building, check whether `HEAD^..HEAD` touches anything outside `docs/` (`git diff --quiet HEAD^ HEAD -- . ':(exclude)docs'`). Docs-only range → exit 0 (skip). Defaults to BUILD when `HEAD^` is unreachable (shallow clone) — never skip a deploy we can't reason about. Preview-skip + the "build all real production code" behavior are unchanged.
- `docs/ENGINEERING.md` — documented the docs-only production skip under the deploy/preview section.

**Verify**: tested locally — preview→skip (0), production+code→build (1), production+docs-only→skip (0), no-env→skip (0). No dashboard change needed (the Ignored Build Step already points at this script). **Local, not pushed** — and note this only takes effect once pushed to `main`, which is itself one production build.

## 2026-06-16 — Deps: remediate the 14 HIGH npm CVEs (esbuild + vite, @workflow chain)

**Why**: The W24 governance audit dropped the Dependencies score 7→5 over 13 HIGH CVEs (now 14) — all `esbuild` and `vite` reachable only through the `@workflow/*` build-time DevKit (the Town Hall pipeline), no runtime path. The report guessed "pin esbuild ≥0.25.0", but live inspection showed esbuild was already 0.27.7; the actual advisory range is 0.17.0–0.28.0 (fixed 0.28.1) and vite ≤8.0.15 (fixed 8.0.16). Both fixes are *in-range* for what `@workflow/*` already declares (`esbuild: ^0.28.1`, vite 8.x) — the tree was simply resolved below its own declared range (stale lock), so this is a non-breaking lift, not a risky bump.

**What changed**:
- `package.json` `overrides` — added `"esbuild": "0.28.1"` and `"vite": "8.0.16"` (kept the existing `undici`/`devalue` pins). Deliberately NOT `npm audit fix --force` (CLAUDE.md: forces a `next@9.3.3` + `exceljs@3.4.0` downgrade).
- `package-lock.json` — regenerated by `npm install`.
- `docs/SECURITY.md` §9 — updated the accepted-advisories posture (was "2 moderate, 0 high as of 06-08"; now "12 moderate / 1 low / 0 high as of 06-16" + the remediation note).

**Result**: `npm audit` HIGH 14→0 (13 left: 12 moderate, 1 low — build-time chain + a uuid-via-exceljs finding whose only fix is a breaking exceljs downgrade, left accepted). **Verify**: typecheck clean, `npm run build` succeeded (exercises the esbuild/vite + @workflow toolchain incl. /th), 864 tests pass. Local, not pushed.

**Commit note**: staged `package.json` maps to `docs/TESTING.md` in the spec-drift map, but this is a security dependency pin with no test-strategy/spec impact — committed with `SKIP_SPEC_CHECK=1` (SECURITY.md is the doc that actually changed).

## 2026-06-16 — Service-credit monitor: surface "out of credits" for any vendor

**Why**: A DataForSEO HTTP 402 (account out of balance) silently stalled the Rubio's Coastal Grill review load — 81 locations, 0 ingested — buried in per-location `error_message` with nothing surfaced; the download monitor showed "nothing pending". Owner asked for something that proactively shows when any/all paid services are out of credit, so this can't happen unnoticed (esp. before a demo).

**What changed** (built, NOT yet pushed/migrated):
- `sql/126_service_health.sql` — `service_health` table (one row per vendor), admin-org-only RLS, service-role writes.
- `lib/serviceHealth.ts` — two-tier model. **Tier 1** (balance API): `probeBalances()` polls DataForSEO (`getDataForSeoBalance` → `/v3/appendix/user_data`), Deepgram, Twilio; `recordBalance()` derives status vs per-service USD thresholds. **Tier 2** (no balance API): `recordCreditError()` captures the last 402/429/credit failure. `statusForBalance` + `isCreditError` are pure (unit-tested). All writes best-effort, never throw.
- Capture-on-error wired into `lib/dataforseo.ts` (the 402), `lib/ai.ts` (Anthropic/OpenAI), `lib/places.ts` (Places 429/billing-403), `lib/email/provider.ts` (Resend quota).
- `app/api/cron/service-balance/route.ts` + `vercel.json` (every 6h) — refresh balances, email `CREDITS_ALERT_TO` (fallback `SENTRY_ALERT_TO`) when any service is low/critical/error, throttled to ~once/day per service.
- `app/admin/health` — new "Service Credits & Health" panel (balance, status badge, last-error-ago); live-probes tier-1 on load.
- `tests/unit/serviceHealth.test.ts` — 11 cases.
- Docs: ENGINEERING.md §4 (main writeup) + cross-refs in USAGE_ACCOUNTING / DATA_SOURCES / MCO_AGENT / TESTING.

**Verify**: typecheck clean; `npm run build` succeeds; full suite **875 pass** (864 + 11 new). Local, not pushed.

**Activation (needs owner OK — production writes)**: (1) apply `sql/126` to prod; (2) push (registers cron + page; prod build); (3) set `CREDITS_ALERT_TO`. Until the table exists the page degrades gracefully (all "unknown") and writes no-op.
