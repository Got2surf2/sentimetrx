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
