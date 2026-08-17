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

