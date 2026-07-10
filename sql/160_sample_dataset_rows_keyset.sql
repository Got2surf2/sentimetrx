-- sql/160_sample_dataset_rows_idsort.sql
-- Fix: the >50K bulk-sample path timed out on the first dataset to ever cross
-- the cap (a 56,117-row upload, 2026-07-10). Root cause was two-fold:
--
--   1. sql/157's body sorted the FULL row (id, row_index, data jsonb) by
--      md5(id||seed). Carrying the ~840-byte jsonb `data` through the sort
--      forced an external-merge sort that SPILLED TO DISK (~40MB temp / call)
--      even though only the id is needed to pick the sample.
--   2. The route paged that function in 50 × 1000-row slices via PostgREST
--      .range(). PostgREST applies OFFSET/LIMIT OUTSIDE the function, so every
--      one of the 50 calls re-ran the whole `ORDER BY md5(...) LIMIT 50000`
--      disk-spilling sort from scratch. 50 × ~0.5s = 25s+ of pure sort, which
--      blew the route's 30s function budget (Vercel Runtime Timeout).
--
-- This rewrite sorts on the ID ALONE (a CTE that never touches `data`), so the
-- md5 ordering is an in-memory quicksort (~2.8MB, no spill), then joins back to
-- fetch `data` only for the sampled ids. Measured on the 56K dataset: 804ms for
-- the FULL 50K-row sample in ONE call (vs 25s+ across 50 calls). The route is
-- updated in the same change to call this once instead of paging.
--
-- Determinism is preserved (ARCHITECTURE.md D6 — deck credibility): the sample
-- SET is still `ORDER BY md5(id||seed) LIMIT n`, a pure function of stable row
-- ids + seed. The final ORDER BY row_index makes the returned ROW ORDER
-- deterministic too (matches the rows route's paginated path) — a superset of
-- the prior guarantee, so no existing sample changes meaning.
--
-- Signature is unchanged (uuid, int, text) → CREATE OR REPLACE keeps the
-- existing REVOKE/GRANT posture (service_role only, sql/157) with no re-grant.

BEGIN;

CREATE OR REPLACE FUNCTION public.sample_dataset_rows(
  p_dataset_id uuid,
  p_limit int,
  p_seed text
)
RETURNS TABLE(id bigint, row_index integer, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH sampled AS (
    -- id-only sort: `data` is never read here, so the md5 ordering stays an
    -- in-memory quicksort instead of a disk-spilling external merge.
    SELECT f.id
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
    ORDER BY md5(f.id::text || p_seed)
    LIMIT p_limit
  )
  SELECT f.id, f.row_index, f.data
  FROM dataset_rows_flat f
  JOIN sampled s ON s.id = f.id
  ORDER BY f.row_index;
$$;

COMMENT ON FUNCTION public.sample_dataset_rows(uuid, int, text) IS
  'Deterministic pseudo-random sample of a dataset''s flat rows: pick ids via ORDER BY md5(id||seed) LIMIT n (id-only sort, no jsonb spill), then join for data, returned in row_index order. Same dataset + seed returns the same sample forever (deck credibility, ARCHITECTURE.md D6). Used by the rows route all=true path when row_count exceeds the 50K bulk cap; the route calls it once (no paging).';

COMMIT;
