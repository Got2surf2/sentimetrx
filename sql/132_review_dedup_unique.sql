-- 132_review_dedup_unique.sql
-- Promote the dedup lookup index to UNIQUE — the hard backstop sql/131 deferred.
--
-- Prereq (done as a one-time data cleanup, not a migration, on 2026-06-24 — see
-- the W26 devlog): every google_reviews row had its `dedup_key` backfilled
-- (`encode(digest(place_id|lower(trim(author))|review_date|lower(left(text,200)),
-- 'sha1'),'hex')` — identical to lib/reviewSync.ts:reviewDedupKey), existing
-- duplicates were collapsed (keep one ctid per dataset+key), and each
-- datasets.row_count was reconciled to count(*). After that, no (dataset_id,
-- dedup_key) collisions remain, so the UNIQUE index builds.
--
-- NULL dedup_key (every non-review row) stays distinct under a btree unique
-- index, so non-review datasets are unaffected. insertReviewRows() upserts with
-- ON CONFLICT DO NOTHING against this index.

BEGIN;

DROP INDEX IF EXISTS idx_dataset_rows_flat_dedup;

CREATE UNIQUE INDEX idx_dataset_rows_flat_dedup
  ON dataset_rows_flat (dataset_id, dedup_key);

COMMIT;
