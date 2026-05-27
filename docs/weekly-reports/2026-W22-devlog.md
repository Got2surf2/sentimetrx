# 2026-W22 — Dev log (Week of May 25 to May 31)

## 2026-05-25 (later) — NOWOCATS facilitator Save blocked on every edit (slug lock)

**Why**: User flagged `Save failed: slug edit on phase-3 town halls not yet supported` on the NOWOCATS (Sarina) facilitator setup at `/townhall/<id>`. Diagnosis: `SessionDetailClient.tsx::saveEdit` was sending `slug` in every PATCH body unconditionally — initialized from `session.slug` when the editor opened — so the server's phase-3 guard fired even when the facilitator didn't touch the field. NOWOCATS postcards have already been mailed with the participant URL printed on them, so the slug is operationally locked anyway. The 405 isn't a missing feature — it's a guardrail. The bug is the client sending an unchanged value.

**What changed**:
- `app/townhall/[sessionId]/SessionDetailClient.tsx::saveEdit` — only includes `slug` in the PATCH body when `trimmedSlug !== (session.slug || null)`. Unchanged-slug saves now go through.
- `app/townhall/[sessionId]/SessionDetailClient.tsx` Step 0 input — renders `readOnly` + greyed-out + a "URL is locked — printed materials reference this slug" caption when `session.__substrate === 'phase3'`. Legacy substrate retains full slug-edit. The marker comes from `lib/townHallAdapter.ts` which already emits `__substrate: 'phase3'` on the JSON payload.
- `docs/TOWNHALL.md` phase-3 PATCH block — calls out the slug-edit lock as deliberate (postcard / QR / signage protection), describes the readOnly UI surface, and documents the redirect-table follow-on path if a customer ever needs slug-renames.

**Out of scope**: the full slug-edit + redirect feature (sql/088 `previous_slugs text[]`, server UPDATE + 23505→409 translation, `app/th/[slug]/page.tsx` fallback). Tracked in TOWNHALL.md as a future commit; not needed for NOWOCATS or any other customer today.

**Verification**: clean `tsc --noEmit`. No tests added (UI-only fix; the server-side 405 stays in place and is its own future test surface).



## 2026-05-25 (later) — W21 audit score-lift item 7 (optional bonus): tests for four under-covered surfaces

**Why**: W21 audit scored Tests 4/10 (headroom 0.9 pts × 15% weight = largest single category for an audit lift, but slowest to land). The 7 new sentryScrub tests in item 1 covered the new surface that landed today; the remaining tests in the queue's item 7 list (`nameExtractor`, `probeFocusClassifier`, `/api/admin/usage/[type]/[id]`, `/api/respond` partial save) were optional bonus.

Shipped three of the four because mocking patterns were already established (`personaExtractor.test.ts` for callAI, `decks.test.ts` for admin-gate, etc.) — adding them was mechanical. `/api/respond` partial save is its own session (state-transition logic against status enum + supabase row updates, more setup).

**What landed**:
- `tests/unit/nameExtractor.test.ts` — 14 cases covering (a) input gating (empty array, ≤3-char-floor messages, ≤10-char corpus → AI not called), (b) clean self-id parsing, (c) markdown-fenced JSON unwrap, (d) defense-in-depth (denylist `Anonymous`/`User`/pronouns; sentence-fragment rejection; >30-char rejection; hyphen/apostrophe acceptance with lowercase-after constraint), (e) source/confidence enum normalisation, (f) graceful fallback on AI throw / malformed JSON / non-JSON text.
- `tests/unit/probeFocusClassifier.test.ts` — 13 cases covering (a) gating (zero focuses → no AI; <12 chars → no AI; <3 words → no AI; disabled focuses filtered), (b) single + comma-separated parsing, (c) NONE handling (mixed-case), (d) hallucinated-slug drop (slugs not in catalog rejected), (e) dedup within response, (f) bracket / quote / newline tolerance, (g) lowercase normalisation, (h) AI-throw + whitespace fallback.
- `tests/integration/admin-usage-detail.test.ts` — 8 cases covering (a) `requireAdmin` 404 passthrough for anon, (b) `VALID_TYPES` allowlist (rejects unknown resource_type with 400), (c) all 6 documented types accepted, (d) totals + by_event + by_model + daily_trend aggregation from a 3-row fixture, (e) zero-rows graceful response, (f) `from`/`to` window with computed `days`, (g) `days=N` fallback when from missing, (h) resource-name fallback to id-prefix when lookup returns null.
- `docs/TESTING.md` — layout tree + What-we-test table extended.

**Verification**: full suite **319 passed / 54 skipped** (was 277 at session start; +42 new tests across 4 new files). Clean `tsc --noEmit`.

**Net W21 audit score-lift this session**: items 1-6 land + bonus tests. Expected Tests category lift ~+0.4 pts on top of the +5 from items 1-6. Estimated total: 72.5 → ~78.

