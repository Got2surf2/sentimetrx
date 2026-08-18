# 2026-W34 devlog

---

## 2026-08-17 — Entity counts: a failed count must not read as a measured zero

**Why**: the W34 governance audit flagged error-swallowing in `lib/entityFilter.ts`.
It's worse than "returns an empty map": `count_entity_terms` 57014s on large
scopes (Sentry: 12 events from the entity-discovery cron), the error was logged
and swallowed, and the empty result was **indistinguishable from a measured
zero**. Two consequences followed:

1. `storeEntityMentionCounts` **persisted** those zeros through
   `apply_entity_mention_counts` — so a transient timeout durably zeroed the
   whole catalog.
2. Default reads drop zero-count entries, so the UI then rendered an **empty
   entity list** instead of surfacing a failure.

⭐ The lesson is the one the substantive-count bug already taught: **an
unmeasured value must never render as a measured one.** The fix is a flag, not a
throw — callers get to decide, and the durable write is the one that must refuse.

**What changed**:
- `lib/entityFilter.ts` — `computeEntityCounts` returns `failed: boolean`;
  `storeEntityMentionCounts` declines to write when set (previous counts stay);
  `getEntitiesWithCounts` skips the background refresh, **suspends the
  zero-count drop** so the catalog can't blank, and exposes `counts_failed` on
  `EntitiesResult`.
- `tests/unit/entityCountFailure.test.ts` — 4 tests. Verified they **fail against
  the pre-fix code** (2 of 4) rather than passing vacuously.
- `docs/ANALYTICS.md` — recorded under Entity Counting.

Coverage rose to 30.93/24.28/34.01/31.52; suite 1,691 green; tsc + lint clean.

---

## 2026-08-17 — The first-open blank screen was a gate on `rowsLoading`, not a missing loader

**Why**: owner reported no loading Lottie on first dataset open, appearing only
after leaving and returning. My first diagnosis was wrong — I blamed the absence
of any `loading.tsx` in the app. Re-checking the repro killed that theory: the
shell had already painted **with real data** (128,619 rows), so the server work
was done and the blank region was a client component rendering nothing.

⭐ The real cause: the full-page loader was gated
`!rowsLoaded && rowsLoading && !rowsError && !themesPaintable`. But
`startRowFetch` is a **one-shot that only fires after the server counts request
finishes** (or a terminal bail-out releases it). Between mount and that moment
`rowsLoaded=false`, `rowsLoading=false`, `themesPaintable=false` — **no branch
matched, so nothing rendered** for the whole multi-second counts scan. A revisit
looked fine only because rows were already loaded.

This is the **same deferred-start window** the nav tabs hit on 2026-08-16, fixed
there by gating on `!rowsLoaded` rather than `rowsLoading`. Same fix applied here.

**What changed**:
- `components/analyze/TextMineModule.tsx` — loader gated on `!rowsLoaded` alone,
  with a phase-accurate message: "Counting themes across the dataset…" before the
  row fetch starts, "Loading dataset rows… N%" once it does.
- `docs/ANALYTICS.md` — recorded.

Verified in the browser on the 128,619-row Outback set: the Lottie now fills the
window that was blank, then hands off cleanly to the theme cards. Confirmed the
fetch is always released (every terminal bail-out calls `startRowFetch`), so the
loader cannot spin forever.

**Lesson**: a loader gated on "is it loading?" misses the window before loading
*starts*. Gate on "is it done?" instead.

---

## 2026-08-17 — A re-enabled field was unusable until a page reload

