# Restaurant Taxonomy Classifier

**Status:** keyword tier + persistence + in-app analytics tab + **auto-classify-on-sync
safety net** shipped (local); the paid AI/brand-overlay tiers are roadmap
(`docs/TAXONOMY_PRODUCTIZATION_PLAN.md`). Originated as the Ruth's Chris
CX-tagging-replacement pilot (`[[project-rc-taxonomy-pilot]]`).

## 1. What it is

Classifies every restaurant review against one shared, versioned **7-axis ABSA
taxonomy** + a cross-cutting **severity flag**:

| Axis | Answers | Example subs |
|---|---|---|
| touchpoint | who served you | server, manager, host, bartender, busser, chef |
| attribute | how they did | flavor, speed, attentive, clean, professional, friendly, **food safety**, **pests** |
| product | what they ate | steak, sides, apps, desserts, seafood, soup (+ items: filet, ribeye…) |
| beverage | what they drank | wine, cocktail, beer, margarita, martini |
| ambiance | the room | noise, light, decor, clean, location, odor |
| context | when / why | daypart, holiday, weekend, occasion, channel (to-go/delivery) |
| outcome | will they return | return, recommend, brand-love, value (expensive/affordable) |

Severity is **not** an 8th axis — it's a flag on any assertion: `normal | alert |
crisis`. `food safety` (food poisoning, raw chicken, foreign object, hair/foreign
objects **in food**) and `pests` fire at alert/crisis. Hair is matched only on
**in-food** phrasings (`piece of hair`, `hair in the …`, `a hair found in …`, etc.)
— deliberately NOT on staff-appearance/hygiene phrasings (`blonde hair`, `hairnet`,
`hair dangling`) which would false-flag. Closed vocabulary lives in
`lib/taxonomyVocabulary.ts`; the keyword dict carries a `TAXONOMY_VERSION` (now
**v3**) bumped on vocabulary changes — already-tagged rows keep their prior version
until re-classified (no auto-reclassify of tagged rows).

## 2. Layered dictionary (keyword tier)

`lib/taxonomyDictionary.ts` → `resolveDictionary(brand)` composes a shared **core**
dictionary (`lib/taxonomyKeywords.ts`, hand-written + the RC-mined
`lib/taxonomyKeywordsLearned.ts`) ⊕ an optional **per-brand overlay** (menu items /
idioms, e.g. `lib/taxonomyKeywordsChuys.ts`). Brand phrases never pollute the core.
The matcher (`lib/taxonomyKeywordMatcher.ts`, `classifyByKeyword(text, dict)`) is
**word-boundary strict** — surface forms must be listed explicitly (`roach` ≠
`roaches`, `fly` ≠ `flies`). An AI tier (`lib/taxonomyExtractor.ts`, `classifyReview`)
exists for nuance/severity but is **not** wired into the persisting path yet.

## 3. Persistence + roll-up

- **Verdicts are EMBEDDED in the row blob** (sql/151, 2026-07-04 — the "taxonomy
  embed" architecture; consistent with ARCHITECTURE.md D2, the record IS the blob):
  - **`dataset_rows_flat.data._tx`** — a reserved top-level key:
    `{"f": {"<fieldKey>": {a, al, as, v, by, m, at}}}` where `a` = axes→sub arrays
    (only non-empty axes), `al` = alert/crisis subs, `as` = the full structured
    assertions (`{axis, sub, item?, polarity, confidence, severity, evidence}`),
    and `v/by/m/at` = version/classifier/model/timestamp. `fieldKey` is the
    **combined key** `taxonomyFieldKey(selectedFields)` (sorted ' + '-join; a single
    field is just its name), so each open-end OR combination carries its own block.
    **No version history** — a re-classify overwrites the field's block in place
    (owner decision 2026-07-03: the workflow is replace-then-spot-check).
    WHY embedded: the old sidecar tables minted one row per `(row, field)` verdict —
    128K rows pre-production; a 1M-comment dataset ⇒ 5–7M sidecar rows — and had to
    be independently covered by backup/clone/delete (the sidecars were MISSED by
    backups until 2026-07-03, and the org-clone restore never remapped their
    `row_id`s, silently dangling every cloned verdict). Embedded verdicts ride the
    row through backup/restore/clone/delete for free; the shape is defined in
    `lib/taxonomyEmbed.ts` (`TaxonomyFieldBlock`, `buildFieldBlock`).
  - **`_tx` is a RESERVED key**, never a dataset column: schema detection
    (`autoDetectSchema`/`applySchema`), the rows API (`projectRow` strips it from
    every client payload — TextMine's bulk fetch must not ship assertions),
    Ana's row-context formatter (`NOISE_FIELDS`), the TextMine search detail, and
    the **Postgres `tsv` trigger + `search_dataset_rows` headline** (fixed in
    sql/151 — without the skip, tag names and evidence quotes would pollute FTS)
    all exclude it. New enumerators of row-data keys must check
    `isReservedRowKey` (`lib/taxonomyEmbed.ts`).
  - **Stored rollups**: `dataset_state.analytics.taxonomy.fields[<fieldKey>]` =
    `{selFields, rollup, updatedAt, version}` — written at classify completion
    (`updateStoredTaxonomyRollup`, merged via the sql/145 atomic-merge RPC) so
    dashboards read aggregates instead of scanning blobs. The Dimensions GET uses
    it as the fast path; `taxonomy_primary_field` resolves the Charts field from
    it (most classified rows wins).
  - **RPCs** (same names/signatures as sql/115/116 — the /aggregate route and
    ChartsModule changed zero code): the `tax_*` aggregates, the axis crosstab
    (sql/133), theme×dimension chips (sql/111), the Comments dimension filter
    (`get_rows_by_filters`, sql/113), the pending-rows helper (sql/117), plus new
    `apply_taxonomy_verdicts` (batch writer), `taxonomy_rows_for_field` (paged
    verdict read incl. same-row rating/date), `taxonomy_drill_rows` (drill-down),
    and `taxonomy_counts` (admin pilot). All read `data._tx`; filter-awareness
    (`p_row_ids`) is unchanged. **Transition**: each read RPC keeps a
    sidecar-fallback leg (chosen per dataset) so sql/151 could be applied to prod
    before the code deployed; the legs AND the sidecar tables
    (`dataset_row_taxonomy` sql/088, `dataset_row_field_taxonomy` sql/114) die
    together in sql/152 — **gated on the prod backfill
    (`scripts/backfill-taxonomy-embed.ts`) verifying clean
    (`scripts/_verify_taxembed.ts --mode parity --prod`)**. Until sql/152 applies,
    `lib/orgSnapshot`/`lib/orgDelete` deliberately keep the sidecar entries as the
    rollback path.
- **Persisting classifier** `lib/taxonomyClassify.ts` (`classifyDatasetKeyword`):
  pages a dataset's rows, runs the keyword tier, and embeds field blocks via the
  `apply_taxonomy_verdicts` RPC in 500-row batches. Pages order by
  `(row_index, id)` — the `id` tiebreak is load-bearing: classify now UPDATEs the
  very table it's paging, so an unstable order can repeat/skip rows across page
  windows mid-run (caught live on the test project: 10,651 classify events over
  10,648 rows). **Strips NUL/C0/surrogate chars** from text — Postgres
  jsonb rejects them and emoji-split evidence windows produce lone surrogates.
  Takes an `offset` and returns `{ nextOffset, reachedEnd, … }` so the self-serve
  UI can drive it in resumable chunks (CLI passes no offset → scans from 0).
  Accepts either a single `textField` or `textFields[]` (concatenated with ` . ` so a
  phrase can't span a boundary) — e.g. a survey's MOST + LEAST verbatims classified
  together. When a run completes (`reachedEnd`, or a pending drain finishes), it
  refreshes the stored rollup for that field key (non-fatal on error — the next
  completed run repairs it).
- **Auto-classify-on-sync safety net** (`classifyPendingRows`): without this,
  reviews pulled by the 6-hourly `review-sync` cron (and manual sync) land in
  `dataset_rows_flat` but stay **unclassified** until a manual Re-classify, so the
  Dimensions tab silently drifts behind the live data. After every sync,
  `lib/reviewSync.syncReviewSource` — **only if the dataset is already classified**
  (the stored rollup exists; never auto-starts an un-opted dataset) — classifies the
  still-pending rows via `classifyPendingRows` **for EVERY stored field combo**
  (each rollup entry carries its real `selFields`, so non-default field selections
  stay current too — previously only `review_text` did). Pending rows come from the
  `dataset_rows_pending_field_taxonomy` RPC: flat rows with no `_tx` block for the
  field key **and non-empty text** (text-less star-only reviews are excluded — the
  classifier writes them a tagless block so the LIMIT window converges; "reviews
  classified" = text-bearing rows). Capped at `maxRows` per sync, non-fatal,
  idempotent (a timeout just leaves already-embedded rows classified; the next sync
  continues).
- **Roll-up** `lib/taxonomyRollup.ts`: `aggregateTaxonomy` (pure, unit-tested) +
  `computeTaxonomyRollup` (org-scoped paged read) → classified-row count, per-axis &
  per-sub mention rates, sentiment per sub, alert tag counts, and **avg star rating per
  axis / per sub + an overall avg**. The per-axis / per-sub averages are over the
  classified (text-tagged) rows that carry that dimension (inherently text-scoped). The
  **overall avg ★, however, is over ALL rated rows** — `computeTaxonomyRollup` overrides
  `aggregateTaxonomy`'s classified-rows mean with an all-rows average from the same
  `numeric_field_stats` / `field_aliased_avg` RPCs the metric strip uses, under the standing
  **"ratings = all reviews"** principle (the Dimensions overall ★ ties back to Google /
  exports; it's display-only, so per-axis colouring is unaffected). The rating field is **detected dynamically** from
  `dataset_state.schema_config` (the first numeric field tagged `sqt` rating/nps/likert or
  `scoreField` — the same rule the metric strip uses), not a hardcoded `rating` key, so it
  works for surveys whose rating lives under an arbitrary question-text key. **Remapped
  fields** (stored text labels like "Highly Satisfied" mapped to numbers via the field's
  `valueAliases`) are resolved label→number per row before averaging. The paged read goes
  through `taxonomy_rows_for_field` (sql/151), which returns each row's verdict block PLUS
  its rating/date values **from the same row** (field names as bind params, so keys with
  spaces/commas/apostrophes work — the sidecar-era version needed two extra lookups per
  page). `aggregateTaxonomy` then averages over matching rows. **Trend windows
  (2026-06-29):** `computeTaxonomyRollup` accepts an optional `dateField` — when set it also
  attaches each row's timestamp from the same RPC (best-effort; unparseable → no trend) and returns
  `recent`/`prior`-window rollups (`TaxonomyTrendRollup extends TaxonomyRollup`) by deriving
  recent-vs-prior windows from the dated rows (`lib/trendWindows.deriveTrendWindows`) and
  re-running `aggregateTaxonomy` on each partition. This is what lets the StoryTime/Report
  **Heads-Up** fire 📉📈 per sub-aspect (`dimensionsToSignals(dim.recent || dim, dim.prior)`);
  default callers omit `dateField` and get the full rollup unchanged. The UI shows a
  ★ badge (red→green ramp) on the KPIs, axis pills, and sub-dimension cards — complements the
  text-polarity sentiment with the actual scores (e.g. on Cheddar's, `touchpoint·manager`
  ★2.4 vs `attribute·flavor` ★4.1; on Carrabba's GSS, `attribute·temp` ★2.35 vs
  `attribute·professional` ★4.56).
- **"flagged reviews" KPI** = `alertRows` = the count of **distinct reviews** carrying ≥1
  severity alert. The Severity section's per-tag pills (`alerts[].count`) count alert
  *occurrences per type*, so a review flagged for both food safety AND pests adds to both
  pills — meaning the pills can sum to MORE than the flagged-reviews KPI (e.g. Cheddar's: 79
  food safety + 40 pests = 119 across 118 distinct reviews, 1 review hit both). Labeled
  "flagged reviews" (not "severity alerts") + tooltip so the distinct-vs-per-type distinction is clear.

## 4. Surfaces

- **In-app Dimensions view** (user-facing label **"Dimensions"**; internal code/routes/keys stay `taxonomy` — friendlier than "taxonomy", reads as analytical structure you can pivot/trend on, aligns with the future chart-integration plan; owner considered "Categories" (the competitor's word) but chose "Dimensions"). As of 2026-06-04 it lives **inside TextMine** — a peer lens section since the Target B IA (2026-06-25), whose Overview view renders `<TaxonomyModule>` (`TextMineModule` renders it when `subTab==='dimensions' && activeView==='overview'`; the section also carries Clouds=`DimensionCloud` / Compare=`DimensionCompareTab` / the unified Comments), shown when `taxonomyEnabled` is true = `datasetSource==='google_reviews' || orgTaxonomyEnabled(org) || dataset.taxonomy_enabled`: Google Reviews; **OR org capability** (`orgTaxonomyEnabled` in `lib/resolveOrg` — the explicit per-org `ModuleFeatures.taxonomy` toggle OR a restaurant `primaryIndustries` value, auto-enabled); **OR per-dataset** (`datasets.taxonomy_enabled`, sql/109 — an "Apply Dimensions" checkbox at upload or a Schema-tab toggle, for admin/one-off datasets). Threaded as `taxonomyEnabled` to TextMine/Charts/Stats; the classify route is org-gated (not source-gated) so it works on any dataset. Exempt from the theme-model lock); the standalone top-level tab was retired (the `/analyze/[datasetId]/taxonomy` route still resolves but is unlinked). `TaxonomyModule.tsx` is self-contained and fed by
  `GET /api/datasets/[datasetId]/taxonomy` (org-gated). **Auto-classification** (no button,
  2026-06-07): when the selected field-set isn't classified yet the tab **classifies it
  automatically** (a guarded effect, once per field-key, fires `runClassifier`) — picking a
  field just shows a brief "Classifying…" progress then the dimensions, like Themes' instant
  update (only failures show a "Try again"). It loops `POST /api/datasets/[datasetId]/taxonomy`
  (`{ cursor, textFields }` body → `{ classifiedThisCall, nextCursor, done, totalRows }`,
  10K-row chunks, `core` overlay, org-gated like the GET) with a live progress bar until
  `done`. Keyword-tier → no AI cost;
  tags are **saved per (row, field-key)** in the row's `data._tx` block (idempotent) so the
  tab reads them back — classification is a one-time pass per selection, never re-run on view.
  **Multi-field & reactive** (no separate picker, as of 2026-06-07): the view follows the
  parent TextMine **ANALYZE** selection — **one OR several** open-ends (`effectiveFields`),
  passed in as `fields`/`fieldLabel`. Like Themes, multiple fields are **combined** into one
  classification, keyed by `taxonomyFieldKey(fields)` (sorted, ' + '-joined; a single field is
  just its own name → existing rows stay valid). The GET takes `?fields=` (comma list) and the
  tab **refetches when the selection changes**, so Dimensions reacts to the open-end set like
  themes. POST passes `textFields[]` to `classifyDatasetKeyword`, which concatenates them (' . '
  separator) and stores under the combined key. **Unlike themes (instant client re-derive),
  each new field combination is classified once** (the keyword dict is too slow client-side to
  re-derive live) — but this is **automatic**: selecting a new combo auto-runs the classify
  (brief "Classifying…" spinner) rather than waiting on a button press. The old
  redundant "Field to classify" dropdown is retired.
  **Reconciled denominator**: the GET returns `rowsWithText` (`dataset_rows_with_text_count`
  RPC = rows with text in this field) and the header reads "**N rows with text · X% tagged**"
  (X = `withSignal/rowsWithText`) — so it lines up with the metric strip's "records" instead
  of the old misleading "N reviews classified · 50% with a signal" (which counted blank rows).
  `detectTextFields` still runs server-side but the UI no longer renders a picker.
  **No prominent Re-classify** (removed 2026-06-06): re-classification overwrites saved tags
  and is expensive, so it is *not* a header button. Keeping new data tagged belongs at the
  dataset level — auto-classify-on-sync already does this for previously-classified Google
  Reviews datasets (`classifyPendingRows`); extending it to CSV/study uploads + a
  "N unclassified rows" dataset-card nudge is the planned model (see §6).
  **Drift nudge (in-tab)**: when `rowsWithText > classifiedRows` (rows with text in this field
  that aren't tagged yet) the populated view shows a contextual amber banner —
  "N {field} rows aren't tagged yet" + a **"Classify N new rows"** button that POSTs
  `{ pendingOnly: true, textField }` → `classifyPendingRows` (per-field pending RPC
  `dataset_rows_pending_field_taxonomy`; tags ONLY the untagged rows, non-destructive,
  dual-writes both tables). This is the drift-triggered, in-context replacement for the old
  always-present Re-classify button (a dataset-card version is the follow-up). Both the
  `rowsWithText` count and the pending RPC use the **same "has real text" test as the
  classifier** — `regexp_replace(field, '[[:space:][:cntrl:]]+', '')` non-empty — so
  whitespace/control-only rows (which the classifier writes no row for) don't show as
  perpetually-pending phantoms in the nudge. As a belt-and-suspenders, `classifyPendingRows`
  now **writes a (tagless) row for every row the pending RPC hands it** — even ones that come
  back empty after the classifier's JS strip (unicode-whitespace edge cases the SQL test
  doesn't catch) — so clicking "Classify N new rows" always **converges the nudge to 0**
  instead of looping. No data cleanup needed.
  **Pills + cards + comment drill-down** (display redesigned 2026-06-06 — see §4a): the 7
  axes render as **Entities-style pills** (identity dot + mention-rate% + ★ rating badge);
  picking one **focuses** the sub-dimension grid below to that axis (no axis picked = the top
  sub-buckets across all axes). The level-2 sub-buckets render as **theme-card-family cards**
  (axis dot + ★ rating + pos/neg sentiment bar + rate% lead / count muted); **clicking a card**
  drills into the comments tagged with that sub-dimension, and a **"Read all comments on this
  dimension"** header link runs the axis-level drill (every comment tagged anywhere on the
  axis). Severity is an 8th **red pill** in the same axis-pill row (status, not
  navigation); selecting it opens its alert sub-types (food safety / pests) as red
  cards, and clicking a card drills that alert's comments.
  Any of these opens an **inline comments
  panel** (breadcrumb header `Dimensions › axis [› sub]` / `Dimensions › Severity alert › tag`,
  count, a scrollable list)
  fed by `GET /api/datasets/[datasetId]/taxonomy/rows` (`?axis=` for the whole axis,
  `?axis=&sub=` for a sub, or `?alert=`,
  org-gated; axis-only uses `.neq(col,'{}')` for any non-empty tag, sub uses `.contains()` on the GIN-indexed axis array → joins `dataset_rows_flat` for
  text. **The displayed comment text is the classified field's value (`data[field]`), not a
  heuristic `pickText` pick** — so the shown text == the field the chips were derived from ==
  where the evidence highlights. (Before this, a row's *other* open-ended column could be shown
  next to chips/evidence from the classified field, reading as a false positive — e.g. a
  Review tagged `product:chicken` displayed beside a different column with no "chicken".)
  `pickText` is the fallback only when no field is scoped / the cell is empty. Returns
  matched-evidence quotes the UI bolds, **plus every other (axis, sub) tag on
  the row, each with its own evidence** so each comment shows what else it hit. The
  **chip for the picked dimension/sub-dimension is highlighted** (an axis-only "read all"
  drill highlights *every* sub of that dimension; a severity drill highlights the
  `attribute:<alert>` chip), while the other tags are shown **muted** — and **hovering any
  chip highlights the exact span of the comment that fired it**. Chips read with their
  display labels (`DIM_AXIS_LABEL` · `dimSubLabel`), not raw keys.
  Cards mirror TextMine's `CommentCard`
  (text, meta chips, **Show more** for long text, a **rating-coloured left bar** via the same
  red→green ramp as TextMine, and a **1–4 column grid selector**); the panel has an **Export CSV**
  (rating/date/comment/evidence of the shown comments) and a per-comment **Copy** button.
  (Inline, not the theme-coupled TextMine `CommentsPanel` — that's 944 lines bound to the
  theme model + in-memory rows; the taxonomy panel reuses the same UX pattern + the
  tag-filtered `/taxonomy/rows` endpoint instead.)
  (Minimal first cut shipped for a demo — the longer-term home is a TextMine lens reusing
  the shared `CommentsPanel`.)
- **Admin pilot viewer** — `/admin/taxonomy-pilot/[datasetId]` (requireAdmin),
  per-row legacy-vs-new side-by-side.
- **Decks** — `lib/pptx/reviewIntelligenceDeck.ts` + `app/api/review-intelligence-deck`
  (`?mode=full|alerts|capability`), surfaced in `/admin/decks`. Datanautix-branded.
- **CLI** — `scripts/taxonomy-classify.ts` (`--dataset-id|--dataset-name --brand
  --rollup`); `scripts/repair-review-dataset-state.ts` (back-fills `dataset_state` for
  script-ingested review datasets so `/analyze` opens).

## 4a. Dimensions view display — pills + cards (BUILT 2026-06-06)

Redesign of the **Dimensions** section Overview display (`TaxonomyModule.tsx`). Pure
presentation change — **no theme-card changes, no new backend, no new
endpoint/RPC**; everything is fed by the existing `taxonomy` rollup (`SubStat`).
Replaced the dense two-column "By axis bars / Top sub-topics list" + the
sub-dimension pill row with one coherent surface that borrows two patterns
already in the product: **Entities-style pills** on top, **theme-card-family
cards** below. A pill is the collapsed form of its cards.

- **Keep as-is**: the inline comment drill panel (`GET …/taxonomy/rows`); the
  first-run **Classify** control on the empty state. The field picker and the prominent
  **Re-classify** button were **removed** 2026-06-06 — the classified field follows the
  ANALYZE toggle, and re-classification is deferred to the dataset level (see §4).
  **Severity** is promoted to an 8th pill in the axis-pill row (kept **red** —
  status, not navigation; via the `SEVERITY='__severity__'` sentinel `filterAxis`),
  showing the total flagged-review count; selecting it **opens its alert sub-types as
  red cards** (food safety / pests → ⚠ tag + the matching attribute sub's ★ rating +
  flagged count, click → `?alert=` drill), mirroring the axis→sub-card flow. The old
  separate severity-pill row is gone.
- **Header** matches the Themes view's scale (not chunky KPI cards): an `<h2>`
  "Dimensions" (20px/800) + a **one-line stat summary** ("N reviews classified · X% with
  a signal · ★ Y avg rating · Z flagged"). No right-aligned controls — the field picker and
  Re-classify were removed (2026-06-06). The old big centered KPI cards were removed (they
  clashed with the TextMine nav chrome); the **flagged count moved onto the ⚠ Severity
  pill**, so it isn't a KPI anymore.
- **Axis pills (the 7 top-level dimensions)** adopt the **Entities-pill treatment**:
  `● Touchpoint  28%  ★3.8` — axis identity-color **dot** + label + **mention rate %**
  (% of classified reviews touching the axis, **rounded, no decimals**) + a red→green
  **★ rating badge**. The pills **filter the card grid**; selected/unselected keeps the
  active-state styling. **Rate%** (not raw count) is the axis-grain metric — volume reads
  better at the broad axis grain.
  - **No rating/sentiment fill-coloring on the pills.** Rationale: an axis-level
    rating is an *average across heterogeneous subs* (Attribute spans flavor / pests /
    rude / food safety) — a soft, directional number. A small ★ **badge** is an
    appropriately lightweight commitment for that; flooding the **pill fill** with a
    performance color would (a) collide with the Severity **red**, (b) fight the
    selected-state signal, (c) double-encode what the cards already show per-sub.
    Same reasoning is why **axes never become full cards** — a card's real estate
    implies a depth the axis-average doesn't have (it would overclaim). UI weight
    must match signal strength: badge = soft signal OK; card = overclaim.
- **Sub-bucket cards (the level-2 breakdown)** — **theme-card family, slightly
  leaner** (same visual language: rounded card, color dot, ★ badge, footer bar;
  tighter vertical rhythm so ~4 data points don't float in theme-card whitespace):
  `● Steak  ★4.3 / ▓▓▓▓▓▓░░ 72% positive / 64% of product · 1,240 ›`.
  Each card = axis-color dot + sub title (title-cased) + **★ avg rating** + **pos/neg
  sentiment bar** (`posPct`) + footer leading with the sub's **share of its dimension**
  (`round(100·sub.count / axis.count)` — "% of *this dimension's* reviews that mention
  the sub", distinct from the axis pill's % of *all* reviews) + the raw count muted;
  click → the existing `setDrill(...)` comment panel. All percentages are **rounded (no
  decimals)**. Honest-by-omission: cards carry only the four things a sub genuinely knows
  (rating, sentiment, share, count) and **skip** the theme-card sections with no
  taxonomy-side data (description, keywords, co-occurs, items, 95% CI, top/bottom box)
  — those are additive later if a backend feed is added; the layout leaves room.
- **Grid states**: **no dimension selected** → **pills only** (a one-line prompt, no
  cards) — the initial view is just the L1 chips; **dimension selected, no sub** → the
  sub-cards for that axis (sorted **rate% desc**, count tiebreak); **sub selected** → the
  cards **collapse to a compact sub-dimension pill row** right under the dimension (with
  "⊞ All sub-dimensions" to expand back), above the comments — so the user can **switch
  sub-dimensions / re-drill without closing**. Selecting a dimension pill also **closes any
  open comments panel** (`setDrill(null)`). The **axis-level drill** is a **"Read all
  comments"** header link on the focused grid.
- **Min-mentions floor**: sub-dimensions surface only at **count ≥ `MIN_SUB_COUNT` (35)** —
  the Dimensions analog of the Themes signal cutoff (cards *and* the collapsed pill row).
  **Severity alerts are exempt** (a low-count food-safety/pests flag still matters).
  *(The comment-text evidence highlight is layout-neutral — background + box-shadow underline,
  no padding/border/weight — so hovering a chip never reflows the text / bounces the cursor.)*
- **Retire**: the "By axis" horizontal-bar column, the "Top sub-topics" list column,
  and the sub-dimension pill row — all folded into pills (axis) + cards (sub).
- **Refactor (done)**: the 7 axis colors now live in a single `AXIS_COLOR` map in
  `lib/dimensionFields.ts`, imported by `TaxonomyModule` **and** the previously-inline
  copies in the theme-card / Theme-cloud **Dimensions chip rows** (`TextMineModule.tsx`
  ×2, `WordCloud.tsx`) so the colors can't drift. Color constant relocation only —
  **no change to the theme-card layout**.
- **Edge cases**: empty buckets are already hidden (the rollup's `subs` only carries
  surfaced/non-zero subs — keep that). Largest grids are **Context** (25 subs, really
  4 clusters: Daypart/Holiday/Channel/Loose) and **Attribute** (22, a flat grab-bag);
  Context sub-grouping (section headers within the grid) is a nice-to-have, not v1.
  Chip-first navigation also resolves the `flavor`/`clean` cross-axis name collision —
  you've already picked the axis, so there's no ambiguity.
- **Cost**: zero new fetching (no per-card requests), zero migration — a contained
  `TaxonomyModule.tsx` + `dimensionFields.ts` change.

## 5. Vendor benchmark + critical-category audit (Ruth's Chris, 43,196 reviews)

Vendor labels exist only in the client CSV (`scripts/pilot-rc-coverage.ts` reads it;
the DB has a 50-row smoke sample). Against the current classifier:

- **Coverage** — 98.6% of reviews tagged vs vendor 95.3%; **90.4%** of the vendor's
  topics reproduced at axis level; +4.1% added; vendor's **20.8% "TEST"** QA leak dropped.
- **Food safety** — an independent Haiku judge over all 1,140 vendor food-safety alerts
  (`scripts/pilot-rc-foodsafety-audit.ts`, conservative rubric) found **~62% are false
  alarms** (703/1,140; 437 genuine). Defensible lower bound.
  - **Hair example (concrete FP pattern):** the vendor tags **72 of 234** hair-mentioning
    RC reviews `Alert - Food Safety`, including ≥16 obvious FPs describing a *person's*
    hair ("blonde hair" ×6, "dark hair" ×3, "no hair"/bald, "golden hair", "lighter
    hair"). Our keyword tier (2026-06-03, dict v2) adds hair + a foreign-object cadre
    (glass/metal/staple/band-aid/plastic/…) as **multi-word in-food phrases only**
    (`piece of hair`, `a hair in`, `hair in my`, …) — catches the real complaint, stays
    clean on the people-describing-hair noise. Verified: 7/7 real complaints flag, 5/5
    competitor FPs clean. On Cheddar's this lifted food-safety alerts 45 → 79.
- **Pests** — fixed a mapping gap (`Alert - Bug` → `pests` in `lib/taxonomyMapping.ts`)
  and expanded/tightened the pests dictionary to **~99% precision**; the vendor's bug
  alert is itself noisy (fires on "fly in", "bar fly", typos). `scripts/pilot-rc-alert-compare.ts`.

**Pitch framing:** never show a raw "agreement %" (contaminated by mutual
false-positives) — frame as **precision**: their alerts get muted, ours get acted on.

## 6. Not built / roadmap

- Auto-classify on ingest (the one core-path change); AI/paid tier wired to persist;
  brand-overlay DB table + promotion governance; taxonomy versioning; the in-app
  vendor-vs-us side-by-side benchmark (needs the vendor-tagged corpus ingested). See
  `docs/TAXONOMY_PRODUCTIZATION_PLAN.md`.

## 7. REO (Restaurant Experience Ontology) — robustness track (2026-06-08)

Evaluation of replacing the legacy 7 flat axes with the REO hierarchy to make the
Dimensions classifier more robust. **Owner decision: LEAN CUT** — adopt only
**Domain › Aspect + Sentiment** (10 domains, ~50 aspects); defer the ~150 fine
Concepts and cut the Emotion(13)/Journey(8) layers to an experimental v2. The lean
vocabulary lives in `lib/reoVocabulary.ts`, kept separate from the legacy
`lib/taxonomyVocabulary.ts` (still production) until a migration lands.

**Gold set (the gate before any classifier work).** A labeled gold set is the
prerequisite for proving REO beats the keyword-only production classifier *before*
spending on LLM calls. Tooling shipped this session:
- `sql/121_reo_gold_set.sql` — `reo_gold_review` table (one row/review; `proposed`
  = draft labels, `gold` = human truth; RLS on, admin-only writes). Applied to prod.
- `scripts/seed-reo-goldset.ts` + `scripts/reo-goldset-seed-data.json` — seeds 30 real
  Ruth's Chris reviews / 122 proposed observations (ported from the CSV draft).
- `/admin/reo-gold-set` (`app/admin/reo-gold-set/*`, API `app/api/admin/reo-gold-set/`)
  — review UI: step through each review, fix/add/delete Domain›Aspect›Sentiment labels,
  leave guidance notes; corrections become `gold`. Closed-vocab validated server-side.

**Key mapping rules** (full rulebook = `~/Downloads/REO_goldset_rulebook_v1.md`): old
`outcome` axis splits → CustomerRelationship›Loyalty + Brand›Reputation; cooked-wrong =
FoodBeverage›Preparation, delivered-wrong/request-ignored = Service›Accuracy; severity
kept as a cross-cutting flag (none/alert/crisis) so allergy/discrimination keep escalating.
**Coverage gap:** steakhouse reviews give zero Access/Digital examples — targeted-sample
those before scaling the set. Cost to run the LLM tier once REO lands: ~$0.5–2/1k rows
(Haiku+caching), ~half via Batch API.

**Gold set v1 result (owner-validated, 2026-06-08).** The owner reviewed all 30 via a
guided **tap-to-judge** UI (each Domain›Aspect carries an inline definition, `REO_ASPECT_DEF`).
Result: after definitions, near-total Domain›Aspect agreement with the draft labels.
**Decision: keep the lean cut — NO product/dish field.** The early "we might need a
dish handle" signal was an artifact of missing definitions (Menu was being overloaded for
the dish); once Menu was defined as "the offering, not a dish," it disappeared. The one
refined rule is **sentiment calibration** — a neutral *mention* is not Positive ("a Cabernet
to pair", "good except…" → Neutral) — now an explicit line in the classifier prompt.

**Scale-up (2026-06-08).** Gold set v1 (30, owner-validated) extended to ~520 via
LLM drafting: `lib/reoExtractor.ts` (Haiku 4.5, cached system prompt encoding the
validated rules — closed vocab, sentiment-calibration "neutral mention != Positive",
Menu = offering) + `scripts/draft-reo-goldset.ts` over a sample (~400 general + 120
Access/Digital-targeted from casual datasets; `scripts/reo-draft-sample.json`). Seeded
490 distinct reviews / 2,352 observations as `pending` for owner SPOT-CHECK (not full
re-label) in `/admin/reo-gold-set`. All 10 domains now covered (Access 65, Digital 12).
Early eval signal: drafts skew Positive (~72%; Neutral only ~4%) — the model over-calls
neutral mentions despite the prompt rule; the spot-check quantifies it, then few-shot /
calibration fix. The owner-verified slice = the gold eval set; the rest are silver.
