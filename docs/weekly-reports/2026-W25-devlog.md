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

## 2026-06-17 — Agents: fix cross-org visibility + cascading org-transfer (the Sarina mess)

**Why**: Platform admin (got2surf2, Datanautix admin org) couldn't attach the "Sarina" agent (which lives in *Arjun Pilots*) to a Town Hall, and moving Sarina errored with "Resource is already in that org." Three distinct bugs, all around agent↔org:
1. **Town Hall agent picker hard org-scoped** — `recordings/new|[id]/setup|[id]/report` listed agents via `.eq('org_id', …)` with no admin override (unlike `/api/bots`, which gives admins all orgs). So a cross-org agent was invisible, and the PATCH agent-link guard rejected it.
2. **Transfer used the caller's org as "from"** — `app/api/bots/[id]` passed `auth.orgId` (caller = Datanautix) to `checkTransferTarget` instead of the agent's own org, so moving an Arjun-Pilots agent *to* Datanautix compared Datanautix→Datanautix → false "already in that org." (bots was the only transfer route with this bug; recordings/studies/datasets already used the resource's org.)
3. **Transfer didn't cascade** — it updated only the `agents` row, stranding the agent's conversations/turns/questions/etc. in the old org. Sarina was split: agent in Arjun Pilots, but 77 conversations + 505 turns + 17 questions + 66 impressions in Datanautix → her history was invisible from the new org.

**What changed**:
- `app/recordings/new|[id]/setup|[id]/report/page.tsx` + `app/api/recordings/[id]/route.ts` — agent picker + PATCH agent-link guard now key off `isAdminOrg` (admins see/link cross-org agents).
- `app/api/bots/[id]/route.ts` — transfer uses the agent's own org as "from"; calls the new RPC for the move.
- `sql/127_transfer_agent_org.sql` — `transfer_agent_org(agent_id, to_org)` SECURITY DEFINER RPC: moves the agent + conversations + conversation_turns (via conversation subquery) + logged_questions + conversation_reviews + agent_change_log + agent_impressions + agent_study_cache in one transaction. Idempotent; repairs already-split agents. `bot_knowledge_chunks` (no org_id) follows the bot; `bots`/`bot_change_log` are views.

**Data fix (done in prod)**: applied sql/127 and ran `transfer_agent_org(Sarina, Arjun Pilots)` — consolidated all of Sarina's data into Arjun Pilots (verified: every table now 100% `05fcdb2a`, zero `b72e9ee6`).

**Verify**: typecheck clean. RECORDINGS.md + BOTS.md updated. Code local + unpushed — the picker/transfer fixes need a push to take effect in prod (the data consolidation is already live).

## 2026-06-17 — Town Hall: re-transcribe action + name diarized speakers

**Why**: (1) Hybrid (Whisper+Deepgram) was selectable only at *create* — no way to re-transcribe an already-processed recording with a different model. (2) Diarized transcripts show generic "Speaker 0/S1" labels with no way to assign real names (the parked attribution gap). Both needed in the report UI.

**What changed**:
- **Re-transcribe** — `workflows/recordings.ts` `retranscribeRecordingWorkflow` (re-transcribe stored audio with the chosen strategy → clear prior Q&A + dataset mirror → re-analyze → complete; new `runClearExtractions` step). `POST /api/recordings/[id]/retranscribe { strategy }` (owner/admin, settled-state only) persists `asr_strategy`, flips to `transcribing`, starts the workflow. UI: strategy dropdown + confirm in the report **Transcript tab**; bounces to the status page.
- **Speaker names** — `sql/128` adds `recordings.speaker_names` jsonb (`{label: name}`). `POST /api/recordings/[id]/speaker-names { names }` (owner/admin). Transcript tab gets a "Name speakers" panel (distinct diarized labels + sample line + name input); render precedence `speaker_names[label] → channel_labels[ch] → raw label`. Display-only; raw labels untouched. Distinct from `channel_labels` (stereo per-mic).
- `lib/recordings/types.ts` (+speaker_names), `app/recordings/[id]/report/page.tsx` (+isAdmin prop), ReportClient (panels + props).

**Verify**: typecheck clean. RECORDINGS.md updated (§3.4 re-transcribe + speaker-names). **Activation**: apply sql/128 to prod (speaker_names column); push (registers the WDK workflow + ships the routes/UI). Local, unpushed.

## 2026-06-17 — Town Hall UI polish: status progress bar, prominent active dot, speaker-panel snippet playback + self-intro auto-suggest

**Why**: Owner feedback on the status/report UI — wanted a progress bar for the pipeline steps, a more prominent active-step indicator, and on the speaker-naming panel (a) clickable snippets to listen+read at that point and (b) auto-detection of names when a speaker introduces themselves (diarization often didn't catch "Hi, I'm Tatiana Morales").

**What changed** (UI only, no schema/API):
- `StatusClient.tsx` — gradient progress bar above the step pills (filled to completed + half-active, pulses in flight); active-step dot upgraded to an amber ping halo + orange core.
- `ReportClient.tsx` (Transcript tab "Name speakers" panel) — sample snippets are now buttons → `onPlay` from that segment + `scrollIntoView` of the `seg-<start>` anchor; self-intro regex over each speaker's lines surfaces a `✨ <name>` chip that one-click-fills the field; input made controlled. Added `id="seg-<start>"` + `scroll-mt-24` to transcript segments.

**Verify**: typecheck clean. RECORDINGS.md §3.4 updated. Local, unpushed.

## 2026-06-17 — Town Hall: report-side entity editor + speaker names feed analysis

**Why**: Two follow-ups: (1) the name/term spelling map (§3.5b) was editable only at the pre-analysis gate — needed a fix-it-later editor on the report. (2) Confirmed speaker names weren't used by the Q&A extraction (asker/panelist were content-guessed), so naming a speaker did nothing for attribution.

**What changed**:
- `POST /api/recordings/[id]/entity-map { entities }` (owner/admin) — saves `recordings.entity_map` post-generation. Report Transcript tab "Correct names & terms" panel (canonical + variants rows, add/remove). Corrected transcript view applies on reload; Q&A on re-analyze.
- A3: `analyzeRecording` applies `speaker_names` to segments before the prompt (`applySpeakerNames`), so `formatTranscript`'s `speaker:` prefix carries the real name → asker/panelist attribution uses confirmed labels. Threaded via `runAnalyze` + `reanalyzeRecording` (+ select speaker_names).

**Verify**: typecheck clean. RECORDINGS.md updated. Local, unpushed. (Gate-side transcript+speaker review is the next chunk.)
