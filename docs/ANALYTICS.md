# Analytics / TextMine Module

> **Update (2026-06-04).** Recordings was **promoted out of Analyze** into the top-level **Town Hall** product (own nav item + `/recordings/*` routes; gated on `features.recordings` alone). The `/analyze` header Recordings button and the `/analyze/new` source tile were **removed**. Analytics is now the parent feature only for **googleReviews / reddit / substack** (`effectiveFeatures` forces those off when `analyze` is off — recordings is no longer in that set). A Town Hall recording still **mirrors into a `source='recording'` dataset** that lives in Analyze as the analytics view (TextMine/Charts/Stats; `buildRecordingSchema()` incl. the **Sentiment** facet) — reachable from the report's "Open in Analytics" cross-link. The Datanautix PowerPoint export (`POST /api/recordings/[id]/export/pptx`) and the report now live under the Town Hall product (`docs/RECORDINGS.md`).

## Overview

Full-stack text analytics engine. AI-powered theme mining, lexicon-based sentiment scoring, 13+ chart types, statistical hypothesis testing, and consulting-quality PPTX export. Works with any data source: surveys, CSV uploads, Google Reviews, agent conversations, **PulseIQ town halls (both legacy `townhall_*` and new-substrate `town_halls`)**, Reddit/Substack/Regulations.gov ingests, and **recorded meeting Q&A** (`source='recording'`; see `docs/RECORDINGS.md`). Each new source type gets a `build<Name>Schema()` in `lib/datasetUtils.ts` that declares the schema_config (fields + `primaryTextField`, and — for relative-period filtering — an optional `primaryDateField`, ranked by `rankPrimaryDateField()`; see `docs/SAVED_VIEWS.md`) so TextMine/themes/stats work without per-dataset configuration; `buildRecordingSchema()` is the latest entrant (2026-05-30).