## 2026-05-25 (later) — W21 audit score-lift item 6: `npm audit fix` brace-expansion DoS CVE

**Why**: W21 audit Dependencies category sat at 7/10 with three open CVEs (one HIGH Next.js Image Optimizer DoS, two MEDIUM — postcss XSS + brace-expansion DoS). Two of the three are transitive via Next (postcss + most of the Next CVEs); patching those requires a Next major upgrade (`14 → 15/16`) which is its own scoped project. The brace-expansion CVE is fixable without that jump.

**What changed**:
- `npm audit fix` (non-force) bumped `brace-expansion` from `5.0.5` → `5.0.6` at two nested locations (`@fastify/otel`, `@sentry/bundler-plugin-core`). Closes GHSA-jxxr-4gwj-5jf2 ("Large numeric range defeats documented max DoS protection").
- `package-lock.json` updated. `package.json` unchanged (transitive).

**Out of scope** (deferred to a dedicated Next-upgrade session):
- next 14.x → 16.2.6 (breaking change) — closes 14 Next CVEs incl. the HIGH Image Optimizer DoS, plus the transitive postcss XSS.
- The HIGH Image Optimizer DoS (`GHSA-9g9p-9gw9-jx7f`) is partially mitigated in prod by Vercel's managed image-optimization runtime; the self-hosted exploit path doesn't directly apply.

**Verification**: clean `tsc --noEmit`. Full test suite **284 passed / 54 skipped** (was 277 — gain from the 7 new `sentryScrub.test.ts` cases added in item 1).

W21 audit score-lift item 6/6 — Dependencies +0.5 pts.

## 2026-05-25 (later) — W21 audit score-lift item 5: verify absorbed MCO parallel-session WIP

**Why**: W21 audit Recommendation #3 — "Typecheck + smoke-test the absorbed MCO parallel-session WIP before any MCO demo deployment." Coordination commit `49e7b9b` had absorbed `lib/places.ts`, `lib/parking.ts`, `lib/securityWait.ts`, the four `/api/mco/*` routes, and the `/demo/mco` canvas without review or test. This item closes that loop.

