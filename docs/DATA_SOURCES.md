# Sentimetrx — Data Sources Spec (Reddit, Google Reviews, Substack, Regulations.gov)

**Module:** `/app/api/{reddit,review,substack,regulations}-sources/*`, `/app/analyze/new/`, `lib/{reddit,dataforseo,reviewSync,substack,regulations}.ts`, `components/analyze/{Reddit,GoogleReviews,Substack,Regulations}Wizard.tsx`
**Storage (config):** `reddit_sources`, `reddit_source_threads` (`sql/phase8_reddit.sql`); `review_sources`, `review_source_locations`, `user_locations` (`sql/phase7_google_reviews.sql`); Substack and Regulations have **no config tables** — metadata lives on `datasets.description` JSONB.
**Storage (rows):** all four sources insert into `dataset_rows_flat` (one row per item, JSONB `data` column).
**External APIs:** DataforSEO (Google + Tripadvisor Reviews), Reddit public JSON (no auth), Substack public JSON (no auth), Regulations.gov API v4 (api.data.gov key).
**Feature gate:** `organizations.features.googleReviews`, `.reddit`, `.substack`. Regulations is gated by `.analyze`.

> **Spec scope:** complete enough to rebuild all four ingest modules from
> scratch. Includes full DDL, every API contract, sync algorithms (each
> source has a different cadence and chunking model), external API call
> signatures, env vars, per-source `dataset_rows_flat.data` schemas, and
> cross-source operational notes. Source of truth is the code — current
> as of 2026-05-15.

---

## 1. Overview

