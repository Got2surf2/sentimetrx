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
