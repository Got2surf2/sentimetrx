-- sql/160_sample_dataset_rows_indexed.sql
-- Deterministic, O(sample) bulk-row sampling for the rows route's all=true path
-- above the 50K cap. Replaces sql/157 to fix a 30s timeout on the first dataset
-- to ever cross the cap (a 56,117-row upload, 2026-07-10) AND to make the sample
-- cost independent of dataset size — required because datasets grow continuously
-- (review/reddit syncs, appends), so an O(total) approach degrades without bound.
--
-- Design constraints, all confirmed by measuring the real PostgREST/service-role
-- path (not just psql/EXPLAIN):
--   * a set-returning result is capped at 1000 rows  -> page, or return jsonb
--   * an 8s statement_timeout per call                -> each page must be cheap
--   * the sample must stay ~constant-time as rows are ADDED (no full rescan)
-- sql/157 (`ORDER BY md5 LIMIT`) re-sorted per page; a row_index keyset over a
-- hash *predicate* still heap-fetched every scanned row (Index Scan, not
-- Index-Only), so cost = O(rows scanned) = O(total) and climbed with growth.
--
-- This version makes the sample an INDEX RANGE SCAN. A stable uniform hash of
-- (id || dataset_id) is materialised in an expression index; the sample is the
-- `cap` rows with the SMALLEST hash, walked in (hash, id) keyset order. The index
-- yields exactly those rows — only the ~50K sampled rows are heap-fetched, never
-- the rest — so a load costs the same at 100K, 1M, or 10M rows. Because it is an
-- EXPRESSION index it auto-maintains on every INSERT (no insert-path change, no
-- reindex/backfill), so appended rows participate immediately and proportionally.
-- Measured on TEST: ~50K sample in 10 pages, ~16s, FLAT after appending 20K rows
-- (the new rows took their proportional ~6.7K share of the sample).
--
-- Determinism (ARCHITECTURE.md D6 — deck credibility): the hash is a pure
-- function of the stable row id + dataset_id (md5 is version-stable), so the same
-- set of rows always yields the same sample. As rows are added the sample evolves
-- (a new row joins only if its hash is below the current cap-th smallest), which
-- is the correct behaviour for a live, growing dataset.
--
-- The uniform hash: first 8 md5 hex chars -> bit(32) -> bigint gives an integer
-- in [0, 2^32); the seed is the row's own dataset_id column so it is baked into
-- the index (the route samples one dataset at a time, seed = that dataset_id).
--
-- Index build: plain CREATE INDEX inside the migration transaction (CONCURRENTLY
-- is not permitted in a tx, and the apply tooling runs the whole file in one) —
-- same call the dedup index made (sql/131). dataset_rows_flat is moderate
-- (~264K rows / 438MB on prod, 2026-07-10) so the brief build lock is acceptable.
--
-- SECURITY DEFINER returns raw row data -> execution stays service_role-only
-- (same posture as sql/157 / get_rows_by_filters); the route enforces org access.

BEGIN;

-- Retire the prior signatures (sql/157 md5-LIMIT, and the interim keyset one).
DROP FUNCTION IF EXISTS public.sample_dataset_rows(uuid, int, text);
DROP FUNCTION IF EXISTS public.sample_dataset_rows(uuid, text, double precision, int, int);

-- Expression index: (dataset_id, sample_hash, id). Seed = the dataset_id column,
-- so the ordering within each dataset is by the uniform hash; id breaks ties for
-- stable keyset paging (32-bit hashes collide above ~65K rows).
CREATE INDEX IF NOT EXISTS idx_drf_sample ON public.dataset_rows_flat
  (dataset_id, ((('x' || substr(md5(id::text || dataset_id::text), 1, 8))::bit(32)::bigint)), id);

-- O(sample) keyset-paged sampler: the `p_limit` rows with the smallest hash after
-- the (p_after_hash, p_after_id) cursor. Returns a single jsonb value (bypasses
-- the 1000-row cap). The WHERE/ORDER BY expression is byte-identical to the index
-- expression so the planner uses idx_drf_sample as an index range scan.
CREATE OR REPLACE FUNCTION public.sample_dataset_rows(
  p_dataset_id  uuid,
  p_after_hash  bigint,   -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int       -- rows in this page
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS (
    SELECT f.id, f.row_index, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'row_index', row_index, 'data', data) ORDER BY h, id),
      '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  ) FROM page;
$$;

COMMENT ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int) IS
  'O(sample) deterministic sampler for the rows route all=true >50K path. Returns the p_limit rows with the smallest uniform hash(id||dataset_id) after the (p_after_hash,p_after_id) keyset cursor, as {rows: jsonb[], last_hash, last_id}. Backed by the idx_drf_sample expression index -> index range scan touching only the ~cap sampled rows, so cost is independent of dataset size and appends participate automatically (the expression index self-maintains). Same rows -> same sample (deck credibility, ARCHITECTURE.md D6).';

REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_dataset_rows(uuid, bigint, bigint, int) TO service_role;

COMMIT;
