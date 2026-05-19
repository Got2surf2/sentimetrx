# Analytics / TextMine Module

## Overview

Full-stack text analytics engine. AI-powered theme mining, lexicon-based sentiment scoring, 13+ chart types, statistical hypothesis testing, and consulting-quality PPTX export. Works with any data source: surveys, CSV uploads, Google Reviews, Town Hall responses.

---

## TextMine (Theme Detection & Analysis)

### Core Features (4 Sub-tabs)

**1. Themes**
- AI-mined or library-selected themes with keyword matching
- Each theme: name, description, keywords[], sentiment, count, percentage, confidence interval
- Per-keyword rating breakdowns (which keywords drive higher/lower scores)
- Dual color mode: sentiment gradient vs rating gradient
- Sampling control with 95% confidence margin-of-error display
- Breakdown by any categorical field (by group / by theme views)
- Hosts the **Entities** card (catalog rendered scope-wide; see Entity Discovery below)

**2. Theme Clouds**
- One word cloud per theme — the words that appear most often inside that theme's matched comments
- Useful for spotting the exact language people use within a theme

**3. Compare**
- Cross-group analysis by a categorical breakdown field (region, channel, age bracket, etc.)
- Stacked bar distributions, by-group / by-theme views
- Two-proportion z-test flags groups whose theme mix differs meaningfully from the baseline
- Welch t-test for rating significance across groups
- (Crosstab is a chart type in the Charts module, not a TextMine sub-tab.)

**4. Comments**
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
  including hidden rows, with `source` + `hidden` flags on each entry (drives the
  Manage Entities panel).
- `GET /api/datasets/[datasetId]/rows-by-entity?entity=<slug>` → the rows mentioning one
  entity, across the scope's members (via the `get_rows_by_entity` RPC, same open-ended
  recheck as counting). `?limit` default 100 / max 500, `?offset`.

### Where entities show up
- **Schema tab** — one per-dataset panel with two modes. Preview mode shows
  last-discovery timestamp, catalog size, and a top-12 chip preview with live
  counts + category dots. Manage mode (`?manage=1`) surfaces the full catalog
  (including hidden rows + source flag) with per-row hide/unhide, single-add
  form, bulk-paste textarea, and the "Reset discovered" admin action.
- **TextMine → Themes tab** — a dedicated **Entities card** (`components/analyze/
  EntitiesCard.tsx`), scope-wide, grouped by category. Pills are styled like the theme
  keyword pills; clicking one opens a modal of the comments that mention it (via
  `rows-by-entity`). Entities are *not* shown per-theme-card — dishes co-occur with every
  theme, so a per-card list just repeated the same entities and added clutter.
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

### PPTX (Consulting-Quality Deck)
- **API**: `POST /api/datasets/[datasetId]/export/pptx`
- **Audience levels**: `executive` (short, exec-only), `stakeholder` (default — charts + fields),
  `full` (full team — most detail, drives theme-impact slide inclusion)
- **Slides**: Title, executive summary, NPS/rating distributions, theme deep-dives
  (keywords + quotes), sentiment breakdown, theme impact on scores, field breakdowns,
  demographic annotations, methodology appendix
- **Branding**: Datanautix palette (navy, teal, gold), `datanautix.com` footer,
  `pptx.author = pptx.company = 'Datanautix'`. **Note:** this is the legacy brand —
  not yet rebranded to Sentimetrx in the exported deck.
- **Quote selection**: `pickBestComments()` selects 2-3 representative quotes per theme
- **Version numbering**: `STORYTIME_VERSION = '1.2.0'` (`route.ts:25`), shown on the
  About slide as `<audience> edition · v<version>`

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
| `components/analyze/textmine/CommentsPanel.tsx` | Comment browser |
| `components/analyze/textmine/EntityCommentsPanel.tsx` | Entity drill-down comments modal |
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
