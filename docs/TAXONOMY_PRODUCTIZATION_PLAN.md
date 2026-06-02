# Restaurant Taxonomy — Productization Build Plan

**Status:** proposal, awaiting approval. No code written against this yet.
**Author:** drafted 2026-06-02 from the Ruth's Chris pilot + the Darden cross-brand scheme alignment.

## 1. Goal

Turn the Ruth's Chris pilot (a manual, one-brand script pipeline) into a product capability that classifies **every restaurant dataset** against one shared, versioned taxonomy — with an optional paid, brand-tuned upgrade. Three principles, agreed in discussion:

1. **One ground truth = the taxonomy.** A single versioned 7-axis schema + closed vocabulary, applied to every dataset going forward.
2. **Layered dictionaries, not one blob.** A shared *core* dictionary (true for all restaurants) + per-brand *overlays* (menu items, idioms, promotions). Brand-specific phrases never pollute the core — they're promoted into it only when they prove generic.
3. **Tiered by cost.** The free, deterministic **keyword tier** runs at upload for everyone; the paid **AI tier** + brand overlay is the upgrade clients pay for.

## 2. Current state (what exists today)

| Component | State |
|---|---|
| 7-axis taxonomy + severity (`lib/taxonomyVocabulary.ts`) | ✅ built, aligned to Darden's cross-brand scheme |
| Vendor-label mapper (`lib/taxonomyMapping.ts`) | ✅ covers Darden's full scheme (0% unmapped) |
| Keyword tier (`lib/taxonomyKeywordMatcher.ts` + hand-written + learned dicts) | ✅ built, RC-tuned |
| AI tier (`lib/taxonomyExtractor.ts`) | ✅ built |
| Mine→build pipeline (`scripts/pilot-rc-keyword-{mine,build}.ts`) | ✅ built, hardcoded to the RC CSV |
| `dataset_row_taxonomy` table + admin viewer (`/admin/taxonomy-pilot`) | ✅ pilot-only |
| **Wired into dataset upload/analysis flow** | ❌ not done |
| **Brand / segment / taxonomy-version data model** | ❌ does not exist |
| **Brand-overlay dictionary mechanism** | ❌ does not exist |

The method is proven. What's missing is the productization: a data model, an ingest hook, a brand-overlay layer, versioning, and a customer-facing surface.

## 3. Target architecture

```
            ┌─────────────────────────────────────────┐
            │  TAXONOMY (the single ground truth)       │   versioned: v1, v2, …
            │  7 axes · severity · closed vocabulary    │   lib/taxonomyVocabulary.ts
            └─────────────────────────────────────────┘
                          │ instantiated as dictionaries
        ┌─────────────────┴───────────────────┐
        ▼                                       ▼
┌──────────────────┐                  ┌──────────────────────┐
│  CORE dictionary  │  ── overlay ──▶ │  BRAND overlay        │  (paid run output)
│  shared, in repo  │   (per brand)   │  per-brand, in DB     │
│  generic phrases  │                 │  menu items, idioms   │
└──────────────────┘                  └──────────────────────┘
        │  promotion path (generic learnings ⟵ brand runs)  ▲
        └───────────────────────────────────────────────────┘

Run tiers:   keyword (free, at upload, core+overlay)  →  AI (paid, on-demand)
```

**Where dictionaries live (recommended split):**
- **Core dictionary → versioned repo file** (`lib/taxonomy*`). It's product IP, must be auditable, and changes via PR + review. Bumping it is a taxonomy version bump.
- **Brand overlays → DB table** (customer-generated, org-scoped, RLS). Each paid brand run writes its mined dictionary here.

## 4. Phases

### Phase 0 — Generalize the pilot scripts  ·  ~0.5 day
Make the proven scripts brand/CSV-parameterized so any dataset can be onboarded.
- `pilot-rc-*` → `taxonomy-{mine,build,classify,coverage}.ts` taking `--dataset-id` / `--brand` / `--csv`.
- Extract the steakhouse-specific product vocab out of the shared closed vocab.
- **Verify:** re-run RC end-to-end through the generalized scripts; numbers match the pilot.

### Phase 1 — Data model  ·  ~1 day
- `datasets`: add `vertical` (e.g. `restaurant`) + `brand_id` (FK to the brand concept — `collections.kind='brand'`, per [[brand-profile-concept]]).
- New `taxonomy_brand_overlays` table: `(org_id, brand_id, version, phrases jsonb, mined_from_dataset_id, created_at)`. **RLS enabled + org-scoped SELECT** (multi-tenancy invariant).
- `dataset_row_taxonomy`: add `taxonomy_version` + `dictionary_version` columns so we know what produced each row.
- A `taxonomy_versions` registry (or a constant in repo) so "applied going forward" is well-defined.
- Migrations in `sql/NNN_*.sql`, applied via `supabase db query --linked`.
- **Verify:** `npm run test:rls` + an egress test for the new table.

