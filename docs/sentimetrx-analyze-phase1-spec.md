# SENTIMETRX — Analyze Module: Phase 1 Specification

**Version:** 1.0 | March 2026  
**Scope:** Dataset infrastructure, permissions gating, survey-to-dataset bridge, Analyze nav section, Ana module hook scaffolding  
**Builds on:** sentimetrx-spec-v4.md — read that first. All v4 rules apply here.  
**Repo:** github.com/Got2surf2/sentimetrx

---

## 0. How to Start a New Session for This Work

Paste this as your opening message:

> *"I am extending Sentimetrx with an Analyze module. The base system spec is sentimetrx-spec-v4.md. The Phase 1 extension spec is sentimetrx-analyze-phase1-spec.md. Both are the full engineering reference. Repo: github.com/Got2surf2/sentimetrx. Please read both specs fully, then help me with [describe task]. Before writing any code, fetch the current version of any file you will modify directly from GitHub."*

**Additional rules for Analyze sessions:**
- All v4 SWC parser rules (Section 11) apply — no exceptions
- Never modify raw dataset rows after initial write — all user changes go to `dataset_state` only
- Always check `org.features.analyze === true` before rendering any Analyze UI
- The `datasets` table follows the same visibility/RLS patterns as `studies`

---

## 1. What Phase 1 Delivers

Phase 1 builds the **foundation layer** that all three Ana analysis modules (TextMine, Charts, Statistics) will sit on top of. It does not port Ana's analysis UI — that is Phase 2. What Phase 1 delivers:

| Deliverable | Description |
|---|---|
| Feature gating | `analyze` paid-tier flag on orgs, enforced at nav + route level |
| Analyze nav section | Top-level nav entry, separate from Studies |
| Datasets list page | `/analyze` — card grid of all datasets the user can see |
| Dataset CRUD | Create, rename, set visibility, delete datasets |
| Upload flow | CSV/TSV/JSON upload → raw storage → schema editor stub |
| Survey bridge | One-click on study page → creates or navigates to linked dataset |
| Append logic | Subsequent one-clicks sync new responses into existing dataset |
| Data storage | Three-table architecture (metadata, raw rows, state) |
| RLS policies | Same org/visibility rules as studies |
| Ana module hooks | Placeholder pages for TextMine, Charts, Statistics with data pipeline wired |

---

## 2. Feature Gating — Paid Tier

### Database Change

Add a `features` JSONB column to the `orgs` table:

```sql
ALTER TABLE orgs ADD COLUMN features jsonb NOT NULL DEFAULT '{}';
```

The `analyze` flag lives inside this object, leaving room for future paid features:

```json
{ "analyze": true }
```

To enable Analyze for an org (super-admin action):

```sql
UPDATE orgs SET features = jsonb_set(features, '{analyze}', 'true') WHERE id = '<org_id>';
```

### TypeScript Type Addition (lib/types.ts)

```typescript
interface OrgFeatures {
  analyze?: boolean
  // future paid features added here
}

interface Org {
  id: string
  name: string
  client_id: string
  features: OrgFeatures    // ADD THIS
  created_at: string
}
```

### Gate Enforcement

Two enforcement points:

**1. Nav level** — `TopNav.tsx` reads the org from session context. If `org.features.analyze !== true`, the Analyze nav item is not rendered at all. No disabled state, no lock icon — simply absent.

**2. Route level** — Every page under `app/analyze/` is a server component that checks the org feature flag before rendering. Returns a redirect to `/dashboard` if not enabled. This prevents direct URL access even if nav is bypassed.

```typescript
// Pattern for all /analyze/* server pages
const org = await getOrgForUser(supabase, user.id)
if (!org?.features?.analyze) redirect('/dashboard')
```

### Admin UI Addition

The super-admin panel (`AdminClientDetail.tsx`) gets a new toggle per org: **"Analyze Module"** — on/off switch that calls a new `PATCH /api/admin/orgs/[orgId]` route updating the features JSONB. This is the only way to enable or disable Analyze for an org.

