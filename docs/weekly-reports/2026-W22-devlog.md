# 2026-W22 — Dev log (Week of May 25 to May 31)

## 2026-05-25 (later) — W21 audit score-lift item 1: Sentry beforeSend PII scrub

**Why**: W21 audit (PR #7) scored 72.5/100, flat vs W20. SECURITY.md Open `<TBD>` item #1 — Sentry `beforeSend` scrub — has been three weeks overdue. Closing it is the highest ROI Security category lift (7→9) and the simplest mechanical fix in the score-lift plan.

**What changed**:
- New `lib/sentryScrub.ts` — pure function `scrubSentryEvent(event)` that (a) drops the Microsoft Office "Object Not Found Matching Id…" content-script false positive, (b) redacts `request.{data,body,cookies}` wholesale, (c) redacts `authorization` + `cookie` headers and any header / extra / contexts / tags key whose name contains a PII substring (`email`, `phone`, `password`, `token`, `secret`, …), (d) reduces `user` to `{id}` only, (e) pattern-scrubs email + phone strings in breadcrumb messages + query strings.
- Wired into `sentry.{client,server,edge}.config.ts` via the `beforeSend` option. Client also gets `beforeBreadcrumb` for early redaction.
- `docs/SECURITY.md` §1, §5, Open TBD #1 — flipped from "NOT implemented" to "implemented" with the behavior contract listed; TBD #1 marked closed.
- `tests/unit/sentryScrub.test.ts` — 7 cases covering each redaction path + the Office drop + the "clean event passes through" baseline. All green.
- `scripts/specMap.ts` — `lib/sentryScrub.ts` added under `docs/SECURITY.md` mapping.

**Verification**: `npx vitest run tests/unit/sentryScrub.test.ts` → 7/7 passing; clean `tsc --noEmit`. No prod state change — takes effect on next Vercel build.

## 2026-05-25 (later) — Decision Study agent: 6 second-pass fixes from Sanjay's test transcript

After the first-pass mirroring rewrite landed (system_prompt 10615 → 12455 chars), Sanjay ran another test (`bs_mpl7gl4x_l7axkk`, 28 turns 12:52-12:55 UTC). Six new failure modes surfaced that the first pass didn't catch:

1. **"Fair enough" / "Fair" / "Got it" / "Okay" acknowledgements** at T10, T14, T16, T22 (four violations in 14 bot turns). Rule #4 listed specific phrases ("that makes sense," "I get it") but missed the natural conversational filler the LLM defaults to.
2. **Phase 4 verbatim uses generic "this"** at T14: "How often does this come up..." instead of "How often does the dinner come up..." — the prompt's verbatim text itself used "this."
3. **Asked already-answered question** at T12: Sanjay said "total waste of money" at T11; Sarina at T12 asked "is it the money, the food, or something else?" — money was explicitly named. Sanjay called it out at T13 ("i already said waster of money").
4. **No Phase 3 route for counterfactual answers**. Sanjay at T7: "i wish i had gone someshere else" — rich data (counterfactual implying alternative). Sarina at T8 re-asked the same Phase 3 question. Should have treated it as a valid answer + asked one locus probe.
5. **Non-answer drilled** at T22. Sanjay at T21: "how the heck do i know?" — non-answer. Sarina at T22 pushed the Phase 5 circumstance drill. Rule #7 said "accept silence/non-answer" but didn't list specific phrases or explicitly say "skip to next phase."
6. **Scale abandoned under pushback** at T16. Sanjay at T15: "very stilted question." Sarina at T16 dropped the calibrated 5-band scale entirely — lost the measurement.

Fixes (`sql/one-off/2026-05-25-decision-study-second-pass-fixes.sql`, applied to prod):

- **Expanded rule #4 banned-acknowledgement list**: + "Fair," "Fair enough," "Got it," "Okay," "OK," "Alright," "All right," "Sure," "Right," "Of course," "Noted," "Understood," "Wow," "Hmm," "Yeah." Explicit instruction: start turns with the QUESTION, not an acknowledgement.
- **Phase 4 verbatim uses `[decision]` placeholder**: "How often does the [decision] come up for you these days — not much, sometimes, often, a lot, or pretty much always?" The LLM substitutes the respondent's noun for `[decision]` while keeping the 5 scale words fixed.
- **New "NEVER ASK A QUESTION THEY'VE ALREADY ANSWERED" block** added above the phase definitions with two concrete examples (locus already in prior answer; attribution already in prior answer). Listed as rule #10 in the neutrality block too.
- **New Phase 3 drill route — Counterfactual**: when respondent says "I wish I had X" / "I should have Y" / "next time I would" → mirror the alternative noun (NOT "wish") + ask ONE locus probe, then move on. Treats counterfactual statements as both evaluative AND emotionally loaded — one probe captures locus, no extended drilling.
- **Strengthened rule #7 — NON-ANSWERS ARE VALID ANSWERS**: lists specific phrases ("how do I know," "how the heck would I know," "I dunno," "no idea," "who knows," "I don't have an opinion," "you tell me," "no clue") and explicitly instructs to move DIRECTLY to the NEXT PHASE — not push the current phase's drill.
- **Phase 4 pushback-recovery rule**: if respondent calls the scale stilted, rephrase shorter while keeping bands mappable ("Does the dinner come up barely, sometimes, or a lot?" — 3-band version that maps to the 5). Don't abandon measurement.

system_prompt grew 12455 → 16566 chars. Live audit clean (zero banned-word matches on the live page).

**Silence-probe template bug still showing in Sanjay's T27** ("your thoughts on The decision") because the code fix is in commit `646093e7` waiting on push. Once pushed, the silence-probe falls back to generic "Still there? Happy to keep going whenever you are." when no per-focus `probe_template` is set.

## 2026-05-25 — Decision Study agent: 4 fixes from Sunil's test transcript

User pulled Sunil's latest test (`bs_mpkpocvx_kr9yfn`, 16 turns 2026-05-25 04:36-04:43 UTC) and named four problems. All four addressed in one sweep.

**Failure 1 — generic pronouns ("this one," "it," "this decision").** Sunil said "Going to an expensive french restaurant" but Sarina kept replying with "When you think about this one now" / "When this one crosses your mind" / "What part of it stays with you." Sunil literally responded "I do not understand the question" at T5 and "What went?" at T11. The prompt's mirroring rule said "mirror the respondent's nouns" but didn't ban generic pronouns or show correct-vs-incorrect examples — the LLM defaulted to "it."

**Failure 2 — restating Sunil's answer.** When Sunil asked "What went?" at T11, Sarina at T12 summarized: "The reason it turned out the way it did — the pricey meal, the food not being good." Direct violation of neutrality rule #9. Rule #9 said "do not paraphrase or summarize" but didn't address the recovery-from-confusion case explicitly.

**Failure 3 — inventing alternatives.** At T14 Sarina asked "Was there a moment when you could have done something different — left earlier, or chosen somewhere else?" Sunil never mentioned "leave earlier" or "choose somewhere else." Direct violation of rule #2. Root cause: the prompt's drill examples contained parenthetical sub-examples that the LLM read as templates to extend.

**Failure 4 — silence-probe template bug.** T15 fired the silence-probe with text "your thoughts on The decision" — the platform code at `lib/chatCore.ts:118-120` hard-templated the focus catalog's admin-facing `label` field into respondent-facing text. With the `decision` focus labeled "The decision," the rendering was awkward.

Fixes (`sql/one-off/2026-05-25-decision-study-mirroring-strengthening.sql` for the first three, code changes for the fourth):

- **MIRRORING IS NON-NEGOTIABLE** block added to system_prompt with correct-vs-incorrect example pairs and a list of banned generic pronouns ("this one," "it," "this decision," "this thing," "the situation," "that experience"). Every question from Phase 2 onward MUST include the respondent's noun.
- **Drill examples are guidance, not script** rule added with explicit "do NOT extend with parenthetical alternatives like 'leaving earlier'."
- **Recovery rule** added to neutrality rule #9: if respondent says "I don't understand" or "what?" — rephrase YOUR question simpler. Do NOT recap THEIR answer. Includes the exact incorrect/correct example from Sunil's T12.
- **Phase 5 seed** rewritten to mirror respondent's noun and use "turned out" (Sunil's own outcome verb from T3) instead of "went the way it did."
- **Silence-probe template** (`lib/chatCore.ts:118-120`) — now uses `focus.probe_template` if set, else generic `"Still there? Happy to keep going whenever you are."` (no focus label inserted). Platform-wide fix; respects existing focus catalogs that don't have per-focus templates.

