-- sql/157_sample_dataset_rows.sql
-- SQL-side deterministic sampling for bulk row fetches (CAPACITY.md §6).
--
-- The rows route's all=true path (BULK_ROWS_HARD_CAP = 50000) previously
-- streamed EVERY flat row through PostgREST pages to run reservoir sampling
-- in Node — at 500K rows that's 500K rows of transfer to keep 50K. This RPC
-- pushes the sample into Postgres so only the sampled rows cross the wire:
-- deterministic pseudo-random order via ORDER BY md5(id || seed) LIMIT n.
--
-- Determinism is a PRODUCT requirement (ARCHITECTURE.md D6 — deck
-- credibility): the same dataset + seed must return the same sample forever.
-- md5(f.id::text || p_seed) is a pure function of stable row ids, so the
-- order (and therefore the LIMIT-ed sample) never drifts across calls,
-- deploys, or Postgres versions. The route seeds with the dataset_id — the
-- same seed source the Node reservoir used (seedFromString(datasetId)).
--
-- NOTE: this CHANGES which rows land in the >cap sample (md5 order replaces
-- the Node mulberry32 reservoir). That is deliberately free right now: no
-- production dataset has ever exceeded the 50K cap (largest is 27,234 rows),
-- so no customer-visible sample exists to preserve.
--
-- SECURITY DEFINER returns raw row data, so execution is revoked from
-- anon/authenticated and granted to service_role only (same posture as
-- get_rows_by_filters, sql/113) — the route enforces org access before
-- calling.

BEGIN;

CREATE OR REPLACE FUNCTION public.sample_dataset_rows(
  p_dataset_id uuid,
  p_limit int,
  p_seed text
)
RETURNS TABLE(id bigint, row_index integer, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.row_index, f.data
  FROM dataset_rows_flat f
  WHERE f.dataset_id = p_dataset_id
  ORDER BY md5(f.id::text || p_seed)
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.sample_dataset_rows(uuid, int, text) IS
  'Deterministic pseudo-random sample of a dataset''s flat rows: ORDER BY md5(id||seed) LIMIT n. Same dataset + seed returns the same sample forever (deck credibility, ARCHITECTURE.md D6). Used by the rows route all=true path when row_count exceeds the 50K bulk cap.';

REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_dataset_rows(uuid, int, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_dataset_rows(uuid, int, text) TO service_role;

COMMIT;