---

## 3. Database Schema — Three New Tables

### 3.1 datasets (metadata)

```sql
CREATE TABLE datasets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  description  text,
  source       text NOT NULL DEFAULT 'upload',
    -- 'upload' = user-uploaded CSV/TSV/JSON
    -- 'study'  = created from a study via one-click bridge
  study_id     uuid REFERENCES studies(id) ON DELETE SET NULL,
    -- Only populated for source='study'. The permanent link.
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  client_id    uuid REFERENCES clients(id) ON DELETE SET NULL,
  created_by   uuid NOT NULL REFERENCES auth.users(id),
  visibility   text NOT NULL DEFAULT 'private',
    -- 'private' = only creator + org members with Analyze access
    -- 'public'  = any authenticated user in the org can view (read-only)
  status       text NOT NULL DEFAULT 'active',
    -- 'active' | 'archived'
  row_count    int4 NOT NULL DEFAULT 0,
    -- denormalized count — updated on every sync/upload
  last_synced_at timestamptz,
    -- for study-linked datasets: timestamp of last response append
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 dataset_rows (raw data — immutable after write)

```sql
CREATE TABLE dataset_rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id   uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  rows         jsonb NOT NULL,
    -- JSON array of row objects: [{ col1: val, col2: val, ... }, ...]
    -- One record per upload/sync batch. Multiple batches = multiple records.
  row_count    int4 NOT NULL,
    -- count of rows in this batch
  batch_index  int4 NOT NULL DEFAULT 0,
    -- 0 = initial upload, 1 = first append, etc.
  source_ref   text,
    -- for study batches: 'study_sync_<timestamp>'
    -- for uploads: original filename
  created_at   timestamptz NOT NULL DEFAULT now()
);
```

**Why batch-per-record instead of one record:** Appending new survey responses means inserting a new `dataset_rows` record with `batch_index = N+1`. The raw data is never mutated. All batches are read and merged in order when the dataset is loaded for analysis.

### 3.3 dataset_state (schema + user workspace — mutable)

```sql
CREATE TABLE dataset_state (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id   uuid NOT NULL UNIQUE REFERENCES datasets(id) ON DELETE CASCADE,
    -- One state record per dataset. UNIQUE enforces this.
  schema_config  jsonb NOT NULL DEFAULT '{}',
    -- Field type assignments, value remappings, derived fields
    -- See Section 4 for full shape
  theme_model    jsonb NOT NULL DEFAULT '{}',
    -- Active theme definitions (keywords, labels, colours)
    -- See Section 4 for full shape
  saved_charts   jsonb NOT NULL DEFAULT '[]',
    -- Array of saved chart configurations
    -- See Section 4 for full shape
  saved_stats    jsonb NOT NULL DEFAULT '[]',
    -- Array of saved statistical test results
    -- See Section 4 for full shape
  filter_state   jsonb NOT NULL DEFAULT '{}',
    -- Active filter panel state (persisted across sessions)
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id)
);
```

### 3.4 Row Level Security

All three tables get the same RLS pattern as `studies`:

```sql
-- datasets: org members with analyze feature can read; creator can write
ALTER TABLE datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can read datasets" ON datasets
  FOR SELECT USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "creator can insert datasets" ON datasets
  FOR INSERT WITH CHECK (created_by = auth.uid());

CREATE POLICY "creator can update datasets" ON datasets
  FOR UPDATE USING (created_by = auth.uid());

CREATE POLICY "creator can delete datasets" ON datasets
  FOR DELETE USING (created_by = auth.uid());

-- dataset_rows: read via dataset ownership; write via service role only
ALTER TABLE dataset_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read dataset_rows via dataset" ON dataset_rows
  FOR SELECT USING (
    dataset_id IN (
      SELECT id FROM datasets WHERE org_id IN (
        SELECT org_id FROM org_members WHERE user_id = auth.uid()
      )
    )
  );