**Verification performed**:
- `npx tsc --noEmit` — clean.
- `npx vitest run tests/unit/uiHints.test.ts` — 47/47 passing (the canvas's intent-extraction layer).
- Code review of the four MCO routes (parking, places, security, handoff):
  - All set `dynamic = 'force-dynamic'` (correct — these read live data).
  - All CORS-open with `Access-Control-Allow-Origin: *` + OPTIONS handlers (correct — the canvas is on a different origin in some demo contexts).
  - `/places` POST validates input: `place_ids` array filtered to strings ≤96 chars, capped at 12; `context` string ≤64 chars.
  - `/handoff` POST uses `crypto.getRandomValues` + Crockford base32 (no `I`/`L`/`O`/`U`) for codes, with 23505-collision retry, message-content sanitization (≤4000 chars/turn, ≤50 turns).
  - Service-role client only used in `/handoff` (writing to `mco_handoff_sessions`); no cross-tenant exposure.
- Prod smoke-test against `https://www.sentimetrx.ai`:
  - `GET /api/mco/parking` — 200, returns live GOAA lot status (hotel/cell-phone/main lots with `rate.daily` + `status`).
  - `POST /api/mco/places` with `{place_ids:[],context:"terminal_a_airside"}` — 200, returns real PlaceCards (Villa Italian Kitchen 4.4/650 reviews, McDonald's 4.1/71, etc.) with cuisine icons.
  - `GET /api/mco/security` — 200, returns TSA checkpoint wait times in seconds.
  - Skipped `/handoff` POST smoke-test (creates DB row; non-idempotent; code review sufficient).

**No code changes** — the absorbed WIP is functionally clean. The W21 finding is now closed via documented review + prod-route-level verification.

W21 audit score-lift item 5/6 — Maintainability +0.5 pts.

## 2026-05-25 (later) — W21 audit score-lift item 4: clarify data/mco_live_ratings.json disposition + tsbuildinfo .gitignore note

**Why**: W21 audit (PR #7) flagged two Structure-category items:
1. `data/mco_live_ratings.json` (388-line snapshot of Google ratings via DataForSEO) committed — TOS concern around caching Google ratings.
2. `tsconfig.tsbuildinfo` committed — bloats diffs.

**Item 2 was already resolved** in a prior commit (`0a4a0ae4 Stop tracking tsconfig.tsbuildinfo`) and `.gitignore` line 7 (`*.tsbuildinfo`) already covers all variants. The W21 audit finding was stale. No code change needed; .gitignore now carries an explanatory comment block calling out the explicit intent so future audits don't re-flag.

**Item 1 disposition: retain with refresh policy.** Deleting the JSON breaks `/demo/mco` (the demo's primary data source via `lib/places.ts`) because Vercel builds have no `GOOGLE_PLACES_API_KEY` set, and runtime can't write to the bundle. The file's actual data source is DataForSEO (Google Maps SERP), not the Google Places API directly — the audit's "Google TOS prohibits caching rating data" concern applies less strictly to DataForSEO redistribution. Added a refresh-policy block in `lib/places.ts` documenting (a) the lineage, (b) the monthly-or-pre-demo re-seed cadence via `scripts/_mco_dfs_seed.ts`, (c) the reason the snapshot stays committed (Vercel deploys it). Locally cleared a pile of stray `tsconfig N.tsbuildinfo` artifacts that `tsc` had written when invoked with quoted/numbered config paths.

**Verification**: clean `tsc --noEmit`. No code behavior change. `git ls-files | grep tsbuildinfo` → empty.

W21 audit score-lift item 4/6 — Structure category, partial credit (1 of 2 findings disposed; the other deliberately retained with documented rationale).

## 2026-05-25 (later) — W21 audit score-lift item 3: strip `send_at` phantom field from campaign email editor

**Why**: W21 audit flagged `send_at` as a phantom — the campaign email editor's "Specific date" Timing mode submits `send_at` in the PATCH body, but no `campaign_emails.send_at` column exists and the `/api/campaigns/[id]/emails` PATCH allowlist (`subject`, `body_html`, `send_delay_hours`, `send_time`, …) drops it silently. The UI looked like it worked; the value evaporated server-side. Better to ship the actual delay-based scheduler we have than to keep a broken UI surface around "until scheduling is a real feature."

**What changed**:
- `app/campaigns/[id]/CampaignDetailClient.tsx` — removed `sendAt` + `scheduleMode` state and the "Timing" select / "Specific date" datetime-local input. The email editor now shows Recipients + Delay (hours) + Send time directly — same widgets as the working delay-based mode.
- `app/campaigns/[id]/CampaignDetailClient.tsx` PATCH body — `send_at` field removed.
- `lib/types.ts` — `CampaignEmail.send_at` removed.
- `docs/CAMPAIGNS.md` § Scheduling Options — replaced the `<TBD: send_at not wired>` warning block with a "Resolved 2026-05-25" note.

**Verification**: clean `tsc --noEmit` (the removed field was already dropped by the API allowlist so server is unaffected). `grep -r send_at` returns zero hits across the repo (excluding node_modules / .next). No tests touched the field.

W21 audit score-lift item 3/6 — Maintainability +0.5 pts.

## 2026-05-25 (later) — W21 audit score-lift item 2: Datanautix → Sentimetrx in customer-visible chrome + customer-export PPTX metadata

**Why**: W21 audit flagged the platform identifying as "Datanautix" on customer-visible surfaces (agent widget chrome, customer dataset/conversation PPTX exports, survey creator default branding label). The product was renamed to Sentimetrx but the chrome lagged. Maintainability category +0.5 pts. Parent-attribution lines (TopNav, login footer via `DatanautixAttribution.tsx`, and internal Datanautix decks like rollup/pitch/architecture/restaurant-expansion/engineering-reality/signal-tiers/agent-capabilities) stay as-is — those are intentional "Sentimetrx is a Datanautix product" lines and the internal decks are *about* Datanautix.

**What changed**:
- `components/ui/ChatBot.tsx` — header "powered by DATANAUTIX" → "powered by SENTIMETRX" (link sentimetrx.ai); footer "Powered by Datanautix" → "Powered by Sentimetrx".
- `components/survey/SurveyWidget.tsx` — fallback `brandingLabel` default `'DATANAUTIX'` → `'SENTIMETRX'`.
- `components/creator/StepBasics.tsx` — wizard `brandingLabel` default + placeholder + tooltip text updated to `SENTIMETRX`.
- `app/api/studies/[id]/responses/[responseId]/conversation-export/route.ts` — PPTX `author` / `company` `Datanautix` → `Sentimetrx`; footer line `datanautix.com` → `sentimetrx.ai`.
- `app/api/datasets/[datasetId]/export/pptx/route.ts` — PPTX `author` / `company` `Datanautix` → `Sentimetrx`; footer "Prepared by Datanautix · datanautix.com" → "Prepared with Sentimetrx · sentimetrx.ai".
- `docs/BOTS.md` § "Mandatory Powered by … badge" updated.
- `docs/SURVEYS.md` § Theming `brandingLabel` default flipped to `SENTIMETRX`.
- `FEATURES.md` survey-creator bullet de-flagged (rename done).

**Out of scope** (intentionally preserved): `DatanautixAttribution.tsx` and its callers (TopNav, login page) — those carry the "by Datanautix" parent attribution. PPTX route-handlers for internal Datanautix decks (rollup, pitch, signal-tiers, engineering-reality, restaurant-expansion, architecture, agent-capabilities, nowocats-approach, pulseiq-deck) keep author/company `Datanautix` because the decks are *about* Datanautix the company.

**Verification**: clean `tsc --noEmit`. No tests added — visual change in widget chrome, eyeball-verified by reading the rendered JSX. PPTX metadata change is invisible at the slide level and shows up in PowerPoint's File → Properties.

## 2026-05-25 (later) — W21 audit score-lift item 1: Sentry beforeSend PII scrub

**Why**: W21 audit (PR #7) scored 72.5/100, flat vs W20. SECURITY.md Open `<TBD>` item #1 — Sentry `beforeSend` scrub — has been three weeks overdue. Closing it is the highest ROI Security category lift (7→9) and the simplest mechanical fix in the score-lift plan.

**What changed**:
- New `lib/sentryScrub.ts` — pure function `scrubSentryEvent(event)` that (a) drops the Microsoft Office "Object Not Found Matching Id…" content-script false positive, (b) redacts `request.{data,body,cookies}` wholesale, (c) redacts `authorization` + `cookie` headers and any header / extra / contexts / tags key whose name contains a PII substring (`email`, `phone`, `password`, `token`, `secret`, …), (d) reduces `user` to `{id}` only, (e) pattern-scrubs email + phone strings in breadcrumb messages + query strings.
- Wired into `sentry.{client,server,edge}.config.ts` via the `beforeSend` option. Client also gets `beforeBreadcrumb` for early redaction.
- `docs/SECURITY.md` §1, §5, Open TBD #1 — flipped from "NOT implemented" to "implemented" with the behavior contract listed; TBD #1 marked closed.
- `tests/unit/sentryScrub.test.ts` — 7 cases covering each redaction path + the Office drop + the "clean event passes through" baseline. All green.
- `scripts/specMap.ts` — `lib/sentryScrub.ts` added under `docs/SECURITY.md` mapping.

**Verification**: `npx vitest run tests/unit/sentryScrub.test.ts` → 7/7 passing; clean `tsc --noEmit`. No prod state change — takes effect on next Vercel build.

## 2026-05-25 (latest) — Decision Study: Phase 5 deeper-why + Phase 7 forward-looking probes (Option A)

User question: "should we not be proving the why and the how as well as how they will avoid a similar future outcome?" Caught a real gap — the prior protocol got attribution (surface cause) at Phase 5 + presence-of-shadow at Phase 7, but did not surface (a) root cause vs proximate cause, or (b) any direct forward-looking behavioral content. Earlier I had argued against asking "what will you do differently?" because the change/avoid/learn frame primes the change-comparison and biases regret measurement (Connolly & Zeelenberg). That argument still holds for the bad framings — but a CONCRETE IMAGINED REPLAY question ("if the same kind of choice came up tomorrow, how would the moment look?") surfaces the same content with much weaker priming because the respondent fills in any "differently" themselves through what they describe.

Two additions (`sql/one-off/2026-05-25-decision-study-why-depth-and-forward-looking.sql`, applied to prod):

- **Phase 5 optional deeper-why probe** — fires ONLY if the first attribution drill surfaced a substantive response (expanded, named a piece, gave context). Mirror the respondent's noun for the proximate cause and probe one level down: "And underneath the rushing — what was it about that moment that made you go fast?" / "What was it about [their reason] that made it land the way it did?" Skips on dismissive / vague / non-answer drill responses.

- **Phase 7 expanded** from pure presence-probing to presence + forward-looking. The presence drill (yes/no/sometimes) stays unchanged; an OPTIONAL forward-looking probe fires after it ONLY if the presence drill surfaced engagement. Phrased as concrete imagined replay: "If the same kind of choice came up tomorrow, how would the moment look for you now?" / "Picture being at a similar [dinner] tomorrow — what would the moment be like?" / "If you were standing at a similar moment again, what would the first beat look like?"

- **Neutrality rule #1 extended** for Phase 7's forward-looking probe with explicit banned framings: `differently / change / avoid / learn / lesson / wiser`. These are the words that prime the change-comparison frame and contaminate measurement. The imagined-replay phrasings deliberately avoid all six. The respondent supplies any "differently" themselves.

system_prompt grew 16566 → 18661 chars. No code changes.

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

---

## 2026-05-26 — Agent widget "Powered by" reverts to Datanautix

**Why**: Going into the UCF Business Incubator demo this week, the parent-company brand reads more credible than the product brand on a B2B/enterprise pitch — Datanautix is the established company name; Sentimetrx is the product line. The W22 rebrand (commit `ac54817e` on 2026-05-25) intentionally swapped customer-visible chrome to "Sentimetrx" for product-name visibility, but for agents specifically, the parent-attribution pattern (already preserved in TopNav / login / share / internal decks) reads better. This reverts the ChatBot widget portion of `ac54817e` only.

**What changed**:
- `components/ui/ChatBot.tsx` — both "Powered by" surfaces: the stacked wordmark in the chat header (line ~559) and the centered caption below the input box (line ~794). Text "Sentimetrx" → "Datanautix" in both. Link target `https://www.sentimetrx.ai` → `https://www.datanautix.com` in both (matches the brand consistently, so the click destination is the parent site).

**Scope**: applies to ALL agents (Cubie, Sarina, Sir O'Gate, MCO AskAna, Decision Study, future ones) — both branding spots are hardcoded once, used everywhere.

**Not changed**: SurveyWidget brandingLabel default ("DATANAUTIX" — was never changed by the W22 rebrand for the survey product), PPTX export metadata, TopNav, login pages, share pages, internal decks (all already reading "Datanautix").

---

## 2026-05-26 — Cubie (UCF Business Incubator agent) full retrieval-quality hardening

**Why**: UCF Business Incubator demo this week — Cubie agent (`bot_id 669e33ba-8725-4b03-a7ee-6c33f3adcc9e`, slug `ucf-incubator`) was originally seeded 2026-05-21 with a thin name-only KB (52 KB, ~93 chunks, mostly noise from masonry-listing pages with no client blurbs). User asked for "a robust enough bot that can answer questions about the program for entrepreneurs, companies looking to expand to our area, and companies looking for certain capabilities or solutions." Initial pass shipped before discovering retrieval doesn't read `bots.knowledge_base` — it reads `agent_knowledge_chunks` (via the view `bot_knowledge_chunks` and the RPC `search_knowledge_chunks`). User caught two real misses ("who manages Winter Springs", "what AI companies") that proved the gap. Multiple iterations after that.

**What changed (all DB-only updates against the linked prod project, no commits, no migrations — pure UPDATE on bots + DELETE/INSERT on agent_knowledge_chunks)**:

1. **Crawled incubator.ucf.edu via WordPress wp-json REST API** (not in-product Deep Crawl — direct API hits). Pulled:
   - All 108 active client posts (cat 22) — title, slug, link, content, categories
   - All 287 graduate posts (cat 167) — same fields, half had clean blurbs, the other half wrapped in Avada/Fusion shortcodes
   - All 23 Soft Landing posts (cat 181)
   - Full category tree (~238 categories) to build location/sector resolver
   - 9 location detail pages (downtown-incubator, orlando-incubator, research-park-incubator, lake-nona-life-sciences-incubator, photonics-incubator, kissimmee-incubator, heathrow-incubator, eustis-incubator, winter-springs-incubator) — full content with addresses, phones, on-site staff lists with emails, partner orgs, year established, square footage
   - Program pages (incubation-programs, mentorship-cohort-program, accelerated-leadership-academy, excellence-in-entrepreneurship-course, soft-landing) — the latter three needed WebFetch to render Avada shortcodes since the API content was unrendered
   - Staff page (14 names total)
   - Impact Reports page — concrete published numbers ($1.25B 2022–2023 output, 2,835 jobs/yr, $10.45 ROI per $1 invested)

2. **Built Avada/Fusion shortcode stripper** in Python (regex over `\[(?:av_|fusion_|ait_)[^\]]*\]` plus generic `\[[^\[\]]{1,200}\]` fallback). Recovered 161 of 287 graduate blurbs that were previously locked behind unrendered theme shortcodes.

3. **Chunking algorithm ported from `app/api/bots/[id]/knowledge/route.ts::chunkText()`** to Python — splits on `##/###/####` headings, drops chunks under 20 chars, subdivides oversize chunks (>1500 chars) at paragraph boundaries. Same logic the admin UI uses on save. Insert bullets are blank-line-separated so the paragraph splitter can subdivide long lists.

4. **Critical retrieval lesson** — when updating `bots.knowledge_base`, MUST also DELETE+rebuild `agent_knowledge_chunks` rows for that bot. The column is just source-of-truth text; chat retrieval uses the chunks. Lost an iteration before figuring this out — three SQL UPDATEs against the column had ZERO visible effect on bot behavior because the stale May-21 seed chunks were still what `search_knowledge_chunks` returned.

5. **Capability buckets promoted to their own `###` chunks** (was a single bulleted list inside one Capability Index chunk). 15 buckets: AI/ML, Cybersecurity, Defense, Healthcare, Optics/Photonics, Aerospace/Space, Semiconductors, Energy/Cleantech, Manufacturing/Materials, Education/Training/Simulation, Software/SaaS, Marketing/Sales/CRM, Financial/Fintech, Hospitality/Consumer, Robotics/Drones. Each title includes synonyms ("AI / ML — Artificial intelligence and machine learning", "Cybersecurity (cyber, infosec, security)", etc.) so `plainto_tsquery('english', ...)` matches common phrasings — stem 'ai' doesn't match the stemmed 'artific' of "Artificial". Each bucket body explicitly reads "these N current UCFBIP client companies in the active portfolio are the full list of matches (complete list — no others exist in this capability among current clients)" so:
   - The chunk matches 'client/clients' stem for "current clients" queries
   - The LLM understands the list is COMPLETE (no padding allowed)

6. **Per-company profile section** — every one of 107 active clients gets its own `### {Name}` chunk with blurb + sector + location + Soft Landing flag + profile URL. Same for 161 graduates with parsed blurbs (`### Graduate: {Name}`). Plus 12 by-sector graduate index chunks for "do you have biomedical graduates" type queries.

7. **Events crawl — initial JSON-only attempt missed recurring events**. Tribe Events Calendar plugin exposes `/wp-json/tribe/events/v1/events` and `/wp-json/wp/v2/tribe_events` — both only return the template/first occurrence of recurring events. The iCal feed at `/events/?ical=1` correctly expands all recurrences. User caught this when a Jun 24 Mentor Insight Forum was visible on the events page but missing from the bot's answer. Switched the events crawl to parse the iCal feed (handles line continuations, escapes, DTSTART/DTEND/SUMMARY/DESCRIPTION/LOCATION/URL). Final state: 2 upcoming events (M3D 2026-05-28, Mentor Insight Forum 2026-06-24) + 10 historical events as recent-activity context, each its own `### Upcoming Event:` or `### Past Event:` chunk.

8. **Anti-hallucination guardrails** — user caught the bot inventing "Healent" as an AI client (the name appears nowhere in any source — pure LLM fabrication, with a fabricated `incubator.ucf.edu/healent/` URL that 404s). Three new guardrails appended to `bots.guardrails` (9 existing → 12 total), idempotent via JSON-array dedupe SQL:
   - Never mention a company/person/location/URL not present verbatim in retrieved context — refer to the [Companies directory](https://incubator.ucf.edu/companies/) or staff instead.
   - When asked for a list, the in-context list IS the complete list — no padding, no "and several others."
   - Never construct URLs from inferred slugs — constructed URLs almost always 404.
   - **No specific company names hard-coded** in any guardrail (user explicitly rejected naming "Healent" as an example: "do not put a specific healent instruction — that seems really stupid").

9. **System prompt rewritten through v3 → v4 → v5 → v6** (3.5 KB original → 12 KB final). Key additions:
   - **ZERO-FABRICATION RULES block** at top of CORE RULES, 4 numbered points (verbatim only, complete lists, never construct URLs, admit ignorance is always better than guessing).
   - **LINK FORMATTING block** — bans bare URLs, requires Markdown `[label](url)` syntax with worked examples for every common URL the bot surfaces. Includes a MANDATORY rule for company names: "WRONG: `**Intelligence Factory** — AI consulting/automation`. RIGHT: `**[Intelligence Factory](https://...)** — AI consulting/automation`." User caught a real instance where the bot stripped link wrappers on company names in lists.
   - **LIST queries vs RECOMMENDATION queries** — distinguishes "what AI companies do you have" (give complete list from retrieved chunk) vs "I'm looking for a partner that does X" (pick 2–4 best fits). Original prompt said "Recommend 2–4 companies; don't dump the whole list" which made the bot truncate 13-company lists down to 2 for LIST queries.
   - **Cross-turn consistency rule** — "if you tagged Talos Health as AI in turn 2, Talos Health is AI in turn 5." User caught the bot contradicting itself within a session.
   - **Capability matching guidance** for "find me a company that does X" — search both the Capability Index and the per-location/per-company chunks, recommend by name with profile link, recommend 2–4 when it's a recommendation question, give the full list when it's a LIST question.
   - **Upcoming events handling** — list real upcoming events from retrieved context; if none, give recent past events as proxy for cadence/types of activity; never invent dates.

10. **Final state in prod (as of 2026-05-26 EOD)**:
    - `bots.knowledge_base`: **270 KB** (was 52 KB at session start)
    - `agent_knowledge_chunks` rows for Cubie: **390** (was 126 stale May-21 seed chunks)
    - `bots.system_prompt`: **12 KB** (was 3.5 KB)
    - `bots.guardrails`: **12** entries (was 9)
    - `bots.training_urls`: **142** (was 35; added every per-company profile URL so any future automated re-crawl pulls fresh blurbs)

**Verification — actual chat API tested (POST `/api/bots/[id]/chat`), not just retrieval RPC**:
- "what AI companies are current clients" → all 13 listed with clickable Markdown links (was 2 with no links pre-fix)
- "what events are coming up in the next few weeks?" → both real upcoming events (M3D May 28, Mentor Insight Jun 24) with venue, time, click links + recent-activity proxy
- "who manages the Winter Springs site?" → Michael Weiss with email + phone + dual-site (Winter Springs + Heathrow) note
- "tell me about Cympire" → correct location (Downtown Orlando), accurate blurb, clickable link, Soft Landing flag noted

**Queued for post-demo (in `project_open_work_queue.md`)**:
- Phase 1: Cubie-specific nightly KB refresh cron (~1 day). Port the Python crawl/parse/chunk logic to a TypeScript route at `/api/cron/cubie-refresh` gated by `CRON_SECRET`. Reference impl: `scripts/_rescan_abel_kb.ts`.
- Phase 2: Generic agent-KB-refresh framework (~3–5 days, trigger = second web-source agent needs the same treatment). Adds `auto_refresh_config jsonb` column to `bots`, uses the existing-but-half-wired `review_interval_hours` / `last_reviewed_at` / `next_review_at` columns.
- Rich link preview cards in the chat widget (polish, lets visitors preview without leaving the chat tab).
- Entity-extraction-as-check validator (optional anti-hallucination second line of defense if prompt-level guardrails prove insufficient at scale).
- Important caveat for BOTH refresh phases: DELETE+INSERT pattern wipes any manually-edited chunks in the admin UI. Decide before shipping: mark agent "auto-refresh source-of-truth" (banner in admin) vs preserve `metadata.source='manual'` chunks on refresh.

**No code change required for this work — all DB UPDATEs. The separate code commit `b3ad96a0` (this commit) is unrelated branding revert.**

---

## 2026-05-26 — Decision Study A/B + PulseIQ adapter fix + NOWOCATS sim infra

**Why this is bundled:** three threads that converged in one session and share enough of the chatCore.ts edit window that splitting would have produced merge-noisy commits.

### Decision Study A/B (4 SQL one-offs + chatCore state injection)

Triggering session `bs_mpm28rvc_hbytgc` (54 turns, 6 "wtf" pushbacks, repeated re-asks of items already answered) made it clear the 11-phase Sarina prompt couldn't reliably skip captured items even with rule #10 ("scan transcript before asking") explicitly stated. Three architectural attempts, in order:

1. **V1 + 4 patches** (`sql/one-off/2026-05-26-decision-study-v1-phase-machine-patches.sql`) — pushback escalation rule, `BEFORE ASKING` checklists at each phase block, "I already told you" hard stop, tightened P5 deeper-why gate. Applied to a cloned control slug `decision-study-v1`.
2. **V2 goal-tracker** (`sql/one-off/2026-05-25-decision-study-goal-tracker.sql`) — replaced the phase scaffold with 7-data-point tracking + "scan the whole transcript before each turn." Reduced 280-line prompt to 90. **In live A/B testing this performed WORSE than V1+patches** — V2 re-asked persistence verbatim, re-asked how-it-sits, and re-asked attribution despite the self-scan instruction. Telling the model to scan a 25-turn context for state every turn is not reliable.
3. **V2 + code-side state injection** (`lib/chatCore.ts` + `sql/one-off/2026-05-26-decision-study-stateful-focus.sql`) — opt-in `bot.config.statefulFocusTracking`. Before every model call, query `bot_conversation_turns` for `topic:<slug>` flags written by `classifyProbeFocuses`, build a `CAPTURED / REMAINING` block, inject as ground truth. The model treats it deterministically. **Same scenario ran in 13 user turns with zero re-asks** (V1+patches: 18 turns + 1 re-ask; V2 original: 17 turns + 3 re-asks). Tradeoff: less per-item depth than V1+patches' deeper-why / forward-looking probes.

**Why it's worth keeping:** the architectural lesson generalizes — when state-tracking matters, computing state deterministically in code and injecting it beats instructing the model to derive it from context. Other research-style agents that grow long can opt in by setting `statefulFocusTracking: true` once they configure `focuses` + `probe_focus_enabled`.

`sql/one-off/2026-05-25-decision-study-v1-control-clone.sql` is the clone-from-canonical SQL. Original phase-machine prompt is preserved on `/b/decision-study-v1`; current canonical `/b/decision-study` is the goal-tracker + state-injection variant.

### PulseIQ admin UX — draft pill + greyed data buttons

User reported all three data buttons (Analytics / Responses / Analyze in Ana) on a NOWOCATS draft card landed on the same view as Manage. Root cause: `SessionDetailClient.tsx:272` auto-enters edit mode when `session.status === 'setup'` (which is what new-substrate `draft` projects to via `lib/townHallAdapter.ts`), and the tabs are gated behind `!editing`. So clicking any data button just loaded the editor.

Fix in `app/townhall/TownHallListClient.tsx`: when the card status is `setup`, the three data buttons render with disabled-style (`bg-#f9fafb`, `cursor: not-allowed`, tooltip explains why) and the status pill flips from muted grey "Setup" → bright orange "Draft" so it's obvious at a glance why the data buttons are dim. Manage / Duplicate / Share / admin actions stay functional.

Originally tried a fix that bypassed the auto-edit when `?tab=` was in URL — reverted, because if the user can't click into an empty data view anyway, the URL bypass is dead code.

### PulseIQ adapter fix — per-conversation + per-topic counts

After running the first NOWOCATS sim (5 personas, 30 turns), the summary card showed correct aggregate counts (`5 participants, 30 turns`) but the per-conversation row in the Responses tab showed `turns: 0` and every topic card showed `response_count: 0`. Root cause in `lib/townHallAdapter.ts`:

- `getTownHallAsLegacy` projected `participants[].turns: 0` (hardcoded — line 220, before fix)
- Topic cards read `town_hall_topics.response_count` which is only updated by the async cohort theme aggregator (cron every 15 min) — never updated during the chat handler, only the **selection-time** tally in `chatCore.ts` is live

`computeBasicStats` now selects `conversation_id, topic_id, created_at` per user-role turn in a single query and returns `perConv` (per-conversation turns / firstAt / lastAt / topicCount) + `perTopic` (live response count per topic). `getTownHallAsLegacy` overlays both — participants get real turn / timestamp / topic-count, themes get live response_count (only when > the persisted column, so the aggregator's own cohort numbers stay if they ever exceed the live count).

### NOWOCATS sim infra

- `NOWOCATS_PACK` (18 personas) added to `app/admin/simulator/townhall/TownhallSimulatorClient.tsx`. Geography across Apopka / Ocoee / Winter Garden / Plymouth / Clarcona; one Spanish-language-switcher persona reflecting Apopka's Hispanic demographic; 4 edge cases (single-issue deer commenter, disengaged teen, anti-gov skeptic, developer-conspiracy commenter).
- `sql/one-off/2026-05-26-duplicate-nowocats-for-sim.sql` creates a `nowocats-sim` clone of the real NOWOCATS town hall (same Sarina agent, same topics, status=live) so sim runs don't pollute the real PM-2 record.
- Out-of-tree runner script at `/tmp/abtest/nowocats_sim.py` drives 5 personas × 6 turns via the public `/api/townhall/join` + `/api/townhall/chat` endpoints, calling Anthropic directly to generate persona utterances (the in-app `/api/townhall/simulate` route requires authenticated session cookie). Same-origin `Origin` header bypasses the CSRF middleware. First run landed cleanly — language switch fired correctly, persona-specific tone retained, three personas chose the name "Marcus" autonomously (Haiku name-bias — needs hard-coded first-name field on the persona spec if name attribution matters for downstream analytics).

---

## 2026-05-26 — Export route: phase-3 fallback (magnifying-glass fix)

Right after the adapter fix above shipped, user reported the Responses-tab magnifying-glass click did nothing on the NOWOCATS-sim session. Root cause: the modal handler fetches `GET /api/townhall/sessions/[id]/export?format=json`, and the export route's session lookup hit only `townhall_sessions` (legacy table). Pure phase-3 sessions like NOWOCATS-sim have no row there → 404 → the client's silent `.catch {}` swallowed it → no modal.

The route already had a phase-3 augmentation block (lines 130+) that populates conversations from `town_hall_conversations → conversations → conversation_turns`, but it was unreachable behind the 404. Fix in `app/api/townhall/sessions/[id]/export/route.ts`:

1. After the `townhall_sessions` lookup, fall back to `town_halls` (by id or slug) and project through `projectHallAsSession` so the downstream code stays substrate-agnostic.
2. Mark `purePhase3 = true` when the legacy table missed.
3. Skip the "No responses to export" early return when `purePhase3` (turns lives in conversation_turns, loaded later in the json branch).
4. Recompute `summary.total_turns` + `summary.answered` from the assembled `participants` map rather than `turns.length` — that count was 0 for pure phase-3 sessions even when participants had plenty of turns.

The `participant_id` column now flows correctly into the modal via `conv.participant_id`, and the modal can finally render.

---

## 2026-05-26 — Count semantics fix: response_count vs mention_count

User caught the previous overlay using "total user turns tagged with topic_id" for `response_count`. That's the wrong semantic — the rest of the system (cron aggregator + `pickNextTopic`'s under-target sort) treats `response_count` as "distinct participants who weighed in on this topic." A participant who returned to the same topic across three turns counts as 1 response, not 3.

`computeBasicStats` now tracks two values per topic:
- `responses` = `count(DISTINCT conversation_id)` — for `response_count` overlay
- `mentions` = `count(*)` of user turns tagged with that topic_id — for `mention_count` overlay

`getTownHallAsLegacy` uses `Math.max(persisted, live)` for both so the cron aggregator's own writes are honored if they're ever higher than the live count.

For the current NOWOCATS sim (5 personas, 6 turns each, each topic covered once per persona at most) `responses == mentions` since no one returned to a topic. The two diverge only on real-world conversations where someone goes deep on one topic — which is exactly when the distinction matters.
