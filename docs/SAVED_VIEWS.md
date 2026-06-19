# Saved Views, Snapshots & Periods

Status: **spec / not yet built** · Scope: v1 · Last updated: 2026-06-19

Lets users save the filter state of a dataset as a reusable **view**, freeze a view's
results as an immutable **snapshot**, and filter/compare by relative **periods**
(current quarter, last month, same period last year) so recurring analysis —
e.g. a quarterly review — stays correct over time with no editing.

---

## 1. Concepts

Three objects, with a deliberate relationship:

- **Period** — a relative, self-resolving date range (`current quarter`, `last month`,
  `QTD`). Stored as *intent*, resolved to concrete dates at read time. A period is the
  date portion of a view's filters and the basis for comparison.

- **View** — a *live* named filter configuration on a single dataset (the "recipe").
  Recomputes against the latest data every time it's opened. A view's date filter may be
  a period, which is what makes "current quarter" views recurring.

- **Snapshot** — a view **frozen at a moment** (the "photo"). The period is resolved to
  absolute dates and the computed results are captured so the numbers never move. A
  snapshot is *defined in terms of* a view — "freeze this view as of today" — so there is
  one mental model, not two unrelated objects.

> Naming note: `collection` already means "virtual dataset that unions member datasets"
> in this codebase. A **view** is a saved filter config layered on a dataset/collection —
> not a collection. Keep the terms distinct.

### Why views are cheap

Saved charts/stats already re-render against the active `FilterContext` via
`applyFilters()` — they store only field-slot config, no data, no filters
(`lib/analyzeTypes.ts`, `lib/filterUtils.ts`). So a **view is just a saved
`FilterContext` state**. Loading a view sets the filters; every existing chart and stat
then reflects it automatically. No chart-side work is required. The real work is the
period model and (later) comparison.

---

## 2. Data model

Views and snapshots get their **own table** — they cannot live in the single shared
`dataset_state` record, because that record is org-universal with no per-user scoping and
views are private-by-default.

```
saved_views
  id            uuid pk
  dataset_id    uuid  fk -> datasets(id)
  org_id        uuid              -- tenant scope; pair id+org_id on service-role reads
  name          text
  kind          text             -- 'view' | 'snapshot'
  visibility    text             -- 'private' | 'org'   (default 'private')
  created_by    uuid  fk -> auth.users
  filter_config jsonb            -- serialized filters (reuse serializeFilters shape) + period spec
  frozen        jsonb            -- snapshots only: resolved range + captured aggregates (see §5)
  source_view_id uuid null       -- snapshots only: back-ref to the view it was frozen from (may dangle)
  created_at    timestamptz default now()
```

- **RLS**: standard org-member scoping (as elsewhere). Additionally, a row is readable
  only by `created_by` when `visibility = 'private'`; `visibility = 'org'` is readable by
  all org members with dataset access.
- `filter_config` reuses the existing serialized-filter JSON shape
  (`serializeFilters` / `deserializeFilters` in `lib/filterUtils.ts`) plus a `period`
  block (§3) replacing/augmenting the raw `DateRangeFilter` for the period-bound field.
- Snapshots store **aggregates only** in `frozen` (§5) — no row copies, no row IDs.

### Period filter config

`filter_config.period` (optional; absent = no period filter, fall back to explicit
`DateRangeFilter` as today):

```jsonc
{
  "field": "submitted_at",        // which date column the period filters (see §3.1)
  "primary": { "granularity": "quarter", "anchor": "current" },
  "compare": {                    // optional; comparison mode
    "offset": { "unit": "year", "n": -1 }   // "same quarter last year"
  }
}
```

`granularity`: `month | quarter | year`. `anchor`: `current | last | { specific: <ISO date> }`.
`compare.offset.unit`: `month | quarter | year`. (v1 supports **one** comparison period;
the `compare` shape is modeled so multiple — an array — can be added later without a
rewrite.)

---

## 3. Period resolver

A pure function: `resolvePeriod(spec, { now, tz, fiscalYearStartMonth }) -> [startTs, endTs)`.