-- INSERT/DELETE on dataset_rows uses service role client (same pattern as responses DELETE)

-- dataset_state: same read access as dataset; write via service role
ALTER TABLE dataset_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read dataset_state via dataset" ON dataset_state
  FOR SELECT USING (
    dataset_id IN (
      SELECT id FROM datasets WHERE org_id IN (
        SELECT org_id FROM org_members WHERE user_id = auth.uid()
      )
    )
  );
-- All writes to dataset_state use service role client
```

---

## 4. TypeScript Types for dataset_state JSONB Fields (lib/types.ts)

### SchemaConfig

```typescript
interface SchemaFieldConfig {
  field:       string          // column name from raw data
  type:        AnaFieldType    // assigned type
  label?:      string          // display label override
  remapping?:  Record<string, number>  // e.g. { "Low": 1, "Med": 2, "High": 3 }
  hidden?:     boolean         // if true, excluded from all analysis
}

type AnaFieldType = 'open-ended' | 'categorical' | 'numeric' | 'date' | 'id' | 'ignore'

interface SchemaConfig {
  fields:          SchemaFieldConfig[]
  primaryTextField?: string    // the open-ended field targeted for TextMine
  autoDetected:    boolean     // false once user has manually confirmed schema
  version:         number      // increment on each save
}
```

### ThemeModel

```typescript
interface AnaTheme {
  id:       string
  label:    string
  keywords: string[]
  color:    string             // hex — from THEME_PALETTE
  description?: string
}

interface ThemeModel {
  themes:       AnaTheme[]
  industry?:    string         // industry library used as base, if any
  aiGenerated:  boolean        // true if AI was used to generate themes
  version:      number
}
```

### SavedChart

```typescript
interface SavedChart {
  id:         string
  title:      string
  chartType:  string           // e.g. 'bar', 'scatter', 'histogram' -- Ana's 12 types
  config:     Record<string, unknown>   // full Plotly config — opaque to Phase 1
  createdAt:  string
}
```

### SavedStat

```typescript
interface SavedStat {
  id:         string
  title:      string
  testType:   string           // e.g. 'welch-t', 'anova', 'regression'
  inputs:     Record<string, unknown>   // test parameters -- opaque to Phase 1
  results:    Record<string, unknown>   // test outputs -- opaque to Phase 1
  createdAt:  string
}
```

### Full DatasetState

```typescript
interface DatasetState {
  id:            string
  dataset_id:    string
  schema_config: SchemaConfig
  theme_model:   ThemeModel
  saved_charts:  SavedChart[]
  saved_stats:   SavedStat[]
  filter_state:  Record<string, unknown>
  updated_at:    string
  updated_by:    string | null
}
```

### Dataset (metadata)

```typescript
interface Dataset {
  id:              string
  name:            string
  description:     string | null
  source:          'upload' | 'study'
  study_id:        string | null
  org_id:          string
  client_id:       string | null
  created_by:      string
  visibility:      'private' | 'public'
  status:          'active' | 'archived'
  row_count:       number
  last_synced_at:  string | null
  created_at:      string
  updated_at:      string
}
```

---

## 5. File Architecture Additions

```
app/
  analyze/
    page.tsx                      Datasets list — server component, analyze gate
    AnalyzeClient.tsx             Dataset card grid, filter bar, create button
    new/
      page.tsx                    New dataset upload flow
      UploadClient.tsx            File upload, parse preview, name/description
    [datasetId]/
      page.tsx                    Dataset workspace — redirects to /textmine by default
      layout.tsx                  Shared dataset layout: header + module tab bar
      DatasetHeader.tsx           Name, row count, sync badge, visibility, actions menu
      textmine/
        page.tsx                  TextMine module hook — Phase 1: placeholder + data ready
      charts/
        page.tsx                  Charts module hook — Phase 1: placeholder + data ready
      stats/
        page.tsx                  Statistics module hook — Phase 1: placeholder + data ready
      settings/
        page.tsx                  Dataset settings: rename, visibility, delete, schema editor

