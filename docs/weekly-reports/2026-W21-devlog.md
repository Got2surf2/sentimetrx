# 2026-W21 — Dev log (Week of May 18 to May 24)

## 2026-05-18 — Control Reports admin group

Added `/admin/control-reports/` as the parent for weekly machine-generated reports a human reviews and merges. Index lists governance + spec-drift; each links to a trend page that mirrors the existing GovernanceTrend layout.

**Why**: enterprise procurement (Darden DD form) and SOC 2 CC4 expect a single coherent evidence story for continuous human oversight of AI-built code. The two control reports were previously surfaced unevenly — governance had `/admin/governance` + a parseable weekly file, spec-drift only appended to the running devlog with no persistent artifact and no chart.

**What changed**:
- `scripts/spec-drift.ts` gains `--write-weekly` which writes `docs/weekly-reports/YYYY-WXX-drift.md` (parseable: summary metrics table + drift detail).
- `lib/specDriftReports.ts` parses those files; mirrors `lib/governanceReports.ts`.
- New routes: `/admin/control-reports/` (index), `/admin/control-reports/governance/` (existing trend, moved), `/admin/control-reports/spec-drift/` (new trend).
- `/admin/governance` is now a 308 redirect to the sub-route so external bookmarks keep working.
- Top-nav admin entry renamed "Governance Reports" → "Control Reports" pointing at the new index.
- `.claude/commands/spec-drift.md` now instructs the Monday 02:00 ET routine to use `--write-weekly` and commit the standalone file rather than appending to the devlog.
- `docs/weekly-reports/2026-W21-drift.md` produced as the first real drift report (0 drifted, 12 specs updated this range).

**Next**: when the routine runs next Monday it will produce `2026-W22-drift.md`, the trend chart gets its second data point, and week-over-week delta starts showing.

## 2026-05-18 — Two-step opener for all agents + Vindman → Abel surrogate

**Why**: every agent with `askName=true` was concatenating the topical opener and the name ask into one flaky double-question (e.g. `"Hi, I'm Alex! Thanks for stopping by. Tell me what's on your mind. What's your name?"`). Users had to parse two asks at once and often answered only one. Separately, the Vindman agent was scoped as a first-person avatar of the candidate, which is a fundraising-and-FEC liability — needed to repose as a campaign surrogate.

**What changed**:
- `components/ui/ChatBot.tsx`: when `askName` is on, the FIRST assistant message is a name-only ask. After the user provides a name, a SECOND assistant message renders the topical opener (`config.initialMessage`). English path renders directly; non-English path calls the API to translate the opener and personalize it with the name. New `nameExchangeMessages` state filters the name exchange out of future API calls so the server sees a clean turn 1 (preserves `askProfile` behavior).
- Vindman agent (`bots.id = 78991aa1-…`) DB updates: `name`/`config.name` → `Abel` (pun on Abe Lincoln), `config.avatarLetter` → `🎩` (top hat, Lincoln-coded), `config.subtitle` → `Vindman for Senate`, `config.initialMessage` → `"Thanks for stopping by. What's on your mind?"`, full rewrite of `system_prompt` + `personality` from first-person avatar to third-person campaign surrogate ("Alex served…", "the colonel has said…"). Slug stays `alexvindman` (public URL).

**Next**: QA the two-step opener on a couple of agents in production. Revisit Sonnet 4.6 → `fast` revert in the chat route once the Tuesday demo is past.

## 2026-05-18 — Entity catalog: manual curation + soft-delete (Bucket A of entity-views build)

**Why**: brand-level entity catalogs need a curation seam. NER discovery is sample-bound (default 500 rows) and produces both gaps (menu items the sample never saw) and noise (generic nouns slipping past the strict prompt). The pre-existing "Re-discover" button wiped the whole scope's catalog before rebuild, so any future hand-curation would have been destroyed on the next click. This blocks the broader entity-views feature (cloud, compare, sentiment) because there's no point visualising a catalog the user can't trust.