Rules:

1. **Calendar arithmetic, never millisecond math.** Compute boundaries as
   midnight-on-the-1st in the target timezone, then convert to UTC ms. This makes DST
   (23h/25h days) and month-length differences self-correcting.
2. **Half-open intervals `[start, end)`.** A row stamped exactly at a boundary instant
   belongs to exactly one period — never double-counted.
3. **Timezone = org-level** (default to the account locale). Everyone viewing a shared
   view sees identical numbers. Boundaries resolve in org TZ; comparisons run against
   stored UTC timestamps.
4. **Fiscal year**: the resolver takes `fiscalYearStartMonth` (default `1` = January).
   Quarters/years derive from it. v1 UI is calendar-only; the param is there so the
   fiscal retrofit is a setting, not a rewrite.

### 3.1 Which date field — `primaryDateField` (auto-default + override)

The default date field is a **first-class schema designation**, not a per-view guess. Add
`primaryDateField?: string` to `SchemaConfig` (`lib/analyzeTypes.ts`), mirroring the existing
`primaryTextField`. A view uses it unless it overrides `period.field`; snapshots inherit the
resolved field.

- **Auto-picked** at schema-build time when any `'date'` field exists; **user-overridable**
  in the schema / Settings editor.
- **`undefined` when the dataset has no date field** — this is the canonical "no date" signal
  the whole feature keys off (§3.3).

Do **not** add a forced confirmation step to the upload flow (it's auto-only today; forcing
would tax every upload, including date-less ones). Auto-pick silently, expose it as editable
in the schema editor, and surface an inline callout **only when ambiguous** — i.e. ≥2 strong
analytical-date candidates ("Using `submitted_at` for time analysis — change?").

### 3.2 Default-date ranking heuristic

Don't pick the "first" date column — column order is arbitrary and the first is often the
wrong one (`exported_at`, `updated_at`). Rank candidates:

1. **Semantic name priority** — analytical dates (`submitted`, `created`, `event`,
   `response`, `review`, `published`) beat operational ones (`updated`, `modified`,
   `exported`, `synced`, `imported`). Operational dates record when a row was *touched*, not
   when the thing *happened*.
2. **Fill rate** — fewest nulls wins.
3. **Spread** — avoid the "constant column" trap: a date that's identical for every row
   (e.g. `imported_at`) is worthless as a period axis. Prefer fields whose values vary.
4. **Tie-break** by column order.

### 3.3 No date field available (graceful disable)

Date-less datasets are valid and common (plain comment CSVs, some social pulls). Periods are
**not** hard-required globally. When `primaryDateField` is `undefined`:

- Views still work — non-date filters are savable.
- The period picker + comparison UI **do not appear** for that dataset.
- Snapshots still work — they freeze whatever filters/aggregates exist.
- If a date field is added later (re-upload or schema edit), period support appears
  automatically; remove the date field and it disappears.

### 3.4 Where resolution runs

Since filtering is currently **client-side in-memory** (`applyFilters`), the resolver runs
**client-side**: resolve the period to `[startTs, endTs)`, inject it as the date filter for
`period.field`, then the existing pipeline applies it. No query rewrite, no server filter
engine needed for views or snapshots (snapshots capture the client's already-computed
aggregates — §5).

---

## 4. Comparison (one period, designed for N)

When `filter_config.period.compare` is set, the view computes **two** filtered result sets —
`primary` and `comparison` — and renders them side by side. v1 ships a single comparison
period; the model permits N later.

The comparison range is an **offset from the primary period**, not an absolute range, so it
rolls forward automatically (`current quarter vs same quarter last year` stays correct every
quarter, forever).

### 4.1 To-date alignment (the critical rule)

- If the primary period is the **in-progress current** one, clip *both* the primary and the
  comparison to the **same elapsed fraction** — QTD vs same-quarter-last-year-**to-date**.
  Prevents the phantom "−90% on day 8 of the quarter."
- If the primary period is a **completed** one (e.g. `last quarter`), compare **full vs
  full**.
