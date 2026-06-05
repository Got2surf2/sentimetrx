# Analytics / TextMine Module

> **Update (2026-06-04).** Recordings was **promoted out of Analyze** into the top-level **Town Hall** product (own nav item + `/recordings/*` routes; gated on `features.recordings` alone). The `/analyze` header Recordings button and the `/analyze/new` source tile were **removed**. Analytics is now the parent feature only for **googleReviews / reddit / substack** (`effectiveFeatures` forces those off when `analyze` is off — recordings is no longer in that set). A Town Hall recording still **mirrors into a `source='recording'` dataset** that lives in Analyze as the analytics view (TextMine/Charts/Stats; `buildRecordingSchema()` incl. the **Sentiment** facet) — reachable from the report's "Open in Analytics" cross-link. The Datanautix PowerPoint export (`POST /api/recordings/[id]/export/pptx`) and the report now live under the Town Hall product (`docs/RECORDINGS.md`).

## Overview

Full-stack text analytics engine. AI-powered theme mining, lexicon-based sentiment scoring, 13+ chart types, statistical hypothesis testing, and consulting-quality PPTX export. Works with any data source: surveys, CSV uploads, Google Reviews, agent conversations, **PulseIQ town halls (both legacy `townhall_*` and new-substrate `town_halls`)**, Reddit/Substack/Regulations.gov ingests, and **recorded meeting Q&A** (`source='recording'`; see `docs/RECORDINGS.md`). Each new source type gets a `build<Name>Schema()` in `lib/datasetUtils.ts` that declares the schema_config (fields + `primaryTextField`) so TextMine/themes/stats work without per-dataset configuration; `buildRecordingSchema()` is the latest entrant (2026-05-30).

