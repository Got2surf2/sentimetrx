# Restaurant Taxonomy Classifier

**Status:** keyword tier + persistence + in-app analytics tab shipped (local);
ingest-hook auto-classify and the paid AI/brand-overlay tiers are roadmap
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
crisis`. `food safety` (food poisoning, raw chicken, foreign object) and `pests`
fire at alert/crisis. Closed vocabulary lives in `lib/taxonomyVocabulary.ts`.

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

- **Table** `dataset_row_taxonomy` (sql/088): per-axis `text[]` columns + `alert_tags`
  + `assertions` jsonb + `raw_legacy_tags`. RLS enabled, org-scoped SELECT
  (`dataset_row_taxonomy_org_read`); writes are service-role only. UNIQUE
  `(dataset_id,row_id)`; GIN indexes on every axis array.
- **Persisting classifier** `lib/taxonomyClassify.ts` (`classifyDatasetKeyword`):
  pages a dataset's rows, runs the keyword tier, projects assertions into the axis
  columns, upserts idempotently. Pairs `(dataset_id, org_id)` on every write
  (multi-tenancy invariant). **Strips NUL/C0/surrogate chars** from text — Postgres
  jsonb rejects them and emoji-split evidence windows produce lone surrogates.
  Takes an `offset` and returns `{ nextOffset, reachedEnd, … }` so the self-serve
  UI can drive it in resumable chunks (CLI passes no offset → scans from 0).
- **Roll-up** `lib/taxonomyRollup.ts`: `aggregateTaxonomy` (pure, unit-tested) +
  `computeTaxonomyRollup` (org-scoped paged read) → classified-row count, per-axis &
  per-sub mention rates, sentiment per sub, alert tag counts, and **avg star rating per
  axis / per sub + an overall avg** (the read pulls `data->>rating` from `dataset_rows_flat`
  by `row_id` per page; `aggregateTaxonomy` averages it over matching rows). The UI shows a
  ★ badge (red→green ramp) on the KPIs, axis bars, and sub-topic rows — complements the
  text-polarity sentiment with the actual scores (e.g. on Cheddar's, `touchpoint·manager`
  ★2.4 vs `attribute·flavor` ★4.1).

## 4. Surfaces

- **In-app Dimensions view** (user-facing label **"Dimensions"**; internal code/routes/keys stay `taxonomy` — friendlier than "taxonomy", reads as analytical structure you can pivot/trend on, aligns with the future chart-integration plan; owner considered "Categories" (the competitor's word) but chose "Dimensions"). As of 2026-06-04 it lives as a **sub-tab inside TextMine** (`TextMineModule` renders `<TaxonomyModule>` when `subTab==='dimensions'`, shown only for `datasetSource==='google_reviews'` and exempt from the theme-model lock); the standalone top-level tab was retired (the `/analyze/[datasetId]/taxonomy` route still resolves but is unlinked). `TaxonomyModule.tsx` is self-contained and fed by
  `GET /api/datasets/[datasetId]/taxonomy` (org-gated). **Self-serve classification**:
  the empty state offers a **"Classify this dataset"** button (and the populated view a
  **"Re-classify"** control); both loop `POST /api/datasets/[datasetId]/taxonomy`
  (`{ cursor, textField }` body → `{ classifiedThisCall, nextCursor, done, totalRows }`,
  10K-row chunks, `core` overlay, org-gated like the GET) with a live progress bar until
  `done`. Keyword-tier → no AI cost; idempotent so an interrupted run resumes.
  **Field picker**: the text column isn't hardcoded — the `GET` response carries
  `textFields[]` + a recommended `defaultField`, detected by `detectTextFields` (samples
  ~25 rows; a column qualifies when its values are mostly multi-word strings ≥12 chars;
  labels from `schema_config` when present; defaults to `review_text`). The tab renders a
  **"Field to classify"** dropdown so a survey dataset can classify `comment`/`feedback`
  instead of `review_text`. The POST passes the pick through to `classifyDatasetKeyword`'s
  `textField` (a JSONB key lookup — an unknown field yields no matches, never an error).
  **Filter + comment drill-down**: a **pill-based Topic** (axis) + **Sub-topic** (sub)
  filter — topic pills show first; **clicking a topic (dimension) pill both reveals that
  axis's sub-topic pills AND drills into every comment tagged anywhere on that dimension**
  (axis-level); picking a specific sub-topic — or clicking a sub-topic row / alert chip
  (which syncs the pills) — narrows the drill to that sub; **deselecting the sub reverts the
  panel to the axis-level drill** (rather than closing). Either opens an **inline comments
  panel** (breadcrumb header `Dimensions › axis [› sub]` / `Dimensions › Severity alert › tag`,
  count, a scrollable list)
  fed by `GET /api/datasets/[datasetId]/taxonomy/rows` (`?axis=` for the whole axis,
  `?axis=&sub=` for a sub, or `?alert=`,
  org-gated; axis-only uses `.neq(col,'{}')` for any non-empty tag, sub uses `.contains()` on the GIN-indexed axis array → joins `dataset_rows_flat` for
  text; returns matched-evidence quotes the UI bolds, **plus every other (axis, sub) tag on
  the row, each with its own evidence** so each comment shows what else it hit — and
  **hovering a dimension chip highlights the exact span of the comment that fired it**).
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
