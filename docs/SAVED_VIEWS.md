# Saved Views, Snapshots & Periods

Status: **spec / not yet built** · Scope: v1 · Last updated: 2026-06-21

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

- **View** — a filter configuration on a single dataset (the "recipe"). **Whatever you are
  looking at right now is a view** — the live `FilterContext` state *is* a view, named or
  not. Recomputes against the latest data every time it's applied. A view's date filter may
  be a period, which is what makes "current quarter" views recurring. **Saving** a view just
  gives that state a name and a row so you can come back to it; naming is optional
  persistence, not part of what makes something a view.

- **Snapshot** — a view **frozen at a moment** (the "photo"). The period is resolved to
  absolute dates and the computed results are captured so the numbers never move. You can
  freeze *any* view — a saved one, or the unsaved live state you're looking at right now. A
  snapshot is **fully self-contained**: it carries the resolved filters and the frozen
  aggregates, so it needs no reference back to a view to be displayed or re-run.

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
  id              uuid pk
  dataset_id      uuid  fk -> datasets(id)
  org_id          uuid              -- tenant scope; pair id+org_id on service-role reads
  name            text
  kind            text             -- 'view' | 'snapshot'
  visibility      text             -- 'private' | 'org'   (default 'private')
  created_by      uuid  fk -> auth.users
  filter_config   jsonb            -- serialized filters (reuse serializeFilters shape) + period spec
  frozen          jsonb            -- snapshots only: resolved range + captured aggregates (see §5)
  source_view_name text null       -- snapshots only: provenance LABEL (see §5.1); not a ref, never dangles
  expires_at      timestamptz null -- snapshots only: retention clock (see §5.2); null = kept forever
  created_at      timestamptz default now()
