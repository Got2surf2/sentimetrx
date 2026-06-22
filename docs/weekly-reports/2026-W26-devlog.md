# 2026-W26 — Dev log (Week of Jun 22 to Jun 28)

## 2026-06-22 — Rubio's Coastal Grill pitch deck, rebuilt from real review data

**Why**: A prior session produced a Rubio's pitch deck (`~/Downloads/Rubios_Pitch_Deck.pptx`) whose numbers were generic/assumed ("4.2★", "post-bankruptcy, 3–4 silent failures dragging the brand down") — a framing that would have torched credibility against an ops team that knows its own ratings. We have the actual data loaded in Sentimetrx (10,600 Google reviews, 81 locations), so rebuild the pitch on real, auditable numbers and let the data set the story.

**What changed**:
- `docs/RUBIOS_PITCH_ANALYSIS.md` (NEW) — source-of-truth spec: dataset id, every headline metric + how it was computed, the competitive method, and the lifetime-vs-trailing caveat. Makes each deck number traceable if questioned in the meeting.
- **The data reframed the whole pitch.** Real findings vs the prior deck: overall **4.56★** (not 4.2), and a genuine turnaround **4.17→4.67 over 5 quarters**; **only 1 store below 4.0★** (not "3–4 failures"). The real problem is *variance* — a **0.88★ best-to-worst spread that is geographic**: top 10 is 9/10 California, bottom 10 is 8/10 AZ/NV. Plus **47% of complaints get no owner response**, and on live Google ratings **Rubio's (≈4.27) beats Chipotle (3.53) and Del Taco (3.79) in every market** — the only peer above is **Cava (4.69)**, the threat to watch.
- `datanautix-homepage/Rubios_Datanautix_Pitch.pptx` (NEW, 12 slides) + `scripts_build_rubio_deck.py` (python-pptx generator, datanautix.com brand palette: cream / orange `#E85A1A` / teal `#2A7A6F`; native trend/variance/competitive charts; a source line on every data slide). Deck saved to `~/Downloads/` next to the original.
- Analysis scratch (sentimetrx, **uncommitted**, kept while the opp is live): `scripts/_rubio_{discover,analyze,themes,competitors}.ts` + `data/_rubio_{locations,lowstar,highstar,competitors}.json`. `_rubio_analyze.ts` is brand-agnostic given a `dataset_id`; `_rubio_competitors.ts` benchmarks any brand/market list via live Maps.
- Spend: ~**$0.06** DataForSEO (live Maps competitor pull; balance 47.36→47.30).

**Verify**: All numbers reproduced from `dataset_id d4e53aec…` and saved to the spec doc. Deck rendered to PDF via LibreOffice and eyeballed all 12 slides — fixed two-line-title/body collisions on slides 2/4/5/6/9. Docs only in-repo; deck + scripts are artifacts, not product code (no behavior change, nothing pushed). Per the W25 scratch-script convention, the `_rubio_*` scratch is delete-after-opp, not commit.

## 2026-06-22 — Build-cost bleed + average reference line on charts

**Why**: Owner saw 5 back-to-back Vercel production builds and asked why, given they actively avoid paying for builds. Root cause was two-fold: (1) the Vercel **Ignored Build Step** was an inline one-liner that skipped previews but **always built on production**, so docs-only governance merges (`af8aa39`, spec-drift PR #20) each burned a full ~$8-10 prod build; and (2) the Monday governance automation opened **two** separate docs-only PRs (spec-drift + weekly-report), structurally 2 merges/2 builds a week.

**What changed**:
- **Vercel Ignored Build Step repointed** (via API, project `prj_c8oyt1…`) from the inline `if production exit 1` one-liner to `bash scripts/vercel-ignore-build.sh` — the repo script (present on main since Jun 16, never wired) that *also* skips production builds when a commit touches **only `docs/`**. Net: docs-only merges to main now cost $0; previews still always skipped. Fail-safe — builds whenever `HEAD^` is unreachable (shallow clone) so a deploy is never silently skipped.
- **Governance routines merged to one PR**: the cloud "Weekly governance report" routine (`trig_016j…`, Mon 08:00 UTC) now runs the spec-drift report **and** the audit, commits both files on one `governance/WK` branch, and opens **one** combined PR. The standalone "Spec drift weekly report" routine (`trig_01XyQ…`) is **disabled**. One Monday review item instead of two.
- **Charts: overall-average reference line** (`components/analyze/ChartsModule.tsx`, `BarAggInner`) — Average-mode Bar/Column charts now overlay a dashed "Avg N" line at the **count-weighted** mean across all groups (true value-field mean, not unweighted bar mean). Both orientations + taxonomy-dimension averages. Requested by owner off a Rubio's "Avg Star Rating by Location" chart.

**Verify**: `npx tsc --noEmit` clean. Ignored Build Step + routine changes confirmed via API read-back. Chart change is render-only — owner to eyeball the line in TextMine → Charts → Average. Infra changes are live (Vercel setting + cloud routines); the two repo files are committed **local only**, not pushed.

## 2026-06-22 — Outlet Report: cross-outlet "Leaderboard" (top/bottom per theme & dimension)

**Why**: The Outlet Report answered "how does THIS outlet compare across all themes." Owner wanted the inverse for a multi-location brand: for each theme and dimension, *which* locations are the top/bottom performers — so you can see at a glance who's lagging on, say, Service across the whole chain. Building block toward a laggard-improvement predictor (next).

**What changed**:
- **`lib/outletReport.ts` refactored to one-scan/two-views.** Extracted `scanDataset()` (the single pass over `dataset_rows_flat` + `dataset_row_field_taxonomy` that builds per-outlet & chain `{pos,neg,total}` accumulators). `buildReport()` (per-outlet vs peers, unchanged behavior) and the new `buildLeaderboard()` both read the same scan. New `computeOutletBundle()` returns `{report, leaderboard}` from a single scan; `computeOutletReport` kept as a thin wrapper for compat.
- **`buildLeaderboard()`** — per theme and per dimension item, ranks the outlets that clear `MIN_N_OUTLET` (≥6 mentions) by **net-positive rate** (signed pos/neg — not bare occurrence), item gated by `MIN_N_CHAIN`/`MIN_POLAR_SHARE`. Carries top-10+bottom-10 per item (`truncated` when >20 qualify). `defaultK` = 3 for ≤15 outlets else round(20%×count) capped at 7; `maxK` = min(10, ⌊count/2⌋).
- **UI**: new **Leaderboard** tab in `OutletReportTabs.tsx` (dataset-wide, ignores `?outlet=`) with a **slider** (1…maxK) to show more/less per side, defaulting to `defaultK`. Cards show Top K / Bottom K with chain baseline; collapses to a single best→worst list when `qualifying ≤ 2K`; "+N in between" note when truncated. Page now calls `computeOutletBundle`.

**Verify**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Refactor is behavior-preserving for the existing tabs (logic moved, not changed); no dedicated outletReport test exists. Owner to eyeball the Leaderboard tab + slider on a real multi-location dataset (e.g. Rubio's, 81 outlets). LOCAL/unpushed. **NEXT: Part 2 predictor prototype** — per-review logistic on *negative-mention* rates → per-laggard gap-to-median × severity → projected ★ lift + what-if scenarios ("lift Service laggards to median", "which units give the biggest overall lift").