### Phase 2 — Layered matcher  ·  ~1 day
- A dictionary loader that composes `core ⊕ brand-overlay(brand_id)` (the merge pattern already in `taxonomyKeywordMatcher.ts`, generalized).
- `classifyByKeyword(text, { brandId })` resolves the right layered dictionary.
- **Verify:** unit tests — core-only vs core+overlay; overlay phrases fire only for their brand.

### Phase 3 — Ingest hook (the core-path change)  ·  ~1.5 days
- When a dataset with `vertical='restaurant'` finishes ingest/sync, batch-run the **keyword tier** over its rows → `dataset_row_taxonomy`. Free, deterministic, idempotent on `(dataset_id,row_id)`.
- Incremental: only classify new/changed rows on re-sync (reuse the `mergeSchemaStats`/row-delta pattern).
- **This is the one change to the core ingest path — needs the most care + review.**
- **Verify:** upload a test restaurant dataset → taxonomy rows appear automatically; re-sync only classifies new rows.

### Phase 4 — Paid AI tier  ·  ~1 day
- On-demand "Run AI classification" action (gated, metered via `lib/usage`), writes the AI/hybrid result over the keyword baseline.
- Quota + cost guardrails (per the recordings metered-add-on pattern, `org_features`/`user_features`).
- **Verify:** AI run upgrades the rows; usage logged with `org_id`; quota enforced.

### Phase 5 — Brand run + promotion governance  ·  ~1.5 days
- "Mine this brand's dictionary" workflow: run mine→build on the brand's reviews → write a `taxonomy_brand_overlays` row. (This is the paid brand-tuning deliverable.)
- A lightweight admin **promotion tool**: review overlay phrases, flag generic ones, promote into the core dictionary (a PR to `lib/taxonomy*` + version bump). This is how the ground truth improves over time — exactly what we did manually with Darden's `eighty-sixed`/`quality`/`prep`.
- **Verify:** a brand overlay changes only that brand's output; a promoted phrase appears in core for all brands on the next version.

### Phase 6 — Customer-facing surface  ·  ~1.5 days
- A taxonomy view in `/analyze/[datasetId]` (a new tab) showing the per-row 7-axis assertions + roll-ups, reusing the pilot viewer's chip styling.
- The vendor-vs-us coverage comparison as a customer-visible benchmark when they have legacy labels.
- **Verify:** renders for a real restaurant dataset; admin-only data stays gated.

### Phase 7 — Versioning + re-application policy  ·  ~0.5 day
- On a taxonomy version bump: **keyword tier re-runs automatically** (free) on next view/ingest; **AI tier does NOT auto-re-run** (expensive) — it re-runs only on next paid request. Record `taxonomy_version` per row so stale rows are detectable.
- **Verify:** bump version → keyword rows refresh; AI rows flagged stale, not silently re-billed.

## 5. Cross-cutting requirements

- **Multi-tenancy:** every new table gets RLS + org-scoped SELECT; service-role queries pair `id` with `org_id`; internal tools wrap `requireAdmin`. (Repo invariants.)
- **Cost control:** AI tier is never eager. Keyword-at-upload only. Quotas on AI runs.
- **Backfill:** existing restaurant datasets get the free keyword tier on a one-time backfill; AI only on request. **Non-restaurant datasets are untouched.**
- **Vertical dimension:** restaurant first. A coffee chain / QSR needs its own product layer later — the architecture supports a `vertical` above `brand`, but only restaurant is in scope now.
- **Specs:** new `docs/TAXONOMY.md` module spec + `specMap.ts` entry; devlog per commit.

## 6. Effort estimate

| Phase | Effort |
|---|---|
| 0 Generalize scripts | 0.5 d |
| 1 Data model | 1 d |
| 2 Layered matcher | 1 d |
| 3 Ingest hook | 1.5 d |
| 4 Paid AI tier | 1 d |
| 5 Brand run + promotion | 1.5 d |
| 6 Customer surface | 1.5 d |
| 7 Versioning | 0.5 d |
| **Total** | **~8.5 days** (≈2 weeks with testing/QC/review) |

A thin MVP (Phases 0–3 + 6) gives "every restaurant dataset is auto-classified and viewable" in **~5 days**; the paid brand-tuning machinery (4, 5, 7) follows.

## 7. Decisions for you

1. **Free/paid line:** keyword tier free + AI tier paid (recommended), or a different split?
2. **MVP scope:** ship Phases 0–3+6 first (auto-classify + view), then the paid layer? Or build the whole thing?
3. **Which brands first** for the paid brand-tuning, and do you have their review exports?
4. **Customer surface:** a new tab in `/analyze`, or keep it admin-only until a design pass?
5. **Backfill:** run the free keyword tier across all existing restaurant datasets now, or only on next view?

## 8. Explicitly out of scope / what we will NOT do
- Eager AI classification at upload (cost blowout).
- One merged cross-brand dictionary (precision loss).
- Auto-re-running the AI tier on every taxonomy version bump (re-billing history).
- Touching non-restaurant datasets.
