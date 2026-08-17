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

