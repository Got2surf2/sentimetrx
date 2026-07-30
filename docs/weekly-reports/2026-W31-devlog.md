# 2026-W31 devlog (Jul 27 – Aug 2)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## chatCore: pair `org_id` on the `last_session_at` update (Jul 27)

WHY: W31 governance (PR #26) carried this MEDIUM forward from W29/W30 — `lib/chatCore.ts:1857` did `service.from('agents').update({ last_session_at }).eq('id', bot.id)` with no `org_id` pair, violating the CLAUDE.md multi-tenancy invariant ("service-role queries must pair id with org_id"). Not reachable cross-tenant in practice (`bot` is loaded after auth gating, so `bot.id` is already org-verified), but the invariant is a class-level safety net and this was the last bare-id **write** in chatCore. `bot.org_id` was already in scope one line above (the `logUsage` call). tsc clean, 1576 tests green.

## Ops: `npm audit fix` evaluated and REJECTED — does not fix the W31 CVEs, and inflates the audit surface (Jul 27, no commit)

WHY: W31 governance lists 4 high CVEs and prescribes `npm audit fix` as a 5-minute fix. Ran it; it is **not** a fix. Two findings, both verified rather than assumed:

1. **The headline Next.js CVEs are not currently fixable.** `npm audit fix` bumps next 16.2.10 → 16.2.12 and reports success, but the advisory range is `14.3.0-canary.0 – 16.3.0-preview.7` — **16.2.12 is still inside it**, and 16.2.12 *is* `latest` on npm. The only builds past the range are `preview` (16.3.0-preview.9) and `canary`. So there is no released version that clears `GHSA-6gpp-xcg3-4w24` (proxy/middleware bypass — relevant to our `proxy.ts` CSRF gate), the Server Actions DoS/SSRF, or the cache-confusion advisory. npm's own post-fix suggestion is to *downgrade* to next@14.2.35 (`isSemVerMajor: true`), which is not on the table. Correct posture: **wait for 16.3.0 stable**, then upgrade deliberately.
2. **The fix made the audit metric worse: 6 vulns → 27.** Verified this is our change and not an advisory-DB refresh, by re-auditing the pristine `HEAD` lockfile in a scratch dir against the same DB *at the same moment*: it still reports 4 high / 6 total. The bumps re-materialize nested `brace-expansion`/`minimatch` copies under `@oclif/core`, `@vercel/queue`, `@typescript-eslint/*`, `filelist`, `readdir-glob`, `workflow`, which cascades "vulnerable dependency" status up into 24 additional parents (eslint, eslint-config-next, exceljs, archiver, ejs, jake, rimraf, glob…).

Lockfile reverted (`git checkout package-lock.json && npm ci`); `npm audit` back to 4 high / 6 total, `package.json` untouched. What `npm audit fix` *does* legitimately clear is only `fast-uri` (high) plus the `body-parser`/`dompurify` lows — reachable via targeted `overrides` (the pattern package.json already uses) **if** we want them, but deliberately not done unilaterally: an override on `dompurify` sits on the pinned `isomorphic-dompurify`/`jsdom@26` cluster that we have a standing do-not-bump constraint on. Owner decision.

**Correction for the governance report:** W31 lists DOMPurify as one of the 4 highs. It is **low**; the actual 4th high is **`sharp` <0.35.0** (transitive via next), which W31 omits entirely.

## Deps: targeted `overrides` for fast-uri + body-parser — the safe subset of the rejected audit fix (Jul 27)

WHY: Follow-up to the `npm audit fix` rejection above. Of the six advisories, three were genuinely fixable by a patch bump; the blanket fix was unusable because it also de-hoisted `brace-expansion`/`minimatch` into 24 new flagged parents. Pinning the two clean ones directly via `overrides` (the pattern package.json already uses) gets the win without the cascade:

- `fast-uri` 3.1.3 → **3.1.4** (high, GHSA-v2hh-gcrm-f6hx host confusion) — transitive via `@sentry/nextjs` → webpack → schema-utils → ajv.
- `body-parser` 1.20.5 → **1.20.6** (low, GHSA-v422-hmwv-36x6 DoS) — transitive via `workflow` → `@workflow/cli` → `@workflow/web` → express.

**`dompurify` deliberately left alone** (low, 3.4.11 → 3.4.12 available). It sits on the pinned `isomorphic-dompurify`/`jsdom@26` cluster that carries a standing do-not-bump constraint; a 1-severity-low gain is not worth poking it. Owner call, deliberately deferred.

Result: `npm audit` **6 → 4** (4 high → 3 high, 2 low → 1 low). Remaining: `next` + `sharp` (no released fix — see above) and `brace-expansion`. Lockfile diff is **2 package entries / 12 lines**, vs 26 package paths for the blanket fix — the containment is the whole point. Verified beyond the usual gates: `npm run build` run locally because both packages live in the *build* toolchain (webpack schema validation / CLI express), where unit tests exercise nothing. tsc clean, 1576 tests green, build succeeded.

## Repo hygiene: archive 4 delivered one-off generators + close the `scripts/_*.mts` gitignore gap (Jul 28)

WHY: `git status` had accumulated 40 untracked files, which makes it impossible to see at a glance whether real work is uncommitted. Two distinct causes, two fixes:

1. **`.gitignore` covered `scripts/_*.{ts,mjs,js,sql,json}` but not `.mts`.** The active verify/backfill harnesses (`_verify_*.mts`, `_backfill_*.mts`, `_spacy_kb_*.mts`, `_copy_townhalls_prod_to_test.mts` — 35 files) are deliberately untracked per the convention in `scripts/oneoff/README.md`, but every one of them showed as `??` because the ignore patterns predate the `.mts` extension. Added `scripts/_*.mts` so the documented intent actually holds.
2. **Four delivered generators were still sitting in `scripts/oneoff/` untracked.** The convention (gitignore comment + `scripts/oneoff/README.md`) is: one-offs start untracked in `scripts/`, then move to `scripts/oneoff/` **committed** once the work ships, as the provenance trail for regenerating a delivered artifact. All four shipped and were never archived: `_nowocats_recap_deck.ts` (VHB engagement recap PPTX, 7/27), `_kimleyhorn_public_engagement_brief_pdf.ts` (partner brief v2, 7/28), `_ppfl_canvasser_onepager_pdf.ts` (delivered 7/14), `_ppfl_proposal_deck.ts`. Secret-scanned before staging; all four read env from `.env.local` like their 90 tracked peers.

Also lands the orphaned `docs/ENGINEERING.md` §6 addition (written 7/15, left unstaged by a parallel session): the **pptxgenjs `shadow` corruption** gotcha. `shadow` on `addText` serializes out-of-range OOXML values *and* mutates the passed options object, so corruption compounds across slides that reuse it — LibreOffice renders it fine (so pixel-QC passes) but PowerPoint declares the file corrupt and strips shapes. Discovered on the PPFL proposal deck, whose `shadowText()` offset-copy workaround the doc now cites — which only works as a reference because the deck script is now tracked.

`next-env.d.ts` churn (`.next/dev/types` ↔ `.next/types`, flips between `next dev` and `next build`) reverted, not committed — the committed variant is the CI-green one.

## CI fix: HelpWidget lint ratchet 253 → 252 (Jul 28)

WHY: The 16-commit push reddened CI on the lint ratchet (`eslint . --max-warnings 252` reported **253 problems, 0 errors**); production deploy correctly skipped, nothing shipped. Localized the single new warning by diffing per-file counts between `origin/main` (a8f83505) and HEAD across the only three changed files that appear in CI's warning list: `ReportClient.tsx` 6→6, `TranscriptReview.tsx` 1→1, **`components/ui/HelpWidget.tsx` 0→1**. Since CI enumerates every warning by file and no other changed file appears, that accounts for the whole delta.

The warning is `react-hooks/set-state-in-effect` at the sessionStorage hydration effect added by `cc70a9ef` (conversation continuity across nav). Applied a scoped `eslint-disable-next-line` with a concrete reason rather than a refactor, because: the effect has `[]` deps so it runs exactly once and cannot cascade (the failure mode the rule exists to catch); `sessionStorage` cannot be read during SSR, so the lazy-`useState`-initializer alternative would produce a **hydration mismatch on a widget mounted in TopNav on every page**; and CLAUDE.md flags `react-hooks/*` as behavior-sensitive — not to be churned without per-file browser verification, which isn't available here. The disable is behavior-identical on a widget already live in prod.

**Ceiling stays at 252 — not raised.** `npm run lint:ci` still cannot be run locally (`eslint .` OOMs the heap even at `--max-old-space-size=8192`, as documented); only CI enforces the full count. Per-file `npx eslint components/ui/HelpWidget.tsx` is clean.

## Agents: embed-URL provenance capture — `?source=/&medium=/&campaign=` → impressions + conversations (Jul 30)

WHY: Prompted by a Kimley-Horn integration question, but the capability is worth more than that one deal: there was no way to tell whether a participant reached an agent from a postcard QR, a QR placard at a live meeting, an email link, or a partner site embedding us. Every conversation looked the same in reporting.

Most of the pipe already existed and had for months — `agent_impressions` has carried `source`/`medium`/`campaign` columns since sql/095, the public impression beacon already writes them, and `ChatBot` already sent them on the widget-open POST. The `conversations` table has the same three columns too. **Nothing populated any of it.** `BotClient.tsx` only ever set `extraBody` from the allowlisted `?site=` param, so `medium`/`campaign` were `undefined` on every request ever made and `source` only ever carried the two hardcoded Hope values. This closes that last hop and adds the conversation-row half.

- **`lib/attribution.ts`** (new) — shared sanitizer. Trim, 80-char cap (matching the cap the impression route already applied), reject empties. Accepts bare names and `utm_*` aliases, bare winning; used by client, server, and tests.
- **`BotClient`** merges parsed attribution into `extraBody` alongside `site`. **`ChatBot`** beacon now prefers an explicit `source` over the legacy `site`, keeping `site` as fallback so the two Hope agents attribute exactly as before.
- **`chatCore`** re-cleans the body server-side and threads an `attribution` object through all 8 `mirrorTurns` call sites; **`phase3DualWrite`** writes only the keys present.

**Security note, deliberately different from `?site=`.** `?site=` is allowlisted because it lands *in the system prompt*; letting a URL put free text there is prompt injection from an untrusted party. Attribution never reaches the model — it is stored as data — which is precisely why it needs no allowlist. Sanitization is applied client-side *and* re-applied server-side, because `/api/bots/[id]/chat` is public and cookie-free and anyone can POST it directly (the tests cover non-string junk and over-long values posted straight at the API).

**The load-bearing guarantee is that a later turn cannot blank out earlier attribution**, since `upsert` compiles to `ON CONFLICT DO UPDATE SET <provided columns>` and we omit absent keys. A mock can only assert payload shape, so that claim is verified against the real TEST database in `scripts/_verify_attribution.mts` (untracked KEEP): first turn stamps, no-attribution turn preserves, partial attribution touches only its own key. 16/16 checks pass. 14 new unit tests (1590 total), tsc clean, no lint delta (ceiling stays 252).

Works for plain links and QR codes with **no partner integration at all** — the iframe case is one consumer, not the requirement.

**Known gap, not addressed here:** `totals.impressions` is read by the Agent Study report (`ReportClient.tsx:224` renders a "Widget Opens" tile) and the deck, but I could not find the code that populates it, and there is no view or RPC over `agent_impressions`. So the table still looks write-only and that tile likely never renders. Capture is now correct end to end; **surfacing it in reporting is a separate piece of work.**

## Agents: surface the provenance breakdown — "Where They Came From" in report, HTML export, and deck (Jul 30)

WHY: Capture landed yesterday but nothing read `source`/`medium`/`campaign` back out, so "which QR code is working" was still unanswerable. `AgentStudy` gains `attribution[]` — one row per `(source, medium, campaign)` tuple over 31 days with opens, conversations started, and a conversion rate, busiest first — rendered in all three study consumers.

**Correction to yesterday's entry, which claimed `totals.impressions` is read but never populated.** That was wrong. `agent_impressions` is fully wired and always has been: `computeHealth` derives `opens7d`, `responseRatePct`, and the daily `opens` series from it, and `buildStudy` sets `totals.impressions` and `openedNotEngaged`. The "Widget Opens" tile does render.

**The claim came from a grep that silently matched nothing because `lib/agentStudy.ts` was classified as a binary file.** Line 195 used two literal control bytes (U+0000 and U+0001) as hash delimiters inside the `kbSignature` template literal. `grep` prints "Binary file matches" and lists no lines, so absence-of-output read as absence-of-code. Replaced the raw bytes with their ` ` / `` escape sequences: the string value is identical, so the hash and every cache key it feeds are unchanged, but the file is now valid UTF-8 and greppable. **Worth remembering as a general hazard — a silent grep miss is indistinguishable from a real absence, and `file <path>` is the check.**

The genuine gap was narrower than stated: impressions were only ever selected as `created_at`/`id`, so the *attribution columns* had no reader. That is what this closes.

Design choices worth keeping: opens ride the **existing** beacon select (three more columns, no extra round trip); untagged traffic keeps its own row in the report and HTML export so columns reconcile to the 31-day totals, but is omitted from the deck where it reads as noise on a client slide; the conversations read is deliberately **not** behind `isPhase3ReadSafe()` like the turn reads beside it, because attribution only ever lands in `conversations` and prod runs dual-write on with `READ_PHASE3` off — reading directly means the breakdown works without flipping the read switch. Rate is capped at 100% and null at zero opens, since a blocked beacon can leave conversations without a matching open and a 140% cell reads as a bug.

`STUDY_SCHEMA_VERSION` v7 to v8 so caches predating the field recompute instead of rendering empty; renderers still guard `|| []`. 9 new unit tests (1599 total), tsc clean, no lint delta (ceiling 252). Real-schema read path verified in `scripts/_verify_attribution.mts` (now 23 checks) — a typo'd column would pass every mock test but fails there.

## Town Hall: "heard as…" field ate its own separators, so only one variant per term was ever possible (Jul 30)

WHY: Owner reported that on the transcript ASR-correction panel, adding to the mis-heard variants "only accepts characters" and not separators. Reproduced from the code: the field is comma-separated, but it parsed on every keystroke — `value` came from `variants.join(', ')` while `onChange` did `split(',').map(trim).filter(Boolean)`. Typing a comma made an empty trailing entry, `filter(Boolean)` dropped it, and the re-join immediately erased the comma. Letters survived; separators did not. **Net effect: only the first mis-hearing per term could ever be entered** — which quietly caps the value of the whole correction feature, since a name the ASR mangles usually gets mangled several different ways ("Vick Road" heard as "Big Road" *and* "Vic Road").

Fix is the standard controlled-input draft pattern, and the codebase already had it: `app/pulseiq/[sessionId]/SessionDetailClient.tsx:2358` keeps a raw string and splits `onBlur`. The row now carries an optional `variantsText` draft, `onChange` writes only the draft, `onBlur` parses into `variants` and clears it. `saveEnts` commits any pending draft defensively (a save not triggered by clicking the button wouldn't have blurred) and rebuilds each row so the draft field never reaches the POST body.

Swept the class rather than fixing the one report: the only other `value={…join(…)}` controlled input is a read-only `<Row>` display in `components/creator/StepReview.tsx`, and the only other split-in-onChange (`NewSessionClient.tsx:369`) already keeps a separate raw draft. **One occurrence, now fixed.**

Server side was never the constraint — `sanitizeEntries` only trims and caps at 120 chars, so digits/hyphens/periods (`US 441`, `Plymouth-Sorrento`) were always accepted. tsc clean, 1599 tests green, no lint delta (ceiling 252). NOT browser-verified — the interaction needs a click-through on a real recording's Transcript tab.

## Town Hall: share panel visible to admins, and the public link is now the whole meeting (Jul 30)

WHY: Owner couldn't find the share control, then found the shared page was only a one-page summary when the goal was sending VHB the full NOWOCATS June meeting. Two separate problems.

**1. The "Public link" panel was gated on `isOwner` alone** — `recording.created_by === ctx.userId`. A platform admin opening a meeting someone else uploaded saw no share control and nothing explaining why. This was inconsistent on both sides: every other editable tab on the same report already used `isOwner || isAdmin`, and `POST /api/recordings/[id]/share` accepts **any member of the owning org**. The UI was strictly narrower than the API it calls. `ExportTab` now gets `isOwner={data.isOwner || data.isAdmin}` (which also unhides the sibling "Brand & linked agent" panel, same prop, same rationale). Still narrower than the endpoint — non-admin org members remain excluded; noted in RECORDINGS.md §4.7 for whenever that gap bites.

Related and worth recording: I sent the owner looking for an "Export & Share" tab. **That tab does not exist** — it's a code comment; the nav label is **Reports**. Exactly the mistake `feedback_use_ui_labels` exists to prevent.

**2. `/th/[token]` rendered a single-scroll summary.** It now mirrors the internal report's tabs — Presentation · Q&A · Action items · Participation · Transcript — through a new `PublicTabs.tsx` client shell that owns *only* which server-rendered section is visible, so no report data or fetching logic crosses into the client bundle. Sections are conditional; the tab bar disappears when one survives.

**Coverage and "Live vs Final" are deliberately excluded** (owner-confirmed). Both describe how the report was produced — analyst QC state, flagged-for-review counts, raw-vs-corrected ASR — rather than what happened at the meeting, and neither belongs in front of an external audience. The exclusion lives in `page.tsx`, not in `PublicTabs`, so the shell can't accidentally widen it.

Transcript is the **entity-corrected** view via the same `normalizeSegments` the internal tab uses, never raw ASR; participation reuses the pure `computeParticipation` and renders stats + share bars with no playback or editing controls.

Verified against the running dev server on two real shared NOWOCATS reports: both HTTP 200, all four applicable tabs present, bogus token still 404s, and a leakage grep for `flagged_for_review` / `confidence` / `cost_cents` / `org_id` / `Coverage` / `Live vs Final` returns **0 on every term**. The Presentation tab is correctly absent on both — each has `proceedings_summary = NULL` — which also means that one section is typecheck-verified but not yet seen rendered. Page weight went 80 KB to ~330 KB now that the transcript is inline; fine at meeting scale, noted in the spec as the thing to revisit for multi-hour meetings. tsc clean, 1599 tests, no lint delta.

## Town Hall: raw float percentage on the public Participation tile (Jul 30)

WHY: Owner screenshot — the "Largest share" tile read **32.2567940133911%**. `computeParticipation` returns raw floats on purpose and every consumer rounds at render (`ParticipationTab.tsx:51` does `Math.round(model.topSharePct)`); the public section I added yesterday rounded the per-speaker rows but interpolated `model.topSharePct` straight into the tile. My bug alone — the internal tab was already correct, so there was no class to sweep.

Speaker rows show **whole percents too** (owner call, after seeing a first pass that borrowed the internal tab's `>= 9.5 ? round : toFixed(1)` rule). A column mixing "32%" and "3.2%" reads as inconsistent to an external audience, and the talk time beside each row already separates entries that round to the same percent — so consistency wins over the extra digit here. The internal tab keeps its decimal; that's an analyst view with different priorities.

Verified by diffing the rendered HTML before and after: `32.2567940133911%` is present in the prior render and absent now, with `32%` in its place. tsc clean, 1599 tests, no lint delta.

## Town Hall: align the public Participation time/percent column (Jul 30)

WHY: Owner screenshot — the right-hand column read ragged. Time and percent shared one right-aligned span, so with "13:39" (5 chars) next to "7:38" (4 chars) the separator and the `%` drifted horizontally down the list even though the right edge lined up. Split into fixed-width columns (`w-11` time, separator, `w-8` percent) with `tabular-nums`, so the dots and percents form clean vertical rules.

## Town Hall: the public share link IS the report now — ReportClient in publicMode (Jul 30)

WHY: Owner: "the internal view allows a much more interactive experience but the shared doesn't — ideally the shared one should be the same as the internal one without the reports tab." The hand-built public page from earlier today was already drifting from the internal report, so `/th/[token]` now renders the **same `ReportClient`** in a new `publicMode` instead of a parallel implementation. Deleted `PublicTabs.tsx` and the bespoke section builders.

**Three mutation controls had no edit gate at all** and rendered for anyone: QATab's "Re-extract all", its per-topic `⋯` re-extract menu, and QACard's scope / hand-edit / regenerate / mark-reviewed cluster. Harmless while the report was login-only, a hole the moment the component serves a public route. `QATab` and `QACard` now take `canEdit`, computed **once** in ReportClient as `!publicMode && (isOwner || isAdmin)` and passed down — never re-derived. Owner confirmed mid-build: "no editing, no re-transcribe for sure."

**The RSC-payload leak was the real find.** `ReportClient` is a client component, so anything on `data.recording` is serialized into page source and readable in view-source *whether or not a tab renders it*. Passing the `select('*')` row published the sign-off reviewer's note, `confidentiality_class: client_confidential`, internal objectives, and the share token; the transcript row carried `raw_response` (entire ASR vendor payload) and `cost_cents`. Now an **allowlist**, never a denylist, so a future column can't silently become public. Page weight fell ~2.3 MB → ~207 KB as a side effect.

**Coverage and Live vs Final are out after all** — and the owner's own reaction is why. Coverage rendered four agenda items at 0 with ⚠ gap markers. I checked the data before removing anything: not a bug. Those four are *presentation sections* ("Welcome and Opening Remarks", "Study Methodology") that never draw audience questions, while the actual Q&A had landed on emergent topics (US 441 Corridor Congestion, Multimodal Transportation). Correct analysis, but publicly it reads as "this report missed 4 of 7 agenda items." Also learned: **dropping a tab from the nav is not enough** — `tab` state drives the body and the internal default is `coverage`, so publicMode overrides the default and rejects internal keys via `?tab=`.

**Audio: opt-in per meeting** (`recordings.share_audio`, sql/185, default false, applied to TEST). New `GET /api/th/[token]/audio` authorises by share token instead of session and fails closed on six conditions; an enabled link with `share_audio=false` still 404s, so publishing the written report never implies publishing residents' voices. Toggle sits beside Polished/Verbatim in the Reports tab. Verified both directions against TEST: off → 404, on → 200 with a 30-min signed URL scoped to that one mp3.

Also made the internal ParticipationTab use whole percents, so it can't disagree with the public view now that they're the same component.

Verified on the running dev server: public report renders 200 with exactly Q&A · Action items · Participation · Transcript, and an audit for `re-extract` / `regenerate` / `sign off` / `mark reviewed` / `re-transcribe` / `edit setup` / scope controls / `confidentiality_class` / `client_confidential` / `cost_cents` / `raw_response` returns **0 on every term**. Internal report still gated (307 to login). tsc clean, 1599 tests, no lint delta on any touched file.

**⏭ ON PUSH: `npm run migrate sql/185_recordings_share_audio.sql`.** Still unverified in a browser: the Presentation tab (both shared TEST meetings have `proceedings_summary` NULL) and click-to-play with audio enabled.

## Town Hall: audio player follows the speaker (Jul 30)

WHY: Owner, on the modal player — "would look fantastic if the top label changed to match who is speaking; be great if we can also change the background between speakers or add a speaker-change marker."

Three fixes, one root cause: **the player knew nothing about speaker identity.** It received only `segments`, so (a) the header showed `req.label` — whoever was speaking when the player was *opened* — and went stale the instant playback crossed into another voice, and (b) the follow-along rows printed raw diarization labels (`S2`, `S5`) even though the recording had real names mapped.

- **`speakerNames` + `channelLabels` are now passed into `AudioModal`**, with a local `nameOf()` resolving channel label → speaker-name map → raw label. Same precedence the transcript and participation views use. Not extracted to a shared helper: `TranscriptReview`'s equivalent resolves against *editable local state*, a genuinely different concern.
- **Header tracks the playhead** — resolved current speaker + live timestamp, with the original label demoted to context above it.
- **Speaker-change marker + banding.** Each change of speaker gets a header row (name, rule, timestamp) and the block gets an alternating tint. Banded by **run, not identity**, so two speakers can never land on the same shade back to back — identity-banding would put the same colour on adjacent speakers whenever a third one spoke between them.

Lint gotcha worth remembering: the first version computed the banding inline via an IIFE with a mutable counter (`(() => { let runIdx = 0; return (...) })()`), which pushed `react-hooks` to flag the `ref={active ? activeRef : undefined}` inside it as "Cannot access refs during render" — 6 → 7 warnings. Precomputing the rows in a `useMemo` fixed it and is cleaner. Back to 6, no delta.

Verified both surfaces still render (public 200, internal 307 to login). tsc clean, 1599 tests.

## Town Hall: corrected transcript everywhere text is displayed (Jul 30)

WHY: Owner spotted "441 and Plymouth-Cemento Road" in the audio player — "let's show the corrected transcript because they can use the transcript to make corrections to errors that still exist; always use the corrected transcript including in the hovers."

The correction already existed. This meeting's entity map carries canonical `Plymouth Sorrento` with variant `Plymouth-Cemento` (a *separate* entry from `Plymouth Sorrento Road`, which is why a first look at the map suggested it was unmapped). The report, PDF and deck have applied on-read normalization since 2026-06-17 — the **in-app surfaces that render raw segments never did**: the audio player's follow-along, action-item source hovers, coverage drill-downs, and the Participation floor-ribbon tooltip, which shows up to 400 characters of the turn. So the one place they actually listen and hunt for errors was the one place still showing raw ASR.

`ReportClient` now derives `correctedSegments` / `correctedTranscript` once and passes them to every text-displaying consumer. Verified against the real TEST transcript: 22 of 46 variant rules fire on this meeting, and segments containing "Cemento" go 3 → 0 after normalization.

Two deliberate exceptions keep RAW, both recorded in RECORDINGS.md §3.5b: the **Transcript tab** (`TranscriptReview` owns the corrected/raw toggle and needs raw to offer it — normalizing its input would make "Raw" show corrected text) and **Live vs Final** (it diffs live ASR against final ASR; entity corrections would show up as ASR improvements and misrepresent it).

Note the workflow this completes: the player now shows corrected text, so what remains visible is genuinely unmapped — and the "heard as…" field fixed earlier today is where those get added. tsc clean, 1599 tests, no lint delta.

## Town Hall: reassign a speaker from the audio player (Jul 30)

WHY: Owner hit a mis-attributed block in the player and asked for drag-to-reassign on a participation-style bar — "or do you want to check the transcription algo, it feels like these edge cases break fairly frequently."

**Checked the algo question first, and the answer is no.** This recording is `audio_channels=1` with **0 of 760 segments carrying a channel**, so speaker identity is 100% ASR-vendor voice clustering — we have no knob. It found **11 speakers where Participation shows ~9**, i.e. over-splitting, and the failures in the screenshot are two-second utterances ("Right.", "And that's just at the intersection.") which is precisely where clustering breaks. The structural fix is **capture, not code**: `computeParticipation` already prefers channels when `audio_channels >= 2`, so a panel mic + an audience mic makes identity deterministic and deletes this failure class for future meetings. Worth doing regardless of any UI.

Reassignment already existed (Transcript tab → edit mode → per-segment select, plus split/merge/nudge and fill-same-speaker-gaps), so this was about *where*, not *whether*. Pushed back on drag-on-the-ribbon: it aggregates runs over time, so the short segments that actually get misassigned are sub-pixel targets at meeting scale — the interaction would be hardest exactly where it's needed. Owner chose player-rows now, ribbon later as a bulk surface.

`AudioModal` gains a **"move block →"** select on each speaker-change header (reassigns the whole run in one call — the common failure) and a hover-revealed per-line select for a single stray segment. Both target an **existing diarization label**, not free text, so the speaker stays joined up with participation and the roster. Persists via the existing `PATCH /transcript` `{ edits: [{ index, speaker }] }`; indices are RAW-array positions, which line up because `correctedSegments` is a 1:1 map.

Both controls gated on `canEdit`. Verified the public report renders **zero `<select>` elements** and the PATCH route 403s unauthenticated. tsc clean, 1599 tests, no lint delta.

**⏭ DEFERRED: the participation-ribbon drag surface** for bulk run-level editing — wants a zoom control to be usable at meeting scale.