> **Substrate-aware town-hall sync (2026-05-22, Gap #5)**: `/api/townhall/sessions/[id]/analyze` POST projects both legacy `townhall_turns` AND phase-3 `conversation_turns` (joined through `town_hall_conversations` → `conversations`) into the same `dataset_rows_flat` row shape `{turn_id, participant_id, turn_number, bot_message, user_message, topic, topic_type, source, language, sentiment, sentiment_score, responded_at}`. Town-hall datasets are substrate-agnostic in Ana — TextMine + Stats + Charts + PPTX export don't need to know which substrate produced any given row. Multi-event customers (e.g. Vindman runs N town halls across districts) get one dataset per event; cross-event rollup combines datasets in Analytics. Theme model auto-populated from `town_hall_topics` (phase-3) or `townhall_themes` (legacy). See `docs/CONVERGENCE.md` § 10 changelog.

> **Bot-level town-hall attribution (2026-05-22, Gap #6)**: `/api/bots/[id]/analyze` row shape gains `town_hall_slug` + `town_hall_name` columns. Populated by joining `conversations` → `town_hall_conversations` → `town_halls` for each session_id in the sync batch. Empty string for 1:1 widget conversations (not linked to any town hall). Lets Ana filter a single bot's dataset by town hall — e.g. compare all Vindman events vs widget visitors inside one dataset, without combining per-event datasets. Same field added to `buildBotSchema()`. The per-event-dataset workflow (Gap #5) still works for users who prefer one dataset per event; this just adds the option to operate at bot scope with town-hall filtering.

Dataset cards on `/analyze` carry a **favorite star** (per-user, via the platform-wide `user_favorites` table in migration 075). Starred datasets float to the top of the `/analyze` grid above a thin orange divider, surface in the `★ Favorites` section on `/m` (PWA), and are listed on the desktop `/favorites` cross-resource page. The grid also exposes a **Sort** dropdown (Last updated / Created / Name, persisted in `localStorage.sentimetrx.sort.analyze`) — "Last updated" uses `last_sync_at` when present, falling back to `created_at`. None of this changes any analytics behavior.

---

## TextMine (Theme Detection & Analysis)

### Navigation IA (two-row bar — Target B, 2026-06-25)

TextMine is **four peer sections** in a persistent **two-row bar** — the shared `TextMineNav` (`components/analyze/TextMineNav.tsx`): **row 1 = sections** `[Themes] [Dimensions] [Entities] [Advanced Analytics]`, **row 2 = the active section's views** `Overview · Clouds · Compare · Comments` (uniform across the three lens sections; Advanced shows `Brand Health · Leaderboard · Outlet Deep-Dive`). Replaces the old flat sub-tab strip + the right-aligned "View by Theme/Entity" toggle (the toggle **folded into the Entities section** — picking a section sets the lens). The pure state-map + gates live in `lib/textmineNav.ts` (unit-tested in `tests/unit/textmineNav.test.ts`).
- **Chrome real-estate (2026-06-25).** To keep more of the viewport on data, three rows were collapsed: (1) the shared `DatasetMetricStrip` (records · signals · theme-fit · rating) and `ViewsBar` (saved views / period) now render in **one row** in `DatasetShell` — both accept an `embedded` prop that drops their own bar wrapper; this benefits *every* analyze tab. (2) The multi-text-field picker ("Review / Owner Response", shown only when a dataset has >1 open-ended column) **moved off its standalone bar onto the views-nav row** via `TextMineNav`'s `viewsExtra` right-slot. (3) The two nav rows were tightened (row 1 36px, row 2 32px). (4) The **Themes Compare** (`CompareTab`) header — previously a big "Group Comparison" h2 + ★ legend + paragraph + a bordered control *card* — was collapsed to the same single compact top-bar the Dimensions/Entities compares use (legend folded into the "?" hint), so all three Compare views are the same height.

- **`section`/`view` are the canonical state**; the legacy `subTab ∈ {themes,clouds,compare,comments,dimensions}` × `viewBy ∈ {theme,entity}` the content renderers key off are **derived** via the pure `deriveLegacy(section, view)`. This is required because `(subTab, viewBy)` can't represent the full grid — Dimensions×Clouds/Compare have no subTab encoding, and Dimensions vs Themes Comments both collapse to `subTab='comments'`. `sectionOf`/`viewOf` survive only for the sessionStorage back-compat map.
- **The cells** (re-keyed onto `(section, view)`): Themes×{Overview=Themes view, Clouds=Theme Clouds, Compare=`CompareTab`, Comments=unified panel}; Entities×{Overview=stat strip + `EntitiesCard`, Clouds=`EntityCloud`, Compare=`EntityCompareTab`, Comments}; Dimensions×{Overview=`<TaxonomyModule>`, Clouds=`DimensionCloud` (one flowing cloud of sub-buckets sized by mentions, colored by axis, with axis filter-chips + show-all — same card/sticky-header chrome as `EntityCloud`), Compare=`DimensionCompareTab` (same bar-chart UX as `CompareTab`/`EntityCompareTab`: a left-aligned "Break down by:" field selector + an axis selector → By Group / By Dimension horizontal-bar cards with over/under-index ★ markers, sort-by-impact, show-all; **two levels** — the default **"All" axis** compares the seven top-level axes against the field via the `tax_axis_crosstab` op (sql/133 `taxonomy_axis_crosstab` RPC = one scan UNION-ing the seven axis arrays; clicking a dimension drills into it), and a **single axis** compares that axis's level-2 sub-buckets via `tax_crosstab` (clicking a bar opens Comments). Bars not a matrix; no rating metric since the crosstabs carry counts only), Comments}. All three lens Clouds + Compare share one loader treatment (centered `LottieLoader size=120` on initial load, `64` transient overlay) so the views read identically. The section highlight is always correct because `section` is explicit, not inferred from `subTab='comments'`. `cellHasContent` is the single gate that swaps a not-yet-built cell for a centered "Go to Overview" placeholder — **every lens cell has a renderer today**, so it's a safety net only.
- **Advanced Analytics is a peer section, folded under the same bar.** Its three server pages (`/analyze/[id]/{improvement-plan,outlet-leaderboard,outlet-report}`) render `AnalyticsNav`, which now renders the shared `TextMineNav`: row 1 = the four sections (Advanced active; the lens sections deep-link back to `/textmine?section=…&view=overview`), row 2 = the three Advanced views. The old "← TextMine" back link is gone. `AnalyticsNav` passes only strings + the page's `action` as children (no server→client function props).
- **Section gates** are the single source of truth in `availableSections({datasetSource, taxonomyEnabled, hasEntities, outletCount})`: Themes always; Dimensions when `google_reviews || taxonomyEnabled`; Entities when the entity catalog is non-empty; Advanced when `google_reviews && outletCount≥5`. The bar maps over it, and a guard effect resets to `defaultSection` (Themes) if the active section becomes unavailable (e.g. an empty entity catalog after async load). A view is **locked** (needs a theme model) when its underlying subTab is clouds/compare/comments and no themes exist — so Dimensions Clouds/Compare (subTab stays `dimensions`) are never theme-locked.
- **State & URL:** section/view round-trips through **`?section=&view=` URL params** (shallow `history.pushState`, shareable + back/forward via a `popstate` listener); `sessionStorage` persists `section`/`view` (back-compat-mapping older saved `subTab`/`viewBy`) as the last-used default. URL wins over the restore on load. In-content drills (theme/entity/dimension chips) jump to Comments **within the current section** and remember the prior view for the back button; they don't rewrite the URL (the highlight stays correct since it reads `section`/`view` directly, and drill filters aren't URL-encoded).

### Core Features (4 lens views)

**1. Themes**
- AI-mined or library-selected themes with keyword matching
- Each theme: name, description, keywords[], sentiment, count, percentage, confidence interval
- Each theme card shows **both a ★ avg-rating badge (colour-ramped) AND the sentiment badge** (was either/or behind the colorMode toggle — `theme.avgRating`/`ratingDelta` come from `recountThemes(..., ratingField)`)
- Per-keyword rating breakdowns (which keywords drive higher/lower scores)
- Dual color mode: sentiment gradient vs rating gradient
- Sampling control with 95% confidence margin-of-error display
- Breakdown by any categorical field (by group / by theme views)
- Hosts the **Entities** card (catalog rendered scope-wide; see Entity Discovery below)

**2. Theme Clouds**
- One word cloud per theme — the words that appear most often inside that theme's matched comments
- Each theme's header carries a **★ avg-rating badge** (green/red vs the dataset overall, via `ratingDelta`)
- Each theme also gets an **"Items" chip row** (on both the **Theme Clouds** and the **Theme Cards** — "Items mentioned") — the named entities reviewers mention *within that theme's matched comments* ("when they talk about steak, what items?" → ribeye 45 / filet 30 / …). The theme×entity cross-tab lives in **`lib/themeEntities.computeThemeEntities`** (shared by `WordCloud` and `TextMineModule` so the two views never diverge): one pass over the filtered rows matching entities (combined `expandEntityTerms` regex) against precompiled per-theme keyword regexes (`buildKwRegex`), crediting each entity to every matching theme, keyed by theme id. Top 6–8 per theme, count ≥ 2, category-dot colored to match the Entities card. Filter-aware; renders only for themes that have entity mentions.
- Useful for spotting the exact language people use within a theme
- On datasets with **Dimensions** enabled (`datasetSource==='google_reviews' || taxonomyEnabled`), each theme card **and Theme Cloud** also shows a **"Dimensions" chip row** — the top taxonomy sub-buckets (across all 7 axes) carried by the reviews that match the theme ("when people talk about *steak*, which Dimensions do they discuss?" → product·steak 1044 / touchpoint·server 418 / attribute·flavor 339 / …). This is the classification-side analog of "Items mentioned": computed **server-side** by the `theme_dimension_counts(dataset, fields, keywords)` RPC (regex match like `count_theme_matches` → join `dataset_row_taxonomy` → unnest the axis arrays), requested by `fetchServerThemeCounts` via the `theme-counts` route's `dimensions` flag and summed across member datasets for collections. Top 6–8 per theme, axis-dot colored; renders only for themes whose matched rows carry tags (so an unclassified dataset shows nothing). Both the card and cloud chips are **drillable** into the Comments filter.

**3. Compare**
- Cross-group analysis by a categorical breakdown field (region, channel, age bracket, etc.)
- Stacked bar distributions, by-group / by-theme views
- **Bar-metric toggle (% ↔ ★ Rating):** when the dataset has a rating field, a toggle switches the bars between **theme/mention share** (relative to the largest segment) and **average rating** (absolute, scaled to the rating field's max; bar colored on a red→green ramp so a low-rated segment reads at a glance). The right-hand columns (%, n, ★ rating) stay visible in both modes — only the bar's encoded metric changes. Present on both the **theme** Compare (`CompareTab`) and **entity** Compare (`EntityCompareTab`). Falls back to share when no rating field exists.
- Two-proportion z-test flags groups whose theme mix differs meaningfully from the baseline
- **Breakdown-field list is filtered for Google Reviews.** The shared `catFields` (the "Break down by:" options across Compare *and* the Overview breakdown selector) drops per-review noise fields on `google_reviews` datasets — `author` (one reviewer ≈ a handful of reviews, so every group is n≈4), `review_id`, `place_id`, `owner_response`, `location_address` — leaving only fields that actually segment the data (rating, outlet/location, city, state). Single denylist in `TextMineModule` (`GREVIEW_NOISE_FIELDS`), gated on source; other dataset types keep every categorical field.
- Welch t-test for rating significance across groups
- (Crosstab is a chart type in the Charts module, not a TextMine view.)

**4. Comments**
- Collapsible inline **search** at the top of the tab (a "🔍 Search comments" toggle that expands the panel, closeable). Scoped, client-side `CommentSearchPanel`: it searches **only the rows currently in view (the filtered set) × the active open-ended field(s)** — so it respects the current filters, the field selection, and the schema (turned-off / non-open-ended fields are never searched). Instant, no fetch. (This is deliberately NOT the dataset-wide `SearchPanel` + `/search` FTS endpoint, which matches every field of every row regardless of view; that still powers the dataset-header search modal.)
- **Unified filter bar (Themes + Entities + Dimensions), AND-combined.** Three facet rows let you stack any mix of selected **themes** (the multi-select strip), **entities** (a "+ Entity" picker from the scope's catalog), and **dimensions** (a "+ Dimension" picker grouped by axis, on Dimensions-enabled datasets). Comments must match ALL active facets (AND across facets; OR within a facet). Selecting any entity or dimension switches the results to a **server-filtered** panel (`FilteredCommentsPanel`) backed by `POST /api/datasets/[id]/comments` → `get_rows_by_filters` (sql/113): theme/entity matching reuses the `get_rows_by_entity` FTS prefilter + open-ended recheck, dimension matching is an axis array-overlap on `dataset_row_taxonomy` (so it scales past the 50K client cap and handles collections via member datasets). Returns up to 300 rows + a window-count total; the panel sorts/grids/infinite-scrolls client-side and highlights the active theme keywords + entity terms. **Themes alone** (no entity/dimension) keep the richer client-side `CommentsPanel` (AI summaries, signal tier). **Every count pill drills into the filter:** clicking an entity (Entities card / Entity cloud / a theme card or Theme-cloud **Items mentioned** chip), a theme card's **Co-occurs** pill (→ that theme), or a **Dimensions chip** (theme card *and* Theme Cloud) adds it to the corresponding facet and opens the tab pre-filtered. On the theme cards the Items/Dimensions chips also select their parent theme (→ theme ∧ entity / theme ∧ dimension); in the clouds they drill the entity/dimension alone.
- Paginated comment browser with keyword highlighting
- Filter by theme, sentiment, or custom criteria
- Clause-boundary highlight expansion (not just the keyword, but surrounding context)
- Entity highlights expand to plural/singular variants (`lib/entityVariants.ts`)
  so "Brussels Sprout" matches when the canonical is "Brussels Sprouts", and
  irregulars (geese/goose, leaves/leaf) are caught via `lib/lemmas.ts`

---

## Theme Mining (AI-Powered)

### API: `POST /api/datasets/[datasetId]/mine-themes`
- Uses Claude to extract 4-7 distinct themes with 8-15 keywords each
- Keywords include: core terms, synonyms, informal variants, short phrases
- Input: caller-supplied `texts[]` + field name + schema context (no hard cap;
  the calling page picks the sample)
- API key: **defaults to the server's `ANTHROPIC_API_KEY`** so customer orgs piggyback
  on the platform key; usage is logged per-org in `usage_log`. The body accepts an
  optional `apiKey` override but it is not required — there is no localStorage-only mode.

### recountThemes() — Core Algorithm (`lib/themeUtils.ts`)
1. Filter rows to non-empty text
2. Pre-compile keyword regexes (lemma-aware, case-insensitive)
3. Per theme: count matching rows, score sentiment, accumulate ratings
4. Compute: percentage, Wilson 95% CI, sentiment classification, avgRating, ratingDelta, per-keyword ratings
5. Performance: O(rows x themes x keywords), single pass

### Signal-stats toolbar (`lib/signalStats.ts`)
**Date-field range (2026-06-24):** `computeFieldStats`/`mergeSchemaStats` (`lib/datasetUtils.ts`) now persist true `dateMin`/`dateMax` on date fields (`SchemaFieldConfig` in `analyzeTypes.ts`), widened across incremental sync batches — the categorical `values` list is still capped at 500 (which, sorted ascending, used to drop the *recent* end on long-running review datasets). The `FiltersModal` review-date slider takes its absolute domain from the **union of schema `dateMin`/`dateMax` and the loaded-row extents**, so the recent end can't be lost whichever path truncates.

The TextMine strip ("N records · M signals · theme-fit X% · K themes · ★ R avg rating · 📅 date range") and the
`/analyze` listing cards are powered by `computeSignalStats`. The **date range** and **avg rating**
are added in the `signal-stats` route (not the cached compute). The date range comes from
`datasets.description.start_date/end_date`; the **avg rating** detects the dataset's rating field from
`schema_config` (numeric with `sqt` rating/nps/likert or `scoreField` — the same rule TextMine uses) and
averages it over the **same population as `records`** — the rows carrying the theme-source text (the
*analyzed* reviews) — via `numeric_field_stats_present(ratingField, themeSourceField)` (sql/107).
**Remapped rating fields** (a survey scale tagged numeric whose stored values are text labels mapped to
numbers via the field's `valueAliases`, e.g. "Highly Satisfied"→5) are detected (any numeric alias value)
and averaged via `field_aliased_avg(field, presentField, aliases)` (sql/110) — which maps each label to its
number before averaging, since the raw value is the label (numeric_field_stats would cast nothing). This
matters: averaging *every* rated row pulls the number above the per-theme/dimension baseline because
text-less reviews are mostly silent 5-stars (Cheddar's: all rated ★4.14 vs analyzed ★3.90 — and 3.90 is
what the Dimensions tab + theme cards show, so they reconcile). Falls back to plain `numeric_field_stats`
when there's no theme model. Read via the RLS-enforced user client (org-safe, no row scan); shown only when present. `records` is the
**max** non-empty count across the saved theme model's fields (summed across
collection members); `signals` / `inThemes` come from `count_theme_matches`.
Results are cached in `dataset_state.analytics.signal_stats`, keyed on **both**
the theme-model hash **and** the current row count: editing/re-mining the themes
flips the hash, and syncing rows in/out changes the count — either forces a
recompute on the next read. **Poisoned-cache self-heal (2026-06-25):** the cache key (hash + row_count) can't see a *malformed* cached value, so a cache with `records === 0` but `signals/inThemes > 0` (impossible — `records ≥ inThemes`) is treated as poisoned and force-recomputed. This shape came from `computeSignalStatsRaw` swallowing a transient statement-timeout on the exact-count `records` query (→ `null → 0`) while the theme-match RPCs in the same parallel batch succeeded; the records query now **throws** on error so a bad partial is never persisted (the batch endpoint catches → next load retries). The row-count key matters because a sync that adds
rows leaves the theme model (and its hash) untouched, which previously left the
strip frozen at a stale snapshot while the live Themes panel counted the new
rows (Coalition Donor collection, 67 cached vs 80 live). Note this strip can
read **lower** than the Themes panel's "responses": the panel counts the
**union** of currently-active fields (`.some()` non-empty), while `records`
takes the single largest field — they intentionally use different denominators.

> **Org gate (cross-org READ fix, 2026-06-08):** the body-driven server query routes that read tenant rows with the service-role client — `POST /api/datasets/[datasetId]/theme-counts`, `…/theme-impact`, and the listing-page `POST /api/datasets/signal-stats-batch` — previously authenticated the caller but never checked their org, so any logged-in user could mine another tenant's theme counts / topical words / signal stats by posting their `datasetId`(s). All three now resolve the caller's `org_id`+`is_admin_org` and gate the dataset (404 cross-org; admin-org bypass), and `signal-stats-batch` filters the requested ids to those the caller's org owns. Their already-gated siblings (`aggregate`, `rows`, `comments`, `taxonomy`) were unaffected. See `docs/SECURITY.md` § 2; regression in `tests/integration/dataset-query-routes-gate.test.ts`.

### Sentiment Scoring (Lexicon-Based, `lib/sentimentLexicon.ts`)
- `POSITIVE_WORDS`: good, great, excellent, amazing, friendly, clean, helpful, etc.
- `NEGATIVE_WORDS`: bad, terrible, slow, rude, dirty, expensive, disappointing, etc.
- `NEGATORS`: negation flips polarity, checking up to 3 preceding words
- `classifySentiment(pos, neg, minResponses=5)` returns one of:
  `'positive'` (≥70% pos), `'negative'` (≤30% pos), `'mixed'` (between),
  `'insufficient'` (total scored words < `minResponses`). `'neutral'` is only kept
  as a fallback when a theme has zero matched rows.

---

## Entity Discovery & Catalog

A flat, scope-level catalog of the named entities a dataset talks about — dishes,
drinks, places, people, brands. Surfaces "who/what was mentioned" alongside themes.

**Why the rebuild (May 2026):** v1 ran per-row NER on comma-split cell fragments and
produced garbage entities ("attentive", "Great food", "service"). v2 separates two
concerns: *discovery* (a small sample tells us the **list** of entities) and *counting*
(full-text search gives **accurate counts** across the whole dataset, not a sample).

### Scope model

Entities are catalogued per **scope**, not per dataset+field:
- A **plain dataset** reads its own catalog — scope `('dataset', dataset_id)`.
- A **branded dataset** (`datasets.brand_tag` set) reads a shared **brand-collection**
  catalog — scope `('collection', brand_collection_id)`. A brand's datasets across
  every source (reviews, survey, Reddit…) share one catalog.
- A **collection** virtual dataset reads its collection catalog, counted across members.

Brand-collections are auto-curated: a free-text `brand_tag` on a dataset find-or-creates
the brand-collection and syncs membership via DB triggers (migrations 060–062).
`lib/entityFilter.ts::resolveEntityScope` maps any dataset id to its scope + member list.

### Discovery (`lib/entityDiscovery.ts`)
1. Resolve the dataset's scope; sample ~500 rows at random across its member datasets
   (`DEFAULT_SAMPLE_SIZE = 500`, clamped to `[25, 1000]` via `opts.sampleSize`).
2. Concatenate **only the schema-selected entity-extraction fields** of each row; batch
   through Claude Haiku NER (`ROWS_PER_BATCH = 25` rows/call, `NER_CONCURRENCY = 4`
   batches in flight). The prompt is **strict** — only specific *named* things, never
   adjectives, sentiments, or generic nouns ("service", "atmosphere", "the food").
3. Aggregate by `slug` (JS mirror of the SQL `slugify()`); merge aliases.
4. **Canonicalisation pass** (`canonicaliseDiscovered`) — per-batch NER produces
   cross-batch near-duplicates ("Filet" / "Filet Mignon" / "Mignon"; "Brussels Sprout" /
   "Brussels Sprouts"). One more Haiku call over the full entity list merges variants
   under one canonical (pre-merge canonicals kept as aliases so the FTS query still hits
   them) while preserving real distinctions ("Lobster" ≠ "Lobster Mac & Cheese"). Best-
   effort — a failed pass just leaves the slug-aggregated map.
5. Upsert the flat catalog into `public.entity_catalog` (UNIQUE on `scope_type, scope_id,
   slug`) — first canonical/category wins, aliases union, `sample_count` accumulates.
6. Log the run to `public.entity_catalog_refresh` (before/after/new counts, sample size,
   cost estimate, duration).

**Field selection** (`SchemaFieldConfig.entityExtraction`): discovery reads a dataset's
`open-ended` fields *only* — categorical/location/numeric/date/ignored columns are never
fed to NER (they produce noise like "Florida" or "Texas"). Each open-ended field carries
an opt-out flag, toggled per-field on the **Schema tab**: absent/true = included,
`false` = skipped. `eligibleEntityFields()` resolves the set; a dataset with none
selected contributes nothing. **All discovery modes are additive** (manual, cron,
incremental) — a re-run never wipes existing entries. Catalog cleanup is the explicit
"Reset discovered entries" action (POST `/api/datasets/[id]/entities/reset-discovered`),
which only deletes `source='discovered'` rows so hand-curated entries survive.

**Category-restricted discovery** (`opts.excludeCategories`, `opts.autoExcludeFromCurated`):
the NER prompt can be told to skip categories whose entities already have a curated
catalog. The weekly cron and the per-dataset incremental run both pass
`autoExcludeFromCurated=true`, which checks the scope for `source='manual'` rows by
category and adds any category with ≥10 manual entries to the exclude list. Result:
for a brand with a menu seed, the cron stops asking Haiku to surface dishes it
already knows about — saves roughly half the AI cost on brand-collection re-runs
since `food` and `drink` are the bulk of the catalog. The manual "Discover" button on
the Schema tab does NOT auto-exclude (user may want to re-explore even curated
categories). Post-filter on the NER result also drops any excluded-category entity
the model returned despite the instruction.

**Subject context**: field selection stops *structured* location columns from reaching
NER, but the subject brand and its cities are also genuinely written into review prose
("we love Fleming's in Tampa") — a generic extractor flags them as `brand` / `place`
findings. So discovery passes a **do-not-extract list** into the prompt:
`gatherDiscoveryContext()` collects the scope's brand name(s) (`datasets.brand_tag`) and
every categorical field's distinct `values` (cities, states, location labels), and the
prompt instructs NER to skip them — they are what the data is *about*, not findings in it.

`sample_count` is a discovery-frequency hint, **not** a row count — real counts are live.

### Counting (`lib/entityFilter.ts` + `count_entity_terms`)
`entity_catalog` deliberately stores **no counts**. At read time, `getEntitiesWithCounts`
builds one `websearch_to_tsquery` per entity (canonical + aliases OR'd) and calls the
`count_entity_terms` SQL function (migrations 064 + 070) — a single set-based query
across the scope's members. An optional theme query ANDs in a theme's keyword match.
Zero-count entities are dropped from results (self-heals on the next discovery run).

**Open-ended recheck (migration 070)**: `dataset_rows_flat.tsv` is built from *every*
string value in a row — including structured columns like `location`. Counting raw `tsv`
matches meant a place entity ("Tampa") matched every review *located* in Tampa, not the
ones that *mention* it (780 vs. 46 rows for Fleming's). The fix keeps the GIN-indexed
`tsv` as a fast prefilter (an open-ended-only match is always a subset), then rechecks
each candidate against a tsvector rebuilt from *only* the open-ended fields.
`count_entity_terms` and `get_rows_by_entity` take a `p_text_fields` jsonb map
(`{dataset_id: [field, …]}`) that `lib/entityFilter.ts` derives from each member's schema
via `resolveScopeTextFields()` + the shared `eligibleEntityFields()`. The theme keyword
match stays on the full `tsv` (theme keywords are content words, not structured labels).
`p_text_fields` is optional (`NULL` = legacy full-`tsv` behaviour).

### Triggering
Discovery does paid Haiku NER, so each path is gated to run only when it adds value:
- **Manual** — Schema tab → one **"Discover entities"** panel per dataset (not per
  field). POST `/api/datasets/[id]/discover-entities`, mode `manual`. Works for any
  dataset, branded or not.
- **Incremental** (Phase 6) — the compute route calls
  `lib/brandRules.discoverBrandEntitiesIfNeeded` after a branded dataset's analytics
  compute succeeds — the first point its rows are guaranteed to exist (the create
  routes run before rows load). Gated **once per dataset**: the gate reads
  `entity_catalog_refresh.datasets_sampled`, so subsequent syncs/computes are free.
  Backgrounded via `waitUntil` — never adds latency to the compute response. Mode
  `incremental`, samples only the dataset that just landed.
- **Weekly cron** (Phase 6) — `/api/cron/entity-discovery` (Sun 05:00 UTC, vercel.json
  `"0 5 * * 0"`) re-runs discovery for **every brand-collection**, sampling across all
  of the brand's member datasets. Mode `cron`. Brand scope only — plain datasets are
  not refreshed on a schedule (bounds AI cost; brand-level analysis is the use case).
- A run samples ≤1000 rows (default 500); ballpark a few cents per run.

### Person suppression at collection scope
Brand-collection catalogs cover many locations, so individual staff names
("our server Maria") are noise — each appears in 1–2 reviews and dominates
the catalog without adding brand-wide signal. `getEntitiesWithCounts` filters
out `category='person'` rows when `scope.scopeType === 'collection'` for
default reads (cloud, compare, drill, schema preview, Ask Ana). The Manage
Entities panel (`includeHidden=true`) still sees them so users can hide
specific entries or recategorise standout named chefs as `brand`. Standalone
dataset scopes (single-location operators) keep person entities — there,
named-server mention counts are real signal.

### Manual catalog curation (migration 073)
The catalog is no longer NER-only. Two columns on `entity_catalog` separate curation
from discovery:
- `source` (`'discovered'` | `'manual'`, default `'discovered'`) — discovery upserts
  never overwrite `manual` rows; the "Reset discovered entries" action only deletes
  `discovered` rows.
- `hidden` (boolean, default `false`) — soft-delete flag. Hidden rows are excluded
  from cloud / compare / drill reads (`getEntitiesWithCounts` filters them out unless
  `includeHidden=true`) and `lib/entityDiscovery.ts` skips them on re-discovery upsert,
  so NER noise stays hidden across runs.

The Manage Entities panel (Schema tab) drives these via:
- POST `/api/datasets/[id]/entities` — single or bulk create with `source='manual'`.
  Accepts `{ canonical, category?, aliases? }` or `{ entities: [...] }`. Bulk paste
  format is `Canonical | category | alias1, alias2` per line. **Auto-hide**: after
  upserting the manual rows, the endpoint slugifies every alias and soft-deletes
  any `source='discovered'` row in the same scope + category whose slug matches
  an alias-slug. This catches the cross-slug duplication case the UNIQUE index
  can't (e.g. `Filet Mignon` and `Filet` have different slugs but are
  conceptually the same — the alias rule hides the latter). Same-category guard
  prevents a food entity from hiding a brand or place that shares a name.
  Response includes `entities_auto_hidden` count for visibility.
- PATCH `/api/datasets/[id]/entities/[slug]` — toggle `hidden`, edit aliases,
  canonical, category. Exposed in the Manage Entities panel via a per-row **Edit**
  button that swaps the row for an in-place form (name input, category dropdown,
  aliases textarea); Save round-trips PATCH and reloads the catalog.
- DELETE `/api/datasets/[id]/entities/[slug]` — hard-delete (`source='manual'` only;
  discovered rows must be hidden to survive re-discovery).
- POST `/api/datasets/[id]/entities/reset-discovered` — escape hatch that wipes every
  `source='discovered'` row in the scope; manual rows survive.

Menu-PDF seeding is the canonical brand-bootstrap workflow: dump a menu PDF into
Claude Code, extract dishes / drinks with categories + aliases, POST to the bulk
endpoint. The brand-collection scope means one POST seeds every dataset in the brand.

### Read APIs (all scope-resolving)
- `GET /api/datasets/[datasetId]/entities` → catalog entities with live counts + category
  rollup + `last_refresh`. `?theme=<themeId>` intersects counts with the theme's
  keywords; `?limit=<n>` default 50, max 200. `?manage=1` returns the full catalog
  *uncapped* (no `catalogLimit` ceiling), sorted by `source DESC, sample_count DESC`
  so `manual` entries pull to the top regardless of their NER sample frequency;
  includes hidden rows + `source` + `hidden` flags. Drives the Manage Entities
  panel; the no-cap rule prevents the truncation bug where high-mention manual
  rows with low `sample_count` (e.g. menu-PDF seeds, sample_count=1) get cut
  off the bottom of a 500-row catalog limit.
- `GET /api/datasets/[datasetId]/rows-by-entity?entity=<slug>` → the rows mentioning one
  entity, across the scope's members (via the `get_rows_by_entity` RPC, same open-ended
  recheck as counting). `?limit` default 100 / max 500, `?offset`.

### Where entities show up
- **Schema tab** — one per-dataset panel with two modes. Preview mode shows
  last-discovery timestamp, catalog size, and a top-12 chip preview with live
  counts + category dots. Manage mode (`?manage=1`) surfaces the full catalog
  (including hidden rows + source flag), **grouped by category (type)** with a
  per-type **Show all / Hide all** control (ignore a whole type — e.g. people — at
  once). Hide/show edits are **staged locally** (`pendingHidden`) — clicking no
  longer PATCHes + refetches per click (which scrolled the panel to the top); a
  **Save** button (was "Done managing") flushes the staged changes (chunked PATCHes)
  and a **Close** exits manage mode (confirms if there are unsaved changes). Plus the
  single-add form, bulk-paste textarea, per-row Edit, and the "Reset discovered" admin action.
- **TextMine → Themes tab** — a dedicated **Entities card** (`components/analyze/
  EntitiesCard.tsx`), scope-wide, grouped by category. Pills are styled like the theme
  keyword pills; clicking one opens a modal of the comments that mention it (via
  `rows-by-entity`). Entities are *not* shown per-theme-card — dishes co-occur with every
  theme, so a per-card list just repeated the same entities and added clutter. When a
  rating field is selected, each pill carries a **★ avg-rating badge** (green/red vs the
  dataset overall) — computed client-side in `TextMineModule` by matching each entity's
  terms (`expandEntityTerms`) against the active text fields of the loaded/filtered rows
  and averaging `row[ratingField]`. The badge shows only once an entity has ≥3 rated
  mentions (`MIN_RATED`); the tooltip surfaces `n` and the delta. Mention counts stay
  scope-wide (SQL); ratings are filter-aware — the same split EntityCloud uses for sentiment.
- **TextMine → Clouds tab** — **Entity Clouds** (`components/analyze/textmine/
  EntityCloud.tsx`), rendered below the Theme Clouds. Words sized by `entity.mentions`
  — the SAME scope-wide count the Entities pill list uses (live full-text via
  `count_entity_terms`), so the cloud and pill list never show divergent numbers
  for the same entity. Sentiment coloring is computed client-side from the
  currently-loaded rows (clearly badged "sentiment from visible rows" when active),
  Sentiment is computed via a clause-aware proximity scan (text split on
  but / however / although / yet / though / while / whereas / comma; opinion-word
  hits in each clause credited to every entity that appears in that clause).
  Category chips at the top filter the cloud; click any entity to drill into
  its comments (same flow as the pill list). Hovering an entity dims every
  other category in the cloud (mirrors WordCloud's theme-chip hover) so the
  viewer immediately sees which category the entity belongs to.
- **TextMine → Compare tab (View by: Entity)** — **Entity Compare**
  (`components/analyze/textmine/EntityCompareTab.tsx`). Mirror of the theme
  `CompareTab` for entities: pick one or more categorical fields, see which
  entities over- or under-index in each compounded segment ("location × day
  of week"). Two views — By Group (per-segment entity prevalence) and By
  Entity (per-entity prevalence across segments). Significance markers (★)
  use the same `sigTest` 2-proportion z-test the theme version uses; rating
  significance per (group, entity) uses `welchTTest` when ≥5 ratings per
  side. Top 25 entities by total mentions across visible groups (Show all
  reveals the long tail). "Summarize findings" exports a copy-pasteable
  text outlier report. Per-row entity match-set computed once via the
  alternation regex shared with `EntityCloud` and `EntityBreakdownDist`,
  so counts stay consistent across all three entity views.
- **TextMine → Themes tab → Breakdown** — **Entity Breakdown by &lt;field&gt;**
  (`components/analyze/textmine/EntityBreakdownDist.tsx`), rendered below the
  theme `BreakdownDist`. Stacked bars per group segmented by entity, plus a By
  Entity view that flips the axis (each entity's prevalence across groups).
  Significance markers (★) come from `sigTest` (2-proportion z-test) — same
  module the theme chart uses, so over/under-representation signals are
  comparable across both charts. Per-(group, entity) rating averages shown
  when a rating field is selected, color-coded by delta vs the overall mean.
  Top 25 entities shown by default with a Show all toggle to reveal the long
  tail; a 1%-of-rows threshold keeps the chart legible. Matching uses the same
  alternation regex over `canonical + aliases + expandEntityTerms` variants the
  cloud does — built once per render and applied row-by-row to a per-row
  match-set so every cell derives from O(rows + groups × entities) work.
- **Ask Ana** — top 40 entities grouped by category appended to the system prompt.

### Tables (migrations 060–066)
- `collections.kind` / `slug`, `datasets.brand_tag` / `brand_collection_id` — brand-
  collection foundation; `slugify()` + `find_or_create_brand_collection()` (060–061).
- `set_brand_collection_id` / `sync_brand_collection_members` triggers (062).
- `entity_catalog`, `entity_catalog_refresh` — RLS enabled (default-deny), service-role
  GRANTs only; reads go through the scope-gated API routes (063).
- `count_entity_terms()` — live full-text count, `SECURITY DEFINER` + locked
  `search_path` (064; migration 070 adds the `p_text_fields` open-ended recheck).
- `get_rows_by_entity()` — entity drill-down read with the same open-ended recheck;
  `count(*) OVER()` carries the pagination total (070).
- `collections.rules` (reserved jsonb seam for brand-level rules) + `find_or_create_
  brand_collection()` now seeds a `dataset_state` row, so every brand-collection
  carries a merged schema and Charts/Stats work on it (066). The merged schema is
  rebuilt lazily from current members in the compute route; `lib/brandRules.ts` is
  the brand-rules seam (`rebuildBrandSchema` + Phase 6's
  `discoverBrandEntitiesIfNeeded`), both invoked from the compute route.
- **Phase 7 (migration 069, applied 2026-05-18):** the v1 `entity_mentions` table,
  `top_entities_for_theme()`, and `datasets.entity_extraction_state` are gone. App
  reads exclusively from the catalog + live `count_entity_terms()`. (067 = review-download
  limits, 068 = response-timestamp backfill.)
- **Manual curation (migration 073):** `entity_catalog.source` + `hidden` columns.
  Discovery is fully additive; hand-curated entries survive re-runs; hidden rows stay
  hidden across runs (NER skips them on upsert). Manage Entities panel + bulk-import
  endpoint enable menu-PDF seeding as the brand bootstrap path.

### Existing deck export
`/api/entity-analysis-deck?dataset=X&field=Y` predates the in-product feature and still
works — it runs canonicalisation fresh per call (no persistence) and produces a 4-slide
PPTX. Unaffected by the rebuild; kept for the "drop into a StoryTime deck" workflow.

---

## Restaurant Taxonomy Classifier (Taxonomy tab)

A restaurant-specific capability that classifies every review against one shared
**7-axis ABSA taxonomy** (touchpoint · attribute · product · beverage · ambiance ·
context · outcome) + a cross-cutting **severity flag** (`normal | alert | crisis`).
Full module spec: **`docs/TAXONOMY.md`**. Summary of the analyze-surface integration:

- **Where it lives.** The **"Dimensions"** peer section **inside TextMine** (`TextMineModule` renders
  `<TaxonomyModule>` for the section's Overview view — `subTab==='dimensions' && activeView==='overview'`; the
  section also carries Clouds=`DimensionCloud`, Compare=`DimensionCompareTab`, and the unified Comments), shown when **`taxonomyEnabled`** is true — which the
  analyze pages compute as `datasetSource==='google_reviews' || orgTaxonomyEnabled(org) || dataset.taxonomy_enabled`:
  (a) Google Reviews datasets; (b) **org capability** — `orgTaxonomyEnabled` (`lib/resolveOrg`) = the explicit
  per-org `ModuleFeatures.taxonomy` toggle **OR** the org's `primaryIndustries` includes a restaurant type
  (`casual_dining`/`fine_dining`/`fast_food`, auto-enabled); (c) **per-dataset** — `datasets.taxonomy_enabled`
  (sql/109), set by an "Apply Dimensions" checkbox at CSV upload or a toggle on the Schema tab, for admin/one-off
  datasets whose org isn't a restaurant. `taxonomyEnabled` is threaded to TextMine/Charts/Stats. The classify
  route is org-gated, not source-gated, so classification already works on any dataset. Exempt from the theme-model lock. User-facing label "Dimensions"; internal key/route stays
  `taxonomy` (`/analyze/[datasetId]/taxonomy` still resolves but is unlinked). Moved here from a
  top-level tab 2026-06-04 so dimensions can later feed Charts/Stats like `__themes__`. Renders
  `components/analyze/TaxonomyModule.tsx`: a **Themes-scale header** (an `<h2>` + a one-line stat
  summary — **N rows with text · X% tagged** · ★ avg rating · flagged — replacing the old chunky
  KPI cards and the misleading "reviews classified / % with a signal" denominator), then a
  **pills + cards** layout (display redesigned 2026-06-06 — `TAXONOMY.md §4a`):
  the 7 axes are **Entities-style pills** (identity dot + mention-rate% + ★ avg-rating badge, red→green
  ramp from `data->>rating`), and the sub-buckets render as **theme-card-family cards** (axis dot +
  ★ rating + pos/neg sentiment bar + the sub's **share of its dimension** `sub.count/axis.count` /
  count; all %s rounded). The view is **multi-field & reactive**: tags are stored per
  `(dataset_id,row_id,field)` in `dataset_row_field_taxonomy` (sql/114) where `field` is the
  combined key of the ANALYZE selection (`taxonomyFieldKey` — sorted ' + '-join; multiple
  open-ends are concatenated like Themes). The GET takes `?fields=`, so changing the selection
  **re-rolls the view for that field-set** (a new combination is **auto-classified on selection**
  — a brief "Classifying…" progress, no button — since dimensions are precomputed). (The classifier
  dual-writes the legacy `dataset_row_taxonomy` too, so Charts/Stats `__dim_*`, theme-card chips, and
  the Comments dimension filter keep working). A **drift nudge** (amber banner) appears when
  `rowsWithText > classifiedRows` — "N {field} rows aren't tagged yet · Classify N new rows" → POSTs
  `{ pendingOnly: true }` (`classifyPendingRows`, tags only untagged rows; the drift count uses the classifier's whitespace/control-stripping emptiness test so blank rows aren't perpetual phantoms). **Initial view = pills only** (no sub-cards until a dimension is picked); selecting a dimension pill closes any open comments panel; **picking a sub-dimension collapses the cards into a compact sub-pill row** above the comments (switch subs without closing). Sub-dimensions surface only at **count ≥ 35** (`MIN_SUB_COUNT`, the Themes-cutoff analog; severity alerts exempt). The **flagged-review count** (`alertRows` = distinct reviews with ≥1 severity
  alert) now rides on the ⚠ Severity pill, not a KPI card; the per-type alert counts are *per type*, so
  they can sum to MORE than `alertRows` when a review hits more than one (Cheddar's: 79
  food safety + 40 pests across 118 flagged reviews — 1 review hit both). **Severity is an 8th red pill** in the
  axis-pill row (status, not navigation); selecting it opens its alert sub-types (food safety / pests) as red cards
  that drill `?alert=`. Picking an axis pill **focuses** the card grid
  to that axis (no pick = top sub-buckets across all axes); **clicking a card** drills that
  sub-dimension and a **"Read all comments on this dimension"** header link does the axis-level
  drill (every comment tagged anywhere on the axis) → an **inline comments panel**
  (cards mirror TextMine's: text + meta chips + Show-more + a rating-coloured left bar + a 1–4
  column grid selector; each comment also shows its other axis·sub tag chips — hovering a chip
  highlights the span of the comment that triggered that dimension) (breadcrumb header + scrollable list + Export CSV + per-comment
  Copy) via `GET …/taxonomy/rows` (`?axis=` whole-axis, `?axis=&sub=`, or `?alert=`, **`?field=`** to scope to the analyzed open-end), matched-evidence quotes
  highlighted. The displayed comment text is the **classified field's value (`data[field]`)**, not a heuristic `pickText` pick, so the shown text matches the chips + evidence (prevents a different column showing next to another field's tags). (Inline panel reuses the same UX as TextMine comments but not the
  theme-coupled `CommentsPanel`; it's driven by the tag-filtered endpoint.) The evidence
  highlight **expands to whole-word boundaries** (stored evidence is a fixed-width char
  window, so the `<mark>` snaps out to full words rather than cutting mid-word).
- **Data.** Read via `GET /api/datasets/[datasetId]/taxonomy` (org-gated; pairs the
  dataset's `org_id` on the read) → `computeTaxonomyRollup` in `lib/taxonomyRollup.ts`
  over the persisted `dataset_row_taxonomy` rows (table from sql/088).
- **Classification (self-serve from the tab).** `lib/taxonomyClassify.ts`
  (`classifyDatasetKeyword`) runs the keyword tier over a dataset and upserts tags,
  idempotent on `(dataset_id,row_id)`; the layered dictionary (`lib/taxonomyDictionary.ts`,
  `resolveDictionary(core|rc|chuys)`) composes a shared core ⊕ per-brand overlay. The tab's
  an unclassified selection is **auto-classified** (no button) via `POST /api/datasets/[datasetId]/taxonomy`
  (org-gated, 10K-row resumable chunks, `core` overlay) with a progress bar — no AI cost. The
  classified **field follows the ANALYZE selection** (passed as `fields`/`fieldLabel`; the old
  "Field to classify" dropdown was removed 2026-06-06), and the prominent **Re-classify** button
  was removed (destructive + expensive — re-classification is deferred to the dataset level).
  `scripts/taxonomy-classify.ts` remains for brand-tuned (`rc`/`chuys`) runs. Auto-classify-on-sync
  runs for previously-classified Google Reviews datasets only; CSV/study upload auto-classify + a
  dataset-card "N unclassified" nudge are the planned model (TAXONOMY.md §4/§6).
- **Vendor benchmark.** For datasets with legacy vendor labels, the classifier reproduces
  ~90% of the vendor's topics at higher coverage and far higher alert precision (see
  `docs/TAXONOMY.md` for the critical-category audit). The in-app vendor-vs-us side-by-side
  is **not built** (the vendor-tagged corpus isn't ingested) — backlog.

---

## Charts Module (13 Types)

Defined in `CHART_TYPE_DEFS` (`components/analyze/ChartsModule.tsx`). Slots are from
`CHART_TYPE_SLOTS` in the same file.

| Chart | Slots | Use Case |
|-------|-------|----------|
| Bar/Column (`bar`) | category (req), colorBy, value | Counts across categories |
| Distribution | field (req numeric), splitBy | Histogram or box plot |
| Scatter | x (req numeric), y (req numeric), colorBy | Two-variable relationship |
| Crosstab | rows (req cat), cols (req cat) | Heatmap of two categorical fields |
| Time Series | date (req), metric, colorBy | Metric over time with breakdown |
| Treemap | category (req), size | Hierarchical rectangles |
| Packed Bubbles (`bubbles`) | (numeric measures) | Circles sized by numeric measures |
| Waterfall | category (req) | Running total contribution |
| Bullet/KPI (`bullet`) | field (req numeric), splitBy | Gauge with performance bands |
| Funnel | category (req) | Ranked bars in funnel shape |
| Gantt/Range (`gantt`) | category (req), range (req numeric/date) | Min-max range bars |
| Score Driver (`driver`) | themes, rating | Which themes drive higher/lower scores |
| Data Table (`table`) | any fields | Sortable, filterable data table |

When a Bar/Column chart has a numeric **value** assigned and the **Average** mode is on (`BarAggInner`), the bars show the per-category mean and the chart overlays a dashed **overall-average reference line** ("Avg N") — the **count-weighted** mean across all groups (i.e. the true mean of the value field, not the unweighted mean of the bars), so each bar reads against the dataset baseline at a glance. Works in both orientations (horizontal line for vertical bars, vertical line for horizontal) and on taxonomy-dimension averages (`tax_group_stats`).

### Synthetic categorical fields

Three families of virtual fields are spliced into the chart field list alongside the real schema fields:

- **`__themes__`** — single best theme per row, re-derived client-side from row text (keyword match in `enrichRows`). Forces the client-rows path.
- **`__mapped_<field>__`** — numeric remap of a categorical (Likert→number).
- **`__dim_<axis>__`** (Dimensions, 2026-06-04) — one per taxonomy axis (Touchpoint, Attribute, Product, Beverage, Ambiance, Context, Outcome), gated to `datasetSource==='google_reviews'` **or the org's `taxonomy` capability flag** (`taxonomyEnabled`, threaded to ChartsModule/StatsModule alongside TextMine). **Values are the axis sub-buckets** (steak, seafood, manager…) and are **multi-value** — a review tagged `product=[steak,seafood]` counts in BOTH. Unlike `__themes__`, dimension values are **never** re-derived on the client (the 250+ keyword dictionary is ~30s/50K rows); they are aggregated **server-side** via three `tax_*` ops on `/aggregate` (`tax_counts`, `tax_group_stats`, `tax_crosstab`; RPCs in `sql/105`, which UNNEST the `axis_<a>` arrays + join `dataset_rows_flat`). As of `sql/115` the RPCs read the **per-field** `dataset_row_field_taxonomy` for the dataset's **primary classified field** (auto-resolved = the field with the most tagged rows; falls back to legacy `dataset_row_taxonomy` when a dataset has no per-field rows) — so chart dimensions match the per-field Dimensions tab. And as of `sql/116` they are **filter-aware**: the RPCs take an optional `p_row_ids bigint[]` and the chart **passes the view's filtered row-id set** (`useAggregation` injects `rowIds` into any `tax_*` spec when filters are active; `null` = whole dataset). The flat row id rides to the client as `_rowId` (the rows GET takes `?withRowIds=true`, set by `RowsContext`). So dimension charts now honor the same field + filters as the rest of the view. (Datasets >50K are filtered over the 50K client sample, consistent with how regular charts already aggregate.) Counts reconcile exactly with the Dimensions section rollup (same source). Helper: `lib/dimensionFields.ts`. In the chart field picker the 7 dimension fields render in their **own collapsible "Dimensions" group** (and `__themes__` in a **"Themes" group**) — both pulled out of raw "Categorical" since they're *derived* categories, not schema columns (2026-06-07). The group shows the **short** axis label (`DIM_AXIS_LABEL` — Touchpoint…) with the **verbose** name on hover (`DIM_AXIS_LABEL_LONG` — "Service — who served you"…); that long map is the single source of truth, re-exported by `taxonomyRollup` as `AXIS_LABEL` (the tab's pill/card labels) so the two never drift. The `tax_*` ops live in `sql/105`–`106` (date-series + quartiles added in 106). **Wired chart types — 10 of 13**: Bar (count/% from the rollup-fed summary; average via `tax_group_stats`), Crosstab + stacked Bar (`tax_crosstab`, dimension × any scalar field, either orientation), Treemap / Bubbles / Waterfall / Funnel (count from summary), Bullet/KPI + Gantt (`tax_group_stats` — avg / min-max per sub), Distribution (precomputed box plot from `tax_group_stats` q1/median/q3/min/max/mean), Time Series breakdown (`tax_date_series` — dimension × time, count or avg per sub per bucket). **Excluded** (hidden from those charts' dim pickers via `pickerFields`): Scatter (colours each *point* — needs per-row tags), Data Table (lists *rows*), Score Driver (a theme-keyword regression engine; redundant with the avg Bar). **Stats module — Group Tests panel (Phase B.2)**: a dimension axis can be the group/variable. t-test + ANOVA are computed from per-sub summary stats via `welchTTestFromStats`/`anovaFromStats` (Welch and one-way ANOVA need only mean/variance/n), chi-square from a server crosstab via `chiSquareFromTable`, and the group box plots from the q1/q3 quartiles. Mann-Whitney is unsupported for dimensions (needs raw ranks). Dim fields are spliced only into Group Tests' categorical list (`groupTestCatFields`), never the row-based panels. (This work also fixed a pre-existing `incompleteGamma` bug — the χ²/F p-value series overflowed for large statistics, so chi-square/ANOVA on large samples silently returned wrong p-values; now series for `x<a+1`, continued fraction above.)

### Drag-to-Assign Interface
- Drag fields from sidebar to chart slots
- Smart slot selection: prefers empty required > empty optional > replace
- Session caching for chart state persistence
- Color palettes: Hermes, Ocean, Sunset, Earth, Pastel, Vivid, Mono

---

## Statistics Module (Hypothesis Testing)

### 6 Analysis Panels

Panel list lives in `ANALYSIS_TYPES` in `components/analyze/StatsModule.tsx`.

**1. Descriptives**
- Mean, median, std dev, min, max, Q1/Q3, skewness, kurtosis
- Shapiro-Wilk normality test
- Bootstrap CI (Monte Carlo) on mean, median, std

**2. Correlations**
- Pearson r (linear correlation) with p-value and 95% CI
- Spearman rho (rank correlation, handles non-linear)
- Correlation matrix with click-through detail

**3. Group Tests** — combines two-sample, k-sample, and contingency tests in one panel:
- Welch's t-test (two groups, unequal variance) + Cohen's d
- Mann-Whitney U (non-parametric rank test with tie correction)
- One-Way ANOVA (k groups) + pairwise Tukey HSD post-hocs
- Chi-square test of independence + Cramer's V (observed vs expected frequencies)

**4. Regression**
- OLS linear regression (one model per selected outcome)
- Coefficient p-values, 95% CI per term
- R-squared, adjusted R-squared, F-statistic
- Residuals for diagnostics

**5. ✦ Auto-Insights**
- Auto-scans the dataset for significant correlations, group effects,
  and distribution flags; surfaces them as ranked findings.

**6. Outlier Analysis**
- Flags groups that are statistically above or below the overall mean
  for a chosen metric.

### Statistical Infrastructure (`lib/statsUtils.ts`)
- Distribution functions: t, F, chi-square, normal CDF
- Matrix operations: Gaussian elimination for regression
- Effect sizes: Cohen's d, eta-squared, Cramer's V
- Significance labels: *** p<.001, ** p<.01, * p<.05
- (Fixed 2026-06-08: `normCDF` applied the erf approximation to `z` instead of `z/√2`, returning Φ(z·√2) and understating two-tailed p-values for `mannWhitneyU`, `tDist2p` at df>100, and `shapiroWilk`. Now correct — those tests read more conservatively than before. The `incompleteBeta` path — t-tests/correlations at df≤100 and ANOVA — was never affected.)

---

> **Open consideration (brainstorm, NOT built — 2026-06-23):** themes and dimensions are conceptually the same object — a way to bucket review text into categories, then measure prevalence + sentiment per bucket (entities are a third such lens). The prevalence/comparison/leaderboard analyses already treat themes + dimensions in parallel (shared `{pos,neg,total}` accumulators in `scanDataset`), and since the Target B IA (2026-06-25) TextMine's section bar already switches between the Theme / Entity / Dimension lenses (the old "View by Theme | Entity" toggle folded into the Entities section). A future unification would make **dimensions a first-class "categorization lens"** with the same analysis suite (clouds, compare, charts, *and* the Advanced Analytics predictor/what-if/playbook) — `clouds/compare/charts/predictor` each taking a `lens` param. Three real differences to reconcile, not just organic-vs-predefined: (1) **sentiment resolution** — dimensions carry per-assertion polarity + evidence (aspect-level: +Food/−Service in one review), themes use whole-review `lexiconScore`; unifying means leveling this (ideally upgrade themes to sentence/aspect-level, which the quote fix started); (2) **structure** — dimensions are 2-level (axis→sub), themes flat; (3) **provenance** — themes organic/per-dataset (drift), dimensions a fixed vocabulary (comparable across brands → the right substrate for cross-brand benchmarking). Prerequisite for dimensions as a predictor lens: fix the keyword-classifier quality (the everything→"Experience" collapse) — until then themes are the better lens.

> **Navigation (Target B IA, 2026-06-25 — supersedes the 2026-06-23 consolidation):** the three multi-location views — **Brand Health** (`improvement-plan`), **Leaderboard** (`outlet-leaderboard`), and **Outlet Deep-Dive** (`outlet-report`) — are the **row-2 views of the "Advanced Analytics" peer section** of TextMine. All three server routes render **`AnalyticsNav`** (`app/analyze/[datasetId]/AnalyticsNav.tsx`), which now renders the **shared two-row `TextMineNav`**: row 1 = the four sections (Advanced active; the lens sections deep-link back to `/textmine?section=…&view=overview`), row 2 = Brand Health · Leaderboard · Outlet Deep-Dive. The old "← TextMine" back link is gone; you no longer lose the section bar on the Advanced pages. They stay separate server routes (no recompute). Same gate: `google_reviews` + `outletCount >= 5`. Where older text below says "Outlets sub-tab" / "Leaderboard sub-tab" / "Improvement plan button on the Leaderboard," read it as a row-2 view of the Advanced Analytics section.

## Outlet Report (Advanced Analytics ▸ Outlet Deep-Dive)

> **Added 2026-06-17.** A one-page **per-outlet vs. peer-group** summary for multi-location review brands. Answers "what does *this* location excel at / need to work on, relative to its sibling outlets?" — the building block was missing before (per-location aggregation and taxonomy existed, but nothing compared one outlet to the group).

**Where it lives.** Route `app/analyze/[datasetId]/outlet-report/` (server component + `OutletPicker`/`PrintButton` client bits). **As of the Target B IA (2026-06-25) it's the Outlet Deep-Dive view (row 2) of the Advanced Analytics section** — a server-rendered route reached via `AnalyticsNav`'s shared two-row bar (earlier, 2026-06-22, it was an "Outlets" sub-tab `<Link>` in TextMine; before that a top-level `DatasetHeader` tab). It preserves the server render + shareable `?outlet=` URL. Same gate as before: `datasetSource === 'google_reviews'` **and** `outletCount >= 5`; the count is computed server-side in `textmine/page.tsx` (a cheap `count` off `review_source_locations` for the dataset's `review_source`, service-role) and passed to `TextMineModule` as `outletCount`. (`layout.tsx` still computes `outletCount` for `DatasetHeader`'s generic `minOutlets` tab-gate machinery, now unused by any tab but retained as reusable infra.) Switching outlets shows a `LottieLoader` overlay (`OutletPicker` wraps the navigation in `useTransition`).

**Tabbed report** (`OutletReportTabs.tsx`, client; tab order **Summary · Themes · Dimensions**, default **Summary**):
- **Themes** — the dataset's **theme model** (`dataset_state.theme_model`). For each outlet, its reviews are matched to each theme's keywords (whole-word regex) and the matched review is sentiment-scored with `lexiconScore` (`lib/themeUtils`); the outlet's net-positive rate per theme is compared to the chain's. Shown whenever a theme model exists (so it's effectively always available for review brands).
- **Dimensions** — the 7-axis taxonomy (`dataset_row_field_taxonomy`), the original logic. When the dataset **has no taxonomy** (never classified), this tab shows a **"Dimensions comparison requires classification — run TextMine → Dimensions"** message instead of a misleading "0 analyzed / no themes" (ratings + rank still render from the flat rows; the Themes tab is unaffected).
- **Summary** *(default)* — leads with a **review-score-over-time chart** (inline SVG dual-line, no chart dependency): this outlet's monthly avg rating vs the network's, from `review_date`, last 24 months (`selected.trend` = `{month, outletAvg, networkAvg}[]`). Below it, a deterministic narrative (no AI) built from rank/rating + the top theme & dimension deltas: "this location ranks #N…, stands out on X, trails on Y."

Each axis surfaces top excels/needs-work by peer-delta with the same stability floors (`MIN_N_OUTLET`/`MIN_N_CHAIN`/`MIN_POLAR_SHARE`/`DELTA_THRESHOLD`).

**Leaderboard — a separate brand-level view (added 2026-06-22).** The **inverse of the per-outlet report**: instead of one outlet across all themes, it fixes each theme/dimension and ranks the outlets. Deliberately **not** a tab inside the single-location report (that view is per-outlet) — it's its **own server route** `app/analyze/[datasetId]/outlet-leaderboard/` — the **Leaderboard view (row 2) of the Advanced Analytics section** (same gate `google_reviews` + `outletCount >= 5`). One card per theme and per dimension item (items sorted most-discussed first by `chainN`); each card shows **Top K / Bottom K** outlets ranked by net-positive rate. The **bold figure is the gap vs the chain average** in points (green above / red below — so color and sign agree; a below-chain outlet reads "−19 pts", not a confusing red "+62%"); the outlet's own net-positive rate, `n`, and ★ are grey context. **K is a slider** (`min 1 … max = min(10, ⌊outlets/2⌋)`), defaulting to **3 for ≤15 outlets, else round(20% × outlets) capped at 7** (`leaderboard.defaultK`). When an item's qualifying-outlet count `≤ 2K` the two columns would overlap, so it renders a single best→worst list; when `>20` outlets qualify, only the top-10 + bottom-10 are carried to the client (`truncated`) with a "+N in between" note. An outlet ranks for an item only with **≥`MIN_N_OUTLET`** mentions, and an item appears only if it clears `MIN_N_CHAIN`/`MIN_POLAR_SHARE` chain-wide. Computed by `buildLeaderboard`; client render in `outlet-leaderboard/LeaderboardClient.tsx`.

**One scan, three views.** `lib/outletReport.ts` was refactored (2026-06-22) so a single `scanDataset()` pass over flat rows + taxonomy assertions builds the per-outlet/chain `{pos,neg,total}` accumulators that **all three** views read from: the per-outlet report (`buildReport` → `computeOutletReport`), the leaderboard (`buildLeaderboard` → `computeOutletLeaderboard`), and the **Action-Plan predictor** (`buildPredictorFromScan` → `computeOutletPredictor`). The report page uses `computeOutletReportWithPredictor` to get the report **and** its predictor from one scan. **Theme labels are read from `theme_model.themes[].name`** (older payloads used `label`); reading the wrong field collapsed every theme into a single "Theme" bucket.

**Action Plan — the "recover your 1–3★ guests" predictor (added 2026-06-22).** The report's **default tab**, powered by `lib/outletPredictor.ts` (`buildPredictor`, pure/unit-tested). **Frame** (after an earlier severity/★-per-mention model was rejected as overstated + tautological): a brand's average is dragged down by its **low-rated (1–3★)** reviews; the goal is moving those guests up. Per outlet the headline is its **1–3★ rate vs the brand's best-run quarter** (`targetLowRate`). The body is **peer quartiles per theme** — the operational layer: for each actionable theme, every outlet is ranked across the chain by its **problem rate** (`# reviews that are 1–3★ AND cite the theme ÷ the outlet's total reviews`). An outlet in the **bottom quartile** (`peerPercentile ≥ 75`) on a theme has a real, peer-relative **weakness** (`outletLevers` — shown worst-first, *all* of them, so a broadly-failing outlet shows multiple issues, never "diffuse"); **top quartile** (`≤ 25`) = a **strength** (`outletStrengths`, shown as full cards — "top 10/25%" badge, low problem rate, and a **praise quote** from a 4–5★ review citing the theme, captured as `highExamples` alongside `lowExamples` in `scanDataset`). Each weakness card shows the percentile ("bottom 10/25%"), the problem rate, a verbatim 1–3★ quote (`lowExamples`), and the **top 3–5 performers** to learn from on that theme (`themeExemplars` — a LIST, not one outlet: the top performers are ~tied at zero problems, so a single pick collapses to whichever outlet is best *overall* and gets recommended for every theme; a handful gives varied, theme-specific options). Two key earlier decisions stand: **outcome themes** (loyalty / brand experience — matched by `OUTCOME_RE`) are **excluded** from weaknesses/strengths and reported only as a brand-health *signal*, because they're lagging symptoms of the operational drivers, not manager levers; and per-review **theme membership** (bare keyword match, same matchers as the leaderboard) is captured in `scanDataset` as `reviewMatrix: {placeId, rating, themes[]}[]`, with the 1–3★ vs 4–5★ split supplying sentiment. **Quote attribution is sentence-level** (2026-06-22): the captured quote is the *sentence containing the matched keyword* (`scanDataset` uses `tm.re.exec` to locate the match, then `extractSentence`), so a quote filed under a theme is actually about it — not just the review's first sentence (which used to let a Cleanliness keyword surface a staff complaint). Client render: `ActionPlan`/`LeverCard` in `outlet-report/OutletReportTabs.tsx`. The tab also carries the GM-context layer (added 2026-06-22): **"where you stand"** (this outlet's `lowRateRank` of N on 1–3★ rate, vs brand avg + best), a **systemic-driver connection** (passes `brandLevers[0]` — "the chain's one systemic issue is X, and you're bottom-quartile / top-quartile / mid on it"), and a **peer-cohort** count per weakness (`cohortSize` = # outlets in that theme's bottom quartile). An **interactive what-if** (`WhatIfPanel`, added 2026-06-23) lets a GM **drag a per-theme slider** to set each theme's target 1–3★ problem rate (with Reset / peer-median / best-in-class presets) and see the projected **1–3★ rate + rank** update live, framed as **detractors recovered** (no fabricated stars). Each slider runs on an intuitive per-theme axis: **left = 0% (perfect), right = the rounded-up worst-in-class rate** (`themeTargets.worstRate` = the worst any outlet does on that theme) — both **anchors are labeled on the bar**, and the handle + benchmark ticks (`Marks`) share the scale. Three ticks — **You (current)** Ana orange `#E85A1A`, **Peer median** brand Sarina teal `#0F7173`, **Best-in-class** bright lime green `#84CC16` — three distinct hues — with a legend above and the median/best values in the right-hand readout (what you're striving toward). It's **two-directional**: drag **left** to improve (past best-in-class toward 0) or **right** to model the theme *worsening* (toward the worst peer) — improvement uses the careful least-improved-theme recovery (a floor), worsening adds a directional estimate (Δrate × reviews, capped at the happy pool). The result reads **detractors recovered** (green) / **added** (red), the **1–3★ rate**, and the outlet's **overall rank** — a *conventional* rank by **average star rating including the 4–5★ pool** (`ratingRank`, **1 = best**), projected by shifting net-recovered detractors from the outlet's detractor-avg up to its happy-avg and re-ranking against every outlet's `allRatings`. (The "1 = worst" 1–3★-rate rank was replaced — people think "I'm #45, this brings me to #29.") `buildPredictor` gained `themeTargets.worstRate`, `outletSummaries.ratingRank`, `outletWhatIf.{avg,detractorAvg,happyAvg}`, and `allRatings`. It's honest about co-occurrence: the pure `projectRecovery` (in `lib/outletPredictor`, unit-tested) recovers a review **gated by its least-improved theme** — a review citing a theme left at its current rate stays a detractor, and recovery scales with how far the binding theme moves (a conservative floor). Each theme row carries a **brand-wide QoQ trend badge** (▲ worsening / ▼ improving / flat) from `themeTrends` — problem rate in the most recent full quarter (≥40 reviews) vs the prior, flagged directional only on a ≥0.5pp **and** ≥25% move (so noise on a ~1% base reads flat); per-outlet-per-quarter is too sparse, so trends are brand-level. The same badge appears on the brand page's driver cards. The predictor exposes `outletWhatIf` (per outlet: its 1–3★ reviews as actionable-theme index sets + current per-theme rate), `themeTargets` (peer-median + best-quartile problem rate per theme), and `allLowRates`; the page ships only the selected outlet's slice to the client. (This is the deliberately-narrow successor to the original ridge "★ what-if" that was rejected as overstated — same interactivity, defensible unit.) An **"Export GM plan"** button (`GET /api/datasets/[datasetId]/outlet-plan-deck?outlet=<place_id>`, org-scoped) renders that single outlet's plan as a Datanautix-branded PPTX via `lib/pptx/outletPlanDeck.ts` (where-you-stand KPIs + systemic-driver note → "what to work on" weakness table with per-theme learn-from → complaint quotes → praise-quote strengths → how-to-use) — the per-store-manager counterpart to the brand deck. Associational — a prioritization signal benchmarking outlets against their peers, not a causal star change.

**Brand improvement plan — the executive summary (added 2026-06-22).** The brand-level "why you need us" view, fed by the same predictor. Route `app/analyze/[datasetId]/improvement-plan/` — **NOT a new tab**; reached via an **"Improvement plan →" button on the Leaderboard** header. Sections: **the opportunity** (brand 1–3★ rate + its *spread* across outlets — e.g. 1.4% best vs 40% worst — plus the projected rate if every outlet hit the best-quartile target); **recommended actions** — a greedy, impact-ranked, **de-duplicated playbook** (`buildRecommendedActions`, pure/unit-tested): candidate actions are outlet turnarounds (fix an outlet's themes to peer median) and theme programs (fix one theme at its bottom-quartile cohort); each round picks the action with the highest *marginal* detractors-recovered (over a shared bad-review pool, recovery gated by each review's least-improved theme), so the list is additive not double-counted. Theme programs tend to lead (single-issue complaints aggregate across the cohort); outlet turnarounds mop up multi-issue stores. It's an **interactive plan builder** (`PlaybookPanel`, 2026-06-23): each action ships its per-review recovery contributions (`rec` = review-index→weight), so checking/unchecking actions recomputes the **de-duplicated** total (union: max weight per review, never the overlapping sum) live, plus the projected **brand 1–3★ rate** and **brand avg ★** (recovered detractors shift from the brand's `model.detractorAvg` up to `model.happyAvg`). Brand-level interactivity is deliberately grounded in *concrete actions*, not a vague chain-wide rate slider (which would imply uniform dialing + has no brand "rank"); **the systemic driver** (`brandLevers` = the one/few themes over-represented in 1–3★ vs 4–5★ *chain-wide* — base-rate-controlled, so loud-but-neutral topics don't mislead — with `outcomeSignals` flagged as a lagging symptom — and made actionable via `outcomeCorrelations`: the operational themes most correlated with loyalty erosion among 1–3★ reviews [co-occurrence lift], computed **brand-level** since per-outlet loyalty-citing reviews are far too sparse, so "fix the drivers and loyalty follows" names *which* drivers; and non-drivers listed); a **"where to start" hot-list** (`outletSummaries`, *highest 1–3★ rate first*, with each outlet's worst-ranked issue + weakness count); a **"by issue" section** (`themeFocus` — per actionable theme, the bottom-quartile outlets to coach, each rendered as a clickable **chip** with its problem rate [and the "Learn from:" exemplars as chips], the card heading showing the **peer-median problem rate** [`themeTargets.medianRate`] as a baseline frame of reference — 2026-06-24 readability pass); and **who already does it well** (`exemplars`). The page's one export control is the **Operational Review** button (below). `buildPredictor` returns `{model, drivers, brandLevers, outcomeSignals, actionableThemes, exemplars, outletSummaries, outletLevers, outletStrengths, themeFocus, themeExemplars}`.

**Operational Review Report — the single merged export (replaces the two separate exports, 2026-06-24).** The Brand Health (improvement-plan) page now ships **ONE** export control (`OperationalReviewExport`, a client control in the nav action slot). Clicking it opens a **cover-info modal** (2026-06-25) that collects: **presentation title** (default `${brand} — Operational Review`), **subtitle** (optional, blank → the auto stats line), **prepared for** (audience/client), **prepared by** (default Datanautix), **competitors** (comma-separated, drives the live benchmark), and **franchise states**. Blank fields are omitted from the URL so they fall back to builder defaults; Generate navigates to the route (download). These flow through as `title`/`subtitle`/`preparedBy`/`preparedFor`/`competitors`/`franchiseStates` query params → `OperationalOpts`, and the **dark cover slide** (`renderTitleSlide`) renders the custom title/subtitle plus "Prepared for {x}" / "Prepared by {y}". The export: an **Operational Review** that **merges the operator improvement-plan detail with the independent-acquirer diligence framing** into one deck, and adds a **NEW Dimensions (aspect-sentiment ABSA) section**. It supersedes the previously-separate "Export deck" (improvement plan) and "Export diligence report" buttons — the `DiligenceExport` control and the `diligence-deck` route were removed; `improvementPlanDeck.ts` + the `improvement-plan-deck` route remain (the merged builder copies their slide logic conceptually, and the route may be referenced elsewhere). Route `GET /api/datasets/[datasetId]/operational-review-deck` (org-scoped, cloned from the old diligence-deck gate: `getCallerOrgContext` + service-role dataset fetch + `!isAdmin && ds.org_id !== orgId → 404`; `force-dynamic`, `maxDuration 120`), backed by `computeOutletPredictor` + `lib/diligenceData.ts` (`computeDiligenceData`) + the persisted **taxonomy rollup** (`lib/taxonomyRollup.ts` `computeTaxonomyRollup`, over the dataset's default free-text field — same field-detection rule as the Taxonomy tab; for google_reviews that's `review_text`) → `lib/pptx/operationalReviewDeck.ts` (`buildOperationalReviewDeck(p, d, brand, opts)`, where `OperationalOpts extends DiligenceOpts` with `dimensions?: TaxonomyRollup | null`). **Slide order:** Executive Summary (KPIs) → **How we read the reviews — two lenses** (a themes-vs-dimensions explainer up front: themes = *organic* / emergent from the guests' words; dimensions = *pre-defined* fixed taxonomy, **defines ABSA = Aspect-Based Sentiment Analysis** — so the audience isn't assumed to know it) → Brand Health (star dist + cautionary volume flag) → Performance by State → Location Leaderboard (top-5 rows tinted green / bottom-5 red for at-a-glance separation) → Where to Start (highest 1–3★ outlets) → What Drives the Stars (protect/fix two-column) → The Systemic Driver (if drivers) → one **"Where to Focus — {theme}"** table **per actionable theme** → Value-Creation Levers → **Dimensions — Aspect Coverage** (column chart of the 7 ABSA axes by mention rate %) + **Dimensions — What Stands Out** (top ~10 sub-aspects: mentions, %-positive, avg ★, with the lowest %-positive called out as the fix list and any food-safety/pest severity alerts surfaced) → What Guests Are Telling You (quotes) → Who Already Does It Well → Competitive Benchmark (if competitors) → merged Method & Diligence Notes. **The Dimensions section is omitted** when the rollup is null or `withSignal === 0` (unclassified dataset) — the rest of the deck still renders. **Two rating lenses, kept distinct:** 18-month blended vs lifetime Google rating. **Competitors typed at generation time** trigger the same **one-time live competitor benchmark** (`lib/competitorBenchmark.ts`, non-fatal) as before. The brand's own Maps search term is a **cleaned `brandSearch`** (prefers `review_sources.brand_name`, strips a trailing "reviews"/"restaurant reviews") — the raw dataset name (e.g. "Ruths Chris Reviews") doesn't match the real listing ("Ruth's Chris Steak House") and produced a brand rating of 0. `norm()` also **removes apostrophes** (so "Ruth's" → "ruths" matches the brand name) and the markets cap is 8. The competitor slide is **only attached when `brandLifetime.rating > 0`** (never a "0.00★" comparison). The `volumeRampFlag` cautionary note and the taxonomy/competitor reads are all non-fatal — the deck ships without the affected section rather than 500-ing. Filename `${brand}_Operational_Review.pptx`. Every figure traces to the predictor, `diligenceData`, or the taxonomy rollup — nothing fabricated. Datanautix-branded export (the deck-export brand exception): each content slide carries the **subject brand prominently top-right** (with the small `data·nautix` producer mark in the footer) — a shared `slideRenderer` chrome change, so every deck export gets it.

**Header & which-location identity.** The eyebrow shows the **brand** (dataset name); the **h1 is the location**, resolved by `resolveLocationName()` — use `location_name` when it carries location-specific words *beyond the brand* (brand tokens from the dataset name + a generic-word stoplist removed), e.g. "Tabla Indian Restaurant **Lake Nona**"; else fall back to **"City, State"** (so a `location_name` that's just the brand, e.g. "Rubio's Coastal Grill", doesn't dupe the eyebrow → shows "Redlands, California"). The subtitle is the street **address · N reviews**, which uniquely pins the outlet either way. The narrative uses the same resolved location name.

**What it shows.** For the selected outlet (dropdown switches via `?outlet=<place_id>`):
- **Headline KPIs** — two: avg star rating vs. peer-group average, and peer **rank (#N of M)** + percentile. Per-outlet rating + review counts come straight from `dataset_rows_flat.data.{rating,place_id}`. (Per-axis analyzed-review counts moved into each tab's footnote.)
- **"Excels at" / "Needs work"** — per tab (Themes or Dimensions), the items where the outlet's **net-positive rate** (`(pos−neg)/total`) most beats / trails the chain average for that same item, each with the gap (in points), the rate vs. peers, mention count, and a representative customer quote.

**How the comparison is computed** (`lib/outletReport.ts`, server-only):
- Outlets are keyed by **`place_id`** — several locations share a name + city, so the human label alone is ambiguous (labels disambiguate by appending the street when name+city collide).
- Sentiment joins the per-field taxonomy assertions (`dataset_row_field_taxonomy.assertions` — `{axis, sub, polarity, evidence}`) to flat rows on **`dataset_rows_flat.id === dataset_row_field_taxonomy.row_id`** (NOT `row_index`).
- Stability floors filter noise: a theme needs ≥6 mentions at the outlet, ≥20 across the chain, ≥30% of its mentions opinionated (drops pure-mention subs like `touchpoint:server`), and a ≥8-point gap vs. peers to surface as a strength/weakness.
- **Quote recovery**: the classifier's `evidence` is a fixed-width window that starts/ends mid-word, so the report locates it inside the full `review_text` and expands to sentence boundaries.
- **Keyword false-positive guard**: the classifier is 100% keyword-based (uniform 0.85 confidence), so the cleanliness keyword "dirty" false-fires on menu items ("dirty soda", "dirty cherry cola") and the idiom "dirty look(s)". `isNoiseAssertion()` drops those from the Clean axis. This is a report-layer patch; the proper fix is vocabulary-level in the classifier.

---

## Filters & Breakdown

### Filter Types
- **Categorical**: Checkboxes with "exclude blanks"
- **Numeric Range**: Min-max slider with "include blanks"
- **Date Range**: ISO date picker

### Global Filter Architecture
- Serializable: `serializeFilters()` / `deserializeFilters()` for URL/storage
- Application: `applyFilters(rows, filters)` returns filtered array
- Context Provider for app-wide state (`components/analyze/FilterContext.tsx`)
- **Filter-option metadata is live, not the loaded rows.** `FiltersModal` is fed *synthetic* rows (one per distinct value) built by `DatasetShell` from `/api/datasets/[id]/filter-options`, which queries the flat table directly: categorical value lists via `count_field_values`, numeric ranges via `numeric_field_stats`, **date range by ordering on the JSON date value** (`data->>field`, empties excluded — NOT `row_index`, which returned two arbitrary insertion-order dates), and a **live per-field `blanks` count** (`SchemaFieldConfig.blanks`, total − non-blank). The modal prefers `f.blanks` over counting synthetic rows (which would fabricate blanks for any field with fewer distinct values than the widest).

### Saved Views & Snapshots (`docs/SAVED_VIEWS.md`)
A **view** is a saved `FilterContext` state; a **snapshot** freezes a view's aggregates.
API: `/api/datasets/[datasetId]/views` (views CRUD, snapshot CRD + `expires_at` lifecycle).
`FilterContext` exposes `loadView` / `activeView` / `isViewDirty` (live filters diverged from the
loaded view — via `serializedFiltersEqual()`). Relative **periods** resolve client-side through
`resolvePeriod()` into the existing `DateRangeFilter`; the default date axis is
`SchemaConfig.primaryDateField`. The `ViewsBar` switcher (`components/analyze/ViewsBar.tsx`) is mounted in
`DatasetShell` between the metric strip and filter chips, and hosts the **relative-period picker** (month/
quarter/year × this/last, gated on `primaryDateField`). A period is stored as intent and resolved into
`effectiveFilters` at read time, so "this quarter" recurs. **Snapshots** freeze
`computeAnalyticsFromRows(applyFilters(rows, effectiveFilters), schema)` into a `frozen` blob and render
read-only via `SnapshotModal` (drift-immune; no per-module render-from-frozen). The Schema tab
(`SchemaEditor`) lets a date field be designated the period axis ("Use for time analysis" →
`primaryDateField`). A period can also carry a **comparison** (previous period / same period last year); `ComparisonStrip` shows
primary-vs-prior record counts + delta with to-date alignment (`alignToDate`) and the §4.2 delta rules.
End-to-end coverage in `tests/e2e/saved-views.spec.ts` (env-gated). _Status: all phases built (foundation,
API/context, views UI, period picker, snapshot freeze/render, date-axis override, headline comparison);
per-chart two-series rendering deferred._

### Value Aliases (`lib/aliasUtils.ts`)
- Remap categorical values for display (e.g., "1" -> "Very Satisfied")
- Applied in: filters, chart axes, statistics output, breakdown labels, exports

---

## Export Features

The ExportModal offers exactly **two formats**: PPTX and HTML. There is no CSV
analytics export — dataset-row CSV download is not part of this module.

> **Org gate:** every export route (`/api/datasets/[datasetId]/export/{pptx,html,signals-pptx,html/share}`) resolves the dataset with the service role, so it pairs the lookup with the caller's `org_id` via `getCallerOrgContext` (admin-org may export any) and returns 404 cross-org. See `docs/SECURITY.md` § 2; regression in `tests/integration/export-org-gate.test.ts`.

### PPTX (Consulting-Quality Deck)
- **API**: `POST /api/datasets/[datasetId]/export/pptx`
- **Rendering (2026-06-25 — the cream flip)**: the route no longer builds slides with its own
  bespoke navy/gold helpers. Its compute phase (auth + cross-org gate, row fetch under the
  no-sample-under-50K rule, filter recompute, live verbatim sampling, canonical-theme
  counting, AI narratives, rating→quote color map) is unchanged, but its **build phase now
  assembles a `DeckSpec.slides: SlideSpec[]` and calls the shared `renderDeck()`** in
  `lib/pptx/slideRenderer.ts` — the same **cream** renderer (single styling source of truth)
  every other deck export uses. Slide-kind mapping: cover → `deck.title/subtitle/preparedBy`;
  dividers → `section`; exec summary → `kpi_grid` + `bullets`; survey overview →
  `survey_funnel`; about → `kpi_grid` (methodology in the insight band); open-ended overview
  & per-theme detail → `quotes` (with an optional `insight` band carrying the AI narrative);
  theme grid → `theme_cards` (paged 5/slide); categorical/pie → `dist_bars`; numeric →
  `numeric_stats`; compact categorical → `compact_grid`; verbatim comments → `comments_grid`;
  key-driver → `theme_impact`; closing & verbatim instructions → `bullets`; recap → `table`;
  entity / provenance / custom-decks → their existing kinds. The old per-slide `build*Slide`
  builders and the navy `DN`-palette draw helpers were deleted. The cream `section` divider
  has **no emoji/PNG art** (the old navy dividers did).
- **Audience levels**: `executive` (short, exec-only), `stakeholder` (default — charts + fields),
  `full` (full team — most detail, drives theme-impact slide inclusion)
- **Slides**: Title, executive summary, **survey overview** (survey sources only — see
  below), about/methodology, NPS/rating distributions, theme deep-dives
  (keywords + quotes), sentiment breakdown, theme impact on scores, field breakdowns,
  demographic annotations, methodology appendix
- **Survey Overview slide (survey sources)**: first slide after the executive summary when
  the dataset is survey-shaped — `dataset.study_id` set, OR a collection whose member
  schema carries `custom`/`psychographic`/`demographic` sections, OR rows carry a `status`.
  ("With comments" counts responses with text in the theme/comment fields, matching the
  dashboard's `commentCount` — not every open-ended field.)
  Rendered as the cream `survey_funnel` kind: headline **Responses** + **With comments** KPI cards
  over a stage-by-stage **completion funnel**, all computed from the same flat rows the deck
  already loaded — mirroring the in-app shared-analytics dashboard (`/api/share/analytics`):
  stages are `Started → {rating label} → Conversation → Survey Questions (N) →
  Psychographics (N) → Demographics (optional) → Completed`, with retention % and per-stage
  drop-off. Replaces the older response-payload `buildFunnelSlide` (removed), which only ran
  for single studies and never for collections.
- **Themes per slide is user-controlled**: the ExportModal Theme Slides picker exposes a
  *Themes per slide* control (`Auto / 1 / 2 / 4 / 6` → `body.themesPerSlide`, capped at 5 by
  the cream `theme_cards` kind). Each card shows a share **%**, the theme name, a sentiment
  badge, `n of N`, and a row of **keyword chips** (each with its own %).
- **Readable type floor**: all body/content text renders at **≥12pt** (headings, bullets,
  KPI labels, table headers, bar-row labels, %/count values, quotes, theme descriptions,
  implications, recap rows). Chrome stays small by design — footers, page numbers,
  "Proprietary and Confidential", section-eyebrow chips, keyword/sentiment chips, annotation
  pills, chart axis ticks, and fine-print methodology notes.
- **No repeated field name on open-ended sections**: the section divider uses a category
  eyebrow ("Open-ended" / "Verbatim") rather than echoing the field label, and its subtitle
  falls back to a generic descriptor (never the label); the OE overview slide suppresses the
  prompt box and "Headline finding" when they would only repeat the field label (no real
  prompt / no AI finding). Previously the label could appear three times on one slide.
- **Branding**: exported decks carry the **Datanautix** company brand (the deliverable
  brand), while the **Sentimetrx** product name stays in the app/widgets. Since the cream flip
  the deck uses the shared `renderDeck` chrome: a **cream** content background with the
  Datanautix accents (Ana orange `#E85A1A`, Sarina teal `#0F7173`; authoritative hexes in the
  `datanautix-homepage` repo), a dark-INK cover, the `data·nautix` wordmark in each footer,
  and the **subject brand prominent top-right** of every content slide. `pptx.author =
  pptx.company = 'Datanautix'` in file metadata. (Decks are Datanautix-branded, product is
  Sentimetrx — clarified by the owner 2026-06-02.)
- **Canonical themes (one set, matches the app)**: themes are counted ONCE across the
  theme model's fields (`computeCanonicalThemes`, mirroring `/api/share/analytics` + the
  in-app Themes page) — not per open-ended field. The executive summary's TOP THEMES and
  the Theme Analysis slides both read this one set, so every theme % agrees. Per-question
  theme sections were collapsed into a single **Theme Analysis** (the per-field verbatim
  overview slides remain). Themes at/below **3% are hidden** (`visibleThemes`, fallback top 5).
- **Theme Analysis = `theme_cards` grid + per-theme `quotes`**: the canonical theme set
  renders first as `theme_cards` (paged ≤5/slide — share **% badge** + `n of N` + name +
  sentiment + keyword chips), then one `quotes` slide **per theme** with its representative
  verbatims (title = theme, subtitle = `% · n of N · sentiment`, optional `insight` = the
  theme description). `themesPerSlide` caps the grid density.
- **Quote selection**: `pickBestComments()` selects the representative quotes per theme
  (run during deck assembly, before `renderDeck`).
- **Comments + signals on text-analytics slides**: every open-ended/theme slide subtitle
  carries `N comments · M signals`, where *comments* = responses with text in that field
  and *signals* = total theme mentions (sum of per-theme match counts; one response can
  hit multiple themes, so signals ≠ comments). Computed live per field via
  `computeFieldThemes` / the canonical `canonMeta`, and appended to each slide's subtitle.
  The same meta is also surfaced on the **Executive Summary** subtitle and the **verbatim
  comment slides** (`comments_grid`) so a response/signal count is never shown bare.
- **Headline response count is live, not snapshotted**: the deck's "Total Responses"
  figure (`displayRows`) and the sampling denominator (`knownTotal`) source from the live
  fetched rows / flat-table count, not the persisted `analytics.totalRows` /
  `collection.row_count` snapshot — which goes stale when collection members gain rows
  (e.g. a 62 snapshot vs 108 live). Prevents the title/summary showing a different total
  than the provenance slide.

> **Collection recompute cascade (2026-06-02, deck-fix #11 — root-cause).** A
> collection dataset (`source='collection'`) holds no rows of its own; its cached
> aggregates (`datasets.row_count`, `analytics.totalRows`, `analytics.signal_stats`)
> are snapshots recomputed only when the collection is explicitly recomputed. Member
> sync (`/api/datasets/[datasetId]/sync`) used to recompute **only the member**, so a
> member gaining rows left every parent collection stale — the underlying cause of the
> 62-vs-108 deck mismatch *and* the earlier 67-vs-80 signal-stats drift (`displayRows`
> and the signal-cache row-count key were band-aids over this). The recompute logic is
> now a shared helper `lib/collectionRecompute.ts`: `recomputeCollectionAnalytics()`
> re-reads every member's flat rows, recomputes via `computeAnalyticsFromRows`, writes
> `row_count` + `analytics`, and calls `invalidateSignalStats`. Member sync calls
> `recomputeParentCollections()` (best-effort, logs-and-continues) after inserting rows
> so parents self-heal immediately; the manual `/compute` route's collection branch was
> refactored to call the same helper (single implementation, no parallel copy).
- **Entity analysis (`body.entityFields`)**: the Custom Builder's Entity Analysis picker
  selects open-ended fields that name organisations (e.g. "Charities Donated To").
  Slides are built from the **stored `entity_catalog`** (`getEntitiesWithCounts`) — the
  same pre-extracted, canonicalised entities shown on the Entities tab. If the catalog is
  empty it runs `discoverEntities` once (which stores the result for next time), unless AI
  is off. Rendered with the shared `entitySlideSpecs` + `renderEntityGrid/renderBarChart`
  from `lib/pptx/slideRenderer` (same renderers as `/api/entity-analysis-deck`, which shares
  the extraction core in `lib/entityAnalysis.ts`). Four deck-specific refinements over the
  raw catalog read:
  - **Field-scoped counts**: `getEntitiesWithCounts` is called with `textFieldKeys =
    entityFields`, so mention counts reflect only the *selected* field. Organisations named
    in other open-ended fields (a venue in a feedback field, a charity-rating site in a
    familiarity field) score 0 there and drop out — they no longer bleed onto the charity
    slide. Falls back to the unscoped field map if the selected keys match nothing.
  - **Platform self-reference drop**: catalog rows whose canonical is the platform name
    (`sentimetrx` / `datanautix`) are filtered — never a respondent-named org.
  - **Focus-area re-categorisation**: the catalog category is a general NER type
    (brand / place / person), the wrong dimension for a charity slide. One cheap Haiku pass
    (`categoriseEntityNames`) re-buckets the surviving names into **focus areas**
    (religious / health / humanitarian / community / youth / …) for the by-category chart;
    on AI failure it keeps the NER category. *(Per-export; not yet persisted back to the
    catalog.)*
  - **Global percentages + no circular quotes**: `entitySlideSpecs` sets each entity's
    `pct` against the **global** total mentions (so the long-tail slide of singletons shows
    a true ~2%, not a per-slide "10%"), and the export passes `includeQuotes: false` to drop
    the "representative mentions" slide, which was circular against the catalog
    (`"Salvation Army — mentioned as: salvation army"`).
- **Skip text analytics (`body.skipTextAnalytics`)**: when set (paired with entity fields),
  the theme/verbatim sections are dropped so the deck is entity-focused; categorical/numeric
  slides still render. Lets a deck be "just analyse Charities, no theme walls of text."
- **Theme picker counts**: the ExportModal theme cards fetch live counts from
  `/api/datasets/[datasetId]/theme-counts` (the saved `theme_model.themes` persist
  `count`/`percentage` as 0), so the cards show real `n`/`%` instead of zeros. For the
  **Executive Summary** TOP THEMES panel the deck applies the same fix server-side:
  themes are recomputed against the dominant open-ended field via `computeFieldThemes`
  before `buildSummarySlide`, so the panel shows live percentages instead of the persisted
  zeros that previously rendered as "Insufficient data".
- **Provenance slide — factual readout, not a sales pitch** ("How this deck was
  made", default ON via `includeProvenance`): a closing methodology slide. As of
  deck-fix #8 (2026-06-02) it reports only *work performed*, never theoretical
  capacity. Field counts come from the **defined schema** (`schema_config.fields`,
  excluding ignored) — open-ended / categorical / numeric / date — not the selected
  export subset. Removed: "potential cross-tabulations", "significance tests run",
  "response × theme pairings", and the "decisions made" headline (all theoretical
  surface, not work done). The human-analyst equivalent is a flat **~15 min per
  content slide** (`slidesSoFar − 1`, excluding the title + closing slides), with the
  assumption stated verbatim on the slide; the key-takeaways row is hidden when 0.
  The renderer (`renderProvenance` in `lib/pptx/slideRenderer.ts`) gained a generic
  `secondStat` (factual second top-stat) and collapses `low===high` hours to "~N hours".
- **Report-inputs recap slide** ("Report Inputs", default ON via `includeRecap`,
  deck-fix #10): an always-present appendix recapping the export request — mode,
  audience, title, selected fields, theme names, entity/impact fields, filters,
  comment options, appendices, and the **verbatim custom instructions**
  (`body.instructions`, otherwise unrecoverable — used transiently then discarded).
  Lets a deck's AI storytelling be retraced. Built by `buildRecapSlide`; renders even
  in quick mode / with no instructions ("None provided."). Suppressible for clean
  client deliverables (decks get emailed, so internal instructions must be hideable).
- **Exec-summary fallback**: when the AI writes no `executiveSummary` bullets, KEY FINDINGS
  falls back to a categorical-field snapshot that **excludes system/internal columns**
  (`status`, `sentiment`, `collection_label`, `language`, rating/score fields, `_`-prefixed)
  so internal plumbing never leaks into the readout.
- **Version numbering**: `STORYTIME_VERSION = '1.2.0'` (`route.ts:25`), shown on the
  About slide as `<audience> edition · v<version>`

> **Planned — deck style/personality picker (not yet built).** A future pass will let the
> export dialog choose a visual style (palette/personality), with the **Datanautix brand**
> (Ana orange `#E85A1A` / Sarina teal, `datanautix.com`) as the default and modern/bold
> variants as alternatives. The blocker is architectural: the generator hard-codes one
> palette (`DN`) as a module constant referenced in ~200 places across `route.ts`,
> `lib/pptx/shared.ts`, and `lib/pptx/slideRenderer.ts`. A *selectable* palette must become
> per-request data, and because the route runs on Vercel Fluid Compute (one instance serves
> concurrent requests), it must be threaded through the builders/helpers — **not** a mutable
> module global (that would bleed colors between concurrent exports). Scoped as its own
> focused refactor + an ExportModal control (`body.style`). See the open-work-queue memory.

### HTML (Shareable Dashboard)
- **API**: `POST /api/datasets/[datasetId]/export/html`
- Generates a Reveal.js HTML presentation from dataset analytics
- Interactive, responsive for mobile/desktop
- Companion `POST /api/datasets/[datasetId]/export/html/share` uploads the HTML to AWS
  for a shareable URL (used by the "Share" button in the success step of ExportModal)

### Signals PPTX (Reddit / Substack)
- **API**: `POST /api/datasets/[datasetId]/export/signals-pptx`
- Separate deck format for Reddit/Substack datasets that have signal-tier ranking
  — not exposed through ExportModal; called from the Signals view.

---

## Analytics Computation Pipeline

### Server-Side (`lib/analyticsCompute.ts`)
Two paths, both producing the same `DatasetAnalytics` JSON shape:

- **`computeAnalyticsSQL`** (main path, used by `/compute` for single datasets):
  pushes work into Postgres via RPCs (`count_field_values`, `numeric_field_stats`) so
  no rows are pulled into Node. Top-value lists are capped at `p_limit: 500` per field;
  open-ended summaries use a 20-row sample for shape stats and an exact `COUNT(*)` for
  nonNull.
- **`computeAnalyticsFromRows`** (collection-rollup path): runs JS accumulators over
  rows already in memory (used when the rollup loads members for a virtual dataset).
  Uses Knuth/Vitter reservoir sampling for numerics: `NUMERIC_RESERVOIR_SIZE = 50_000`.

Output: `DatasetAnalytics` JSON with per-field summaries (categorical / numeric /
open-ended / date / id / ignore).

### Computation Triggers
- After upload batch completion
- After Google Reviews sync (and other source syncs)
- Manual re-compute from the Schema tab
- After brand-collection membership changes (rebuilds merged schema + recomputes)

---

## Shared Dashboards

### Public Sharing (`app/shared/[token]/`)
- Token-based access (no login required, read-only)
- Expiry options: 24h, 7d, 30d
- Response metrics, sentiment distribution, NPS trend, volume chart
- Theme visualization, auto-refresh
- Audit: all access logged with `last_accessed_at`

### Shared Analytics Links (Filtered vs Benchmark)
- **Purpose**: Send a stakeholder a view of how their subset (e.g., a specific restaurant) performs vs the system aggregate, without exposing individual data from other entities
- **Share type**: `analytics` — stored in `shared_links` with filter criteria in `metadata` JSONB
- **API**: `GET /api/share/analytics?token=...` — splits `dataset_rows_flat` into filtered and benchmark sets, returns only aggregates
- **UI**: "Share Analytics" button in Ana header bar opens `ShareAnalyticsModal` — use current active filters or pick new categorical filters, set label + expiry
- **Outlier Detection**:
  - **Numeric metrics**: z-score comparison of filtered mean vs benchmark (Welch-style SE). Flagged at p<0.05
  - **Theme frequencies**: two-proportion z-test of filtered rate vs benchmark rate. Flagged at p<0.05
- **Privacy safeguards**: minimum sample sizes enforced (n=10 filtered, n=10 benchmark, n=5 theme count). Benchmark data is aggregate-only — no individual rows or identifiable data exposed
- **Shared view**: side-by-side bars for each metric/theme, green/red outlier badges with p-values, filter criteria pills in header
- **Completion funnel (survey sources only, 2026-06-02)**: the shared view renders a stage-by-stage completion funnel (Started → rating → Conversation → Survey Questions → Psychographics → Demographics → Completed) **only when the dataset is survey-shaped** — `dataset.source==='study'`, OR the schema has `custom`/`psychographic`/`demographic` sections, OR an `experience_score`/`nps_score`/`status` field, OR rows carry `status` — and ≥3 stages exist. Otherwise the route returns `completion: null` and the page hides it (uploads / Google-reviews / other ingests have no funnel data, which would otherwise show a misleading "Started 100% → Completed 0%"). Same survey-source gate as the dataset-report Survey Overview slide.

---

## Key Files

| File | Purpose |
|------|---------|
| `components/analyze/TextMineModule.tsx` | Main shell — four peer sections × lens views (~3k lines) |
| `components/analyze/TextMineNav.tsx` | Shared two-row nav bar (sections row + views row); item-with-`href`→Link, else button. Used by TextMineModule + AnalyticsNav |
| `lib/textmineNav.ts` | Pure nav state-map + gates: `deriveLegacy`/`sectionOf`/`viewOf`/`viewsFor`/`cellHasContent`/`viewLocked`/`availableSections`/`defaultSection` (unit-tested) |
| `components/analyze/textmine/DimensionCloud.tsx` | Dimensions×Clouds — taxonomy sub-buckets as a per-axis cloud sized by mentions |
| `components/analyze/textmine/DimensionCompareTab.tsx` | Dimensions×Compare — axis × categorical-field crosstab (`tax_crosstab`) with over/under-index markers |
| `components/analyze/ChartsModule.tsx` | Chart builder (~2.5k lines) |
| `components/analyze/StatsModule.tsx` | Statistics (~2.2k lines) |
| `lib/outletReport.ts` | Per-outlet vs. peer-group compute (rating rank + sub-theme strengths/weaknesses) |
| `app/analyze/[datasetId]/outlet-report/` | Outlet Deep-Dive view of Advanced Analytics — one-page report (page + OutletPicker + PrintButton) |
| `app/analyze/[datasetId]/AnalyticsNav.tsx` | Renders the shared `TextMineNav` for the 3 Advanced Analytics pages (Advanced section active; row 2 = Brand Health/Leaderboard/Outlet) |
| `components/analyze/ExportModal.tsx` | Export workflow (~1.2k lines) |
| `components/analyze/FiltersModal.tsx` | Filter UI (~480 lines) |
| `components/analyze/EntitiesCard.tsx` | Entity catalog — the Entities×Overview home (also shown on Themes×Overview) |
| `components/analyze/textmine/WordCloud.tsx` | Themes×Clouds (and Entities×Clouds) view content |
| `components/analyze/textmine/BreakdownDist.tsx` | Breakdown visualization |
| `components/analyze/textmine/CommentsPanel.tsx` | Theme comment browser (themes-only, client-side) |
| `components/analyze/textmine/FilteredCommentsPanel.tsx` | Unified filter results (theme + entity + dimension, server-filtered) |
| `components/analyze/textmine/ThemeEditor.tsx` | Theme CRUD |
| `lib/themeUtils.ts` | recountThemes(), Wilson CI, keyword matching |
| `lib/sentimentLexicon.ts` | POSITIVE_WORDS / NEGATIVE_WORDS / NEGATORS sets |
| `lib/filterUtils.ts` | Filter types & applyFilters() |
| `lib/statsUtils.ts` | All statistical functions |
| `lib/analyticsCompute.ts` | Server-side computation (SQL + JS paths) |
| `lib/analyzeTypes.ts` | TypeScript interfaces |
| `lib/timeBucket.ts` | Time series bucketing (hourly/daily/weekly/monthly/quarterly/yearly) |
| `lib/aliasUtils.ts` | Value aliases & remapping |
| `lib/entityDiscovery.ts` | Haiku NER discovery + canonicalisation |
| `lib/entityFilter.ts` | Scope resolution, eligible-fields, count plumbing |
| `lib/brandRules.ts` | Brand-collection schema rebuild + Phase 6 entity gating |
| `components/analyze/ShareAnalyticsModal.tsx` | Share analytics link creator |
| `app/api/share/analytics/route.ts` | Filtered vs benchmark analytics API |
| `app/api/datasets/[datasetId]/` | All dataset API routes (note: param is `[datasetId]`, not `[id]`) |