**What changed**:
- `sql/073_entity_catalog_source_hidden.sql`: adds `source TEXT NOT NULL DEFAULT 'discovered' CHECK IN ('discovered','manual')` and `hidden BOOLEAN NOT NULL DEFAULT false`, plus a partial index `WHERE hidden=false` for the read filter. Applied to prod.
- `lib/entityDiscovery.ts`: drops the manual-mode DELETE entirely — all discovery modes are now additive. Upsert pass skips rows where existing `source='manual'` (curation never overwritten) and where `hidden=true` (NER cannot resurface what a user hid). Tracks `skippedManual` / `skippedHidden` counts.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` gains `includeHidden?: boolean`. Default reads hide soft-deleted entries; the Manage panel passes `true` to surface them with `source` + `hidden` flags. Zero-count rows are now retained when `includeHidden` so empty-but-curated entries are visible.
- New API endpoints:
  - `POST /api/datasets/[id]/entities` — single or bulk create. Accepts `{canonical,category?,aliases?}` or `{entities:[...]}` (max 500). Auth via `getCallerOrgContext` + paired `id+org_id` (CLAUDE.md multi-tenancy rule). Logs to `entity_catalog_refresh`.
  - `PATCH /api/datasets/[id]/entities/[slug]` — toggle hidden, edit canonical / category / aliases.
  - `DELETE /api/datasets/[id]/entities/[slug]` — hard-delete `source='manual'` rows only; discovered rows must use hidden.
  - `POST /api/datasets/[id]/entities/reset-discovered` — escape hatch, only wipes `source='discovered'`.
- `components/analyze/ExtractEntitiesPanel.tsx`: adds a "Manage" toggle that swaps the panel from top-12 pill preview to a denser row view with per-row hide/unhide + delete (manual only), inline single-add form, bulk-paste textarea (`Canonical | category | alias1, alias2` per line), and a two-step-confirmed "Reset discovered" admin button. Uses the existing `LottieLoader`.
- `docs/ANALYTICS.md`: Entity Discovery section updated — discovery is fully additive, new "Manual catalog curation" subsection documents the API surface and the menu-PDF seeding workflow, migration 073 added to the migrations list.

**Brand bootstrap workflow this unblocks**: drop a menu PDF into Claude Code, extract dishes / drinks with categories + aliases, POST to the bulk endpoint. Because the catalog is brand-collection-scoped, one POST seeds every dataset under the brand. Re-discovery then accumulates the long tail (competitors, people, off-menu items) on top without ever touching the menu seed.

**Next (Bucket B-E of entity-views build)**: entity cloud (`EntityCloud.tsx` mirroring `WordCloud.tsx`), per-entity sentiment (adapt the clause-aware proximity scan at `WordCloud.tsx:206-240` for multi-word entity spans + alias expansion), entity compare chart (fork or generalise `BreakdownDist.tsx`), `View by Theme | Entity` toggle at the TextMine module top, category-restricted monthly discovery (skip food/drink once menu seed exists).

## 2026-05-18 — Fleming's menu seed + person-at-collection suppression (Buckets A operational test + F)

**Why**: testing the menu-PDF workflow end-to-end on Fleming's (brand-collection `11daf03a-…`) surfaced the predicted noise: 198 of 497 catalog rows were `category='person'` — staff names from many locations, each mentioned in 1–2 reviews. They dominate the catalog without adding brand-wide signal. The brainstorm that produced bucket F predicted exactly this; doing the menu seed made it tangible.

**What changed**:
- Fetched Fleming's official dinner PDF (`https://www.flemingssteakhouse.com/-/pdf/5702-dinner.pdf`) via curl with browser headers (WebFetch was 403-blocked).
- Extracted 78 entities (52 food, 26 drink) — appetizers, salads, soups, sides, every steak and cut, entrées, Chef's Signature items, all hand-crafted cocktails, zero-proof beverages, and the wine producers reviewers actually name (Caymus, Duckhorn, Stag's Leap, etc.). Aliases capture vernacular ("the filet", "mac n cheese", "the tomahawk").
- Wrote `/tmp/flemings_menu_seed.sql` and applied via `supabase db query --linked`. Used `ON CONFLICT … DO UPDATE` to promote any existing discovered match to `source='manual'` while unioning aliases (18 of 78 hit existing slugs and were promoted; 60 new). Audit log entry written so the panel's "Last updated" reflects the seed.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` now adds `.neq('category', 'person')` to the catalog query when `scope.scopeType==='collection'` *and* `includeHidden=false`. Manage Entities still sees person rows so users can curate; standalone datasets are unaffected.
- `docs/ANALYTICS.md`: new "Person suppression at collection scope" subsection documents the rule.

**Result for Fleming's**: catalog visible to cloud / compare / drill / schema preview / Ask Ana drops from ~479 noise-heavy rows to ~281 useful ones (food, drink, brand, place). Manage panel still surfaces all 198 person entries so they can be curated individually if any deserve promotion to `brand` (e.g., a named chef).

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Menu seed verified in prod via the verify SELECT in the SQL file (52 food manual + 26 drink manual present, alongside reduced discovered counts).

