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
