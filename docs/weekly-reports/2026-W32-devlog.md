# 2026-W32 devlog (Aug 3 – Aug 9)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## Dimensions: rating-based sentiment fallback for neutral "who" subs (Aug 7)

WHY: On the Flemings dataset the "Service — who served you" sub-cards (Server, Manager, Chef) showed "No sentiment signal" despite carrying star ratings and large mention counts. Cause is by-design: the `touchpoint` axis entities are all *neutral* keyword phrases (`lib/taxonomyKeywords.ts:44` — "Pure category words: polarity neutral, context fills in pos/neg"), so they accumulate mention counts but never pos/neg assertions → `posPct` stays null → "No sentiment signal", even though the sibling `attribute` axis carries the actual service sentiment. Fix: when a sub has no polarised mentions (`pos+neg == 0`), `posPct` now falls back to the **star ratings of the mentioning reviews** (share rated ≥4★), consistent with the Ratings-=-all-reviews principle and the emotion axis's existing ≥4/≤3 rating split. New `SubStat.sentBasis` (`'keyword' | 'rating' | null`) records the method so the card labels the fallback "· by rating" and the footnote stays honest — the two denominators are never silently blended. Touches `lib/taxonomyRollup.ts` (accumulate subPosRows/subNegRows, finalize fallback) + `components/analyze/TaxonomyModule.tsx` (label) + `docs/TAXONOMY.md`. Requires a rollup refresh (re-run the keyword classify on the Dimensions tab) to regenerate the stored rollup — the fallback reads only already-embedded row ratings, so no row re-classification is needed. tsc clean; 1602 tests green (3 new rollup cases).

---

## Stats: logistic Bottom Line — Plain English now genuinely differs from Expert (Aug 7)

WHY: On the logistic regression result the "Bottom Line" card's Expert and Plain-English toggle rendered identical text. Cause: `logitBL(naive)` in `StatsModule.tsx` only branched on `naive` for the "no significant terms" case — the main (significant-terms) branch ignored the flag and always emitted the odds-ratio sentence ("5 of 6 terms significantly affect the odds… cuts the odds 0.06× (−94%)… McFadden pseudo-R² = 0.06"), so a non-technical owner got the same jargon on both toggles. Added a real plain-English branch matching the house `*BL_naive` voice in `lib/statsUtils.ts`: names the single biggest lever, phrases its effect as "makes that ~X% more likely" / "cuts those chances by ~X%", and translates pseudo-R² into "explains only a small part / a good part / most of what's going on" — no "odds", no "McFadden", no "pseudo-R²". Expert branch byte-identical to before. UI-string logic only (`logitBL` is inline in the component, not unit-tested); tsc clean, stats + full suite green, no lint delta.

## Stats: both regression Bottom Lines given a Gemini-style plain-English brief (Aug 7)

WHY: Owner compared our Plain-English toggle to Gemini's breakdown of the same logistic output and wanted ours as complete for a non-technical reader. Enriched the logistic plain branch to a full layperson brief — target, "a real pattern, not a fluke (holds across all N responses)", the biggest lever in intuitive terms, and the model-fit caveat — pulling the sample size from `fit.d.n`. Gave the **linear** regression the same treatment: `regrBL_naive` now states the target + sample size + reliability + fit% in plain words and lists **directional drivers** ("Linked to a higher / lower <outcome>: …") by coefficient sign, replacing the old flat "the factors that matter most are: …" list. Expert registers for both are unchanged. `docs/ANALYTICS.md` updated. tsc clean; stats (36) + full suite green; no lint delta.

---

## Analyze: fix "Manage members → Save changes does nothing" on collections (Aug 7)

WHY: Owner reported adding a dataset to a collection and clicking Save changes did nothing. Root cause was a stale-closure bug in `AnalyzeClient.tsx`, not the modal or the API — the add always succeeded server-side. `ManageMembersModal.save()` calls `onChanged()` then `onClose()` synchronously in one tick; `onChanged` did `setManageDirty(true)` and `onClose` read `const dirty = manageDirty` to decide whether to `window.location.reload()`. Both callbacks are closures from the same render, so `onClose` saw the pre-update `false`, skipped the reload, and the grid never refreshed — the member was in the collection but invisible until a manual page refresh, which read as "Save does nothing." Fixed by tracking the dirty flag in a `useRef` (readable synchronously in the same tick) instead of `useState`. Swept the class: no other parent reads a sibling-callback-set state value synchronously in an onClose. tsc clean; 1602 tests green.

---
