# 2026-W25 — Dev log (Week of Jun 15 to Jun 21)

## 2026-06-21 — Saved Views / Snapshots / Periods design spec + pitch-deck brand casing

**Why**: Customers doing recurring analysis (e.g. quarterly reviews) need to save the filter state of a dataset and re-open it later, and to filter/compare by relative time ("current quarter", "same period last year") so a saved analysis stays correct as new data lands. Captured the full design before building, resolving the hard edge cases up front (partial-period comparison, timezone, snapshot fidelity vs continuously-syncing sources).

**What changed**:
- `docs/SAVED_VIEWS.md` (NEW, committed `dbc1888d`) — v1 design for three concepts: **view** (live named filter config), **snapshot** (a view frozen to *aggregates only* — drift-immune vs synced review/Reddit/Substack sources; row-copy deferred), **period** (relative date range, resolved at read time). Key decisions: snapshot = a view frozen at a moment (one mental model, not two); periods stored as intent, resolved client-side into the existing `DateRangeFilter` so `applyFilters()` is unchanged; **to-date alignment** for in-progress periods (QTD vs same-quarter-last-year-to-date — kills the phantom "−90% on day 8"); **org-level timezone**; calendar arithmetic with half-open `[start,end)` boundaries; comparison = offset from primary (rolls forward automatically), one comparison now but modeled for N; "—" instead of a fake delta when the prior window predates the dataset's earliest data. New `SchemaConfig.primaryDateField` (auto-ranked: analytical names > operational, fill rate, value spread; user-overridable) is the date-field default and the "no date → hide period UI" signal. Views get their **own table** (`saved_views`, RLS org-scoped, private-by-default w/ opt-in org visibility) — can't live in the shared org-universal `dataset_state`. Deferred: collections (need per-source canonical date mapping), auto-snapshot-at-period-close, fiscal-year UI, snapshot re-slice.
- `SPEC.md` — added a "Saved Views & Snapshots + relative Periods (spec'd, not yet built)" note under § Filters pointing to the design doc.
- `PITCH_DECK.md` (committed `480447c6`) — normalized brand casing `SentimetRx` → `Sentimetrx` (product-naming rule; deck-export Datanautix brand untouched).
- Cleanup: deleted 8 one-off scratch scripts (`scripts/_*.ts` — NOWOCATS #2 recording-recovery + deck-QC throwaways, work already shipped) rather than commit them.

**Verify**: docs only — no code/behavior change yet. Spec doc + casing fix committed locally, unpushed.

## 2026-06-19 — Community-feedback deck refinements + deck "last updated" fix

**Why**: Generalized the community-engagement deck (was NOWOCATS-specific), wove PulseIQ in, put real NOWOCATS metrics on it, and fixed a wrong "Last updated" date on the decks hub.

**What changed**:
- `lib/decks/communityFeedbackHtml.ts` — generalized to public/community engagement (NOWOCATS now a single proof slide); slide 3 → "one KB, every touchpoint" (Sarina web · **PulseIQ pre-meeting** · Town Hall live); NOWOCATS slide made accurate: trained on project docs, QR to 37,000+ households, 24×7, **~94% answered confidently** (16 flagged of ~265 real questions), and Town Hall **transcription only — not auto-answering** (no oversell). The 94% was computed from prod (`town_halls(slug='nowocats').bot_id` = 5c468b90; `logged_questions` 16 = 15 ai_uncertain + 1 kb_miss vs ~265 user turns, demo session excluded). Accuracy intentionally omitted (needs an eval — see [[project-community-feedback-deck]]).
- `lib/deckLastModified.ts` — **bug fix**: was returning last-commit time only, so files committed together (e.g. the v2/v3/community decks in `23642ce7`) shared one timestamp and post-commit edits never moved it. Now returns **max(git commit time, file mtime)** so local edits surface and same-commit files de-bundle; Vercel runtime (no git) still falls back to mtime as before.

**Verify**: typecheck clean; community deck renders (13 pages); per-deck timestamps now differ (community shows its post-commit edit time vs the Anthology commit time). Local, unpushed.

## 2026-06-19 — Anthology pitch variants + a community-engagement capability deck

**Why**: Iterating the Menlo × Anthropic Anthology pitch into a full + short variant, and adding a public/community-engagement capability deck for the decks hub.

**What changed**:
- `lib/decks/pitchDeckV2Html.ts` — the FULL 17-slide warm-editorial Anthology deck (40-year founder arc, incumbents-falling/AI-inflection, sourced CXM market sizing, Claude-as-spine, restaurant vertical, traction, "why we fit Anthology"). Positions in **Consumer AI** (Anthology focus area). Route `/api/pitch-deck-v2` → `Sentimetrx-Anthology-Fund.pdf`.
- `lib/decks/pitchDeckV3Html.ts` + `app/api/pitch-deck-v3` (NEW) — the SHORT (~12-slide) deck per YC-founder feedback: collect→unify→act architecture, the **data-flywheel moat** ("the model is rented; the data is the moat"), $1M use-of-funds, Claude in the product + in how we build, first-party/always-on framing (implicit Gather differentiation).
- `lib/decks/communityFeedbackHtml.ts` + `app/api/community-feedback-deck` (NEW) — "Gathering Community Feedback: A New Approach" (13 slides): one KB → Sarina web assistant + live town-hall capture, any-format intake, entity/error correction, near-real-time notes + Q&A, a closed-loop engagement process, confidence-flagging; generalized with a NOWOCATS proof slide.
- `app/admin/decks/DecksClient.tsx` — cards for the full / short / community decks, grouped by audience.
- `app/admin/decks/page.tsx` — `lastUpdated` entries for the lib-file decks so cards show dates.

**Verify**: typecheck clean; all three decks render (17 / 12 / 13 pages) via the puppeteer-core + @sparticuz/chromium pipeline. Local, unpushed. NOTE: PDF render depends on Google Fonts reachable from the serverless fn — confirm on first prod download.

## 2026-06-18 — Engineering Reality Check deck: bring current + reposition

**Why**: The peer-review deck was anchored to "Mar 1 → ~9 weeks" and listed zero-tests / no-CI / in-memory-rate-limit as the headline gaps — all since resolved — and omitted the Town Hall product. Also needed a sharper positioning: not a consolidation play, but a Claude-spined stack solving real, well-understood problems, with funding used to harden scalability + enterprise usability.

**What changed** (`app/api/engineering-reality-deck/route.ts`, `app/admin/decks/DecksClient.tsx`):
- **Current numbers** (verified from the repo today): ~16 weeks, 2,428 commits, 903 TS files / ~193K lines, Next.js 16, 126 SQL migrations, 31 spec docs.
- **Discipline** now reflects reality: 875 tests + CI on every push (`.github/workflows/ci.yml`), RLS + cross-org egress suites, k6 + Playwright load suites, Postgres-backed rate limiter. The three former "big gaps" moved here.
- **Gaps / Risks / Hardening** reframed to what's actually left — compliance (SOC 2 / GDPR), mutation audit trail, pen-test/SAST, cost-cap enforcement — "investment, not bugs."
- **What Got Built** adds the Town Hall product (13 modules; dropped per-module line figures rather than fabricate new splits); 4-col grid.
- **New positioning slide** ("Anyone can build a tool now. We solve real problems."): 20 years across platforms (12 in NLP/NLU), Claude-spined stack, known pain points, real customers; initial funding → scalability + enterprise usability; roll-up demoted to upside. Cover subtitle + admin card updated to match.

**Verify**: typecheck clean. Not standalone-renderable (route's auth import chain needs the Next runtime); eyeball via /admin/decks download. Local, unpushed.

## 2026-06-18 — Investor deck: founder-origin slide + warm-editorial PDF variant (Anthology Fund)

**Why**: Prepping the Menlo × Anthropic Anthology Fund application. Two needs: (1) the deck should open with the founder's 40-year AI arc (1986 OSU LAIR under Dr. B. Chandrasekaran → Bell Labs → 2000 consumer insights → 2014 consultancy→tech pivot → Claude as the unlock), and (2) a design-forward deck that does NOT read as the default LLM/pptxgenjs chip-grid look, matching datanautix.com's brand.

**What changed**:
- `app/api/pitch-deck/route.ts` — added a "40 Years in the Making" timeline slide as slide 2 (renumbered the subsequent slide-comment banners; deck is now 15 slides).
- `lib/decks/pitchDeckV2Html.ts` (new) — warm-editorial deck as one HTML string (15 16:9 slides) on the real datanautix.com `:root` tokens: Fraunces serif + DM Sans, paper/cream canvas, Ana orange + Sarina teal, editorial layouts (typographic numbered lists + hairline rules, NOT colored chip-grids), inverse closing "Ask" slide. Market slide keeps qualitative-only framing (no fabricated TAM $).
- `app/api/pitch-deck-v2/route.ts` (new) — admin route (`requireAdmin` + `logDeckDownload('pitch-deck-v2')`) that renders the HTML → 16:9 PDF via the existing puppeteer-core + @sparticuz/chromium pipeline (mirrors reportPdf.ts). Fonts via Google Fonts + `document.fonts.ready`.
- `app/admin/decks/DecksClient.tsx` — added the v2 card; download button label now derives from the file extension (.pdf vs .pptx); bumped the classic pitch-deck slide count 14→15.

**Verify**: typecheck clean, 875 tests pass. Rendered the PDF locally and eyeballed all 15 pages; fixed two overflow bugs (slide 3 headline wrap, slide 11 quote/footer collision). Local, unpushed. NOTE: prod PDF render depends on Google Fonts being reachable from the serverless function — confirm on first prod download.

## 2026-06-18 — Admin decks: group + filter by audience

**Why**: The decks list grew to 15 in a flat column — hard to scan. Group by audience and let the user filter.

**What changed** (`app/admin/decks/DecksClient.tsx`): decks now render in three sections — **Investor** (5), **Technical & Diligence** (2), **Client & Prospect** (8) — each with a colored heading + count, plus a row of filter pills (All / per-category) to narrow the view. Categorization is a `logKey → DeckCategory` map (`CATEGORY_OF`) with a `'client'` fallback, so adding a deck doesn't force an edit here. Cards unchanged. Typecheck clean; not separately render-verified (admin page needs auth).

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

## 2026-06-17 — Town Hall: full transcript review at the gate (shared component) + segment edit API

**Why**: Closing the loop on the previous entry's "next chunk." The transcribed gate let users tweak agenda/panel/entity-spellings/split, but the two corrections that most affect extraction quality — **speaker labels** (asker/panelist attribution) and **verbatim ASR errors** (what gets extracted) — weren't fixable there. They were only correctable post-analysis in the report, which means a wrong transcript shipped into the first (paid) Opus+Sonnet pass. The gate is the right home: correct first, extract once.

**What changed**:
- `GET+PATCH /api/recordings/[id]/transcript` — GET returns segments + speaker_names + channel_labels + `can_edit` (org-scoped read, admin-org sees all; segments omitted from the polled `GET /[id]` for size). PATCH applies `{ edits: [{ index, text?, speaker? }] }` to `recording_transcripts.segments` in place (raw ASR preserved in `raw_response`), recomputes `word_count`. Owner/admin only.
- `components/recordings/TranscriptReview.tsx` — extracted the report Transcript-tab segment list + speaker-naming into one shared component; added an `editable` mode (inline verbatim textareas + per-segment speaker-reassignment dropdown, batched save). Keeps the report features (corrected/raw entity toggle, audit overlay `roles`, stereo/crosstalk) as optional props.
- `ReportClient.tsx` — Transcript tab now renders `<TranscriptReview editable>` (kept the re-transcribe + entity-spelling panels as siblings); a save there shows a "re-run Q&A to apply" hint. Removed the now-orphaned local `micLabel`/`highlight` and the `buildReplacements`/`normalizeSegments` import.
- `StatusClient.tsx` — `GeneratePanel` gains a collapsible "Review & correct transcript" panel (lazy GET on first open) rendering `<TranscriptReview editable>`. Edits persist to `recording_transcripts` before "Generate Q&A"; `analyzeRecordingWorkflow` re-reads the transcript at run time, so corrections feed the first extraction pass with no extra wiring.

**Verify**: `npm run typecheck` clean. RECORDINGS.md § 5.3 (Gate 1) updated. Local, unpushed. NOWOCATS #2's hand-recovered transcript is safe to edit (in-place, raw_response untouched) but must still not be re-transcribed.

## 2026-06-17 — Town Hall PDF: per-page footer (branding + meeting name + page N of M) + widow-title pagination

**Why**: The exported report PDF had a single footer at the very end of the document and no page numbers; multi-page reports read as unbranded after page 1. Separately, topic section titles could land orphaned at the foot of a page with their content on the next.

**What changed** (PDF only — `reportHtml.ts` + `reportPdf.ts`):
- Per-page footer via `page.pdf({ displayHeaderFooter, footerTemplate })`: Datanautix wordmark (teal/orange) · meeting name (escaped, centered) · "Page N of M". Emptied `headerTemplate` to suppress Chromium's default header. Removed the old static `<footer class="foot">` + now-orphaned `DN_WORDMARK`/`.foot`.
- Margins moved from CSS `@page` to the `page.pdf` `margin` option (`14mm` top / `12mm` sides / `16mm` bottom) so the footer band is reserved and margins don't double up; `@page{margin:0}`.
- Pagination CSS: `h1,.topic,.ov-h{break-after:avoid;page-break-after:avoid}` (heading stays with following content) + `orphans:3;widows:3` on body copy. Existing `break-inside:avoid` on Q&A cards / pitems / overview kept.

**Verify**: typecheck clean. Rendered an 11-page sample locally with real Chrome (throwaway script, since removed) — confirmed footer repeats per page with correct branding/name/page-count, and a topic title ("Right-of-Way Acquisition") moved to the top of the next page with its first card rather than widowing. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Town Hall transcript review: auto-fill same-speaker gaps + PDF Letter/1in margins

**Why**: (1) Assigning speakers segment-by-segment is tedious when diarization drops labels mid-turn; (2) the report PDF should print on US Letter with standard 1" side margins.

**What changed**:
- `TranscriptReview.tsx` — "⚡ Auto-fill speakers" button in edit mode. Fills runs of unassigned segments bounded on BOTH sides by the SAME identified speaker (safe, no cross-speaker guessing); cross-speaker / unanchored gaps left alone. Stages fills as pending edits (dirty) for review before Save; shows a count / "nothing to fill" note. (Chose same-speaker-bounded over carry-forward per user — avoids mislabeling a new speaker who started unlabeled.)
- `reportPdf.ts` — `page.pdf` format `a4` → `letter`; left/right margins → `1in` (top `14mm` / bottom `16mm` unchanged); footer template side padding `12mm` → `1in` so it stays aligned with the body.

**Verify**: typecheck clean. Re-rendered a Letter sample with real Chrome (throwaway, removed) — 1" side margins + footer correct. RECORDINGS.md §4.5 + §5.3 updated. Local, unpushed.

## 2026-06-17 — Town Hall PDF: running header ("powered by datanautix") + restructured footer

**Why**: Owner wanted Datanautix branding promoted to a top-right page header, and the footer reorganized to timestamp / title / page-number.

**What changed** (`reportPdf.ts` only):
- Header template (was empty): "powered by datanautix" (wordmark teal/orange), top-right, every page. Top margin 14mm → 16mm to seat it without overlapping content.
- Footer template: dropped the left wordmark; now generated-at timestamp (left, `new Date()` formatted UTC) · meeting name (center, ellipsized) · "Page N of M" (right). Shared `DN_WORDMARK`/`FOOT_FONT`/`escFooter` helpers.

**Verify**: typecheck clean. Rendered a Letter sample with real Chrome (throwaway, removed) — header sits top-right clear of the title, footer shows timestamp/title/page across the band. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Town Hall: "Speakers" setup roster → assignable in transcript review (no-diarization path)

**Why**: When a recording isn't split into speaker tracks (no diarization labels), the transcript-review reassignment dropdown had nothing to offer — you couldn't assign segments to anyone. Owner wanted a predefined speaker roster like the panel.

**What changed**:
- `QaSetupInputs.speakers?: PanelMember[]` (name + role) — new optional roster.
- `RecordingSetupForm` — new "Speakers (optional)" section mirroring Panel members (name + role rows, add/remove); persisted in `setup_inputs.speakers`. `setup/page.tsx` maps it into the form's initial values.
- `TranscriptReview` — new `rosterSpeakers` prop; the reassignment dropdown now merges diarized labels + roster names (deduped by display), so segments can be assigned by name with zero diarization. Assigning sets `segment.speaker` to the name directly.
- Wiring: `GET /transcript` returns `roster_speakers` (panel + speakers names, deduped); `GateTranscriptReview` and the report's `TranscriptTab` pass it through.

**Verify**: typecheck clean, 875 tests pass. RECORDINGS.md §5.3 updated. Local, unpushed.

## 2026-06-17 — Town Hall PDF fixes: no header/footer bleed, local-time stamp, first-page panel context

**Why**: Reported issues on the exported PDF — (1) content bled under the running header/footer on dense pages, (2) the footer timestamp was UTC not the viewer's local time, (3) the first page jumped straight into Q&A with no meeting context.

**What changed**:
- **Bleed fix** (`reportHtml.ts`): removed the `@page{margin:0}` rule. It overrode the `page.pdf` `margin` option, so content used the full page height while the header/footer still drew in the reserved bands → overlap. Margins are now owned solely by `page.pdf` (`18mm` top/bottom, `1in` sides).
- **Local time** (`reportPdf.ts` + `report/pdf` route + `ReportClient`): the browser posts its IANA `tz`; the route validates it (Intl) and threads it to the renderer, which stamps the footer in local time with a zone abbrev (e.g. `10:11 AM EDT`). Email path falls back to server zone. `report/send` select also gains `setup_inputs` for parity.
- **First-page context** (`reportHtml.ts`): added a **Panel** chip row (name + role from `setup_inputs.panel`) to the header block, alongside the existing date·location, objectives, and Overview summary — all before the Q&A.

**Verify**: typecheck clean. Rendered a 7-page Letter sample with real Chrome (throwaway, removed): header/footer clear of content on dense pages, footer shows local time, page 1 shows panel chips + date/location + summary. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Town Hall speakers: consolidate to ONE place + fix reassignment reflection

**Why**: Follow-up feedback — speaker management was in two places (Setup "Speakers" list + the transcript "Name speakers" panel), and edit-mode segment reassignments didn't reflect in the read view / survive tab switches. Single, post-STT place was the ask.

**What changed**:
- **One place**: removed the Setup-page "Speakers" section (Setup keeps Panel members). The transcript-review panel ("🎙 Speakers") is now the single roster manager: names diarized labels (self-intro seeded) **and** holds an editable extra-speakers roster (moderator/audience/untagged). One "Save speakers" persists both — `POST /speaker-names` extended to take `extra_speakers` → `setup_inputs.speakers`. Panel members flow in read-only (always assignable).
- **Dropdown roster** = diarized labels + panel members + extra speakers (deduped). `GET /transcript` now returns `roster_panel` + `roster_extra` (was merged `roster_speakers`).
- **Reflection fix**: `TranscriptReview` calls `onSegmentsSaved(segments)` after a successful PATCH; ReportClient lifts the transcript to state and updates it (read view + tab-switch remounts stay fresh), GateTranscriptReview updates its segments state.
- `QaSetupInputs.speakers` type retained (now written from the transcript panel, not setup).

**Verify**: typecheck clean, 875 tests pass. RECORDINGS.md §5.3 updated. Local, unpushed.

## 2026-06-17 — Town Hall PDF polish: section spacing, larger labels, header/footer rules, brand colors

**Why**: Report polish pass — sections (Panel/Objectives) felt cramped with tiny labels; wanted separator rules under the header and above the footer; the header wordmark teal was off-brand.

**What changed** (`reportPdf.ts` + `reportHtml.ts`):
- Section labels: new `.sec-h` (13px bold caps) for the first-page **Panel**/**Objectives** blocks (the inline Q&A `.label` is untouched), with `20px` top margin so each block has breathing room.
- Separators: hairline rule under the running header (`border-bottom`) and above the footer (`border-top`).
- Brand color fix: header wordmark now uses the canonical palette — **data = Sarina teal `#0F7173`, nautix = Ana orange `#E85A1A`** (was a non-brand `#1FA8A8` teal). Matches `lib/pptx/shared.ts` primaries.

**Verify**: typecheck clean. Letter render confirmed: header/footer rules present, labels larger with spacing, wordmark on-brand. Local, unpushed.

## 2026-06-17 — Town Hall: targeted re-transcription of quiet stretches (listen + tuned ASR pass)

**Why**: Coverage flagged "long quiet stretches" (≥5min, no extracted pair) but they were dead text. NOWOCATS-style low-coverage spans need a way to recover missed speech without a full (destructive) re-transcribe.

**What changed**:
- **Listen**: coverage quiet stretches are now clickable ▶ time ranges → play that span in the report audio modal (threaded `onPlay` + `recordingId`/`canEdit` into `CoverageTab`).
- **Re-transcribe span**: per-stretch action + vendor pick (Whisper default — not VAD-gated, better at faint speech; Deepgram alt). `POST /api/recordings/[id]/transcribe-span` → `retranscribeSpanWorkflow`: slices `stitched.mp3` to [start,end] in a Sandbox (ffmpeg `-ss/-t -c copy`), runs ASR on the clip (`lib/recordings/transcribeSpan.ts`), shifts segments to absolute time, merges into `recording_transcripts.segments` (drops overlapping, re-sorts, recomputes word_count). Does NOT clear extractions / re-analyze — Q&A preserved.
- Exported `extract.ts` Sandbox helpers (`bootSandbox`/`runOrThrow`/`freshReadUrl`/`freshUploadUrl`/`shellQuote`/`BUCKET`) for reuse.

**Verify**: typecheck clean, 875 tests pass. UI + routing verified by types/patterns; the Sandbox+ASR leg only runs deployed (same as extract/transcribe). RECORDINGS.md §5.3 updated. Local, unpushed.

## 2026-06-17 — docs refresh + span re-transcribe usage accounting

**Why**: Bring the feature inventory current and close an accounting gap in the new span re-transcribe.

**What changed**:
- `lib/recordings/transcribeSpan.ts` — log the span ASR charge to `usage_logs` via `logFlatCost` (`recording_transcribe`, `model:'asr:<vendor>:span'`), matching the full transcribe; still also bumps `recordings.cost_cents`. (Was only bumping the recording's cost, escaping `/admin/usage`.)
- `FEATURES.md` — added "Transcript review & correction (Town Hall)" + "Recording report PDF" capability subsections.
- `RECORDINGS.md` §5.3 + `USAGE_ACCOUNTING.md` — note the span-retranscribe cost path.

**Verify**: typecheck clean. Docs-only + a 4-line accounting addition. Local, unpushed.

## 2026-06-17 — Town Hall: editable action items + per-pair "Mark reviewed"

**Why**: Action items were read-only (only Q&A pairs were hand-editable), and a curator-flagged "needs review" pair had no resolve action — the ⚠ flag only cleared on a full re-analyze.

**What changed**:
- **Editable action items**: `ActionItemPayload` gains a revertible edit overlay (`edited_description/owner/due_date` + audit stamp); `ActionItemRow` has inline edit/save/revert (mirrors the Q&A editor). `PATCH …/extractions/[extractionId]` now handles `action_item` edits (gated per unit type). The PPTX deck prefers the edit overlay so corrections export.
- **Mark reviewed**: same PATCH accepts `{ flagged_for_review: false }` (clears flag + reason, only ever clears); ✓ Mark reviewed button on flagged Q&A cards. Distinct from the report-level sign-off finalize.

**Verify**: typecheck clean, 875 tests pass. RECORDINGS.md §3.5d updated. Local, unpushed.

## 2026-06-17 — Town Hall PDF: add Action Items section

**Why**: Action items appeared in the in-app report tab and the PPTX deck but NOT in the PDF report — so a PDF recipient missed the follow-ups/commitments the deck recipient saw.

**What changed** (`reportHtml.ts`): added an "Action Items" section (after Q&A topics, before the transcript appendix) rendering `action_item` extraction rows — description + owner + due, using the §3.5d edited overlay so corrections show; `page-break-inside:avoid` per item, `.topic` heading for widow control. Always included when present. The input already carried all extractions (it filtered to qa_pair), so no input/route change. The public `/th` link stays Q&A-only (separate React page, unaffected).

**Verify**: typecheck clean. Letter render confirmed the section + edited-owner overlay. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Fix: Coverage tab badge stale after Mark reviewed

**Why**: After ✓ Mark reviewed, the per-pair "Needs review" filter cleared (live state) but the **Coverage tab badge** still read "1 to review" — it was counting the stored `coverage_report.flagged_count` snapshot, which Mark-reviewed doesn't touch.

**What changed** (`ReportClient.tsx`): the Coverage tab badge now counts `qaPairs.filter(flagged_for_review)` from live state, matching the QATab filter + the Coverage body (already live via `computeCoverage`). One-line fix.

**Verify**: typecheck clean. RECORDINGS.md §3.5d note added. Local, unpushed.

## 2026-06-17 — Fix: PDF Q&A now applies entity-map spelling corrections (was transcript-only)

**Why**: Reported — the PDF didn't pick up the corrected transcript; "Big Road"/"Vick Road" read as interchanged. Root cause: the entity_map (§3.5b) was applied only to the transcript appendix (`normalizeSegments`); Q&A cards / action items / exec summary rendered polished/verbatim text un-normalized, so a name fixed after analysis stayed stale in the Q&A.

**What changed** (`reportHtml.ts`): build variant→canonical replacements once (`nz`) and apply to all AI text — `qaCard` (q + a), action item description/owner, exec summary — not just the transcript. Verified: a Vick Road↦Big Road map turns all "Big Road" → "Vick Road" across Q&A/action/summary (0 remaining).

**Caveat surfaced**: correction direction depends on the entity entry having the correct spelling as `canonical`; a reversed entry would propagate the wrong word. On-screen report Q&A + PPTX deck still only normalize on re-analyze (follow-up if wanted).

**Verify**: typecheck clean. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Analytics: per-outlet "vs. peer group" one-page report (Outlets tab)

**Why**: For a multi-location review brand (e.g. BareBurger — 29 outlets, 14.7k Google reviews, ~7.3k taxonomy-classified) there was no way to ask "what does *this* outlet excel at / need to work on, relative to its sibling outlets?" The pieces existed (per-location rows, 7-axis taxonomy with polarity-tagged assertions, rating per location) but nothing compared one outlet to the group. Needed a demoable one-pager that ranks an outlet against peers and surfaces concrete strength/weakness themes with quotes.

**What changed**:
- `lib/outletReport.ts` (new, server-only) — `computeOutletReport(datasetId, placeId)`. Outlets keyed by **`place_id`** (same name+city collide). Headline = avg rating vs. chain + percentile/rank from `dataset_rows_flat.data.{rating,place_id}`. Strengths/weaknesses = taxonomy sub-themes where the outlet's net-positive rate (`(pos−neg)/total`) most beats/trails the chain, joining `dataset_row_field_taxonomy.assertions` to flat rows on **`flat.id === taxonomy.row_id`** (not `row_index` — 0 matches on the wrong key). Stability floors (≥6 outlet / ≥20 chain mentions, ≥30% opinionated, ≥8pt gap). Quotes recovered from full `review_text` expanded to sentence boundaries (raw `evidence` is a mid-word window). `isNoiseAssertion()` drops keyword false-positives where "dirty" hits menu items ("dirty soda/cherry cola") or the idiom "dirty look(s)" on the Clean axis — measured 8 dropped / 35 real hygiene complaints kept.
- `app/analyze/[datasetId]/outlet-report/` (new) — server page + `OutletPicker` (client, `?outlet=` switch) + `PrintButton`. Printable one-pager: KPI row + Excels/Needs-work columns with quotes + method footnote.
- `app/analyze/[datasetId]/{DatasetHeader,DatasetShell,layout}.tsx` — new **🏪 Outlets** tab, gated `sources:['google_reviews']` + `minOutlets:5` (generic per-tab gate). `layout.tsx` computes `outletCount` via a cheap `review_source_locations` count (service-role) and threads it through the shell.

**Verify**: typecheck clean; compute logic proven against live BareBurger data (Stamford laggard 4.18★ bottom; Dobbs Ferry leader 4.89★ 92nd pct); outlet-count gate validated across all 20 review datasets (BareBurger/Ruth's Chris/Cheddar's show, single-property/tiny datasets hide). Route compiles + auth-redirects. ANALYTICS.md "Outlet Report" section added. Local, unpushed.

## 2026-06-17 — Extend entity-correction-on-read to the deck + on-screen report

**Why**: After fixing the PDF to apply entity-map corrections on read, the PPTX deck (client deliverable) and the on-screen report Q&A still showed stale names until re-analyze — inconsistent across the three deliverables.

**What changed**:
- `recordingDeck.ts` — build `nz` from `entity_map` (threaded via the export route's select) and apply to all AI text: Q&A (polishByQ + appendix + representative exchanges), exec summary, headline, objectives, topic summaries, decisions, action item desc/owner.
- `ReportClient.tsx` — `reportNz` from `data.recording.entity_map`, threaded to QATab→QACard (shownQuestion/shownAnswer) and ActionItemsTab→ActionItemRow (read-only display).

So PDF, deck, and on-screen all apply the reviewed spelling corrections on read; direction still depends on the entry's canonical being correct.

**Verify**: typecheck clean, 875 tests pass. RECORDINGS.md §4.5 updated. Local, unpushed.

## 2026-06-17 — Docs sync: FEATURES inventory caught up to the Town Hall sweep

**Why**: `FEATURES.md` predated the last few features.

**What changed** (docs only): added to the Town Hall inventory — edit Q&A *and* action items (revertible overlay), resolve "needs review" per-pair (vs report sign-off), and name corrections flowing on-read across report/PDF/deck. Fixed the PDF bullet (it carries action items + optional transcript, more than the Q&A-only public link) + noted the Action Items section. RECORDINGS.md (§3.5d/§4.5/§5.3) + memory were already current per-commit.

## 2026-06-17 — CI fix: tx-wrap sql/126,127,128 (BEGIN/COMMIT guard)

**Why**: First push of the batch failed CI on `check:sql-tx` — migrations >70 must be wrapped in BEGIN/COMMIT, and the three prior-session migrations weren't (they'd never hit CI while unpushed).

**What changed**: wrapped `sql/126_service_health.sql`, `sql/127_transfer_agent_org.sql`, `sql/128_recording_speaker_names.sql` in `BEGIN; … COMMIT;`. Cosmetic only — all three are already applied to prod and re-run no-op (IF NOT EXISTS / DROP POLICY / CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS). `npm run check:sql-tx` passes.

## 2026-06-18 — Town Hall: correct ASR label mid-re-transcribe + span re-transcribe bookkeeping

**Why**: A Whisper re-transcribe showed "running Deepgram Nova-3" — the live status label read `asr_vendor_chosen`, which is only written when a transcribe *completes*, so on a re-run it showed the *previous* run's vendor. Separately, a span re-transcribe left no trace: the user could repeat the (paid) pass on the same quiet stretch, and there was no persistent signal that the Q&A pairs no longer matched the updated transcript.

**What changed**:
- `StatusClient.tsx` — the live transcribe label now derives from the in-flight `asr_strategy` (resolving `auto` via the pure `resolveAsrVendor` router), not the completed-run `asr_vendor_chosen`. The `past`-state label still uses `transcript.vendor` (the true vendor). Bugfix only.
- `sql/129` — `recordings.respan_log jsonb default '[]'` + `recordings.qa_stale boolean default false` (applied to prod 2026-06-18).
- `transcribeSpan.ts` — appends `{start_sec,end_sec,vendor,at}` to `respan_log`, sets `qa_stale=true`, tags recovered segments `span re-transcribe (<vendor>)`. `transcribe.ts` — full transcribe resets `respan_log=[]`. `runAnalyze` — clears `qa_stale=false` (covers fresh analyze, re-analyze, full re-transcribe).
- `ReportClient.tsx` — Coverage tab shows "✓ re-extracted with <vendor>" on a done gap (button hidden, no repeat); amber "Q&A is out of date — Re-run Q&A →" banner across all tabs while `qa_stale` (the link fires `reanalyze scope:'all'`).

**Verify**: typecheck clean, 875 tests pass. RECORDINGS.md §5.3 updated. Local, unpushed.

## 2026-06-18 — Agent Study route: retryable 503 on AI timeout

**Why**: A Sentry `TimeoutError: The operation was aborted due to timeout` on `GET /api/bots/[id]/study` traced to `getAgentStudy`'s two `callAI` passes (`AbortSignal.timeout`, 40s/45s via `lib/ai.ts:332`). When a vendor ran slow the error bubbled out of the un-try/caught route as an unhandled 500, and the report page (`ReportClient.tsx`) showed the generic "Failed to load study."

**What changed**: `app/api/bots/[id]/study/route.ts` wraps `getAgentStudy` in try/catch — a `TimeoutError` (matched by `err.name`) returns a **retryable `503`** with `"Analysis is taking longer than usual. Please try again."`; every other error rethrows unchanged so real failures aren't swallowed. No change to the AI timeouts themselves, no retry added (1 Sentry event so far — not yet worth it). BOTS.md §10 Agent Study note updated.

**Verify**: typecheck clean. Local, unpushed.

## 2026-06-19 — Community Feedback deck: add PulseIQ as a co-equal pillar

**Why**: Compliance pass against the original brief — the deck must "highlight all that they could do with (1) agents (2) townhalls (3) PulseIQ." Sarina (agents) and Town Hall each had a dedicated deep-dive slide; PulseIQ only had a single column on the "One KB, every touchpoint" slide, leaving it underweighted relative to the other two pillars.

**What changed**: `lib/decks/communityFeedbackHtml.ts` — inserted a new PulseIQ deep-dive slide (the pre-meeting interactive pulse: collects concerns digitally, hands moderators a ranked summary, feeds the same KB) as slide 5, between Sarina (4) and Town Hall (6). `TOTAL` 13→14; flipped the cream/paper variant on slides 6–13 to preserve the alternating rhythm; renumbered slide comments; updated the file-header story comment ("two front doors" → "three front doors"). Accuracy figure on the NOWOCATS slide deliberately left off (no measured accuracy data; repo forbids fabricated stats) — slide stands on the ~94%-confidence claim only.

**Verify**: typecheck clean. QC PDF rendered locally (14 slides, PulseIQ symmetric with the other two pillars). Local, unpushed.

## 2026-06-19 — Community Feedback deck: reframe around value delivered

**Why**: Per direction, lead with the value an engagement lead is after and weave the capabilities in as the means — and close the gaps a practitioner would notice (representativeness, language access, defensible community-wide synthesis, neutrality). The deck was strong on "how it works" but light on "will it hear everyone, stay neutral, and tell me what the community thinks?"

**What changed** (`lib/decks/communityFeedbackHtml.ts`, 14→16 slides):
- New **objective** slide 8 "Hear from everyone — not just who shows up" (reach: 24×7 + QR; multilingual end-to-end; plain-language + ADA/language-access routing).
- New **objective** slide 11 "Know what the whole community thinks — with the evidence to back it" (pooled themes incl. emergent; sentiment/priorities; geographic hotspots; coverage/"did we hear enough"; folds in report-back: "here's what we heard, here's what we'll do").
- Slide 2 (Challenge): added "Only a few show up" to set up representativeness; list set `tight` to fit 5 items.
- Slide 4 (Sarina): "Always on-message" → "Sourced, neutral, on the record — no advocacy, no promises, no improvisation" (trust for a public/government audience).
- Slide 14 (Benefits) reframed to the value set: Everyone heard · Answers in minutes · Evidence not anecdote · Consistent & neutral · Compounding; `.cases` CSS tightened (padding 13→8, case-n 30→25px + line-height) to fit 5.
- Cream/paper rhythm preserved (two insertions kept parity; only slides 9/10 flipped); comment numbers + `TOTAL` updated; file-header story rewritten around the value arc. NOWOCATS accuracy figure still intentionally omitted.

**Verify**: typecheck clean. QC PDF re-rendered (16 slides, no overflow on the reflowed slides 2/8/11/14). Local, unpushed.

## 2026-06-19 — Community Feedback deck: restructure around the 5 practitioner pains (the spine)

**Why**: The five anxieties an engagement lead actually carries (representativeness, language/accessibility, "did we hear enough", neutrality/accuracy, "did we show them we listened") were the most persuasive content but were scattered/buried mid-deck. Direction: lead with the pains, make them the spine, show we understand each and solve it.

**What changed** (`lib/decks/communityFeedbackHtml.ts`, 16→12 slides, near-total slide-sequence rewrite; helpers + CSS unchanged):
- New slide 2 "Five questions every engagement lead has to answer" names all five pains up front (the thesis).
- Five solution slides (4–8), each headlined by the practitioner's *question*, kicker numbered `// 1 · representativeness` … `// 5 · closing the loop`: (1) reach/representativeness, (2) language access + Title VI/ADA — now its own slide, (3) aggregate synthesis / "did we hear enough", (4) neutrality + accuracy + confidence (merges old accuracy + confidence + Sarina-neutrality), (5) report-back + closed loop.
- Per the channel-slide decision: the 3 dedicated Sarina/PulseIQ/Town Hall deep-dives were **folded into** the "One KB, three ways to engage" foundation slide (3); all three pillars still named + described there and act as the heroes within the solution slides.
- Title + close reframed around answering the five; intake kept as a supporting "under the hood" slide; NOWOCATS proof + value-recap ("Five questions. Five answers.") retained. NOWOCATS accuracy figure still omitted.
- File rewritten via Write (large exact-match Edit infeasible with smart quotes); `TOTAL`=12; cream/paper rhythm clean (12 = ink close).

**Verify**: typecheck clean. QC PDF re-rendered, all 12 slides eyeballed — no overflow on the 5-item thesis, the two-line-head question slides, or the 5-case value recap. Local, unpushed.

## 2026-06-19 — Admin decks: sort most-recently-updated first

**Why**: Decks rendered in hardcoded array order within each audience group, so a freshly reworked deck stayed buried wherever it sat in the list. Most-recent-first is the intuitive order.

**What changed**:
- `app/admin/decks/DecksClient.tsx` — each category's decks now `.sort()` by the per-deck "last updated" timestamp (descending; decks with no known timestamp sort last). Also refreshed the community-feedback-deck card metadata to match the rebuilt deck (12 slides; new five-questions subtitle) — it still read "13 slides" with the old description.
- `app/admin/decks/page.tsx` — added the three `review-intelligence-deck:*` variants to the `lastUpdated` map (they were missing, so they'd have sorted to the bottom with no date). All 17 decks now carry a last-updated time.

**Verify**: typecheck clean. Sort is on a filtered copy (no mutation of the module-level DECKS). Local, unpushed.

## 2026-06-19 — Community deck: make the staff-email-reduction explicit

**Why**: "Sarina is the first line of defense → deflect questions out of staff inboxes → far fewer emails for the team to answer" was a headline ask in the brief, but the pain-led restructure folded away the slides that carried it, leaving it only implicit. Make the team-side operational win explicit.

**What changed** (`lib/decks/communityFeedbackHtml.ts`):
- Foundation slide (3): Sarina card now reads "…so routine questions are handled on the site, **not in a staff inbox**."
- Closing-the-loop slide (8): items reworded to name the deflection payoff — "never becoming an email the team has to answer", "not a shared inbox full of repeats", "one reply, not fifty"; aside now "Far fewer emails reach the team — … the inbox load keeps shrinking." Headline + 5-pain spine unchanged.

**Verify**: typecheck clean. QC PDF re-rendered, slides 3 + 8 eyeballed (no overflow). Local, unpushed.

## 2026-06-19 — Community deck: email burden becomes a top-5 pain; AI-trust demoted to reassurance

**Why**: "Will the AI stay neutral/accurate?" isn't a pain the client has today — they don't use AI yet — so it shouldn't sit among the five questions they actually ask. The real, current pain is the email load: repetitive questions flooding staff inboxes and the pressure to reply in time. Promote that to the spine and give it its own solution slide instead of burying it on the loop slide.

**What changed** (`lib/decks/communityFeedbackHtml.ts`, 12→13 slides):
- Slide 2 (the five questions): Q4 "Will the AI stay neutral and accurate?" → "Can we keep up with the questions?" (email flood + timeliness).
- New solution slide 7 "Can we keep up — without drowning in email?" (Sarina = first line, repetitive Qs never arrive, timely by default, staff handle only the genuinely new). Kicker `// 4 · keeping up`.
- Slide 8 (closing the loop) reverted to a pure listening/report-back focus (capture → answered-for-everyone → "you said we did" → proof their voice mattered); the email-deflection lines moved to slide 7.
- The neutral/sourced/accurate/flagged content kept but relocated to a non-numbered reassurance slide 9 "Built to be trusted in front of the public."
- Value recap remapped: "Trusted answers" → "Fewer emails in / answered in time"; close lede updated. `TOTAL`=13; cream/paper rhythm clean (13 = ink close).

**Verify**: typecheck clean. QC PDF re-rendered, slides 2/7/8/9 eyeballed (no overflow). Local, unpushed.

## 2026-06-19 — Community deck: foreground response consistency

**Why**: Consistency of responses — every resident gets the same approved answer regardless of who's on shift or what they recall — is a huge value of a single-KB assistant, but it was only an implicit aside on the foundation slide (the old "answers are inconsistent" pain was dropped in the restructure).

**What changed** (`lib/decks/communityFeedbackHtml.ts`): slide 9 retitled "One source of truth — consistent, and trusted" (kicker `// consistency + trust`) and now leads with a consistency item — "The same answer, every time… no matter who would have replied, on what shift, or what they remembered" — ahead of sourced / no-advocacy / corrected / flagged. List set `tight` to hold 5 items; dropped the now-redundant aside to avoid overflow.

**Verify**: typecheck clean. QC PDF re-rendered, slide 9 fits (no overflow). Still 13 slides. Local, unpushed.

## 2026-06-19 — Community deck: NOWOCATS next-day public summaries

**Why**: A strong, concrete proof of the near-real-time turnaround — at NOWOCATS the meeting notes + Q&A were published for public consumption the next day, not after weeks of manual write-up.

**What changed** (`lib/decks/communityFeedbackHtml.ts`): NOWOCATS proof slide (11) gains a 5th item "Summaries public the next day" (structured meeting notes + full Q&A cleaned up and posted for the community the next day). Dropped the generalization aside to fit five tight items without overflow.

**Verify**: typecheck clean. QC PDF re-rendered, slide 11 fits. Still 13 slides. Local, unpushed.

## 2026-06-19 — Community deck: final polish + spec catch-up

**Why**: Wrap up the community-deck session and bring SPEC.md current.

**What changed**:
- `lib/decks/communityFeedbackHtml.ts` — NOWOCATS next-day-summary contrast "not weeks later" → "not several days later" (realistic alternative); slide 12 value-recap kicker → "now you can sleep at night", bookending slide 2's "what keeps you up at night". Copy only.
- `SPEC.md` — added `community-feedback` and `review-intelligence` to the admin-only deck-routes list (both were missing) and noted the `/admin/decks` index now sorts most-recently-updated first.

Community deck is in a good state for now: 13 slides, pain-led spine (hear-from-everyone · access/Title VI · heard-enough · keep-up-without-drowning-in-email · listened) + a "consistent & trusted" reassurance slide, any-format intake, NOWOCATS proof (incl. next-day public summaries), and the five-questions/five-answers bookend. Open item unchanged: NOWOCATS *accuracy* figure still omitted (no measured data; would need an LLM-judge eval).

**Verify**: typecheck clean; QC PDF renders 13 slides without overflow. All committed locally; **NOT pushed** (≈18 commits ahead — deck rebuild + admin-decks sort + spec/devlog).

## 2026-06-20 — Public agent display-config endpoint for external embeds

**Why**: External embeds (the datanautix.com chat widget) hardcoded the agent's name, avatar, greeting, and suggestions, so they drifted from the agent's real config. Expose a read-only public surface so embeds render the agent's identity at runtime — the agent config becomes the single source of truth (requested while wiring the datanautix.com widget to the `datanautix` Branded Agent).

**What changed**:
- `app/api/bots/[id]/public/route.ts` — new `GET /api/bots/[id]/public`: unauthenticated, CORS-open (same posture as `/chat`), returns ONLY safe display fields (`name`, `avatarLetter`, `subtitle`, `greeting`, `suggestions`, `placeholder`). Requires `agents.status='active'`. Never exposes system prompt, KB, guardrails, or other private config.
- `docs/BOTS.md` + `SPEC.md` — documented the endpoint in the Agents module overview and the API Routes Summary.
- **Consumer (separate repo `datanautix-homepage`, local commit `7325bba`, not pushed):** the site chat widget (`js/chat-widget.js` + homepage inline copy) now fetches this endpoint on load and applies name/avatar/greeting/suggestions/placeholder, falling back to bundled defaults if unreachable — rendering as the agent (`Sarina@Datanautix` / 🤖) instead of the old hardcoded "Datanautix Assistant".

**Verify**: endpoint tested locally via dev server against the `datanautix` agent — returns name/avatarLetter/greeting/suggestions/placeholder (HTTP 200); widget JS syntax-valid and the contract matches. Committed locally in both repos; **NOT pushed** (the endpoint must deploy to sentimetrx.ai before the live widget picks it up).

## 2026-06-21 — Survey kiosk mode (`?kiosk=1`) for unattended shared tablets

**Why**: Exploring a Ziosk-style "feedback tablet" — a counter/table-top tablet running our existing survey software so guests self-serve feedback (no payment hardware; the checkout tie-in is a receipt-QR / phone-handoff trigger, not us processing cards). The survey's one-response-per-device lock and lack of any reset made a shared tablet unusable for a second guest; kiosk mode fixes that. Owner chose unattended **auto-reset** (vs staff-tapped reset).

**What changed**:
- `components/survey/SurveyWidget.tsx` — split the engine-driven body into a keyed inner `SurveySession` (remount = clean engine state, since the engine is all refs). Outer shell adds kiosk lifecycle: `phase` attract↔survey, `runKey` remount counter, an `AttractScreen` ("tap to begin") between guests, ×1.15 base font, auto-reset ~7s after the closing card, and a 90s idle-abandon → attract.
- `components/survey/useSurveyEngine.ts` — new `kiosk` + `onComplete` props. Kiosk: fresh `session_id` per guest (no `sessionStorage` reuse), the per-device lock (`sentimetrx_completed_*`) is neither read (gate bypassed) nor written, and `onComplete` fires at the closing card to drive the reset.
- `lib/types.ts` — `StudyConfig.kioskAttractHeadline` / `kioskAttractSubtext` (optional attract-screen copy).
- `docs/SURVEYS.md` — documented kiosk entry point + lifecycle.

**Verify**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Not yet exercised in a browser — test at `/s/<guid>?kiosk=1` (tap attract → run → confirm auto-reset to attract, and a second run isn't device-blocked). Committed locally; **NOT pushed**.

## 2026-06-21 — Survey kiosk: Publish-page enablement card

**Why**: Kiosk mode was a remember-the-URL-param feature (`?kiosk=1`). Give it a real home so non-technical operators can turn it on per survey.

**What changed**:
- `app/studies/[id]/deploy/DeployClient.tsx` — new **Kiosk mode** card on the Publish page: the `?kiosk=1` link with copy + "preview in new tab", a dedicated kiosk QR (download), and two inputs (welcome-screen headline / sub-text) that PATCH `study.config.kioskAttractHeadline`/`kioskAttractSubtext` via the existing `/api/studies/[id]` route (`config` already allowed). Inputs use 16px font (iOS no-zoom rule).
- `docs/SURVEYS.md` — noted the Publish-page card as the enablement point.

**Verify**: typecheck clean; dev server compiles the route and `/s/<x>?kiosk=1` serves 200 (no 500). Full browser click-through (attract → tap → run; normal-mode regression) staged in `scripts/_kiosk_verify.mts` — pending a published survey GUID to run against. Committed locally; **NOT pushed**.