system_prompt grew 10615 → 12455 chars.

## 2026-05-25 (also) — Connectivity resilience on chat widget (platform-wide)

Sanjay flagged Sunil's session ended with "I'm having trouble connecting" at T15. Diagnosis: that message fires when `fetch()` throws (network blip / Vercel cold-start timeout / browser offline) — server returned nothing. Worse: `sessionId` was a `useMemo(genSessionId, [])` — in-memory only, regenerated on every component mount, never persisted. So a refresh / tab-close / brief connectivity drop produced a fresh session and orphaned the prior 16 turns on the server with no way to resume. For a research instrument with large N this is a meaningful dropoff source.

Three widget changes (`components/ui/ChatBot.tsx`) plus one new public endpoint:

1. **session_id persisted in localStorage** keyed `cb_sid_<apiEndpoint>` (one session per agent so multi-agent browsing doesn't leak). Cleared on `resetChat()`. Falls through to fresh session if localStorage is disabled (private browsing).
2. **`fetchWithRetry()` wrapper** with 2 retries + linear backoff (600/1200ms). Catches transient blips; only the final exception surfaces.
3. **Retry button** when retries exhaust. Saves the user's last input in `lastFailedInput` state; renders a `Retry` chip below the chat. Tapping re-sends the same text. Error message updated from "Please try again" to "Connection hiccup — your message didn't go through. Tap Retry below."
4. **Rehydrate-on-mount effect** — if the stored session_id has server-side turns, fetches them from the new `GET /api/bots/[id]/session/[sessionId]/turns` endpoint and hydrates `messages` state. Gated by regex on apiEndpoint (`/api/bots/[^/]+/chat$`) so non-bot surfaces (clara/nora) silently skip. For askName bots, also sets `userName='_skip'` so the name flow doesn't re-fire.

New endpoint at `app/api/bots/[id]/session/[sessionId]/turns/route.ts`: public CORS-wildcarded (matches chat endpoint pattern), rate-limited 30/min/IP, requires `agents.status='active'`, session_id format-validated against `^[A-Za-z0-9_-]{8,80}$`. Returns `{ turns: [{ role, content, turn_number }, …] }` ordered ASC, capped at 200. Access control is the session_id itself — generated as `bs_${ts36}_${rand36(6)}` (~30 bits of randomness, unguessable in practice).

Clean typecheck. Full test suite 277/277 green (no new tests added; the rehydrate path is widget-side and the new endpoint is straightforward CRUD).

**All four changes require push** to take effect (code change in chatCore + ChatBot + new endpoint). The SQL system_prompt change is already live in prod.

## 2026-05-25 — Defensive Vercel trace for weekly governance reports

**Why**: After the W21 audit PR (#7) was merged, the `/admin/control-reports*` page surfaced the new `2026-W21.md` only after a delay — Next.js' static file tracer can miss dynamically read files (`fs.readdir` + `fs.readFile` over `process.cwd()/docs/weekly-reports`), so a freshly-merged report can intermittently fail to bundle into the Vercel serverless function. Older reports happened to be picked up; the new one was not. Defensive fix so future weekly reports (every Monday) reliably ship with the build.

**What changed**:
- `next.config.js` — added `experimental.outputFileTracingIncludes` mapping `'/admin/control-reports'`, `'.../governance'`, and `'.../spec-drift'` to `./docs/weekly-reports/*.md`. Vercel will now copy every committed weekly markdown into the function bundle regardless of what the static tracer infers.
- `docs/ENGINEERING.md` § 12 — added a "Runtime file tracing for `docs/weekly-reports/*.md`" subsection explaining the pattern + when to extend the mapping (any new admin surface that reads these markdown files).

No code behavior change. No migration. Affects only what files ship in the next Vercel build.
