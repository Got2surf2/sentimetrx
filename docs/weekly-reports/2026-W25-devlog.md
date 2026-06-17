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