components/
  analyze/
    DatasetCard.tsx               Card component (mirrors StudyCard pattern)
    DatasetFilterBar.tsx          Filter by source/visibility/status
    SchemaEditor.tsx              Field type assignment UI (stub in Phase 1, full in Phase 2)
    ModulePlaceholder.tsx         "Coming Soon" placeholder for Charts + Stats hooks
    DatasetActionsMenu.tsx        Rename, visibility toggle, archive, delete

lib/
  datasetUtils.ts                 Row merging, auto-schema detection, response formatter
  analyzeTypes.ts                 All Dataset* TypeScript interfaces (from Section 4)

app/api/
  datasets/
    route.ts                      GET list + POST create
    [datasetId]/
      route.ts                    GET, PATCH, DELETE dataset
      rows/route.ts               GET merged rows + POST new batch (append)
      state/route.ts              GET + PUT dataset_state
      sync/route.ts               POST — trigger study response sync
```

---

## 6. API Routes

### GET /api/datasets

Returns all datasets visible to the authenticated user's org, with `analyze` feature check.

Response:
```json
{
  "datasets": [
    {
      "id": "...",
      "name": "...",
      "source": "upload",
      "study_id": null,
      "visibility": "private",
      "row_count": 847,
      "last_synced_at": null,
      "created_at": "..."
    }
  ]
}
```

### POST /api/datasets

Creates a new dataset record + empty `dataset_state` record. Does NOT upload rows — that is a separate call to `/api/datasets/[id]/rows`.

Body:
```json
{
  "name": "Q1 Customer Feedback",
  "description": "Optional",
  "source": "upload",
  "study_id": null,
  "visibility": "private"
}
```

Response: `{ "id": "...", "state_id": "..." }`

### GET /api/datasets/[datasetId]

Returns dataset metadata + state in one call (join).

### PATCH /api/datasets/[datasetId]

Updates metadata only: `name`, `description`, `visibility`, `status`. Never touches rows or state.

### DELETE /api/datasets/[datasetId]

Deletes dataset + all rows + state (cascade). Uses service role. Auth check via user client first.

### GET /api/datasets/[datasetId]/rows

Returns all row batches merged into a single flat array, ordered by `batch_index`.

Query param: `?raw=true` returns raw batch records instead of merged array (used by admin/debug).

Response:
```json
{
  "rows": [ { "col1": "val", ... }, ... ],
  "row_count": 847,
  "batch_count": 3
}
```

### POST /api/datasets/[datasetId]/rows

Appends a new batch of rows. Used by both the upload flow and the study sync.

Body:
```json
{
  "rows": [ { ... } ],
  "source_ref": "feedback_q1_2026.csv"
}
```

### GET /api/datasets/[datasetId]/state

Returns the full `dataset_state` record.

### PUT /api/datasets/[datasetId]/state

Replaces the entire state record. This is the "Save" action.

Body: full `DatasetState` object (minus `id`, `dataset_id`, `updated_at`, `updated_by` — those are set server-side).

### POST /api/datasets/[datasetId]/sync

The study bridge endpoint. Called when user clicks "Analyze" on a study page.

Logic:
1. Load the dataset by `datasetId`
2. Verify `dataset.study_id` matches the study being synced
3. Query responses created after `dataset.last_synced_at`
4. If new responses exist: format them (see Section 7), POST to `/rows`, update `last_synced_at` and `row_count`
5. Return `{ synced: N, total: M, dataset_id: "..." }`

If `N === 0`: return `{ synced: 0, total: M, dataset_id: "..." }` — caller navigates to dataset without showing a sync message.

---

## 7. Survey-to-Dataset Bridge

### The One-Click Button

On the study responses page (`app/studies/[id]/responses/page.tsx`) and analytics page, add an **"Analyze in Ana"** button in the `StudyPageHeader`.

Visible only if: user's org has `features.analyze === true`.

### Button Behavior — Decision Tree

```
User clicks "Analyze in Ana"
    │
    ├─ Does this study have a linked dataset?  (check datasets WHERE study_id = studyId)
    │
    ├─ NO → Create new dataset
    │        POST /api/datasets  (name = study.name, source = 'study', study_id = studyId)
    │        POST /api/datasets/[id]/rows  (all current responses)
    │        Navigate to /analyze/[datasetId]/textmine
    │        (schema editor opens automatically — isNew = true)
    │
    └─ YES → Sync new responses
             POST /api/datasets/[datasetId]/sync
             Navigate to /analyze/[datasetId]/textmine
             If synced > 0: show toast "X new responses added"
             If synced = 0: show toast "Already up to date"
