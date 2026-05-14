# Sentimetrx — Data Sources Spec (Reddit, Google Reviews, Substack, Regulations.gov)

**Module:** `/app/api/{reddit,review,substack,regulations}-sources/*`, `/app/analyze/new/`, `lib/{reddit,dataforseo,reviewSync,substack,regulations}.ts`, `components/analyze/{Reddit,GoogleReviews,Substack,Regulations}Wizard.tsx`
**Storage (config):** `reddit_sources`, `reddit_source_threads` (`sql/phase8_reddit.sql`); `review_sources`, `review_source_locations`, `user_locations` (`sql/phase7_google_reviews.sql`); Substack and Regulations have **no config tables** — metadata lives on `datasets.description` JSONB.
**Storage (rows):** all four sources insert into `dataset_rows_flat` (one row per item, JSONB `data` column).
**External APIs:** DataforSEO (Google Reviews), Reddit public JSON (no auth), Substack public JSON (no auth), Regulations.gov API v4 (api.data.gov key).
**Feature gate:** `organizations.features.googleReviews`, `.reddit`, `.substack`. Regulations is gated by `.analyze`.

> **Spec scope:** complete enough to rebuild all four ingest modules from
> scratch. Includes full DDL, every API contract, sync algorithms (each
> source has a different cadence and chunking model), external API call
> signatures, env vars, per-source `dataset_rows_flat.data` schemas, and
> cross-source operational notes. Source of truth is the code — current
> as of 2026-05-06.

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
{ "type": "substack", "publication": "mattyglesias.substack.com", "publication_name": "Slow Boring" }
```

**Regulations `datasets.description`:**
```json
{
  "type": "regulations", "docket_id": "USDA-2024-0003",
  "docket_title": "Procedures for Quantification...", "agency": "USDA",
  "comment_count": 372, "download_status": "downloading", "next_page": 5,
  "use_search": false
}
```

The download flow updates `next_page` and `download_status` between calls.

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

### Reddit row
```json
{
  "comment_id":       "t1_xyz123",
  "thread_id":        "t3_abc456",
  "subreddit":        "AskReddit",
  "thread_title":     "What's your favorite...",
  "author":           "user123",
  "body":             "Comment text…",
  "score":            42,
  "ups":              45,
  "downs":            3,
  "controversiality": 0,
  "is_submitter":     false,
  "gilded":           0,
  "total_awards":     0,
  "permalink":        "/r/AskReddit/comments/abc456/_/xyz123/",
  "created_utc":      1715000000,
  "depth":            2,
  "parent_id":        "t1_parent123"
}
```

### Google Reviews row
```json
{
  "review_id":        "place_id_review_xyz",
  "location_id":      "ChIJ…",
  "location_name":    "Starbucks, New York, NY",
  "place_id":         "ChIJ…",
  "reviewer_name":    "Jane Doe",
  "rating":           4,
  "review_text":      "Great coffee…",
  "timestamp":        "2026-05-01T12:34:56Z",
  "owner_response":   "Thank you!",
  "owner_timestamp":  "2026-05-02T10:00:00Z",
  "review_url":       "https://maps.google.com/…",
  "review_likes":     3,
  "city":             "New York",
  "state":            "NY"
}
```

### Substack row
```json
{
  "comment_id":      "c_12345",
  "post_id":         67890,
  "post_title":      "My thoughts on…",
  "post_date":       "2026-04-15",
  "author":          "reader_name",
  "author_handle":   "@reader",
  "body":            "Great post…",
  "likes":           2,
  "is_author_reply": false,
  "comment_date":    "2026-04-16T08:30:00Z",
  "depth":           0,
  "parent_id":       null,
  "children_count":  1,
  "restacks":        0,
  "edited":          false
}
```

### Regulations.gov row
```json
{
  "comment_id":     "USDA-2024-0003-12345",
  "docket_id":      "USDA-2024-0003",
  "document_id":    "USDA-2024-0003-0001",
  "commenter_name": "John Smith",
  "organization":   "Environmental Group",
  "city":           "Denver",
  "state":          "CO",
  "country":        "US",
  "posted_date":    "2024-03-15",
  "comment_text":   "We oppose this rule because…",
  "comment_type":   "Comment",
  "agency":         "USDA",
  "title":          "Re: Proposed Rule"
}
```

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
Calls `fetchThreadComments(permalink, max_comments || 500)`. Includes the post selftext as row 0 (`depth=0`, `parent_id=null`). Inserts into `dataset_rows_flat` in 50-row chunks. Updates `dataset.row_count` and `reddit_source_threads.total_pulled`. Designed to be called once per thread from the UI.

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

### Wizard flow — `components/analyze/GoogleReviewsWizard.tsx`
1. User enters brand keyword → `POST /api/review-sources/search` calls DataforSEO Maps Live and returns up to ~700 candidate locations.
2. User selects locations (checkboxes), optionally sets date range and sync frequency.
3. User clicks Create → `POST /api/review-sources` creates dataset + review_source + review_source_locations rows. `next_sync_at` is set to `now()` so the cron picks it up immediately.
4. The 6-hour cron does the rest (no UI polling needed). UI shows progress on the dataset page.

### API routes

#### `GET /api/review-sources`
**Response:** `{ sources: Array<{...review_source fields, locations_count}> }` for the user's org.

#### `POST /api/review-sources`
**Body:** `{ brand_name, locations: DfsLocation[], dataset_name?, sync_frequency_hours?, start_date?, end_date?, brand_tag? }` — `brand_tag` defaults to `brand_name` when omitted (a reviews dataset always has a brand).
**Response:** `{ source_id, dataset_id, locations, status: 'active' }` (201).
Creates dataset, review_source (status='active'), one location row per selection (`selected=true`). Sets `next_sync_at = now()`. Optional date range stored in `datasets.description`.

#### `GET /api/review-sources/[sourceId]`
**Response:** `{ source, locations, datasetRowCount }`. Locations ordered by state, city.

#### `PATCH /api/review-sources/[sourceId]`
**Body:** `{ status?: 'active' | 'paused', sync_frequency_hours? }` → returns `{ ok: true }`.

#### `DELETE /api/review-sources/[sourceId]`
Cascades: deletes source → locations → linked dataset → its `dataset_rows_flat` and `dataset_state`.

#### `POST /api/review-sources/search`
**Body:** `{ keyword: string }`
**Response:** `{ keyword, count, locations: DfsLocation[] }`.
Calls `searchLocations(keyword)` → DataforSEO. Preview only — does **not** persist. Used by wizard step 1.

#### `POST /api/review-sources/[sourceId]/sync`
**Body:** `{}`
**Response:** the `SyncResult` shape (see lib/reviewSync.ts below).
Manual sync trigger for the same algorithm the cron runs. Useful for testing.

### `lib/reviewSync.ts` — the two-phase sync algorithm

`syncReviewSource(sourceId, service)` does both phases within a single Vercel function invocation, time-bounded to ~45s (under the 60s timeout).

**Phase 1: Check pending tasks (~first 15s)**
1. Find locations whose `error_message` starts with `pending_task:` → these have a DataforSEO task in flight.
2. For each (up to `BATCH_SIZE = 3`):
   - Parse the task ref: `pending_task:{taskId}|{getPath}`.
   - Call `checkReviewTask(ref)` → DataforSEO `GET {getPath}/{taskId}`.
   - If `status_code === 20000` → task ready. Filter reviews by date range + `last_review_id`. Convert to JSONB rows. Insert into `dataset_rows_flat` (500-row chunks). Update `last_review_id`, `last_review_date`, `total_pulled`, `last_synced_at`. Clear `error_message`.
   - If status is in `[40402, 40602, 140607]` → task pending. Leave the ref in place; next call retries.
   - If error → store `error_message`. Don't retry.

**Phase 2: Submit new tasks (remaining time, max 45s total)**
1. Find locations with `last_synced_at IS NULL` AND `error_message IS NULL` (unsynced, not in flight).
2. For each (up to `BATCH_SIZE = 3`):
   - Compute initial `depth` via `estimateDepth(review_count, created_at, start_date, end_date)`. For incremental syncs (after first), use `depth = 200`.
   - Call `submitReviewTask(place_id, depth, 'newest')` → DataforSEO `POST .../task_post`. Returns `{ taskId, getPath }`.
   - Store `error_message = "pending_task:{taskId}|{getPath}"` (the column is overloaded for pending refs).

**Returns:** `{ synced, total, locations_synced, locations_remaining, locations_errored, locations_submitted, errors, expected_reviews, with_comments, without_comments, pending_locations, processing_location }` for UI/cron telemetry.

### `lib/dataforseo.ts` — DataforSEO API wrapper

Endpoint base: `https://api.dataforseo.com/v3`. Auth: HTTP Basic, header `Authorization: Basic ${btoa("login:password")}`.