> **Substrate-aware town-hall sync (2026-05-22, Gap #5)**: `/api/townhall/sessions/[id]/analyze` POST projects both legacy `townhall_turns` AND phase-3 `conversation_turns` (joined through `town_hall_conversations` → `conversations`) into the same `dataset_rows_flat` row shape `{turn_id, participant_id, turn_number, bot_message, user_message, topic, topic_type, source, language, sentiment, sentiment_score, responded_at}`. Town-hall datasets are substrate-agnostic in Ana — TextMine + Stats + Charts + PPTX export don't need to know which substrate produced any given row. Multi-event customers (e.g. Vindman runs N town halls across districts) get one dataset per event; cross-event rollup combines datasets in Analytics. Theme model auto-populated from `town_hall_topics` (phase-3) or `townhall_themes` (legacy). See `docs/CONVERGENCE.md` § 10 changelog.

> **Bot-level town-hall attribution (2026-05-22, Gap #6)**: `/api/bots/[id]/analyze` row shape gains `town_hall_slug` + `town_hall_name` columns. Populated by joining `conversations` → `town_hall_conversations` → `town_halls` for each session_id in the sync batch. Empty string for 1:1 widget conversations (not linked to any town hall). Lets Ana filter a single bot's dataset by town hall — e.g. compare all Vindman events vs widget visitors inside one dataset, without combining per-event datasets. Same field added to `buildBotSchema()`. The per-event-dataset workflow (Gap #5) still works for users who prefer one dataset per event; this just adds the option to operate at bot scope with town-hall filtering.

Dataset cards on `/analyze` carry a **favorite star** (per-user, via the platform-wide `user_favorites` table in migration 075). Starred datasets float to the top of the `/analyze` grid above a thin orange divider, surface in the `★ Favorites` section on `/m` (PWA), and are listed on the desktop `/favorites` cross-resource page. The grid also exposes a **Sort** dropdown (Last updated / Created / Name, persisted in `localStorage.sentimetrx.sort.analyze`) — "Last updated" uses `last_sync_at` when present, falling back to `created_at`. None of this changes any analytics behavior.

---

## TextMine (Theme Detection & Analysis)

### Core Features (4 Sub-tabs)

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
- Two-proportion z-test flags groups whose theme mix differs meaningfully from the baseline
- Welch t-test for rating significance across groups
- (Crosstab is a chart type in the Charts module, not a TextMine sub-tab.)

**4. Comments**
- Collapsible inline full-text **search** at the top of the tab (a "🔍 Search comments" toggle that expands the panel, closeable) — the same `SearchPanel` + `/search` endpoint (FTS + optional AI re-rank) as the dataset-header search modal, embedded here for in-place comment search
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
recompute on the next read. The row-count key matters because a sync that adds
rows leaves the theme model (and its hash) untouched, which previously left the
strip frozen at a stale snapshot while the live Themes panel counted the new
rows (Coalition Donor collection, 67 cached vs 80 live). Note this strip can
read **lower** than the Themes panel's "responses": the panel counts the
**union** of currently-active fields (`.some()` non-empty), while `records`
takes the single largest field — they intentionally use different denominators.

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

- **Where it lives.** A **"Dimensions"** sub-tab **inside TextMine** (`TextMineModule` renders
  `<TaxonomyModule>` when `subTab==='dimensions'`), shown when **`taxonomyEnabled`** is true — which the
  analyze pages compute as `datasetSource==='google_reviews' || orgTaxonomyEnabled(org) || dataset.taxonomy_enabled`:
  (a) Google Reviews datasets; (b) **org capability** — `orgTaxonomyEnabled` (`lib/resolveOrg`) = the explicit
  per-org `ModuleFeatures.taxonomy` toggle **OR** the org's `primaryIndustries` includes a restaurant type
  (`casual_dining`/`fine_dining`/`fast_food`, auto-enabled); (c) **per-dataset** — `datasets.taxonomy_enabled`
  (sql/109), set by an "Apply Dimensions" checkbox at CSV upload or a toggle on the Schema tab, for admin/one-off
  datasets whose org isn't a restaurant. `taxonomyEnabled` is threaded to TextMine/Charts/Stats. The classify
  route is org-gated, not source-gated, so classification already works on any dataset. Exempt from the theme-model lock. User-facing label "Dimensions"; internal key/route stays
  `taxonomy` (`/analyze/[datasetId]/taxonomy` still resolves but is unlinked). Moved here from a
  top-level tab 2026-06-04 so dimensions can later feed Charts/Stats like `__themes__`. Renders
  `components/analyze/TaxonomyModule.tsx`: classified-row KPIs (incl. an **avg-rating ★ KPI**),
  per-axis mention-rate bars and top sub-topics — each with a **★ avg-rating badge** (red→green
  ramp, from `data->>rating`) alongside the text-polarity sentiment. The **"flagged reviews" KPI** =
  `alertRows` = distinct reviews with ≥1 severity alert; the per-type alert pills count occurrences
  *per type*, so they can sum to MORE than the KPI when a review hits more than one (Cheddar's: 79
  food safety + 40 pests across 118 flagged reviews — 1 review hit both). **Severity alerts (food safety / pests) live as red
  pills inside the filter card** (no separate panel — saves vertical space). Sub-topics and
  alert pills are **clickable**, and a **pill-based Topic + Sub-topic filter** narrows the view
  (topic pills first; **clicking a topic/dimension pill reveals its sub-topic pills AND drills
  into every comment tagged anywhere on that axis** — clicking a specific sub then narrows, deselecting it reverts to the axis drill) → an **inline comments panel**
  (cards mirror TextMine's: text + meta chips + Show-more + a rating-coloured left bar + a 1–4
  column grid selector; each comment also shows its other axis·sub tag chips — hovering a chip
  highlights the span of the comment that triggered that dimension) (breadcrumb header + scrollable list + Export CSV + per-comment
  Copy) via `GET …/taxonomy/rows` (`?axis=` whole-axis, `?axis=&sub=`, or `?alert=`), matched-evidence quotes
  highlighted. (Inline panel reuses the same UX as TextMine comments but not the
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
  **"Classify this dataset"** / **"Re-classify"** buttons loop `POST /api/datasets/[datasetId]/taxonomy`
  (org-gated, 10K-row resumable chunks, `core` overlay) with a progress bar — no AI cost. The text
  column is **user-selectable** via a "Field to classify" dropdown (GET returns detected `textFields[]`
  + `defaultField` = `review_text` when present), so survey datasets can target `comment`/`feedback`.
  `scripts/taxonomy-classify.ts` remains for brand-tuned (`rc`/`chuys`) runs. Still not wired into the upload/ingest path (auto-classify-on-sync is roadmap).
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

### Synthetic categorical fields

Three families of virtual fields are spliced into the chart field list alongside the real schema fields:

- **`__themes__`** — single best theme per row, re-derived client-side from row text (keyword match in `enrichRows`). Forces the client-rows path.
- **`__mapped_<field>__`** — numeric remap of a categorical (Likert→number).
- **`__dim_<axis>__`** (Dimensions, 2026-06-04) — one per taxonomy axis (Touchpoint, Attribute, Product, Beverage, Ambiance, Context, Outcome), gated to `datasetSource==='google_reviews'` **or the org's `taxonomy` capability flag** (`taxonomyEnabled`, threaded to ChartsModule/StatsModule alongside TextMine). **Values are the axis sub-buckets** (steak, seafood, manager…) and are **multi-value** — a review tagged `product=[steak,seafood]` counts in BOTH. Unlike `__themes__`, dimension values are **never** re-derived on the client (the 250+ keyword dictionary is ~30s/50K rows); they are aggregated **server-side from the stored `dataset_row_taxonomy` tags** via three `tax_*` ops on `/aggregate` (`tax_counts`, `tax_group_stats`, `tax_crosstab`; RPCs in `sql/105`, which UNNEST the `axis_<a>` arrays + join `dataset_rows_flat`). Counts reconcile exactly with the Dimensions sub-tab rollup (same source). Helper: `lib/dimensionFields.ts`. The `tax_*` ops live in `sql/105`–`106` (date-series + quartiles added in 106). **Wired chart types — 10 of 13**: Bar (count/% from the rollup-fed summary; average via `tax_group_stats`), Crosstab + stacked Bar (`tax_crosstab`, dimension × any scalar field, either orientation), Treemap / Bubbles / Waterfall / Funnel (count from summary), Bullet/KPI + Gantt (`tax_group_stats` — avg / min-max per sub), Distribution (precomputed box plot from `tax_group_stats` q1/median/q3/min/max/mean), Time Series breakdown (`tax_date_series` — dimension × time, count or avg per sub per bucket). **Excluded** (hidden from those charts' dim pickers via `pickerFields`): Scatter (colours each *point* — needs per-row tags), Data Table (lists *rows*), Score Driver (a theme-keyword regression engine; redundant with the avg Bar). **Stats module — Group Tests panel (Phase B.2)**: a dimension axis can be the group/variable. t-test + ANOVA are computed from per-sub summary stats via `welchTTestFromStats`/`anovaFromStats` (Welch and one-way ANOVA need only mean/variance/n), chi-square from a server crosstab via `chiSquareFromTable`, and the group box plots from the q1/q3 quartiles. Mann-Whitney is unsupported for dimensions (needs raw ranks). Dim fields are spliced only into Group Tests' categorical list (`groupTestCatFields`), never the row-based panels. (This work also fixed a pre-existing `incompleteGamma` bug — the χ²/F p-value series overflowed for large statistics, so chi-square/ANOVA on large samples silently returned wrong p-values; now series for `x<a+1`, continued fraction above.)

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

---

## Filters & Breakdown

### Filter Types
- **Categorical**: Checkboxes with "exclude blanks"
- **Numeric Range**: Min-max slider with "include blanks"
- **Date Range**: ISO date picker

### Global Filter Architecture
- Serializable: `serializeFilters()` / `deserializeFilters()` for URL/storage
- Application: `applyFilters(rows, filters)` returns filtered array
- Context Provider for app-wide state

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
  Built by `buildSurveyOverviewSlide`: headline **Responses** + **With comments** KPI cards
  over a stage-by-stage **completion funnel**, all computed from the same flat rows the deck
  already loaded — mirroring the in-app shared-analytics dashboard (`/api/share/analytics`):
  stages are `Started → {rating label} → Conversation → Survey Questions (N) →
  Psychographics (N) → Demographics (optional) → Completed`, with retention % and per-stage
  drop-off. Replaces the older response-payload `buildFunnelSlide` (removed), which only ran
  for single studies and never for collections.
- **Themes per slide is user-controlled**: the ExportModal Theme Slides picker exposes a
  *Themes per slide* control (`Auto / 1 / 2 / 4 / 6` → `body.themesPerSlide`, 0 = auto).
  `buildThemeGridSlides(…, perSlide)` honours the override; fewer per slide = larger cards.
  Each theme card now matches the in-app theme cloud detail: up to **6 keywords** (wrapping
  to fit), one-line description, sentiment badge, `n in N` count, and the **% occurrence**.
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
  brand), while the **Sentimetrx** product name stays in the app/widgets. The navy/teal/gold
  `DN` palette is the Datanautix brand palette (Ana orange `#E85A1A`, Sarina teal `#0F7173`;
  authoritative hexes in the `datanautix-homepage` repo). Every deck-visible string reads
  Datanautix: the header wordmark (`logo()` in `lib/pptx/shared.ts` → "**data**·nautix",
  data = Sarina teal, nautix = Ana orange), the title-slide wordmark + "D" monogram, all
  footers (`datanautix.com`, "Generated by Datanautix"), the About-slide methodology
  ("Datanautix AI Text Analytics"), and `pptx.author = pptx.company = 'Datanautix'` in file
  metadata. (Reverted 2026-06-02 — a prior session's deck-fix #9 had switched decks to
  Sentimetrx; the owner clarified decks are Datanautix-branded, product is Sentimetrx.)
- **Canonical themes (one set, matches the app)**: themes are counted ONCE across the
  theme model's fields (`computeCanonicalThemes`, mirroring `/api/share/analytics` + the
  in-app Themes page) — not per open-ended field. The executive summary's TOP THEMES and
  the Theme Analysis slides both read this one set, so every theme % agrees. Per-question
  theme sections were collapsed into a single **Theme Analysis** (the per-field verbatim
  overview slides remain). Themes at/below **3% are hidden** (`visibleThemes`, fallback top 5).