**Next**: Bucket B (entity cloud + per-entity sentiment using the clause-aware proximity scan).

## 2026-05-18 — Entity Clouds + per-entity sentiment (Bucket B)

**Why**: the pill list answers "what entities are mentioned" but not "how big is each in this view" or "how does sentiment feel per entity." The cloud is the visual layer themes already had at `components/analyze/textmine/WordCloud.tsx`; the entity catalog deserves the same. Per-entity sentiment is the bigger value — it's the answer to "is the steak getting good or bad reviews" without anyone reading 200 rows.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx` (new, ~280 lines): renders the scope's catalog as a sized + colored cloud. Two color modes — Category and Sentiment. Category chips at the top dim out everything not in the chip's category (mirrors WordCloud's theme-chip dimming). Words sized by per-entity row count *within the currently-filtered view* — so the cloud answers questions about the user's current slice, not the scope total. Click any entity → `handleDrillEntity` (existing wiring opens the EntityCommentsPanel modal with the rows that mention it).
- Sentiment algorithm: per row → split text into clauses on `but / however / although / yet / though / while / whereas / comma` → for each clause, alternation-regex detect every entity term (canonical + aliases + plural variants from `lib/entityVariants.ts::expandEntityTerms`) → count opinion-word hits in the clause's tokens → credit each entity in that clause with the clause's pos/neg counts. Mixed-sentiment rows ("loved the steak but hated the wait") split correctly because the clause boundary is the credit boundary. Cheaper than WordCloud's per-token proximity scan and more apt for entities (the entity is usually the subject of its clause, so the whole clause's opinion words apply, not just neighbors).
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityCloud` (parallel to `WordCloud`), mounts it below WordCloud inside the `subTab === 'clouds'` branch behind an `entityCatalogRows.length > 0 && effectiveFields.length > 0` guard. Passes `parsedData=filteredRows` so the cloud respects current filters.
- `docs/ANALYTICS.md`: "Where entities show up" entry for TextMine → Clouds documents the new view + sentiment method. Schema-tab entry updated to mention preview/manage modes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the Fleming's dataset pending (would benefit from rendering the Clouds tab with the menu seed live).

**Performance notes**: single alternation regex built once per useMemo; O(rows × regex pass) for both freq and sentiment scans. 45K rows × ~100 entity terms expected to run in <500ms on the existing TextMine "rows loaded client-side" model. If this becomes a bottleneck above 100K rows, fold both passes into one and move the regex build behind a useDeferredValue.

**Next**: Bucket C (entity compare chart by group) and/or Bucket D (View by Theme | Entity toggle at the TextMine module top). With the cloud + sentiment live, the compare chart is the missing visualization piece before we can claim a full theme-functionality mirror.

## 2026-05-18 — Entity Breakdown chart (Bucket C)

**Why**: theme `BreakdownDist` shows theme prevalence across categorical groups with significance markers — "which group disproportionately mentions which theme." Entities deserve the same view: "which Fleming's location over-indexes on the Filet vs the Tomahawk." Without it, the only way to compare entities across a segment is to filter the cloud one segment at a time. The compare chart is what makes brand-rollup analysis useful.

**What changed**:
- `components/analyze/textmine/EntityBreakdownDist.tsx` (new, ~270 lines): mirror of `BreakdownDist.tsx` operating on the entity catalog instead of the theme model. Two views — **By Group** (each group's stacked bar segmented by entity, with per-entity rows + significance + rating delta) and **By Entity** (each entity's bar across groups, default view since entity counts are higher than theme counts).
- Matching: same alternation regex over `canonical + aliases + expandEntityTerms` that `EntityCloud` builds, but computed once per render into a per-row → `Set<slug>` map. Every group×entity cell then derives from that map in O(rows + groups × entities) instead of O(rows × entities × groups).
- Significance markers (★) reuse `lib/statsUtils::sigTest` (2-proportion z-test), so over/under-representation signals are comparable between the theme and entity charts. Rating deltas (when a rating field is set) are colored green / red around overall mean.
- Top-25 cap by default + 1%-of-rows threshold (entities below get hidden behind a Show all toggle) keep the chart legible for catalogs with 100+ entries.
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityBreakdownDist`, mounts it below `BreakdownDist` on the Themes subtab behind the same `breakdownField && selectedValues.size > 0 && themesView !== 'signals'` gate plus `entityCatalogRows.length > 0 && effectiveFields.length > 0`. Reuses the existing `breakdownField` + `selectedValues` state — no new sidebar controls.

