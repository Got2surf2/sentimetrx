-- sql/165_drf_id_keyset_index.sql
-- (dataset_id, id) index for the classify id-keyset (2026-07-12).
--
-- WHY: classifyDatasetKeyword pages rows with
--   WHERE dataset_id = X AND id > cursor ORDER BY id LIMIT n
-- believing it O(page) — but no index backs (dataset_id, id), so the prod
-- planner walks the PK with dataset_id as a per-row FILTER (EXPLAIN-verified
-- on the 785K scale test): every other dataset's rows between cursor
-- positions get heap-fetched and discarded, and past ~1M total rows a single
-- page blows the 8s statement timeout (Sentry NEXTJS-H — POST taxonomy 500
-- while the owner's TextMine auto-classify ran against the 785K). The
-- 2026-07-06 emotion backfill hit the same wall and worked around it in the
-- script, banking "add that index" as the lib fix — this is it. Every other
-- keyset on the table is already backed ((dataset_id, row_index) by
-- idx_drf_dataset_idx, the hash sampler by idx_drf_sample).
--
-- Index build: plain CREATE INDEX inside the migration transaction, same as
-- sql/131/160 (CONCURRENTLY can't run in a tx and the apply tooling wraps the
-- file in one). The build scans the heap once (~3.5GB / ~1.06M rows on prod,
-- 2026-07-12) and blocks WRITES to dataset_rows_flat for the duration
-- (reads unaffected) — apply in a quiet window.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_drf_id_keyset ON public.dataset_rows_flat (dataset_id, id);

COMMENT ON INDEX public.idx_drf_id_keyset IS
  'Backs the classify id-keyset (WHERE dataset_id = X AND id > cursor ORDER BY id) — without it the planner walks the PK filtering dataset_id per row, which times out past ~1M total rows. sql/165.';

COMMIT;
