-- 131_review_dedup_key.sql
-- Content-addressed dedup key for review rows in dataset_rows_flat.
--
-- WHY: review refreshes (Google Reviews etc.) re-inserted rows with no dedup
-- guard. The only protection was a fragile per-location `last_review_id`
-- sentinel that failed whenever DataForSEO returned "Task Not Found" (40401,
-- treated as transient → location re-fetched → rows re-inserted). Result was
-- ~10% duplicate rows on refreshed datasets. `review_id` is unreliable
-- (fabricated as `profile_name + ':' + timestamp` when Google omits it), so we
-- key on a CONTENT hash computed in lib/reviewSync.ts:reviewDedupKey() instead.
--
-- The column is nullable with no default: this is a fast metadata-only ALTER,
-- and existing non-review rows simply stay NULL (they are never deduped).
--
-- NOTE: deliberately NOT a UNIQUE constraint yet — existing review datasets
-- already contain duplicates, so a unique index would fail to build. The
-- application-side dedup in insertReviewRows() prevents NEW dupes; a later
-- cleanup migration will collapse existing dupes and THEN add the unique
-- backstop.

BEGIN;

ALTER TABLE dataset_rows_flat
  ADD COLUMN IF NOT EXISTS dedup_key text;

COMMIT;

-- Non-unique lookup index for the existing-keys probe in insertReviewRows().
-- dataset_rows_flat holds every dataset's rows, so build CONCURRENTLY to avoid
-- a long write-lock on this large table. CREATE INDEX CONCURRENTLY CANNOT run
-- inside a transaction block, so it lives OUTSIDE the BEGIN/COMMIT above (the
-- tx-wrap CI guard only requires that a BEGIN; and COMMIT; appear in the file).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dataset_rows_flat_dedup
  ON dataset_rows_flat (dataset_id, dedup_key);