**Why**: owner re-enabled a previously-ignored field ("Liked Least" on the
Carrabba's GSS set) and selecting it in TextMine's Text picker snapped straight
back to "Liked Most".

Four things had to line up, and all four are load-bearing:
1. The rows API **drops `ignore`/`hidden` columns from the payload** (sql/186 — a
   9.45MB → 5.76MB win, so it isn't going away).
2. `RowsProvider`'s fetch is a **one-shot** (`if (rowsLoaded || rowsLoading) return`).
3. `router.refresh()` after a schema save re-renders the server layout but does
   **not remount** the provider, so the stale payload survived.
4. TextMine's "auto-switch away from empty fields" effect read *column absent* as
   *field empty* and bounced the selection to `openFields[0]`.

⭐ Fixed with a **remount key**, not an effect: `DatasetShell` keys
`RowsProvider` on `analyzableFieldsKey(schemaFields)`. A changed key remounts
deterministically — no `set-state-in-effect`, and no refetch-loop risk in a
provider that feeds TextMine, Charts, Stats, Filters and ViewsBar with 50K-row
payloads. `FilterProvider` sits outside it, so filters survive the remount.

The key's contract IS the fix, so it's extracted to `lib/datasetUtils.ts` and
unit-tested (9 cases): it must change on an ignore/hidden flip, and must NOT
change on field reordering, a label/sqt/hierarchyLevel edit, a fresh array with
identical content, or such that two columns collide with one. Too loose and the
dataset view remounts on every render; too tight and the bug stays.

Belt-and-braces: the auto-switch effect now skips fields whose key is absent from
the payload, so a stale payload can never override a deliberate selection.

**Verification, stated honestly**: I reproduced the stale-payload state on TEST
and confirmed the selection now sticks ("Field: Liked Least · 7 themes · 17,157
responses"). I could **not** reliably stage the side-by-side failing case — soft
navigation wouldn't fire consistently in the dev server — so the negative half
rests on code reading plus the unit tests, not on an observed A/B. The remount
itself is deterministic React behaviour.

---

## 2026-08-17 — The word modal's % is a share of the theme, not the corpus

**Why**: owner: *"the % on this image is calculated using the old approach and
represents the % of total comments — this should show as % of that theme."* Right
question to ask of it: "chicken (1%)" tells you almost nothing, whereas "19% of
Food Quality" tells you how much of that theme the word accounts for.

Harder than a formula swap, because `OpinionPopover` had **no theme context** —
its props were `word, rows, fields, ratingField, hiddenFields, onClose`. It now
takes an optional `themeScope: { label, count }`.

⭐ **The denominator had to be the theme's OWN displayed count.** `theme.count` is
what the card prints as "N comments", so passing anything else would put a
percentage on screen that doesn't reconcile with the number right next to it.
Verified live: 358 mentions of "overcooked" / 1,895 = **19%**, matching the card;
the old code showed 358 / 17,157 = 2%. Rounding matches `pctOfThis` — the
"% of this theme" convention the co-occurrence chips already use — so the two
figures agree rather than being two conventions on one screen.

Both readouts (header pill + stats row) now derive from **one** `share` memo, so
they cannot disagree; the tests assert both render sites.

**Scope resolution.** From a theme card the theme is unambiguous. In Theme Clouds
the scope is `selectedThemes` — an array — so only a **single** selected theme
qualifies; with 0 ("All responses") or 2+ there is no one theme to be a share OF,
and it falls back to the dataset share. Every case **names its denominator**,
which is the deck-number-credibility rule applied to a UI readout.

This is a deliberate divergence from `totalCommentsWithText`, documented as the
canonical denominator. `ThemePopover`'s "% of comments" is theme-level, where % of
total is correct, and is untouched.

4 tests, verified to fail against the pre-fix component. Browser-verified on the
Carrabba's set.

---

## 2026-08-17 (later) — Correcting the theme-% fix: wrong scope source, wrong population

Owner reported still seeing "9% of comments" in **Theme Clouds**. Two defects in
my own first pass, both worth recording:

⭐ **1. Wrong scope source.** I keyed the Clouds popover off `selectedThemes` —
which is the *filter* selection and is normally **empty** on that view — so every
cloud word fell straight back to "% of comments". Theme Clouds draws one cloud
**per theme**, and `WordCloud`'s `onWordClick(word, themeIdx, type)` already hands
back the row's theme; I simply wasn't capturing it. Now tracked by theme **id**,
which both entry points (card keyword chip, cloud word) can set.

⭐⭐ **2. Wrong population — the more serious one.** Even once scoped, the modal
counted mentions across the **whole dataset** while dividing by the **theme's**
comment count. That is a ratio of two different populations; it can exceed 100%.
Concretely: "server" reported 950 dataset-wide mentions over the theme's 2,231
comments = 43%, while the cloud counted 896 mentions *inside* the theme = 40%.
The modal now reads the theme's rows (`commentMatchesTheme` — the same matcher
behind the theme's own count), so numerator and denominator share a population.

**Known residual, stated rather than hidden**: the modal's mention count and
`WordCloud`'s token frequency use different matchers, so the modal can read 19%
where the cloud chip says 18% (433 vs 403 for "waitress"). The modal is internally
consistent; aligning the two matchers is a separate piece of work.

**Verification**: browser-confirmed on both entry points before the final
id-refactor — Overview "19% of Food Quality & Preparation Issues" (358/1,895) and
Clouds "19% of Service & Staff Issues" (433/2,231). The last refactor (index → id,
plus row-scoping the Overview site) is mechanical and covered by typecheck, the 4
denominator tests, and 1,704 green — but the browser extension dropped before I
could re-confirm it visually. Lint on TextMineModule holds at 19 warnings, so the
229 ceiling is intact.

---

## 2026-08-17 (later²) — Word modal header: the share gets its own line

**Why**: owner confirmed the percentages read correctly, but with a real theme
name the header wrapped mid-phrase — *"Opinions about \"celebrating\" (10% of
Special / Occasions & Celebrations)"*. Splitting a parenthetical across lines
reads as broken text rather than as a caption.

The share span was an inline tail with `marginLeft: 8`. It's now `display: block`
with `marginTop: 2`, so the title keeps line 1 and the whole share phrase stays
intact on line 2. This only became visible once the label carried a *theme name*
instead of the short fixed word "comments" — the change that made the number
useful is the same one that made the layout wrong.

Pinned by a test asserting the element's `display` is `block` and that no inline
`marginLeft` survives; verified it fails against the inline markup.


---

## 2026-08-18 — Lint burn-down Tier 0: 229 → 202

**Why**: the backlog was 229 warnings across 90 files with no plan attached.
Analysing it first changed what "cleaning it out" should mean: `set-state-in-effect`
is 109 warnings spread over **63 files** (a thin long tail, 1–2 each), while
`exhaustive-deps` is 73 over 24 files and *concentrated* — three files carry 73 of
the 229 between them. So the order matters more than the effort.

Tier 0 was the part that needed no behavioural judgement. Two genuine defects came
out of it:

⭐ **`StatsModule` subsampled with `Math.random()` inside a `useMemo`.** React
treats `useMemo` as a performance hint, not a semantic guarantee — it may discard
and recompute at any time, which would draw a **new subsample and silently change
every statistic on screen** with no user action. That is a numbers-credibility bug
in the one module where numbers must reconcile, and it also contradicted the
deterministic sampling the server side already does (sql/160/167). Replaced with a
seeded `deterministicSubsample` in `lib/statsUtils.ts`; 8 tests pin that repeated
calls return the identical sample.

⭐ **`StepQuestions` declared a component during render.** `Row` was defined inside
`SurveyFlowPanel`, so it was a new component type on every render and React
unmounted/remounted the subtree rather than updating it. Hoisted to module scope as
`FlowRow`, with the single closure it needed (`onDragEnd`) passed as a prop —
verified all 9 usages sit inside `SurveyFlowPanel`, since the file has a *second*
`onDragEnd` in a later component that would have bound silently.

**The honest part**: 17 of the 27 cleared warnings were **documented as
intentional**, not refactored. Every remaining `purity` site is correct code the
rule is conservative about — server components (one render per request), `useMemo`s
where re-resolving against a fresh `now` is the whole point, async callbacks that
aren't render at all, and relative-time displays where a recompute just refreshes
"3 days ago". Each carries a scoped disable naming the reason. That is suppression
with rationale; it lowers the ceiling because a documented decision stops being an
open question, but it is not the same as elimination and shouldn't be counted as it.

**Left deliberately**: three self-referencing loops (two `requestAnimationFrame`
draw loops in live-audio, one polling loop in Town Hall chat). Breaking the
self-reference needs a ref indirection that trades the warning for a
`react-hooks/refs` one, in real-time media code that is hard to verify.

Ceiling lowered 229 → 202.

---

## 2026-08-18 (later) — Lint Tier 1 started, and stopped early on purpose

Target was `useSurveyEngine.ts` — 20 `exhaustive-deps`, the most concentrated
single file in the backlog. Two findings changed the plan.

**1. The big structural win didn't move the number.** 14 of the 20 were "missing
dependency `C.something`". `C` is the theme object — and it turned out to be a
**constant literal of hard-coded colour strings** that was simply declared inside
the hook, so it got a fresh identity every render. Adding its fields to the
dependency lists (what the rule literally asks for) would have churned 14
callbacks on every render — the opposite of the intent. Hoisted `C` and its two
`IMSG_*` constants to module scope: now stable forever and out of the dependency
question entirely. **But the count stayed at 20**, because `C` had been masking 14
other genuine dependency issues (`reducedMotion`, `typingSpeed`, `submitResponse`,
`savePartial`, …) that only surfaced once it was gone. Net for the file: 20 → 19,
via one genuinely unnecessary dep (`config`, listed but never read).

That is worth recording as a pattern: **a warning count can be a poor progress
signal.** The code is materially better and the number barely moved.

**2. `useSurveyEngine` has ZERO test coverage.** No test references it, and
`components/**` isn't even in the coverage `include` (which is `lib/**` +
`app/api/**`). I picked this file to start Tier 1 *because* I assumed the survey
runtime was well covered — it isn't. So the remaining 18 are individual dependency
judgements on a 2,638-line, respondent-facing, data-collecting runtime with no
automated safety net, where the only verification is manually walking every branch
(NPS, rating, follow-ups, psychographics, demographics, contact, clarify, deflect,
verbose) in a browser.

Stopped there rather than pressing on. Ceiling 202 → 201.

---

## 2026-08-18 (later²) — Lint Tier 1 on TextMine + Stats: 201 → 195

Switched off `useSurveyEngine` (zero coverage) to the two modules I can actually
verify. Took only the changes that are provably equivalent, not the behavioural
ones.

**`TextMineModule` 19 → 16**
- Two `activeFields.join(',')` / `_recountFields.join(',')` call expressions
  extracted out of dependency arrays into named values. An inline call in deps is
  re-evaluated every render and the rule can't verify it, so it hides whether the
  effect's real inputs changed. Same value, named.
- The `filteredRows` memo depended on `signalCutoffs.mainstream` /
  `.noise` while passing the whole `signalCutoffs` object, so the rule asked for
  the object. Depending on the object would be *less* precise (a new identity with
  identical numbers would recompute). `signalCutoffs` is exactly those two
  numbers, so the memo now takes the two primitives and rebuilds the argument —
  complete, and stricter than what the rule asked for.

**`StatsModule` 32 → 29**
- `STATS_HARD_CAP = 5000` was declared *inside* the component, so a constant read
  as a hook dependency. Hoisted to module scope — the same shape of problem as
  `C` in the survey engine.
- Dropped `themeEnrichKey` from a `useMemo`'s deps: listed but never read, so it
  only forced the enrichment to recompute when nothing it used had changed.
- The Plotly cleanup read `ref.current` *at cleanup time*, by which point it may
  point elsewhere or be null — it could purge the wrong node or miss one. Now
  captured at effect setup.

**Verification.** The change with real behavioural risk is the deterministic
subsample from Tier 0, so that got the browser check: Statistics on the 56,117-row
Carrabba's set renders 2,000 sampled rows, and **after a full reload the figures
are byte-identical** (1,596 observations, mean 4.731, median 5.000, SD 0.797,
variance 0.636) — which is exactly the property the old `Math.random()` shuffle
could not provide. The Plotly distribution chart renders and purges cleanly after
the ref change.

TextMine's three changes are semantically-equivalent transformations (a named
value in place of an inline call; the same two numbers passed a different way,
on a code path that returns early for anything that isn't Reddit/Substack). They
are covered by typecheck, the suite and a clean dev compile, but the browser
extension dropped before I could re-confirm them visually after the final edit.

Ceiling 201 → 195. Session total: 229 → 195.

---

## 2026-08-18 — A test net for `useSurveyEngine`, before refactoring it

**Why.** The next piece of work is the `useSurveyEngine` dependency-graph
refactor — 19 `exhaustive-deps` warnings that are one bottom-up restructuring,
not 19 small fixes. The file is 2,647 lines, drives a **respondent-facing
data-collection flow**, does ~256 direct DOM operations, and had **zero test
coverage**: nothing under `tests/` referenced it, and `components/**` isn't even
in the vitest coverage `include` (that's `lib/**` + `app/api/**`). Refactoring
a callback graph with no regression net, on the code path that captures
customers' survey answers, is not a trade worth making.

So the net came first. `tests/unit/surveyEngineFlow.test.tsx` mounts the hook in
jsdom behind a minimal host component and drives real surveys through the same
buttons and textareas a respondent touches. It asserts on the artefact that
must not drift: the `/api/respond` payload, which embeds the entire
conversation transcript. Two transcripts are snapshotted, so a reordered
bubble, a duplicated acknowledgement or a dropped question fails loudly instead
of quietly changing what we collect.

**What's covered.** The full walk (NPS → experience rating → q3 → q4 →
psychographics → demographics → contact → closing card); the AI clarifier —
asked, `SKIP` respected, follow-up appended to the stored answer — and the
keyword fallback; AI deflection short-circuiting the clarifier; both `#verbose`
commands; the kiosk vs non-kiosk device lock; all seven custom question types;
`_end` skip logic; a required open question refusing an empty send; and hidden
fields / `urlParams` / `?rid=` click self-reporting.

**Determinism.** `Math.random` is pinned to 0 — the engine uses it to shuffle
the psychographic bank and the custom-question pool and to vary the
acknowledgement wording, so a fixed script would otherwise encode the shuffle
rather than the behaviour. Timers are faked so the typing animation, the 100ms
focus timeouts and the 2s `savePartial` debounce run instantly. jsdom under
Node 22 exposes no Web Storage, so `localStorage`/`sessionStorage` are stubbed;
the engine reads both.

**Two things writing the tests taught me about the engine, before I changed a
line of it.** The keyword clarifier fires even with `useAIClarify` off —
`buildClarify`'s fallback never returns null, so any answer under 12 words gets
probed. And `stepDemographics` falls back to age/gender/zip whenever
`demoFields` is empty, so there is no way to switch demographics off by
emptying that list; a focused test has to narrow `sectionOrder` instead. Both
were assumptions I'd have carried into the refactor.

### Step 1 of the refactor — move the declarations, change nothing else

`useSurveyEngine`'s 19 `exhaustive-deps` warnings could not simply be fixed by
adding the missing dependencies, because several of the missing values are
declared *below* the callback that needs them. `progressFlow` (was line 1901)
calls `showTextInput` (1967) and `showTextInputOptional` (2093); `handleOpenEnded`
(1933) calls `showClarifyInput` (2017); `showLikertFollowUpInput` (1032) calls
`showLikertClarifyInput` (1103). Those work today only because the calls happen
inside closures that run on a click, long after render. Naming them in a
dependency array evaluates them **during** render — which is a temporal-dead-zone
`ReferenceError`, not a lint fix. The thirteen translation helpers had the same
problem in the other direction: they sat at the very bottom of the hook (2161+)
as hoisted `function` declarations, so the ~40 callbacks above them could call
them but could never depend on them.

So this commit is a pure move: the translation block goes to the top of the
hook, `showLikertClarifyInput` goes above its caller, and the three input
renderers go above `progressFlow`/`handleOpenEnded`. Verified mechanically — the
file before and after contains the exact same multiset of 2,648 lines, so nothing
was edited, only relocated — and the new jsdom harness passes unchanged, both
snapshotted transcripts included.

The cycle that genuinely exists (`progressFlow` → `showTextInput` →
`handleOpenEnded` → `progressFlow`) is still broken where it always was, by the
`progressFlowRef`/`handleOpenEndedRef` latest-value refs the file already used.

### Step 2 — stabilise the roots, then fill in the arrays. 19 → 0.

With the declarations in an order that permits it, the actual refactor is
bottom-up. Three predicates (`isDecline`, `isQuestionOrOffTopic`, `typingDur`)
close over nothing and went to module scope. The thirteen translation helpers
each read exactly two things — the `activeLang` ref and `config.translations` —
so each became a `useCallback` keyed on the latter, stable for the life of the
study config. Then `checkVerbose`, `smartAck`, `shouldClarify`, `checkDeflect`,
`buildClarify`, `pickPsychoQuestions` and `submitResponse`; then `sectionOrder`'s
`||` fallback array literal, which was a fresh identity every render, into a
`useMemo`. Only after all of that did the dependency arrays get filled in.

Fixing top-down would have achieved nothing, which is the whole point:
`savePartial` and `showTypingDuring` were *already* `useCallback`s and still
churned on every render, because their own dependencies were unstable.

Five dependencies turned out to be **unnecessary** — `config` on two typing
callbacks that never read it, `showTyping` on two that only use
`showTypingDuring`, and `progressFlow` on `renderInput`, which goes through
`progressFlowRef`. Each was confirmed unreferenced in its callback body before
removal. `exhaustive-deps` on this file: **19 → 0**. Repo ceiling **195 → 176**,
exact, no slack.

**⚠️ The thing worth remembering from today is not the number.** Step 1's
reorder — provably zero edited lines — took this file from **19 warnings to 51**.
The `react-hooks` v7 rules are compiler-based, and the compiler **bails out of an
entire component** when it hits a construct it can't model, reporting nothing
from `refs`/`purity`/`immutability` for that component. The forward references
were exactly such a construct. Those 32 findings were always true; they were
invisible, not absent. So: **a low `react-hooks/*` count on a structurally odd
file is not evidence of health until you've confirmed the compiler actually
analysed it** — and fixing a structural problem there can legitimately raise the
count, which is progress, not regression.

The 32 unmasked warnings are three pre-existing clusters — render-phase lazy
initialisation (session id, device fingerprint, hidden-field capture, device
lock), the latest-value ref idiom, and one self-recursive `useCallback`. They got
scoped disables with concrete reasons rather than a file-level blanket, so the
rules stay live everywhere else in the file. Restructuring them touches
respondent session identity, the one-response-per-device lock and the campaign
`?rid=` capture; that is its own piece of work with its own browser verification,
not a rider on this one. Also noticed and deliberately left alone:
`stepConversationExtrasRef` is assigned every render and never read.

**Verification.** Both snapshotted transcripts came through byte-identical,
`tsc` clean, full suite 1,728 green.

On top of that, `scripts/_verify_survey_engine_live.mts` (untracked, KEEP) drives
the **real client bundle** with Playwright against `npm run dev` on the TEST
project — actual React 19 runtime, actual Next build, actual `/api/respond`
round-trip, which jsdom cannot prove. It walks a survey to its closing card and
asserts: exactly one `complete` POST, partial saves fired, a conversation log
captured, a score and an open-ended answer stored, **no consecutive duplicate bot
message** (the shape a stale-closure regression would take), and zero console
errors. All five active TEST studies pass, including the Anna Eskamani survey
(4 languages) and a full **Spanish** run of the Vindman campaign — greeting, ready
prompt, NPS labels, adaptive follow-ups, `smartAck`, psychographics, section
transitions and the closing card all translated correctly, which is the single
best evidence that memoising the thirteen translation helpers on
`config.translations` changed nothing: they still read `activeLang` through the
ref at call time, so a callback captured before the language switch still resolves
the new language.

One harness bug found and fixed along the way: the completion check matched the
literal text "All done!", which is itself translated — so it failed the Spanish
run while the engine was fine. It now matches the closing-card element instead.

### Hidden fields and in-conversation answers were being dropped from the final payload

Found while scoping the next lint item, which touches the render-phase block
that captures hidden fields. `state.current.customAnswers` is an accumulator with
three writers: the hidden-field capture at mount (URL params such as
`?location=orlando`), `stepConversationExtras` (questions with a
`conversationPosition`), and `stepCustomQuestions`. The first two merged into the
map. The third assigned it **wholesale** from a fresh object — so as soon as a
study had at least one ordinary custom question, it wiped both.

The failure mode is unusually deceptive: the debounced `savePartial` calls fire
*before* `stepCustomQuestions` completes, so the incomplete row on the way through
**does** contain the hidden fields. Only the `status:'complete'` payload loses
them. A study looked like it was capturing its campaign/tracking metadata right up
to the moment the respondent finished.

Reproduced first as two failing tests (hidden field + custom question; conversation
-position question + custom question), then fixed by making the third writer spread
like the other two. Swept the class: `customAnswers` was the only accumulator being
replaced — every other `State` object field is written per-key, and
`psychoQuestions = picked` is a deliberate fresh selection, not an accumulation.

### The 32 suppressed warnings, actually fixed — `useSurveyEngine` 32 → 0

The scoped disables added earlier today are gone. The file now reports zero even
under `--no-inline-config`, so nothing is hidden. **The lint ceiling does not move
(still 176)** — suppressed warnings never counted toward it, which is precisely
why the ratchet number is a bad measure of this kind of work.

I started by *measuring* what the compiler accepts instead of guessing: a scratch
file of ~20 candidate patterns, linted. That turned a speculative refactor into a
mechanical one, and produced a reusable table now in ENGINEERING.md. The
counter-intuitive findings: the lazy-ref exemption requires an explicit
`ref.current === null` guard (a falsy `if (!ref.current)` is *not* exempt); a
latest-value ref must be declared **before** the function it points at, or
reassigning it trips `immutability` with "value previously passed as an argument
to a hook"; and naming a ref in a dependency array makes the compiler treat it as
hook-owned and forbid mutating it.

What changed: per-mount initialisation (session id, device fingerprint,
hidden-field/URL capture, device lock) moved into `useState` lazy initialisers
over module-scope factories; the conversation state uses the `=== null` lazy-ref
idiom and is narrowed once so the ~100 `state.current.x` reads stay untouched;
the campaign `?rid=` click beacon moved into an effect (it is a real side effect,
and a discarded render must not report a click); the five latest-value refs moved
into one block ahead of their callbacks with a single syncing effect;
`stepPsychoQ`'s self-recursion routes through a ref; and the dead
`stepConversationExtrasRef` is deleted.

**Verification, and a harness bug it exposed.** The live Playwright harness
failed one study on "no consecutive duplicate bot message". It was not a
regression: the Eskamani TEST study genuinely contains two pairs of questions
with identical prompts but different ids (`q_8cd5188e` / `i_po_engage_…` and
`q_684e6637` / `i_po_issues_…`), and my check compared adjacency in a *bot-only*
projection of the log, which hides the respondent's answer sitting between them.
It now compares adjacent entries in the raw log, which is the actual signature of
a duplicated bubble. The run-to-run variation also showed the harness wasn't
comparable across code changes, so it now seeds `Math.random` inside the page.
With that, the decisive check: **the full conversation transcript is
byte-identical before and after the change** on two studies (18 and 39 turns),
against the real client bundle. All five active studies plus a full Spanish run
pass; jsdom 17/17 with both snapshots unchanged; suite 1,730 green.

### The first-open loader was invisible because it was queued behind its own page

Owner item ⑦ ("no loading Lottie on FIRST dataset open") was still live, and the
diagnosis carried in memory — *"there is NO route-level loading UI anywhere; add
`app/analyze/[datasetId]/loading.tsx`"* — was **wrong**. A screenshot settled it:
the shell, the tab strip, the row count and the module were all rendered, and the
content area showed the module's own pending sentence, *"Counting themes across
the dataset…"*, with nothing above it. The server render had already finished, so
a route-level Suspense boundary would have fixed nothing.

`components/ui/LottieLoader` was mounted and running the whole time. Instrumenting
it showed `loadAnimation` being called with a valid container — and the container
staying empty for 15+ seconds. The network trace gave the answer: the request for
`/morphing-particle-loader.json` was **issued and never answered**. Not a 404, not
a failure — no response at all.

It's client connection queueing. A first dataset open saturates the origin with a
ten-page serial row download plus the theme-counts and signal-stats scans, and
over HTTP/1.1 Chrome allows ~6 connections per origin. **The loader's own asset
sits in the queue behind the very work it exists to announce.** The dev server
returned that same file to `curl` in 3ms throughout, so it was never server
slowness.

Fix: bundle the animation (`animationData`) instead of fetching it by `path`.
~8.6KB in the shared chunk. Verified on a 42,224-row collection with the cache
cleared: the animation now appears ~530ms after the pending state starts (the
residual is the `lottie-web` dynamic chunk) and stays for the whole ~9s wait —
confirmed by DOM assertion **and** by looking at the screenshot. Deleted the
now-orphaned `public/morphing-particle-loader.json`; the component copy is the
single source. The general rule is now in ENGINEERING.md: *a progress indicator
may not have a runtime dependency on the resource whose contention it reports.*

**Two verification traps, both mine, both worth remembering.** My first assertion
was "some `<svg>` on the page is ≥80×80" — it matched an unrelated page icon and
went green while the loader was visibly blank; the check now scopes to an `<svg>`
inside the loader's own container. Then I read a screenshot from a *previous* run
(an edit had silently dropped the screenshot call) and briefly concluded the fix
hadn't worked. Confirm the artefact you're reading came from the run you think it
did.

Harness: `scripts/_verify_dataset_loading.mts` (untracked, KEEP). It seeds a
**throwaway** user — never the owner's account, which `_mint_test_cookie.mjs` once
locked out — and reaps it before *and* after. Writing it caught a third instance
of the silent-empty-result trap: `auth.admin.listUsers` returns
`{ error: 'Database error finding users', users: [] }` on this project, so a reap
that reads only `data.users` looks exactly like "nothing to clean up". It now
resolves ids from `public.users` and checks every error.

### Theme counts: one population, not two

Closed the open owner decision (server 1,817 vs client 1,962). It was not a
preference call — the client number was arithmetically inconsistent with the
denominator it was being divided by.

The theme card divides by the **substantive** comment base (the 2026-07-14
two-count decision), and the server's per-theme counts come from
`theme_counts_substantive` (sql/181) over that same base. But `recountThemes` —
the client recount that runs once rows land and *overwrites* the server's
numbers — counted matches over all **non-empty** text. Numerator and denominator
came from different populations, so a theme could be credited with hits inside
comments the base excludes.

Fixed by gating `recountThemes` on `isSubstantiveText`, **per field**, matching
the stored SQL map (`substantive ? fld`, any field) rather than testing the
joined text — otherwise two short answers add up to a passing word count. Six
tests, including that one.

The verification that matters is population parity, not a spot number: the JS
gate now selects **exactly** the rows the server counts over — 19,708/19,708,
19,133/19,133 and 27,234/27,234 across three TEST datasets, zero divergence in
either direction. sql/178 stores the verdict per comment precisely so JS and SQL
can't drift; the client finally reads the same population.

⚠️ **Numbers move, and the old ones were wrong.** Review datasets shift a little
(Cheddar's Food Quality 4,455 → 4,275, 39% → 37%). Survey datasets shift a lot:
Carrabba's GSS Food Quality read **89%** — 8,393 matches over a 9,482 substantive
base — and now reads **58%**. Service Excellence 83% → 59%. A card claiming 89%
of respondents raised food quality was counting one- and two-word answers the
denominator never included. Anything exported before today won't reconcile; same
class of one-way move as sql/191.

**A verification trap I walked into and had to back out of.** My first before/after
comparison pre-filtered rows to non-empty and passed them to `recountThemes` —
which now applies the substantive gate itself, so it measured the new rule twice
and printed a flat "no change" across every dataset. I nearly published that.
The "before" arm has to compute the old rule independently
(`commentMatchesTheme` over the non-empty set); once it did, the 89% → 58% shift
appeared immediately. **When you change a function, your baseline cannot run
through it.**

### The four `<img>` → `next/image` conversions

All four `@next/next/no-img-element` warnings were the same asset —
`/mco/logo-mark.png` (275×120) across `demo/mco/CanvasShell`,
`demo/mco/WelcomeCard`, `m/[code]/MobileChat` and `m/[code]/page`. Every call
site sizes by CSS height with `width: auto`, which is the clean case: passing the
intrinsic dimensions just gives `next/image` the ratio to reserve, and the
existing CSS keeps controlling the rendered size. Ceiling 176 → 172.

QC'd with `scripts/_verify_mco_logo.mts` (untracked, KEEP) across desktop, kiosk
and the mobile pickup card, plus screenshots.

**And the QC caught me over-asserting.** My first check was "rendered box ratio
must match 275/120". Two sites failed it — the topbar chip measured 48×24
(2.000) on desktop and 24×32 (0.750) in kiosk. That looked like exactly the
distortion the conversion risked. It wasn't: `.avatar-mco img` carries
`object-fit: contain`, so the image letterboxes inside a fixed chip and the box
ratio is meaningless there. An A/B — stash the change, re-measure, restore —
returned **identical** geometry on both arms, and the before/after screenshots
are indistinguishable. The check now passes when the ratio matches **or**
`object-fit` is `contain`.

Worth stating plainly: a red check is a hypothesis, not a verdict. Two of these
three sessions' scares came from an assertion that was wrong about the thing it
was measuring rather than from the code under test.