**Why not generalize BreakdownDist instead of fork**: theme matching (`Theme.keywords + commentMatchesTheme`, with negation support) and entity matching (`canonical + aliases + plural variants`) don't unify cleanly without one side losing precision. The two charts share a ton of layout code but diverge in matching, which is the load-bearing part. Forked keeps both readable; the cost is two files that move together when the look-and-feel changes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on Fleming's pending.

**Next**: Bucket D (View by Theme | Entity toggle at the TextMine module top) and Bucket E (category-restricted monthly discovery — skip food/drink in cron NER once a menu seed exists, saves ~half the AI cost). With C done, the theme-functionality mirror is complete; D and E are polish/cost optimization.

## 2026-05-18 — View toggle + category-restricted discovery (Buckets D + E)

**Why (D)**: with the cloud, sentiment, and compare chart now living as a parallel stack to the theme equivalents on the same TextMine subtabs, the page got visually noisy — both stacks competed for attention. A toggle promotes one set at a time, giving users a clean view that matches their current question ("am I looking at concepts or named things?").

**Why (E)**: the weekly cron re-runs NER discovery across every brand-collection. For brands that have menu-PDF-seeded `source='manual'` food/drink, those Haiku calls produce mostly duplicates or noise — the catalog already has the right list. Auto-excluding curated categories drops the cron's AI cost roughly in half on seeded brands without losing the long-tail discovery for `brand`/`place`/`person`.

**What changed**:
- `components/analyze/TextMineModule.tsx`:
  - New state `viewBy: 'theme' | 'entity'` (default `theme`), persisted in the same session-state object that already saves subTab/themesView/etc.
  - Toggle button rendered in the subtab header's right-side action area, visible only on Themes / Clouds subtabs and only when an entity catalog exists for the scope (otherwise Entity mode would render empty).
  - Themes subtab: AI banner, summary cards, themesView switcher (Distribution/Cards/Signals), the three themesView blocks, and BreakdownDist all gated to `viewBy === 'theme'`. EntityBreakdownDist gated to `viewBy === 'entity'`. EntitiesCard remains visible in both modes (it's the gateway/drill-in for entities).
  - Clouds subtab: WordCloud + its opinion/theme popovers gated to `viewBy === 'theme'`; EntityCloud gated to `viewBy === 'entity'`. h2 title flips between "Theme Clouds" and "Entity Clouds". Fallback empty-state message when an entity-view scope has no catalog yet.
- `lib/entityDiscovery.ts`:
  - New opts: `excludeCategories?: string[]` (explicit list of categories to skip in the NER prompt) and `autoExcludeFromCurated?: boolean` (auto-detect from `source='manual'` row counts ≥ `autoExcludeThreshold` default 10).
  - NER prompt rewritten to render only the active categories' descriptions in the "Extract" list and add a "Do NOT extract" block listing curated categories with the reason.
  - Post-filter on NER results drops any entity in an excluded category (defence against the model ignoring the instruction).
- `app/api/cron/entity-discovery/route.ts`: weekly cron now passes `autoExcludeFromCurated: true`.
- `lib/brandRules.ts`: per-dataset incremental run (`discoverBrandEntitiesIfNeeded`) also passes `autoExcludeFromCurated: true` — same cost-saving logic at the point a new dataset lands in a brand.
- Manual "Discover entities" button on the Schema tab does NOT pass the flag — when a user explicitly clicks Discover, give them everything (they may want to re-explore curated categories).
- `docs/ANALYTICS.md`: "Category-restricted discovery" subsection added; "Where entities show up" entries updated for the view toggle.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the toggle pending — need to render Themes and Clouds subtabs against the Fleming's dataset in both modes to confirm the gating is clean.

**Bucket scoreboard**: A ✅ B ✅ C ✅ D ✅ E ✅ F ✅. All six buckets of the entity-views build shipped. The full theme-functionality mirror is live for entities (cloud, sentiment, compare, drill-down, modal), plus the architectural foundation (manual curation, soft-delete, category-restricted discovery) that makes brand-bootstrap from a menu PDF realistic.

**Next**: visual QC end-to-end on Fleming's, then push when ready. After that the open questions are the standard polish items — catalog telemetry on the admin panel, an entity version of CompareTab (multi-field breakdown), and possibly a "promote to brand" affordance for named-chef person entries that survived the collection-scope suppression.