```

### Response-to-Row Formatter (lib/datasetUtils.ts)

This function converts Sentimetrx response records into flat row objects that Ana can consume. It runs server-side in the sync route.

```typescript
function formatResponsesAsRows(responses: Response[], study: Study): Record<string, unknown>[] {
  return responses.map(r => ({
    response_id:      r.id,
    submitted_at:     r.created_at,
    nps_score:        r.nps_score,          // numeric
    experience_score: r.experience_score,   // numeric
    sentiment:        r.sentiment,          // categorical
    duration_sec:     r.duration_sec,       // numeric
    // Open-ended fields from payload — dynamic based on study config
    q3_response:      r.payload?.q3Answer ?? null,
    q4_response:      r.payload?.q4Answer ?? null,
    // Custom questions — flattened with sanitized column names
    ...flattenCustomQuestions(r.payload, study.config),
    // Psychographic responses
    ...flattenPsychographics(r.payload),
  }))
}
```

### Companion Schema — Auto-populated on Create

When creating a study-linked dataset, the system auto-generates an initial `schema_config` based on known field types. The user still sees the schema editor to confirm/adjust — but the tedious part is done:

```typescript
const autoSchema: SchemaConfig = {
  autoDetected: false,    // false because we KNOW the types — no guessing
  fields: [
    { field: 'response_id',      type: 'id' },
    { field: 'submitted_at',     type: 'date' },
    { field: 'nps_score',        type: 'numeric' },
    { field: 'experience_score', type: 'numeric' },
    { field: 'sentiment',        type: 'categorical' },
    { field: 'duration_sec',     type: 'numeric' },
    { field: 'q3_response',      type: 'open-ended' },
    { field: 'q4_response',      type: 'open-ended' },
    // Custom questions: 'open-ended' or 'categorical' based on question type
    // Psychographics: 'categorical'
  ],
  primaryTextField: 'q3_response',
  version: 1,
}
```

---

## 8. Analyze Nav Section

### TopNav.tsx Changes

Add "Analyze" as a top-level nav item, rendered only when `org.features.analyze === true`:

```
[Logo]  Studies  |  Analyze  |  Team  |  Admin (super-admin only)
```

"Analyze" links to `/analyze`.

Active state: highlight when current path starts with `/analyze`.

### SubHeader.tsx Changes

When on any `/analyze/*` route, SubHeader shows the dataset name as breadcrumb:

```
Analyze  >  [Dataset Name]  >  TextMine / Charts / Statistics / Settings
```

Clicking "Analyze" in the breadcrumb returns to `/analyze` (dataset list).

---

## 9. Page Specifications

### /analyze — Datasets List

Mirrors the `/dashboard` page structure. Server component with analyze gate.

Layout:
- Page heading: "Analyze" with "Upload Dataset" button (orange, primary action)
- FilterBar: filter by Source (All / Survey / Upload), Visibility (All / Private / Public), Status (All / Active / Archived)
- Card grid: `DatasetCard` components (see below)
- Empty state: "No datasets yet. Upload a dataset or sync a study to get started."

`DatasetCard` shows:
- Dataset name (large)
- Source badge: "Survey: [Study Name]" (orange) or "Upload" (grey)
- Row count: "847 rows"
- Last updated timestamp
- Visibility pill: private / public
- "Analyze" button → navigates to `/analyze/[datasetId]/textmine`
- Three-dot menu → rename, visibility toggle, archive, delete

### /analyze/new — Upload Flow

Three-step flow (mirrors study creator UX pattern):

**Step 1 — Upload**
- Drag-and-drop or file picker: accepts `.csv`, `.tsv`, `.json`
- Parse preview: show first 10 rows in a table
- File stats: row count, column count, detected encoding
- Error state if file cannot be parsed

**Step 2 — Name & Describe**
- Dataset name (required)
- Description (optional)
- Visibility: Private (default) / Public

**Step 3 — Confirm**
- Summary: name, row count, column list
- "Create Dataset" button → POST /api/datasets → POST /api/datasets/[id]/rows → navigate to schema editor

### /analyze/[datasetId]/layout — Dataset Workspace

Persistent layout wrapping all dataset sub-pages.

**DatasetHeader** (top of page):
- Dataset name (editable inline on click)
- Source badge
- Row count + "Last synced X ago" (study datasets only)
- Visibility pill (clickable toggle for owner)
- "Sync" button (study datasets only — triggers sync and refreshes count)
- "Save" button — saves current `dataset_state` (active when state is dirty/unsaved)
- Three-dot menu: rename, visibility, archive, delete

**Module tab bar** (below header):
```
[ TextMine ]  [ Charts ]  [ Statistics ]  [ Settings ]
```

Active tab highlighted. Settings tab always visible.

### /analyze/[datasetId]/textmine — TextMine Hook

**Phase 1:** Renders the data pipeline (loads rows, applies schema, applies filters) and confirms data is ready. Shows a "TextMine Coming Soon" placeholder using `ModulePlaceholder` component — but the data loading, schema application, and filter state are fully wired and functional. When Phase 2 ports the Ana TextMine UI, it drops into this page and the data is already there.

Data available to the page (loaded server-side, passed as props):
- Merged rows (all batches combined)
- Schema config (from `dataset_state`)
- Theme model (from `dataset_state`)

**Phase 2 drop-in point:** Replace `<ModulePlaceholder />` with `<TextMineModule rows={rows} schema={schema} themes={themes} onSave={handleSave} />`.

### /analyze/[datasetId]/charts — Charts Hook

**Phase 1:** Same pattern. `ModulePlaceholder` with message: "Charts — in development. Your data is ready when this module launches."

**Phase 2 drop-in point:** Replace with `<ChartsModule />`.

### /analyze/[datasetId]/stats — Statistics Hook

**Phase 1:** Same pattern. `ModulePlaceholder` with message: "Statistics — in development. Your data is ready when this module launches."

**Phase 2 drop-in point:** Replace with `<StatisticsModule />`.

### /analyze/[datasetId]/settings — Dataset Settings

Four sections:

**Details** — rename, description, update button

**Visibility** — private/public toggle with explanation of what each means

**Schema Editor** (stub in Phase 1) — table showing all columns with their assigned field types. In Phase 1 this is read-only display with field type dropdowns that POST to `/api/datasets/[id]/state`. Full Ana schema editor (remapping, derived fields) is Phase 2.

**Danger Zone** — archive dataset (reversible), delete dataset (confirmation modal, irreversible)

---

## 10. ModulePlaceholder Component

```typescript
// components/analyze/ModulePlaceholder.tsx
// Props: module name, coming-soon message, data summary
// Shows:
//   - Module name as heading
//   - Orange animated "Ana" wordmark (matches Ana brand)
//   - Message text
//   - Data readiness summary: "X rows loaded, Y fields configured"
//   - Link to Settings to configure schema
```

This component is what users see for Charts and Stats in Phase 1. It is NOT a dead end — it confirms their data is loaded and ready, and tells them what's coming.

---

## 11. data Pipeline Helper (lib/datasetUtils.ts)

Functions needed for Phase 1:

```typescript
// Merge multiple dataset_rows batches into flat array
mergeRowBatches(batches: DatasetRowBatch[]): Record<string, unknown>[]

// Apply schema config to raw rows (type coercions, hidden fields, remappings)
applySchema(rows: Record<string, unknown>[], schema: SchemaConfig): ProcessedRow[]

// Auto-detect field types from raw rows (Ana's heuristics — from ana_spec Part 16)
autoDetectSchema(rows: Record<string, unknown>[]): SchemaConfig

// Format Sentimetrx responses as flat rows for dataset storage
formatResponsesAsRows(responses: Response[], study: Study): Record<string, unknown>[]

// Flatten custom question answers from payload JSONB
flattenCustomQuestions(payload: SurveyPayload, config: StudyConfig): Record<string, unknown>

// Flatten psychographic answers from payload JSONB
flattenPsychographics(payload: SurveyPayload): Record<string, unknown>

// Sanitize column name for use as a JS object key
sanitizeColumnName(raw: string): string
```

---

## 12. Admin Panel Changes

### AdminClientDetail.tsx

Add an "Analyze Module" feature toggle per org in the org management panel.

Toggle state reads from `org.features.analyze`. On change, calls:

```
PATCH /api/admin/orgs/[orgId]
Body: { features: { analyze: true | false } }
```

New API route: `app/api/admin/orgs/[orgId]/route.ts`

Uses service role. Super-admin only (existing auth pattern).

---

## 13. Supabase Storage Bucket

Create a Supabase Storage bucket named `dataset-uploads` for the raw uploaded files (CSV/TSV/JSON originals). This is separate from the parsed `dataset_rows` table — it stores the original file for audit/reprocessing purposes.

Bucket policy: private, authenticated users only, scoped to their org.

File naming: `{org_id}/{dataset_id}/{batch_index}_{original_filename}`

This bucket is write-once. Files are never modified after upload.

---

## 14. Environment Variables

No new environment variables required for Phase 1. The existing Supabase and service role keys cover all new routes.

---

## 15. Deployment Checklist for Phase 1

- [ ] `orgs` table has `features jsonb` column
- [ ] `datasets`, `dataset_rows`, `dataset_state` tables created with RLS
- [ ] `dataset-uploads` Supabase Storage bucket created
- [ ] `analyzeTypes.ts` added to `lib/`
- [ ] `datasetUtils.ts` added to `lib/`
- [ ] All 7 new API routes deployed and tested
- [ ] `/analyze` page renders only for orgs with `features.analyze = true`
- [ ] Direct URL access to `/analyze/*` redirects to `/dashboard` when flag is off
- [ ] "Analyze in Ana" button visible on study pages for enabled orgs
- [ ] First-click creates dataset + navigates to schema editor
- [ ] Second-click syncs and navigates, no duplicate dataset created
- [ ] Sync with 0 new responses shows "Already up to date" toast
- [ ] Admin panel toggle enables/disables Analyze per org
- [ ] TextMine, Charts, Stats hooks render `ModulePlaceholder` with data summary
- [ ] Dataset settings page: rename, visibility, delete all working
- [ ] Dataset visibility follows same public/private rules as studies

---

## 16. What Phase 1 Does NOT Include

To be clear about scope boundaries:

- No TextMine UI (Phase 2)
- No Charts UI (Phase 2)
- No Statistics UI (Phase 2)
- No AI API calls (Phase 2)
- No industry theme library serving (Phase 2)
- No full Ana schema editor with remapping/derived fields (Phase 2)
- No saved chart/stat rendering (Phase 2 — the JSONB fields exist, nothing writes to them yet)
- No dataset sharing across orgs (future)
- No dataset versioning/history (future)

---

*End of Phase 1 Specification.*
