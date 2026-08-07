# 2026-W32 devlog (Aug 3 – Aug 9)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## Dimensions: rating-based sentiment fallback for neutral "who" subs (Aug 7)

WHY: On the Flemings dataset the "Service — who served you" sub-cards (Server, Manager, Chef) showed "No sentiment signal" despite carrying star ratings and large mention counts. Cause is by-design: the `touchpoint` axis entities are all *neutral* keyword phrases (`lib/taxonomyKeywords.ts:44` — "Pure category words: polarity neutral, context fills in pos/neg"), so they accumulate mention counts but never pos/neg assertions → `posPct` stays null → "No sentiment signal", even though the sibling `attribute` axis carries the actual service sentiment. Fix: when a sub has no polarised mentions (`pos+neg == 0`), `posPct` now falls back to the **star ratings of the mentioning reviews** (share rated ≥4★), consistent with the Ratings-=-all-reviews principle and the emotion axis's existing ≥4/≤3 rating split. New `SubStat.sentBasis` (`'keyword' | 'rating' | null`) records the method so the card labels the fallback "· by rating" and the footnote stays honest — the two denominators are never silently blended. Touches `lib/taxonomyRollup.ts` (accumulate subPosRows/subNegRows, finalize fallback) + `components/analyze/TaxonomyModule.tsx` (label) + `docs/TAXONOMY.md`. Requires a rollup refresh (re-run the keyword classify on the Dimensions tab) to regenerate the stored rollup — the fallback reads only already-embedded row ratings, so no row re-classification is needed. tsc clean; 1602 tests green (3 new rollup cases).

---