- **Theme Analysis = theme-cloud slides** (`buildThemeGridSlides`): each theme renders as
  the in-app Theme Cloud — a colored **% badge** (+ `n of N`) + name + sentiment, then its
  keywords as a **frequency-sized word cloud** (each word 12–30pt by how often it occurs,
  tagged with its %). Blocks fill the slide height (no dead white space). The ExportModal
  **Themes per slide** control (`body.themesPerSlide` = Auto/1/2/4/6) sets density; word
  size + count scale to block height with `autoFit` so a cloud never overflows its block.
- **Quote selection**: `pickBestComments()` selects 2-3 representative quotes per theme
- **Comments + signals on text-analytics slides**: every open-ended/theme slide header
  carries `N comments · M signals`, where *comments* = responses with text in that field
  and *signals* = total theme mentions (sum of per-theme match counts; one response can
  hit multiple themes, so signals ≠ comments). Computed live per field via
  `computeFieldThemes` and passed to `buildOpenEndedSlide` / `buildThemeGridSlides` /
  `buildThemeSlides` as a `meta` arg (`withCounts()` appends it to the subtitle). The same
  meta is also surfaced on the **Executive Summary** (right of the TOP THEMES header), the
  OE-overview **Responses** KPI card (signals as the sub-line), and the **verbatim comment
  slides** (`buildCommentsSlide`) so a response/signal count is never shown bare.
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
| `components/analyze/TextMineModule.tsx` | Main shell, 4 sub-tabs (~2.4k lines) |
| `components/analyze/ChartsModule.tsx` | Chart builder (~2.5k lines) |
| `components/analyze/StatsModule.tsx` | Statistics (~2.2k lines) |
| `components/analyze/ExportModal.tsx` | Export workflow (~1.2k lines) |
| `components/analyze/FiltersModal.tsx` | Filter UI (~480 lines) |
| `components/analyze/EntitiesCard.tsx` | Entities card rendered on the Themes sub-tab |
| `components/analyze/textmine/WordCloud.tsx` | Theme Clouds sub-tab content |
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