```

- **RLS**: standard org-member scoping (as elsewhere). Additionally, a row is readable
  only by `created_by` when `visibility = 'private'`; `visibility = 'org'` is readable by
  all org members with dataset access.
- `filter_config` reuses the existing serialized-filter JSON shape
  (`serializeFilters` / `deserializeFilters` in `lib/filterUtils.ts`) plus a `period`
  block (§3) replacing/augmenting the raw `DateRangeFilter` for the period-bound field.
- Snapshots store **aggregates only** in `frozen` (§5) — no row copies, no row IDs.
- **No `source_view_id` foreign key.** A snapshot is self-contained (it stores its own
  `filter_config` + `frozen`), so it never needs to reference a view to be displayed or
  re-run live. The only provenance carried is `source_view_name`, a denormalized **label**
  copied at freeze time (§5.1) — it cannot dangle, and renaming/deleting a view does not
  affect it. This is why deleting a view has **zero** effect on any snapshot.

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
   stored UTC timestamps. **v1 status:** `resolvePeriod` resolves boundaries in **UTC** —
   there is no org-timezone column yet, and no date library in the stack. `ResolvePeriodOpts`
   reserves the seam (it already carries `fiscalYearStartMonth`; a `tz` follows the same
   pattern), so org-TZ is an additive setting, not a rewrite. Track the column + offset math
   as the retrofit.
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

## 5. Snapshots (aggregates-only, self-contained)

Freezing a view (saved or the unsaved live state):

1. Resolve the period to an absolute `[startTs, endTs)`.
2. Capture the **computed results** the client already holds — the summary stats and the
   results backing the dataset's saved charts/stats under the frozen filters — into
   `frozen`, along with the resolved range and the resolved date field. Also persist the
   resolved `filter_config` so the snapshot can be re-run live on its own.
3. Persist a `saved_views` row with `kind = 'snapshot'`, `name` (set at freeze, §5.2),
   `source_view_name` per §5.1, and `expires_at` defaulted per §5.2.

Properties:

- **Immune to synced-source drift** (reviews/Reddit/Substack edit & dedupe after the fact) —
  frozen aggregates reference no live rows.
- **Self-contained** — a snapshot carries everything needed to display *and* re-run it: its
  own resolved `filter_config` plus the captured `frozen` aggregates. It holds **no reference
  to a view**, so editing, renaming, or deleting any view never alters it. "Open this
  snapshot's filters live" loads the snapshot's *own* `filter_config` into `FilterContext` —
  faithful to exactly what was frozen, and works even if no view was ever saved.
- **Content is immutable** — `filter_config`, `frozen`, and `name` never change after freeze.
  (Retention is a separate axis — see §5.2.) Re-running analysis means opening the snapshot's
  filters live, which produces a *new* current-data result, not a mutation of the snapshot.
- **Trade-off accepted**: a snapshot cannot be re-sliced in a *new* dimension later (it's a
  frozen report, not frozen data). Row-copy materialization is **deferred** until usage
  proves people need to re-slice.

### 5.1 Provenance label & dirty-view detection

A snapshot may carry the **name of the view it was frozen from** as a display label
(`source_view_name`, e.g. *"frozen from Q2 Exec Review"*). It is a denormalized string, not a
reference — it cannot dangle and is unaffected by later renames or deletes of that view.

The label is carried **only when the live state still matches the loaded saved view**:

- Loading a saved view records its identity + its stored `filter_config`.
- On any filter change, the live `FilterContext` is compared against that stored config:
  - **Clean (identical)** → you are still looking at that view. Header shows the view name; a
    freeze stamps `source_view_name = <view name>`.
  - **Diverged (modified)** → you are now looking at a *different, unsaved* view (per §1,
    whatever you're looking at is a view). Header shows *"<name> (modified)"* or unnamed; a
    freeze stamps **no** `source_view_name` — it's a standalone snapshot of an ad-hoc state.

This is why provenance is a conditional label and not a foreign key: a FK would keep pointing
at the view even after you've diverged from it, misrepresenting what was actually frozen.

Implementation note: `FilterContext` needs a **dirty/diverged flag** — a structural equality
check between the live filter state and the loaded view's serialized config. That one flag
drives both the "(modified)" header and whether a freeze inherits the view name.

### 5.2 Lifecycle — default TTL, soft-expire, keep / extend / restore

Snapshots accumulate; most are transient explorations, a few are the durable record (e.g. a
quarter-close report). They get a default retention clock modeled on shared links, but tuned
so a record is **never silently destroyed**.

- **Default TTL = 30 days.** On freeze, `expires_at = now + 30 days`. (Views never expire;
  `expires_at` is snapshot-only.)
- **Soft-expire, not delete.** Expiry is enforced as a **read-time filter**: a snapshot with
  `expires_at < now` drops out of the default list and renders an *"expired — restore?"*
  state. The row and its `frozen` data are **retained**. There is **no cron hard-delete** for
  snapshots (unlike `shared_links`) — frozen data can't be recreated once live data has
  drifted, so it is never garbage-collected automatically.
- **Keep** = set `expires_at = null` (at freeze or any time after) → kept forever.
- **Extend** = push `expires_at` to a later date. **Restore** an expired snapshot = the same
  action (extend or keep).
- These are **lifecycle-metadata** actions, distinct from content editing. They adjust only
  the retention clock; `filter_config`, `frozen`, and `name` remain immutable, so the
  "snapshots have no content update" rule (§8) holds.

---

## 6. Behavior rules (defaults)

- **Null/blank-date rows** → excluded from period filtering (no date ⇒ no period).
- **Stale filter fields** (a view filters on a column later renamed/removed) → drop the dead
  facet, surface a warning ("N filters no longer apply"), do **not** error.
- **Visibility transitions**: an `org`-visible view whose `created_by` user is deleted →
  reassign ownership to the org so it survives. `private` views of a deleted user → removed.
- **Deleting a view has no effect on snapshots** — they are self-contained (§2/§5). No
  cascade, no prompt, no dangling references.
- **Opening a deleted / unavailable item** (e.g. an `org`-visible view a teammate just
  deleted, or a snapshot since removed): the single-item read returns a clean **not-found**
  signal (HTTP 404), never a 500. The UI shows a *"This view was deleted"* /
  *"This snapshot is no longer available"* toast, drops it from the list, and refreshes —
  rather than erroring.
- **Snapshot content is read-only**; re-running analysis means opening the snapshot's filters
  live (or the source view, if it still exists). Only the retention clock is adjustable (§5.2).

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
  primary + comparison filter sets when comparison is on; track the **dirty/diverged flag**
  vs the loaded saved view (§5.1) for the "(modified)" header and snapshot name carry-over.
- `components/analyze/FiltersModal.tsx` — period picker (granularity + anchor), date-field
  override, comparison toggle. **Gated on `primaryDateField` being set** — hidden entirely
  for date-less datasets (§3.3).
- New `saved_views` table + RLS → next SQL migration (`sql/130_saved_views.sql`).
- New API: `/api/datasets/[datasetId]/views`:
  - **Views — full CRUD**: `list`, `read` (single), `create`, `update` (rename, visibility,
    re-save filters), `delete`.
  - **Snapshots — CRD on content**: `create` (freeze), `read` (single + list), `delete`. **No
    content update** — `name` / `filter_config` / `frozen` are fixed at freeze. The freeze
    request sets the name up front (default suggestion: source view name + resolved range,
    e.g. *"Q2 Exec Review · Apr–Jun 2026"*).
  - **Snapshot lifecycle** is a single field on the snapshot's `PATCH`: `expires_at`
    (`null` = keep forever; a future ISO date = extend/restore). It touches only the clock,
    never content (§5.2). On a snapshot, `PATCH` rejects any content field
    (`name`/`filter_config`/`frozen`/`visibility`).
  - Single-item reads return a clean 404 for missing/deleted/unauthorized rows (§6).
  - Mirror the `dataset_state` route's org-access gating; pair `id` with `org_id` on
    service-role reads.

**Implemented (Phase 2):** `views/route.ts` (GET list, POST create/freeze), `views/[viewId]/route.ts`
(GET/PATCH/DELETE), shared `views/gate.ts` (caller → dataset-org gate, returns the dataset's
`org_id` so saved_views pairs `id`+`org_id` and still works for admins). `FilterProvider` gained
`activeView` / `loadView` / `clearActiveView` / `isViewDirty` (the §5.1 dirty flag, via
`serializedFiltersEqual`). Snapshot default TTL = 30 days. Remaining: Phase 3 UI, Phase 4 comparison.
- Charts/stats: **no change** for views (they already re-render against active filters);
  comparison adds a two-series render mode.