| Function | Endpoint | Returns |
|---|---|---|
| `searchLocations(keyword)` | `POST /serp/google/maps/live/advanced` body `[{keyword, location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 700}]` | `DfsLocation[]` (place_id, title, address, address_info, rating, votes, phone, lat/lng) |
| `submitReviewTask(placeId, depth?, sortBy?)` | `POST /reviews/google/task_post` (or `/business_data/google/reviews/task_post` fallback) body `[{place_id, location_code: 2840, language_code: 'en', depth: 200..4490, sort_by: 'newest'\|'relevant'}]` | `{ taskId, getPath }` |
| `checkReviewTask(ref)` | `GET {ref.getPath}/{ref.taskId}` | `{ status: 'ready'\|'pending'\|'error', reviews?: DfsReview[], message? }` |

### Why two phases?

DataforSEO is async — submitting a task returns immediately with an ID, the actual data arrives anywhere from 30 seconds to several minutes later. Vercel functions have a 60s ceiling. So we submit on one cron run, check on the next. Locations with many reviews thus take **~12 hours** end-to-end for first sync (one cron cycle to submit + one to check + one to ingest if depth was too small). The state machine lives entirely in `review_source_locations.error_message` (with `pending_task:` prefix) plus `last_synced_at` (NULL = never synced; non-NULL = at least one cycle complete).

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
Creates dataset (`source: 'substack'`) and dataset_state with the Substack schema. Does **not** fetch posts.

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
Creates dataset (`source: 'regulations'`) with `description: { type, docket_id, docket_title, agency, comment_count, download_status: 'downloading', next_page: 1 }`. Creates dataset_state with the Regulations schema.

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
| `listComments(docketId, page?, pageSize?, useSearch?)` | `GET /comments?filter[docketId]={id}&page[size]=10&page[number]={p}&sort=-postedDate` | `{ data: [{id, type, attributes}], meta: {totalElements, totalPages} }` |
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