- Alignment is by day-of-period index. Watch the sub-cases when implementing: leap years
  (Q1 = 90 vs 91 days), and month-length when aligning month-to-date onto a shorter month
  (clip day index to `min(day, daysInComparisonMonth)`).

### 4.2 Delta display

- **No prior-period data because it predates the dataset's earliest data** → render `—` /
  "no prior-period data", **not** a delta. (Distinguish "zero activity" from "didn't exist
  yet" — never imply a real −100% to a newer brand.)
- **Zero base** (genuine zero last period) → render "new" or `—`, never `∞%`.
- Same granularity only; comparing across granularities is disallowed in v1.

---

## 5. Snapshots (aggregates-only)

Freezing a view:

1. Resolve the period to an absolute `[startTs, endTs)`.
2. Capture the **computed results** the client already holds — the summary stats and the
   results backing the dataset's saved charts/stats under the frozen filters — into
   `frozen`, along with the resolved range and the resolved date field.
3. Persist a `saved_views` row with `kind = 'snapshot'`, `source_view_id` set.

Properties:

- **Immune to synced-source drift** (reviews/Reddit/Substack edit & dedupe after the fact) —
  frozen aggregates reference no live rows.
- **Self-contained** — editing or deleting the source view must not alter a snapshot;
  `source_view_id` may dangle.
- **Trade-off accepted**: a snapshot cannot be re-sliced in a *new* dimension later (it's a
  frozen report, not frozen data). Row-copy materialization is **deferred** until usage
  proves people need to re-slice.

---

## 6. Behavior rules (defaults)

- **Null/blank-date rows** → excluded from period filtering (no date ⇒ no period).
- **Stale filter fields** (a view filters on a column later renamed/removed) → drop the dead
  facet, surface a warning ("N filters no longer apply"), do **not** error.
- **Visibility transitions**: an `org`-visible view whose `created_by` user is deleted →
  reassign ownership to the org so it survives. `private` views of a deleted user → removed.
- **Snapshots are read-only**; re-running analysis means opening the source view live.

---

## 7. Deferred (explicitly not in v1)

- **Collections / virtual datasets**: periods need a canonical date-field mapping per member
  source (review posted-date vs survey submitted-at vs recording date). v1 = **single
  datasets only**.
- **Auto-snapshot at period close** (with settle-lag for late-syncing data). v1 = **manual
  freeze only**.
- **Multiple comparison periods** (trend). Modeled for, not built.
- **Snapshot row-copy / re-slice**. Aggregates-only for now.
- **Fiscal-year UI**. Resolver supports it; UI stays calendar-only.

---

## 8. Build surface (where things touch)

- `lib/analyzeTypes.ts` — add `primaryDateField?: string` to `SchemaConfig` (mirrors
  `primaryTextField`).
- `lib/datasetUtils.ts` — in `autoDetectSchema()`, set `primaryDateField` via the §3.2
  ranking heuristic (leave `undefined` when no date field exists).
- `components/analyze/SchemaEditor.tsx` — let the user view/override `primaryDateField`;
  inline ambiguity callout when ≥2 strong candidates.
- `lib/filterUtils.ts` — add the `period` spec type + `resolvePeriod()`; periods resolve to
  the existing `DateRangeFilter` shape so `applyFilters()` is unchanged.
- `components/analyze/FilterContext.tsx` — load/apply a view's `filter_config`; hold
  primary + comparison filter sets when comparison is on.
- `components/analyze/FiltersModal.tsx` — period picker (granularity + anchor), date-field
  override, comparison toggle. **Gated on `primaryDateField` being set** — hidden entirely
  for date-less datasets (§3.3).
- New `saved_views` table + RLS → next SQL migration (`sql/130_saved_views.sql`).
- New API: `/api/datasets/[datasetId]/views` (list/create/delete) and snapshot-freeze
  endpoint; mirror the `dataset_state` route's org-access gating.
- Charts/stats: **no change** for views (they already re-render against active filters);
  comparison adds a two-series render mode.