Four user-initiated ingest paths feed the standard analytics layer (`dataset_rows_flat`). They share:
- **One-row-per-item** writes to `dataset_rows_flat` (no batched dual-write — see PR #1, May 2026).
- **Org-scoped** datasets (every source creates a `datasets` row with `source = 'reddit' | 'google_reviews' | 'substack' | 'regulations'`).
- **Service-role writes** with app-level org checks (RLS is enabled + default-deny after migration 032; the previous `USING (true)` policies were dropped).

They differ in their sync cadence:

| Source | Cadence | Driver | Pagination model |
|---|---|---|---|
| Reddit | one-shot, user-initiated | UI calls `/download-thread` per thread | Per-thread, all comments fetched in one call |
| Google Reviews | continuous, cron-driven | `/api/cron/review-sync` every 6h | Two-phase: submit task → poll later |
| Substack | one-shot, user-initiated | UI calls `/download-comments` per post | Per-post, all comments fetched in one call |
| Regulations | one-shot, multi-call user-initiated | UI loops `/download-comments?page=N` until done | Page-by-page, ~10 comments per call (Vercel timeout-friendly) |

Each source has a wizard at `/app/analyze/new/` that creates the dataset and walks the user through item selection.

---

## 2. Database Schema

### Reddit — `sql/phase8_reddit.sql`

```sql
CREATE TABLE IF NOT EXISTS reddit_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id      UUID REFERENCES datasets(id) ON DELETE SET NULL,
  search_query    TEXT NOT NULL,
  subreddits      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','downloading','done','error')),
  total_posts     INT NOT NULL DEFAULT 0,
  total_comments  INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rds_org     ON reddit_sources(org_id);
CREATE INDEX idx_rds_dataset ON reddit_sources(dataset_id);

CREATE TABLE IF NOT EXISTS reddit_source_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reddit_source_id  UUID NOT NULL REFERENCES reddit_sources(id) ON DELETE CASCADE,
  thread_id         TEXT NOT NULL,
  subreddit         TEXT NOT NULL,
  title             TEXT NOT NULL,
  author            TEXT,
  score             INT NOT NULL DEFAULT 0,
  comment_count     INT NOT NULL DEFAULT 0,
  permalink         TEXT,
  created_utc       TIMESTAMPTZ,
  selected          BOOLEAN NOT NULL DEFAULT true,
  total_pulled      INT NOT NULL DEFAULT 0,
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rst_source ON reddit_source_threads(reddit_source_id);
CREATE UNIQUE INDEX idx_rst_source_thread ON reddit_source_threads(reddit_source_id, thread_id);

ALTER TABLE reddit_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE reddit_source_threads ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only after migration 032.
```

### Google Reviews — `sql/phase7_google_reviews.sql` (+ `sql/065_multi_source_reviews.sql`)

```sql
CREATE TABLE IF NOT EXISTS review_sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  dataset_id            UUID REFERENCES datasets(id) ON DELETE SET NULL,
  brand_name            TEXT NOT NULL,
  source                TEXT NOT NULL DEFAULT 'google'   -- migration 065: review platform
                          CHECK (source IN ('google','tripadvisor')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','searching','active','paused','error')),
  sync_frequency_hours  INT NOT NULL DEFAULT 24,
  last_synced_at        TIMESTAMPTZ,
  next_sync_at          TIMESTAMPTZ,
  error_message         TEXT,
  created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rs_org        ON review_sources(org_id);
CREATE INDEX idx_rs_dataset    ON review_sources(dataset_id);
CREATE INDEX idx_rs_next_sync  ON review_sources(next_sync_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS review_source_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_source_id  UUID NOT NULL REFERENCES review_sources(id) ON DELETE CASCADE,
  place_id          TEXT NOT NULL,    -- Google place_id, or Tripadvisor url_path
  name              TEXT NOT NULL,
  address, city, state, zip TEXT,
  rating            NUMERIC(2,1),
  review_count      INT NOT NULL DEFAULT 0,
  selected          BOOLEAN NOT NULL DEFAULT false,
  last_review_id    TEXT,         -- newest review ID seen, for incremental sync
  last_review_date  TIMESTAMPTZ,
  total_pulled      INT NOT NULL DEFAULT 0,
  last_synced_at    TIMESTAMPTZ,
  error_message     TEXT,         -- ALSO holds 'pending_task:{taskId}|{getPath}' refs (overloaded)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rsl_source ON review_source_locations(review_source_id);
CREATE INDEX idx_rsl_place  ON review_source_locations(place_id);
CREATE UNIQUE INDEX idx_rsl_source_place ON review_source_locations(review_source_id, place_id);

CREATE TABLE IF NOT EXISTS user_locations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  review_source_id  UUID NOT NULL REFERENCES review_sources(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES review_source_locations(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_id)
);
CREATE INDEX idx_ul_user   ON user_locations(user_id);
CREATE INDEX idx_ul_source ON user_locations(review_source_id);

ALTER TABLE review_sources         ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_source_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_locations          ENABLE ROW LEVEL SECURITY;
-- No policies — service-role only after migration 032.
```

### Substack & Regulations — no config tables

Both store metadata on `datasets.description` (a JSONB column on the standard `datasets` table). Examples:

**Substack `datasets.description`:**
```json
{ "type": "substack", "publication": "https://mattyglesias.substack.com" }
```

**Regulations `datasets.description`:**
```json
{
  "docket_id": "USDA-2024-0003",
  "docket_title": "Procedures for Quantification...", "agency": "USDA",
  "comment_count": 372, "download_status": "downloading", "next_page": 5
}
```

The download flow updates `next_page` and `download_status` between calls. `use_search: true` is added mid-download only if the Regulations.gov API needed the `filter[searchTerm]` fallback (see § 9).

---

## 3. Environment Variables

| Variable | Required by | Purpose |
|---|---|---|
| `DATAFORSEO_LOGIN` | Google Reviews | Basic-auth login for DataforSEO API |
| `DATAFORSEO_PASSWORD` | Google Reviews | Basic-auth password |
| `REGULATIONS_GOV_API_KEY` | Regulations | `X-Api-Key` header for api.regulations.gov v4 |
| `CRON_SECRET` | Google Reviews cron | Bearer token gate for `/api/cron/review-sync` |

No env vars for Reddit or Substack — both use unauthenticated public JSON endpoints. Reddit's User-Agent is hardcoded in `lib/reddit.ts`: `"sentimetrx:reddit-downloader:v1.0 (by /u/sentimetrx)"`.

---

## 4. Cron Jobs

`vercel.json`:

| Path | Schedule | Max | Purpose |
|---|---|---|---|
| `/api/cron/review-sync` | `0 */6 * * *` | 60s | Drives Google Reviews two-phase sync. No bot/Reddit/Substack/Regulations cron. |

Reddit, Substack, Regulations are **all UI-initiated** — the user triggers download via wizard buttons or the UI loops paginated calls itself.

---

## 5. `dataset_rows_flat` Row Schemas (the JSONB `data` column)

### Reddit row — produced by `lib/reddit.ts::commentToRow`
```json
{
  "comment_id":       "xyz123",
  "author":           "user123",
  "body":             "Comment text…",
  "score":            42,
  "ups":              45,
  "downs":            3,
  "controversiality": 0,
  "is_submitter":     false,
  "gilded":           0,
  "total_awards":     0,
  "post_date":        "2024-05-06",
  "subreddit":        "AskReddit",
  "thread_title":     "What's your favorite...",
  "thread_id":        "abc456",
  "depth":            2,
  "permalink":        "https://www.reddit.com/r/AskReddit/comments/abc456/_/xyz123/"
}
```
Note: `created_utc` is converted to a `post_date` YYYY-MM-DD string; the row carries no `parent_id` even though the `RedditComment` interface has one. The post selftext (when present) is inserted as a separate row with `depth: -1` and `comment_id: "post_<thread_id>"`.

### Google Reviews row — produced by `lib/reviewSync.ts::reviewToRow`
```json
{
  "review_id":         "abc_xyz",
  "author":            "Jane Doe",
  "rating":            4,
  "review_text":       "Great coffee…",
  "review_date":       "2026-05-01",
  "location":          "Starbucks 5th Ave - New York, NY",
  "location_name":     "Starbucks 5th Ave",
  "location_address":  "123 5th Ave, New York, NY 10003",
  "location_city":     "New York",
  "location_state":    "NY",
  "place_id":          "ChIJ…",
  "owner_response":    "Thank you!",
  "review_likes":      3
}
```
Note: the DataForSEO `timestamp` (ISO) is truncated to a `review_date` YYYY-MM-DD string. Tripadvisor rows use the same schema (the upstream review id, profile name, rating, and timestamp parse into the same fields). The row carries no `location_id` (the `review_source_locations` row is not joined into the JSONB), no `owner_timestamp`, and no `review_url`.

### Substack row — produced by `lib/substack.ts::commentToRow`
```json
{
  "comment_id":      "12345",
  "author":          "reader_name",
  "author_handle":   "@reader",
  "body":            "Great post…",
  "likes":           2,
  "is_author_reply": false,
  "post_title":      "My thoughts on…",
  "post_date":       "2026-04-15",
  "comment_date":    "2026-04-16",
  "depth":           0,
  "parent_id":       "",
  "children_count":  1,
  "restacks":        0
}
```
Note: `comment_date` is truncated to YYYY-MM-DD (not an ISO timestamp). The `post_id` and `edited` fields on the `SubstackComment` interface are intentionally **not** persisted into the row. `parent_id` is the empty string when no parent (Substack uses an `ancestor_path` it derives from).

### Regulations.gov row — produced by `lib/regulations.ts::commentToRow`
```json
{
  "comment_id":      "USDA-2024-0003-12345",
  "comment_text":    "We oppose this rule because…",
  "comment_type":    "Comment",
  "commenter_name":  "John Smith",
  "organization":    "Environmental Group",
  "city":            "Denver",
  "state":           "CO",
  "country":         "US",
  "posted_date":     "2024-03-15",
  "agency":          "USDA",
  "docket_id":       "USDA-2024-0003",
  "document_id":     "USDA-2024-0003-0001",
  "title":           "Re: Proposed Rule",
  "tracking_number": "lcq-jw9k-abcd"
}
```
Note: `comment_type` is `"Attachment Cover Note"` when the body is short and matches the attachment-cover boilerplate detector (`isAttachmentOnly`), otherwise `"Comment"`. The row is dropped (returns `null` from `commentToRow`) when the cleaned body is empty.

---

## 6. Reddit Module

### Wizard flow — `components/analyze/RedditWizard.tsx`
1. User enters subreddit name → `POST /api/reddit-sources/search` returns up to 100 hot posts.
2. User selects threads (checkbox per row).
3. User clicks Create → `POST /api/reddit-sources` creates dataset + reddit_source + reddit_source_threads.
4. UI then loops: for each thread, `POST /api/reddit-sources/[sourceId]/download-thread` (synchronous; UI shows progress).
5. After all threads downloaded, `POST /api/reddit-sources/[sourceId]/sync` finalizes (analytics + status='done').

### API routes

#### `POST /api/reddit-sources/search`
**Body:** `{ subreddit: string, sort?: 'hot' | 'new' | 'top' }`
**Response:** `{ subreddit, posts: RedditThread[] }` (max 100).
Calls `https://old.reddit.com/r/{name}/{sort}.json?limit=100`. Strips `r/` prefix. 404 / 403 produce friendly errors. Reddit's *search* endpoints require auth and are blocked, so this uses the public listing.

#### `POST /api/reddit-sources`
**Body:** `{ search_query, dataset_name?, threads: RedditThread[], max_comments_per_thread?, brand_tag? }`
**Response:** `{ source_id, dataset_id, threads, status: 'created' }` (201).
`brand_tag` (optional, all create routes) sets `datasets.brand_tag` — the DB trigger find-or-creates the brand-collection so the dataset shares one entity catalog with the brand's other datasets. See ANALYTICS.md → Entity Discovery & Catalog.
Creates `datasets`, `reddit_sources`, and one `reddit_source_threads` row per submitted thread. Does **not** download comments.

#### `POST /api/reddit-sources/[sourceId]/download-thread`
**Body:** `{ thread_id, max_comments? }`
**Response:** `{ comments, has_post, rows_inserted }`.
Calls `fetchThreadComments(permalink, max_comments || 500)`. When the post has selftext, inserts the post as the first row (`comment_id: "post_<thread_id>"`, `depth: -1`, `is_submitter: true`) before the comments. Inserts into `dataset_rows_flat` in 50-row chunks. Updates `dataset.row_count` and `reddit_source_threads.total_pulled`. Designed to be called once per thread from the UI; threads already fully downloaded (`total_pulled > 0`) are skipped.

#### `POST /api/reddit-sources/[sourceId]/sync`
**Body:** `{}`
**Response:** `{ status: 'done', total_comments, total_threads, errored }`.
Finalizer. Reads sample rows from `dataset_rows_flat`, builds the Reddit schema (`buildRedditSchema()`), enriches it with field stats, computes analytics. Sets source status to `'done'` or `'error'` based on whether any threads recorded errors.

### `lib/reddit.ts` — external API wrapper
- `fetchThreadComments(permalink, limit?)` → `GET https://old.reddit.com{permalink}.json?limit=500&depth=10&sort=top` → returns `{ post: RedditThread, comments: RedditComment[] }`.
- `searchSubreddits(query)` → `/subreddits/search.json` (used in early subreddit lookup).
- `commentToRow(comment)` → flattens to the JSONB shape in § 5.
- **Rate limiting:** `throttle()` enforces 2000ms between requests. On 429/403 backs off 5s → 10s → 15s.

---

## 7. Google Reviews Module

The most complex source — operates async via DataforSEO's task-submit/task-get pattern, driven by a 6-hour cron.

**Auto-classify-on-sync:** `lib/reviewSync.syncReviewSource` (the shared fn behind both the manual sync route and the `review-sync` cron) runs an **auto-classify safety net** after each sync — if the dataset already has taxonomy ("Dimensions") classification, it classifies the freshly-synced still-pending rows (`classifyPendingRows` + the `dataset_rows_pending_taxonomy` RPC, `sql/108`). Gated on prior classification (never auto-starts an un-opted dataset), capped, non-fatal. Keeps the Dimensions tab from drifting behind newly synced reviews. See `docs/TAXONOMY.md`.

**Multi-platform:** despite the legacy name, this module pulls from both **Google** and **Tripadvisor** (migration 065). The platform is chosen in the wizard and stored on `review_sources.source`. `datasets.source` stays `'google_reviews'` for both — it's the discriminator the analyze UI keys off; the authoritative platform lives on `review_sources.source` (and `datasets.description.platform`). Yelp is intentionally excluded — DataForSEO retired its Yelp endpoints.

### Wizard flow — `components/analyze/GoogleReviewsWizard.tsx`
1. User picks a platform (Google / Tripadvisor) and enters a brand keyword → `POST /api/review-sources/search` returns candidate locations. Google uses the Maps **Live** endpoint (instant, ~700 results); Tripadvisor is **task-based** — the route submits a search task and polls within its 30s budget (~210 results).
2. User selects locations (checkboxes), optionally sets date range and sync frequency.
3. User clicks Create → `POST /api/review-sources` creates dataset + review_source + review_source_locations rows. `next_sync_at` is set to `now()` so the cron picks it up immediately.
4. The 6-hour cron does the rest (no UI polling needed). UI shows progress on the dataset page.

> **Tripadvisor caveat:** the Tripadvisor search endpoint returns no structured address/city/state, so those columns are NULL for Tripadvisor locations — the wizard's per-state grouping lumps them under "Other". Review pulls are unaffected.

### API routes

#### `GET /api/review-sources`
**Response:** `{ sources: Array<{...review_source fields, review_source_locations: [{count}]}> }` for the user's org. The locations array carries a single `{count}` row (Supabase relation-count syntax) the UI unwraps for the locations-per-source badge.

#### `POST /api/review-sources`
**Body:** `{ brand_name, locations: DfsLocation[], dataset_name?, source?: 'google'|'tripadvisor', sync_frequency_hours?, start_date?, end_date?, brand_tag? }` — `source` defaults to `'google'`; `brand_tag` defaults to `brand_name` when omitted (a reviews dataset always has a brand).
**Response:** `{ source_id, dataset_id, locations, status: 'active' }` (201).
Creates dataset, review_source (status='active', `source` = the chosen platform), one location row per selection (`selected=true`). Selections are **deduped by `place_id`** before insert (keep first; drop empty/duplicate) — discovery can surface the same physical place twice (e.g. a legacy + current Google listing sharing a `place_id`), which would otherwise violate the `UNIQUE(review_source_id, place_id)` index and fail the whole batch. Sets `next_sync_at = now()`. Optional date range stored in `datasets.description`.

#### `GET /api/review-sources/[sourceId]`
**Response:** `{ source, locations, datasetRowCount }`. Locations ordered by state, city.

#### `PATCH /api/review-sources/[sourceId]`
**Body:** `{ status?: 'active' | 'paused', sync_frequency_hours? }` → returns `{ ok: true }`.

#### `DELETE /api/review-sources/[sourceId]`
Cascades: deletes source → locations → linked dataset → its `dataset_rows_flat` and `dataset_state`.

#### `POST /api/review-sources/search`
**Body:** `{ keyword: string, source?: 'google'|'tripadvisor' }` (`source` defaults to `'google'`)
**Response:** `{ keyword, source, count, locations: ScoredLocation[] }`.
Dispatches to `searchLocations(keyword)` (Google) or `searchTripadvisorLocations(keyword)` (Tripadvisor) → DataforSEO, then runs the results through `scoreBrandMatch` (`lib/brandMatch.ts`) so the response is ranked strongest-match-first. Preview only — does **not** persist. Used by wizard step 1.

**Brand-match scoring — `lib/brandMatch.ts`.** A brand search ("Chuy's") returns the real chain plus look-alikes ("Chuy's de Mexico" — a different business). `scoreBrandMatch(keyword, locations)` annotates each result with `matchScore` (0-100) and `matchStrength` (`'strong'`|`'weak'`), sorted strongest-first. Two signals, pure + deterministic (no API cost): (1) **token similarity** — Dice coefficient between the location name and the keyword, after dropping structural stopwords (`the`, `a`, `of`, …); (2) **chain consensus** — the largest cluster of identically-named locations *that is still relevant to the keyword* is treated as "the brand", so a loose keyword still ranks the real chain (e.g. "Chuy's Tex-Mex") above look-alikes. A relevance floor stops a big unrelated cluster from hijacking the ranking. The wizard pre-selects only `'strong'` matches (falling back to all if none are strong) and badges `'weak'` ones.

#### `POST /api/review-sources/[sourceId]/sync`
**Body:** `{}`
**Response:** the `SyncResult` shape (see lib/reviewSync.ts below).
Manual sync trigger for the same algorithm the cron runs. Useful for testing.

#### `PATCH /api/review-sources/[sourceId]/locations`
**Body:** `{ clear_errors: true }` → returns `{ ok: true }`.
Clears `error_message` on every location of this source so they can be retried on the next sync. Used by the UI's "Retry failed locations" button.

#### `GET /api/review-sources/[sourceId]/user-locations`
**Response:** `{ assignments: Array<{id, user_id, location_id, review_source_locations: {name, city, state}, users: {email, full_name}}> }`.
Role-gated (`owner` / `admin` / `platform_admin`); returns all user-to-location assignments for this source. Backs the per-user location-restriction feature so a non-admin user only sees rows / analytics for their assigned locations.

#### `POST /api/review-sources/[sourceId]/user-locations`
**Body:** `{ user_id, location_ids: string[] }`
**Response:** `{ ok: true, assigned: number }` (201).
Upserts `user_locations` rows. Role-gated; admin-org callers can assign across orgs, otherwise the target user must belong to the same org as the source.

#### `DELETE /api/review-sources/[sourceId]/user-locations`
**Body:** `{ user_id, location_ids?: string[] }`
**Response:** `{ ok: true }`.
Removes assignments. Omitting `location_ids` clears every assignment for the user on this source.

### `lib/reviewSync.ts` — the two-phase sync algorithm

`syncReviewSource(sourceId, service)` does both phases within a single Vercel function invocation, time-bounded to ~45s (under the 60s timeout).

**Out-of-credit signal (added 2026-06-16):** DataForSEO returns **HTTP 402** when the account balance is exhausted; `lib/dataforseo.ts` now reports that to the **service-credit monitor** (`recordCreditError('dataforseo')` → `service_health`) in addition to the per-location `error_message`, so a broke vendor surfaces on `/admin/health` + the alert cron instead of silently stalling a load (this exact case stalled the Rubio's load, 2026-06-16). `getDataForSeoBalance()` (`/v3/appendix/user_data`) is the polled tier-1 balance. See `docs/ENGINEERING.md` §4.

**Phase 1: Check pending tasks (~first 15s)**
1. Find locations whose `error_message` starts with `pending_task:` → these have a DataforSEO task in flight.
2. For each (up to `PHASE1_BATCH_SIZE = 10` — deliberately larger than Phase 2 so backlogged queues drain faster; a 29-task backlog took 10 cron cycles at the old batch-of-3 cadence — see the 2026-05-11 Flemings incident note in `lib/reviewSync.ts`):
   - Parse the task ref: `pending_task:{taskId}|{getPath}`.
   - Call `checkReviewTask(ref)` → DataforSEO `GET {getPath}/{taskId}`. The parser is chosen by inspecting `getPath` (Google vs Tripadvisor), so old refs route correctly without a schema change.
   - If `status_code === 20000` → task ready. Filter reviews by `last_review_id` / `last_review_date` (dedup), then by configured date range. Convert to JSONB rows. **Dedup before insert** (2026-06-24): the `last_review_id` sentinel is fragile (it fails when DataForSEO returns "Task Not Found" 40401 → the location is re-fetched and re-inserted, which had silently duplicated ~10% of rows on refreshed datasets). `insertReviewRows` now also computes a **content-hash `dedup_key`** = `sha1(place_id|author|review_date|review_text[:200])` (`reviewDedupKey()` — recomputable from persisted fields), drops in-batch dupes, probes existing keys via a chunked `.in()` on the `(dataset_id, dedup_key)` index, and **inserts only genuinely-new rows** (500-row chunks) with `dedup_key` set. `review_id` is NOT used as the key (it's fabricated `profile_name:timestamp` when Google omits it). **`datasets.row_count` is reconciled from `count(*)`** after each sync (the old running counter drifted both ways). Update `last_review_id`, `last_review_date`, `total_pulled`, `last_synced_at`. Clear `error_message` (or set it to `'API returned 0 reviews'` if the task came back empty). The `dedup_key` column (`sql/131`) now has a **UNIQUE `(dataset_id, dedup_key)` index** (`sql/132`) as the hard backstop — `insertReviewRows` **upserts with ON CONFLICT DO NOTHING** against it, so even a concurrent-sync race can't duplicate. (NULL keys on non-review rows stay distinct.) Applied after a one-time cleanup: all existing google_reviews rows had `dedup_key` backfilled, existing duplicates collapsed (Ruth's Chris: 30,170→27,234, −2,936 dupes), and every `row_count` reconciled.
   - If status is in `[40402, 40602, 140607]` → task pending. Leave the ref in place; next call retries.
   - If non-transient error → store `error_message`. **Transient errors** (timeouts, network blips, DataForSEO `40601` / `40401` / `40602`) preserve the pending ref so the cron retries instead of permanently parking the location.

**Phase 2: Submit new tasks (remaining time, max 45s total)**
1. Find locations with `last_synced_at IS NULL` AND `error_message IS NULL` (unsynced, not in flight).
2. For each (up to `BATCH_SIZE = 3`):
   - Compute initial `depth` via `estimateDepth(review_count, created_at, start_date, end_date)` — clamped to `[200, 4490]`. For incremental syncs (after first), use `depth = 200`.
   - **Cap `depth` to the org's remaining monthly review-download budget** (see *Download limits & accounting* below). If the budget is already exhausted, set `limit_reached: true` on the result and stop submitting tasks this run.
   - Call `submitReviewTask` (Google) or `submitTripadvisorReviewTask` (Tripadvisor), dispatched on `review_sources.source` → DataforSEO `POST .../task_post`. Returns `{ taskId, getPath }`.
   - Store `error_message = "pending_task:{taskId}|{getPath}"` (the column is overloaded for pending refs). Decrement local `remainingBudget`.
   - Transient submit failures skip writing `error_message` so the cron picks the location up next cycle.

**Phase 3: Incremental refresh of already-synced locations.** Selects up to `BATCH_SIZE = 3` locations whose `last_synced_at < now - REFRESH_STALE_MS` (1 hour) with no current `error_message`, ordered by oldest-synced-first. Submits `depth = 200` `'newest'`-first tasks under the same monthly-budget cap; Phase 1 picks the results up on a later call and `filterNewReviews` dedupes against `last_review_id` / `last_review_date`. The 1-hour staleness floor keeps a single sync session from re-refreshing the same location twice.

Phase 1's `checkReviewTask` is platform-agnostic — it picks the right review parser by inspecting `ref.getPath` (`…/tripadvisor/…` → Tripadvisor parser), so old pending task refs keep working without a schema change.

**Scheduling & Manual-source drain (`updateSourceTimestamps`).** After each run, `next_sync_at` is set by priority: **(1)** if any tasks are still pending → `now + 5min` (drain them promptly — checked *first*, so it applies to Manual sources too); **(2)** else if `sync_frequency_hours <= 0` (Manual) → parked at `2999` (no auto-sync); **(3)** else `now + sync_frequency_hours`. The cron selects all active sources with `next_sync_at <= now` (no longer excludes Manual) and runs Manual ones (`sync_frequency_hours <= 0`) in **`drainOnly` mode** — `syncReviewSource(id, service, { drainOnly: true })` runs Phase 1 only, skipping the cost-incurring Phase 2/3 submits. This closes a gotcha where a Manual source left mid-download (tasks submitted, page closed) stranded its already-paid pending tasks at `2999` forever; they now drain on the next cron tick. The UI's manual sync route still calls `syncReviewSource` with no opts (full submit+drain).

**Returns:** `{ synced, total, locations_synced, locations_remaining, locations_errored, locations_submitted, errors, expected_reviews, with_comments, without_comments, pending_locations, processing_location, limit_reached }` for UI/cron telemetry. `limit_reached` is `true` when the org's monthly cap stopped task submission.

### Download limits & accounting

Review downloads are the only paid data-source path, so they have an opt-in per-org monthly cap (built for the Darden pilot, where we absorb the DataForSEO cost). Migration `067_review_download_limits.sql`:

- **`review_downloads`** — append-only ledger, one row per sync call that ingested rows (`org_id`, `review_source_id`, `dataset_id`, `source`, `records`, `created_at`). Doubles as the billing record and the monthly-cap counter. Written by `lib/reviewSync.ts` after `insertReviewRows`.
- **`organizations.limits`** jsonb — `{ "review_records_monthly": N }` sets the cap. Absent / empty `{}` = unlimited (the default for every org).

`lib/reviewLimits.ts::getReviewBudget(service, orgId)` returns `{ cap, used, remaining }` for the current calendar month (UTC). `syncReviewSource` reads it once at the start of each run and decrements a local `remainingBudget` as Phase 2/3 submit tasks, so a single run can't blow past the cap. Because tasks are requested newest-first, a budget-capped `depth` pulls the **most-recent N reviews** — the cap doubles as a recency-sampling lever rather than a sequential full-history pull. Cross-run overshoot from in-flight tasks is bounded and acceptable for a cost guard. The cap is set per org on the admin client-detail page (`/admin/clients/[id]` → Review Downloads).

### `lib/dataforseo.ts` — DataforSEO API wrapper

Endpoint base: `https://api.dataforseo.com/v3`. Auth: HTTP Basic, header `Authorization: Basic ${btoa("login:password")}`.

| Function | Endpoint | Returns |
|---|---|---|
| `searchLocations(keyword)` | `POST /serp/google/maps/live/advanced` body `[{keyword, location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 700}]` | `DfsLocation[]` (place_id, title, address, address_info, rating, votes, phone, lat/lng) |
| `submitReviewTask(placeId, depth?, sortBy?)` | Two attempts: (1) `POST /reviews/google/task_post` body `[{keyword: 'place_id:{placeId}', location_code: 2840, language_code: 'en', depth: ≤4490, sort_by: 'newest'\|'relevant'}]`, (2) fallback `POST /business_data/google/reviews/task_post` body `[{place_id, depth: ≤4490, sort_by, language_code: 'en'}]` (note: no `location_code` on the fallback) | `{ taskId, getPath }` |
| `searchTripadvisorLocations(keyword)` | `POST /business_data/tripadvisor/search/task_post` body `[{keyword, location_name: 'United States', depth: 210}]`, then polls `task_get` (~25s) | `DfsLocation[]` — `place_id` holds the Tripadvisor `url_path`; address/city/state are NULL |
| `submitTripadvisorReviewTask(urlPath, depth?, sortBy?)` | `POST /business_data/tripadvisor/reviews/task_post` body `[{url_path, depth: ≤4490, sort_by: 'most_recent'\|'detailed_reviews', language_code: 'en'}]` — `'newest'\|'relevant'` is translated to Tripadvisor's sort terms | `{ taskId, getPath }` |
| `checkReviewTask(ref)` | `GET {ref.getPath}/{ref.taskId}` — parser selected by `getPath` (Google vs Tripadvisor) | `{ status: 'ready'\|'pending'\|'error', reviews?: DfsReview[], message? }` |

### Why two phases?

DataforSEO is async — submitting a task returns immediately with an ID, the actual data arrives anywhere from 30 seconds to several minutes later. Vercel functions have a 60s ceiling. So we submit on one cron run, check on the next. Locations with many reviews thus take **~12 hours** end-to-end for first sync (one cron cycle to submit + one to check + one to ingest if depth was too small). The state machine lives entirely in `review_source_locations.error_message` (with `pending_task:` prefix) plus `last_synced_at` (NULL = never synced; non-NULL = at least one cycle complete).

### 7.x Google Reviews Response Dashboard (SCOPED 2026-07-06, NOT BUILT)

Owner ask: poll for new Google reviews and respond in near-real-time — management
alerts, AI-drafted replies, response tracking. Scoping outcome (~70% of the
substrate already exists — sync + auto-classify + severity/emotion alert signals +
Resend email + the client-review draft→approve→send workflow as the UX template):

- **Phase 1 — dashboard + alerts + AI drafts, manual posting** (~3–4 sessions, no
  external dependencies): a needs-response queue over synced reviews; alert rules
  (rating ≤2★, severity alert tags, churn/disappointment emotion language, per-
  location rating spikes) → instant Resend email to a management list; an
  AI-drafted reply per review following brand tone guidelines; edit → approve →
  **copy/open-in-Google** (manual paste into GBP); "mark responded" + SLA timers.
  Freshness bound: DataForSEO polling — practical floor ~hourly per priority
  location (fractions of a cent per poll).
- **Phase 2 — one-click posting + minutes-level freshness** (~2–3 sessions of our
  work + Google's approval lead time): **Google Business Profile API** integration.
  DataForSEO can only READ; posting replies requires GBP. Per-client OAuth
  (`business.manage`; tokens encrypted at rest — the BYOK `lib/secretbox` pattern),
  reply post + read-back for true response-rate analytics, and GBP-native review
  polling (fresher than DataForSEO, free).
- **Phase 3 — polish**: auto-thank-you rules for 5★, digest vs instant alert
  preferences, response-time benchmarking per location.

**The long pole is Google's API approval, not our build.** Application: the GBP
API contact form ("Application for Basic API Access") via
https://support.google.com/business/workflow/16726127 — requires a Google Cloud
project, and the APPLYING org (Datanautix/Kaizen) to have its OWN verified
Business Profile ≥60 days old, submitted from the profile's OWNER account, with
a business website + use-case description; ~2 weeks to process. Only Datanautix
applies — clients later grant access to their own listings via OAuth. Owner
action item (2026-07-06): confirm whether Kaizen/Datanautix has a verified,
60-day-old GBP and which account owns it; if none exists, create one NOW (the
60-day clock is the real lead time). Build starts on owner go.

---

## 8. Substack Module

### Wizard flow — `components/analyze/SubstackWizard.tsx`
1. User pastes a publication URL (e.g. `mattyglesias.substack.com`).
2. UI calls `POST /api/substack-sources/fetch-posts` with `{ url, offset: 0 }` → returns publication metadata + first 50 posts. UI loops with `offset += 50` while `has_more === true`.
3. User selects which posts to ingest (checkbox per row).
4. UI clicks Create → `POST /api/substack-sources` creates the dataset + state with the Substack schema.
5. UI loops: for each selected post, `POST /api/substack-sources/download-comments` with `{ dataset_id, base_url, post_id, post_title, post_date }` (synchronous; UI shows progress).

### API routes

#### `POST /api/substack-sources`
**Body:** `{ publication_url, dataset_name?, publication_name?, brand_tag? }`
**Response:** `{ dataset_id, status: 'created' }` (201).
Creates dataset (`source: 'substack'`, description `{ type: 'substack', publication: publication_url }`) and dataset_state pre-populated with the Substack schema. `publication_name` is only used to build the default dataset name (`"Substack: {publication_name || publication_url}"`); it's not persisted. Does **not** fetch posts.

#### `POST /api/substack-sources/fetch-posts`
**Body:** `{ url, offset? }`
**Response:** `{ publication, posts: SubstackPost[], base_url, has_more }`
Calls `fetchPosts(baseUrl, 50, offset || 0)` → `https://{publication}.substack.com/api/v1/archive?sort=new&limit=50&offset={offset}`. On `offset === 0`, also fetches publication metadata.

#### `POST /api/substack-sources/download-comments`
**Body:** `{ dataset_id, base_url, post_id, post_title?, post_date? }`
**Response:** `{ comments, rows_inserted }`
Calls `fetchPostComments(baseUrl, postId, postTitle, postDate)` → `/api/v1/post/{id}/comments?all_comments=true&sort=best_first`. Recursively flattens the comment tree (depth tracking + `parent_id` links). Converts to JSONB rows. Inserts into `dataset_rows_flat` in 50-row chunks. Updates `dataset.row_count`. Called once per post by the UI.

### `lib/substack.ts` — external API wrapper
- `resolveBaseUrl(input)` → normalises (handles bare subdomain, missing protocol, trailing slashes).
- `fetchPublication(baseUrl)` → extracts metadata from a 1-post archive response.
- `fetchPosts(baseUrl, limit?, offset?)` → archive endpoint listed above.
- `fetchPostComments(baseUrl, postId, postTitle, postDate)` → comments endpoint, flattens tree.
- `commentToRow(comment)` → JSONB row per § 5.
- **Rate limiting:** 500ms throttle (politeness; no observed Substack limits).

---

## 9. Regulations.gov Module

Public-comment ingestion for federal dockets. The most user-visible pagination model — UI loops through pages explicitly because each call only fetches ~10 comments (Vercel timeout safe).

### Wizard flow — `components/analyze/RegulationsWizard.tsx`
1. User searches dockets by query (e.g. "biofuel emissions") or pastes a docket ID directly (e.g. `USDA-2024-0003`). UI calls `POST /api/regulations-sources/search`.
2. User selects a docket from results. UI fetches `commentCount` for that docket (separate `/search?docketId=…` call).
3. User clicks Create → `POST /api/regulations-sources` creates the dataset with `description: { ..., download_status: 'downloading', next_page: 1 }`.
4. UI loops: `POST /api/regulations-sources/download-comments` with `{ dataset_id, docket_id, page: N }`. Increments N until response indicates `lastPage`.
5. UI calls one final `POST /api/regulations-sources/download-comments` with `{ ..., finalize: true }` to compute analytics and set `download_status: 'complete'`.

### API routes

#### `POST /api/regulations-sources/search`
**Two modes:**
- `{ docketId: 'USDA-2024-0003' }` → returns `{ commentCount }` (count lookup for the selected docket).
- `{ query, page? }` → returns `{ dockets: Array<{id, title, agency, docketType, lastModified, commentCount: -1}>, totalElements }` (count is `-1` until separately requested).

If `page === 1` and `query` matches the docket-ID regex (`[A-Z]{2,5}-[0-9]{4}-\d+`), tries direct lookup first.

#### `POST /api/regulations-sources`
**Body:** `{ dataset_name, docket_id, docket_title?, agency?, comment_count?, brand_tag? }`
**Response:** `{ dataset_id }`
Creates dataset (`source: 'regulations'`) with `description: { docket_id, docket_title, agency, comment_count, download_status: 'downloading', next_page: 1 }`. Creates dataset_state with the Regulations schema. (No `type` field on the description JSON; the dataset row's `source` column is the discriminator.)

#### `POST /api/regulations-sources/download-comments`
**Body:** `{ dataset_id, docket_id, page: number, finalize?: boolean, use_search?: boolean }`
**Response (download mode):** `{ inserted, fetched, totalElements, lastPage, usedSearch }`
**Response (finalize mode):** `{ ok: true }`

Three-step pipeline (download mode):
1. **List comment IDs**: `listComments(docketId, page, 10)` → `GET /comments?filter[docketId]={docketId}&page[size]=10&page[number]={page}`. **Fallback**: if 0 results on page 1, retry with `filter[searchTerm]={docketId}` (Regulations.gov API bug workaround) and set `use_search: true` in the dataset description so subsequent pages reuse it.
2. **Fetch full text**: `fetchCommentsBatch(commentIds)` → loop, `GET /comments/{id}` for each.
3. **Insert**: filter via `isAttachmentOnly()` (drops boilerplate cover notes). Convert via `commentToRow()`. Insert into `dataset_rows_flat` (500-row chunks). Update `datasets.description.next_page = page + 1`.

Finalize mode: builds the schema (if not already), enriches with sample stats, computes analytics, sets `download_status: 'complete'`.

### `lib/regulations.ts` — external API wrapper

Endpoint: `https://api.regulations.gov/v4`. Auth: header `X-Api-Key: {REGULATIONS_GOV_API_KEY}`. Free tier: 1000 requests/hour.

| Function | Endpoint | Returns |
|---|---|---|
| `searchDockets(query, page?)` | `GET /dockets?filter[searchTerm]={q}&page[size]=25&page[number]={p}&sort=-lastModifiedDate` | `{ dockets, totalElements }` |
| `listComments(docketId, page?, pageSize?, useSearch?)` | `GET /comments?filter[docketId]={id}&page[size]={pageSize≥5}&page[number]={p}&sort=-postedDate` — auto-falls back to `filter[searchTerm]={id}` (and re-runs with `useSearch: true`) when `filter[docketId]` returns 0 results | `{ data: RegCommentListItem[], totalElements: number, lastPage: number, usedSearch?: true }` |
| `getCommentDetail(id)` | `GET /comments/{id}` | full comment with `attributes.comment` body |
| `fetchCommentsBatch(ids)` | loops `getCommentDetail` | `RegCommentDetail[]` |
| `commentToRow(detail)` | n/a | JSONB row per § 5 |
| `cleanText(s)` | n/a | HTML entity decode + Unicode quote normalisation |
| `isAttachmentOnly(detail)` | n/a | `true` if comment body is just an attachment cover note |

**Rate limiting:** `throttle()` enforces 1000ms between requests. With 10 comments per page + 1 list call = ~11 requests per `download-comments` invocation → ~330 comments/hour ceiling per docket. Bigger dockets need multiple hours of UI loop time.

---

## 10. UI Configuration Layer

All four sources are configured via wizards under `/app/analyze/new/`:

- `app/analyze/new/UploadClient.tsx` — top-level source-type selector (Upload CSV, Survey, Town Hall, Reddit, Substack, Google Reviews, Regulations).
- `components/analyze/RedditWizard.tsx`
- `components/analyze/GoogleReviewsWizard.tsx`
- `components/analyze/SubstackWizard.tsx`
- `components/analyze/RegulationsWizard.tsx`

After creation, each source uses the standard `/analyze/[datasetId]` flow for analysis — there is no source-specific dashboard. Google Reviews additionally has a Settings page on the dataset to toggle `status`, change `sync_frequency_hours`, or unselect locations. Reddit, Substack, and Regulations have no edit UI — they're write-once.

---

## 11. Cross-References

- **`dataset_rows_flat`** is the single landing point for all four sources. The `data` JSONB column shape varies per source (§ 5) but the table schema is identical.
- **`dataset_state`** carries the per-source schema definition (Reddit / Google Reviews / Substack / Regulations). `lib/datasetUtils.ts` provides `buildRedditSchema()`, `buildGoogleReviewsSchema()`, `buildSubstackSchema()`, `buildRegulationsSchema()`.
- **Analytics RPCs** (`count_field_values`, `crosstab_counts`, etc.) work uniformly because every source funnels into the same flat-row table with a per-source schema.
- **`lib/usageLog.ts`** is **not** invoked by these modules — they don't make AI calls during ingestion. Theme mining etc. happens later in the standard analytics flow and logs there.
- **`/api/cron/social-sync`** (every 15 min, AI-emitting) is a separate path — see `SOCIAL.md`. It does *not* use `dataset_rows_flat` directly; the social→TextMine bridge is `/api/social/export-dataset`.

---

## 12. Operational Notes

### Per-source rate limits
- Reddit: hard-coded 2s between requests, backoff 5/10/15s on 429/403. Reddit will quietly throttle aggressive scraping.
- DataforSEO: pay-per-task, **priced by review depth, not a flat per-location fee**. The submit requests `depth` 1,000–4,490 reviews per location (see `estimateDepth` in `lib/reviewSync.ts`) and DataforSEO bills per page of results returned; `task_get` checks are free. Measured blended cost (2026-05, 123,274 reviews / $45.67 spent): **≈ $0.37 per 1,000 reviews** (~$0.14 per location, ~366 reviews/location avg). **Budget $0.50 per 1,000 reviews** to cover location-search SERP calls and Phase-3 refresh overhead. A 50-location brand full backfill is therefore on the order of ~$7, not cents. Auto-refresh sources (`sync_frequency_hours > 0`) re-pull `depth` 200 per location each cycle — a recurring cost; set `sync_frequency_hours = 0` for manual-only sources.
- Substack: no observed limits; 500ms self-imposed.
- Regulations.gov: free tier = 1000 req/hour. Effective comment throughput is ~330/hour per docket due to detail-fetch round-trips.

### Common failure modes
- Reddit 403 / "blocked": often when running from data centers. The User-Agent string matters — Reddit gets twitchy when it's missing.
- DataforSEO task stuck pending forever: rare but happens. The retry-on-next-cron behaviour eventually self-heals; `error_message` won't be cleared until the task either completes or hard-errors.
- Regulations.gov 0 results despite a valid docket ID: the `filter[docketId]` index occasionally goes stale; the auto-fallback to `filter[searchTerm]` plus the `use_search: true` flag in `datasets.description` works around this.

### Storage growth
A single Google Reviews source for a multi-location brand can produce 50K+ reviews and ~50 MB of `dataset_rows_flat` rows. Reddit threads with active comment sections can produce 5K+ rows. Substack publications with engaged readerships can produce 10K+ rows per post. None of these triggers any infrastructure concerns until you have hundreds of orgs running them.

---

## 13. Build Checklist (Rebuilding from Scratch)

1. Apply migrations `phase7_google_reviews.sql` and `phase8_reddit.sql`. (Substack and Regulations need no schema beyond the existing `datasets`.)
2. Apply migration 032 to drop the old `USING (true)` policies that previously left these tables publicly readable.
3. Set env vars (§ 3).
4. Implement `lib/reddit.ts`, `lib/dataforseo.ts`, `lib/reviewSync.ts`, `lib/substack.ts`, `lib/regulations.ts`.
5. Build the API routes per source (§§ 6–9).
6. Add cron entry to `vercel.json`: `/api/cron/review-sync` at `0 */6 * * *`.
7. Build the wizard components (§ 10) and wire them into `/app/analyze/new/UploadClient.tsx`.
8. Wire feature flags into `organizations.features`: `reddit`, `googleReviews`, `substack` (Regulations is gated by `analyze`).
9. Add row-shape definitions to `lib/datasetUtils.ts` (`buildRedditSchema`, `buildGoogleReviewsSchema`, etc.) so the analytics layer renders the right fields.
10. Test each end-to-end: small subreddit → small docket → small Substack post → small brand on Google Reviews. Verify rows appear in `dataset_rows_flat` and analytics + Charts + TextMine load.

---

## 14. Per-Row Taxonomy (admin pilot — Ruth's Chris 2026-05-27)

Closed-vocab 7-axis ABSA layered over `dataset_rows_flat`.

### Storage — embedded `data._tx` (sql/151, 2026-07-04)

Verdicts live INSIDE each flat row's `data` blob under the reserved `_tx` key
(shape + full transition story: `docs/TAXONOMY.md §3`; helpers in
`lib/taxonomyEmbed.ts`):

```
data._tx = { "f": { "<fieldKey>": {
  "a":  { "<axis>": ["sub", …], … },   -- 7-axis projection, only non-empty axes
  "al": ["sub", …],                     -- severity ∈ {alert, crisis}
  "as": [{axis, sub, item?, polarity, confidence, severity, evidence}],
  "v": "…", "by": "…", "m": "…", "at": "<iso>"   -- provenance
} } }
```

Access control rides the row: `dataset_rows_flat` scopes via `dataset_id`, and
every taxonomy route pairs the dataset's `org_id` before reading. The original
sidecar tables (`dataset_row_taxonomy` sql/088, `dataset_row_field_taxonomy`
sql/114 — per-axis text[] columns, GIN indexes, org-scoped RLS SELECT) are
retiring: sql/151 ports every RPC to the blob with a transitional sidecar
fallback, and sql/152 drops the tables once the prod backfill
(`scripts/backfill-taxonomy-embed.ts`) verifies. The pilot's
`raw_legacy_tags` audit copy was redundant — the prospect's Classification
column already rides on each row as `data.legacy_tags`.

### Closed vocab

- `lib/taxonomyVocabulary.ts` — 7 axes, sub-buckets, product items (filet/ribeye/etc.), severity `{normal, alert, crisis}`, polarity `{pos, neg, neu}`. `isValidAxisSub(axis, sub)` drops out-of-vocab emissions from the LLM. Aligned 2026-06-02 to the client's authoritative cross-brand vendor scheme (Darden "Classification Categories"): added attribute subs `quality/prep/menu variety/eighty-sixed/experience/sequence/ziosk`, touchpoint `delivery`, beverage `alcohol/assortment/flavor`, context `special-occasion`.
- `lib/taxonomyMapping.ts` — projects raw legacy labels to assertions or quarantine buckets (`campaign_tags`, `system_tags`, `competitor_menu`, `_unmapped`). Canonicalizes case duplicates (`Menu - Salads` ≡ `menu - salads`) and `Service-X / SERV-X / Staff-X` parallel parents to `(touchpoint, attribute)` tuples. 2026-06-02: extended to cover 100% of the vendor's cross-brand scheme — `Bev-`/`Steak-`/`IOR-`/`Dayparts-` prefix aliases, context-axis wiring (dayparts, holidays, special-occasion, sporting-event, channels), `Busser Janitor`→busser and `Delivery` touchpoints, `Generous Pour`→campaign quarantine. Verify with `scripts/pilot-rc-vendor-vocab-check.ts` (0% unmapped). NOTE: `canonicalizeLegacyLabel` splits internal hyphens (`to-go`→`to - go`), so split-variant keys are included in the lookup dicts.

### LLM extraction — `lib/taxonomyExtractor.ts`

- `buildSystemPrompt()` emits a closed-vocab structured-output prompt (current `PROMPT_VERSION = '2026-05-27.v4'` — v4 bans dish inference from steakhouse context after the model started hallucinating product:steak from the word "food").
- `classifyReview()` calls Haiku via `callAI` (dynamic-imported so the prompt helpers are usable outside Next.js). Output passes through `parseExtractorOutput()` which drops out-of-vocab subs, attaches `source: 'llm'`, and projects into per-axis arrays + `alert_tags`.
- Every assertion carries a `evidence` field (≤12-word verbatim quote, required at v3+).
- 7-anchor regression in `scripts/pilot-rc-regression.ts` covers: Raymond / day-old potato / food-poisoning + Olive Garden / gnats + Burger King / 30-min-late mixed-polarity / "food was horrible" (no-dish-inference guard) / "food was good but service bad" (no-dish-inference guard). Green at v4 across all three tiers.

### Keyword (Tier 1) extraction — `lib/taxonomyKeywords.ts` + `lib/taxonomyKeywordMatcher.ts`

Deterministic basket-of-words classifier that mirrors the competitor's approach, but emits assertions in our 7-axis taxonomy instead of their flat-label scheme.

- `taxonomyKeywords.ts` — closed dictionary indexed by axis-sub. Each entry has `phrases: [{phrase, polarity, severity?}]`. Restaurant-vertical for the pilot; multi-word phrases preferred over single words to avoid false-alarms (e.g. `"food safety"` not just `"safety"`).
- `taxonomyKeywordMatcher.ts::classifyByKeyword(text)` — word-boundary phrase scan, simple negation flip (sentiment phrase preceded by `not/no/wasn't/didn't/never` within 3 tokens flips polarity), dedup by `(axis, sub, item)` preferring higher severity. Emits assertions with `source: 'keyword'`, `confidence: 0.85`, evidence = matched phrase + ±20-char window.
- `taxonomyKeywordMatcher.ts::mergeAssertions(keyword, llm)` — hybrid merge. Same `(axis, sub)` from both tiers → `source: 'both'` with LLM's evidence/polarity (context-aware) and the higher of the two severities; confidence bumped by 0.1 (capped at 0.99) as a cross-tier confirmation. Keyword-only or LLM-only assertions pass through with their own source.

### Learned keyword dictionary (Path B) — `lib/taxonomyKeywordsLearned.ts`

The hand-written dictionary (~290 phrases) is too thin to compete with vendors whose libraries are thousands of phrases tuned over years. Path B **machine-generates** a dictionary from the prospect's own reviews, so it is pre-tuned to actual customer vocabulary (idioms, dish names, slang) and is itself a pitch artifact: "this library was generated by reading your reviews, not guessed at a desk." Two offline scripts:

- `scripts/pilot-rc-keyword-mine.ts` — reads the 43K-review CSV directly (the pilot DB dataset holds only a 50-row smoke sample, so we sample from the source file), draws a deterministic seeded sample (`--seed`, default 1; `--limit`, default 5000), and asks Haiku 4.5 to extract every verbatim ≤6-word phrase mapping to a `(axis, sub, polarity)` in the closed vocab. System prompt is prompt-cached. Output → `data/keyword-candidates.jsonl` (gitignored). ~$0.0017/review (~$8.50 for 5K).
- `scripts/pilot-rc-keyword-build.ts` — aggregates the JSONL: normalize → count by `(phrase, axis, sub, polarity)` → **product guard** (drops generic food-sentiment like "great food" misfiled on the product axis — that belongs on `attribute:flavor` — unless the phrase also names a concrete product sub/item) → frequency floor (`--min-count`, default 3) → polarity resolution (majority wins; a second polarity is kept only at ≥30% share AND count ≥ 2) → item assignment (product items, plural-tolerant) → emits `lib/taxonomyKeywordsLearned.ts` in the same `KeywordEntry[]` shape, with per-phrase sample-frequency comments for audit. Mining once and persisting the JSONL lets the build threshold be re-tuned for free.
- **Swap (merge, not replace).** `taxonomyKeywordMatcher.ts` scans `ACTIVE_DICTIONARY = [...KEYWORD_DICTIONARY, ...LEARNED_KEYWORD_DICTIONARY]`. Merge keeps the hand-written entries' tuned severity defaults (`pests=alert`, `food safety=crisis`) and the regression-anchor phrases; `collapseHits()` dedups overlap by `(axis, sub, item)`. `classifyByKeyword(text, dictionary?)` takes an optional dictionary override (used by the lift script).
- **Verification.** `scripts/pilot-rc-regression.ts` (7/7 anchors must still pass — the product guard prevents the learned phrases from introducing forbidden `product:steak` on food-only reviews) and `scripts/pilot-rc-keyword-lift.ts` (keyword-tier chip-count lift on held-out reviews, seed≠mine). First 5K run (seed 1, min-count 3): 1,017 learned phrases; **3.15× keyword-tier assertions** on 500 held-out reviews (coverage 82% → 99%).

### Tiers — operational mode

`scripts/pilot-rc-classify.ts --mode <keyword|llm|hybrid>` (default `hybrid`):

- `--mode keyword` — Tier 1 only. Zero AI cost, instant, deterministic. What the competitor sells.
- `--mode llm` — Tier 2 only. ~$0.006/row, ~1s/row. Catches mixed polarity, severity calls, novel phrasings, evidence quotes, polarity from negation in long sentences.
- `--mode hybrid` — both tiers, merged. What ships. Customer-facing pitch: "keyword tier is the baseline (free); AI tier is the upgrade (per-row $$); both confirm = highest-confidence."

### Viewer cues

`/admin/taxonomy-pilot/[datasetId]` chip styling encodes provenance:
- Solid border = keyword tier (Tier 1).
- Dashed border + tiny `ⁱ` superscript = LLM-only (Tier 2).
- Solid border + emerald ring + tiny `✓` = both tiers confirm. This is the high-confidence subset.

The chip legend is rendered above the row list so first-time viewers learn the encoding.

### Pipeline

- `scripts/pilot-rc-ingest.ts` — RFC4180 parser → `dataset_rows_flat` under Datanautix admin org, preserves prospect's `Classification` column as `legacy_classification` + parsed `legacy_tags` array on each row.
- `scripts/pilot-rc-classify.ts` — concurrent driver (default `--limit 50 --concurrency 4`), idempotent per `(row, 'description')` block.
- `/admin/taxonomy-pilot/[datasetId]` — side-by-side viewer (admin-only). API route at `/api/admin/taxonomy-pilot/[datasetId]` returns paged rows + their taxonomy.

### In-app classification (self-serve) — `components/analyze/TaxonomyModule.tsx` + `POST /api/datasets/[datasetId]/taxonomy`

The **Dimensions** tab (Analyze nav) is no longer view-only. When the selected field-set isn't classified it **auto-classifies** (no button, 2026-06-07): a guarded effect calls `runClassifier`, which loops `POST /api/datasets/[datasetId]/taxonomy` with a `{ cursor, textFields }` body until `done`, showing a live progress bar; only a failure shows a "Try again". (The prominent **Re-classify** control was removed 2026-06-06 — re-classification is destructive/expensive, so it's deferred to the dataset level; for previously-classified Google Reviews datasets, auto-classify-on-sync already keeps daily-synced rows tagged.)

- **Endpoint** (`POST`): org-gated identically to the `GET` (pairs the dataset's `org_id`; non-admins must own it). Each call runs `classifyDatasetKeyword({ offset: cursor, limit: CHUNK, textField })` over one `CHUNK` (10K rows) using the **`core`** brand overlay, then returns `{ classifiedThisCall, scanned, nextCursor, done, totalRows }`. `maxDuration = 120`. Keyword-tier only — **no AI cost**.
- **Per-field & reactive** (no in-tab picker as of 2026-06-06): the classified field is the parent TextMine ANALYZE selection (`effectiveFields[0]`), passed to `<TaxonomyModule>` as `textField`/`fieldLabel` and ridden into the POST body as `textField`. The GET takes `?field=` and the tab refetches on the Liked Most/Least toggle, so Dimensions reacts per field. `detectTextFields` still runs server-side but the UI no longer renders the old "Field to classify" dropdown.
- **Embedded storage** (`lib/taxonomyClassify.ts` → `apply_taxonomy_verdicts` RPC, sql/151): every classified row gets a per-fieldKey block in its own `data._tx` — one source feeds Charts/Stats `__dim_*`, theme-card chips, the Comments dimension filter, decks, the admin viewer, AND the reactive Dimensions tab. Completed runs also store the field's rollup in `dataset_state.analytics.taxonomy`.
- **Chunking** (`lib/taxonomyClassify.ts`): `classifyDatasetKeyword` takes an `offset` and returns `{ nextOffset, reachedEnd, … }` so a large dataset (a Cheddar's-scale 600K-review pull would otherwise blow the function timeout) is processed in resumable chunks driven by the client. Writes are idempotent per `(row, fieldKey)`, so an interrupted run resumes safely.
- The brand-tuned `rc` / `chuys` overlays stay **script-only** (`scripts/taxonomy-classify.ts --brand …`) — they're internal pilot tuning; the self-serve button always uses the generic `core` vertical.

### Production scope

Pilot-only. If the prospect signs, productionizing means:
- ~~Replace the script driver with an analyze-route trigger (or a per-dataset "classify" button)~~ **DONE 2026-06-03** — self-serve "Classify this dataset" button + `POST` route (see above); works for any Google Reviews dataset, `core` vocab.
- Lift the closed vocab into a per-dataset / per-vertical config (the Ruth's Chris vocab is steakhouse-specific).
- Add filter-by-axis-sub queries to the TextMine UI so the GIN indexes earn their keep.
