# 2026-W22 — Dev log (Week of May 25 to May 31)

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
