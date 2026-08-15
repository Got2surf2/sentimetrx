-- sql/188_stratified_sample_blocks.sql
-- The sampling primitive: stratified CONTIGUOUS blocks instead of hash order.
-- PROOF OF CONCEPT — converts sample_dataset_rows only. The other 19 sampled
-- functions still page on the hash and MUST be converted before this ships, or
-- the rows the client holds and the counts the server reports would describe
-- different samples (see the "all-at-once" note at the bottom).
--
-- WHY. The existing sample is the `cap` rows with the smallest
-- hash(id||dataset_id). It is uniformly random and perfectly deterministic, and
-- its cost is dominated by something the design never accounted for: hash order
-- is uncorrelated with PHYSICAL order, so the 50,000 sampled rows are scattered
-- at random across a 922MB heap (2GB with TOAST, 117,961 pages). Every page of
-- the sample is a fresh set of random heap fetches, and what actually decides
-- the time is whether those pages happen to be in the buffer cache:
--
--   Same 5,000 rows, same ~5,060 buffers touched, on two datasets:
--     Outback    (128,619 rows)  shared hit=2096 read=2967   1,895ms
--     Carrabba's  (56,117 rows)  shared hit=5052 read=11        28ms
--
-- That is why cost tracks dataset size (measured 1.68x for a 2.3x bigger
-- dataset) despite scanning exactly the same number of rows, and why identical
-- queries varied 15-24s all session. It does not flatten on its own, so it is
-- the blocker for the 1M-row target.
--
-- MEASURED ALTERNATIVES, reading 5,000 rows of the Outback dataset:
--     hash order (today)                     2,296ms
--     systematic every-Nth (row_index % N)   full scan + temp spill  <- unusable
--     one contiguous block                     374ms
--     50 stratified contiguous blocks           41ms   <- ~55x
--     200 blocks                               243ms
--     1000 blocks                              309ms
--
-- Every-Nth is the trap: `row_index % N = 0` is not indexable, so Postgres
-- full-scans the dataset and sorts to disk. Contiguous runs are what make the
-- read sequential; spreading K of them across the range is what keeps the
-- sample representative. K=50 sits in the flat part of the curve — below ~200
-- the seeks are free, above it they start to cost.
--
-- WHAT CHANGES STATISTICALLY. Uniform random -> stratified cluster sample.
-- For counts and proportions over a large corpus this is sound, and for
-- row_index-ordered data (~insert order, ~time order for review syncs) it is
-- arguably better than uniform: 50 blocks spread across the range guarantee
-- coverage of the whole span rather than merely expecting it. The exposure is
-- periodicity aligned to the stride — unlikely, but it is a real difference and
-- it is why the numbers move once (below).
--
-- DETERMINISM is preserved and is a pure function of (min row_index, max
-- row_index, cap, block count) — no hashing, no randomness. Appends extend the
-- range so the stride grows and the blocks shift, which is the same
-- evolve-proportionally-on-append behaviour the hash sample already had
-- (ARCHITECTURE.md D6). Robust to gaps: `row_index >= lo LIMIT n` simply takes
-- the next n rows at or after lo, so deleted rows don't leave holes in the
-- sample.
--
-- REJECTED: CLUSTER the heap on idx_drf_sample. It would make the EXISTING
-- sample sequential and move no numbers at all, which is tempting — but CLUSTER
-- takes an ACCESS EXCLUSIVE lock and rewrites the whole table, is not
-- maintained as rows are inserted, and every sync would append unclustered rows.
-- It would need a recurring locking rewrite of a live production table forever.
-- Stratified blocks are self-maintaining.
--
-- ⚠️ THE NUMBERS MOVE ONCE. Every sampled figure — theme counts, chart
-- aggregates, statistics, anything already exported into a deck — is computed
-- over the sample, so changing the sample changes them. Owner accepted this
-- explicitly (2026-08-15) in preference to carrying two sampling paths forever.
-- Every cached analytic must be invalidated when this lands.

BEGIN;

-- The block set for a dataset's sample: K contiguous runs of row_index, evenly
-- spread across the dataset's actual row_index range. Returns ONE block
-- covering everything when the dataset fits under the cap (no sampling).
CREATE OR REPLACE FUNCTION public.dataset_sample_blocks(
  p_dataset_id uuid,
  p_cap        int,
  p_blocks     int DEFAULT 50
)
RETURNS TABLE(lo bigint, hi bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH bounds AS (
    -- min/max, not count: row_index can be sparse after deletes, and the blocks
    -- must be spread over the range that actually exists.
    SELECT min(f.row_index) AS lo_ri, max(f.row_index) AS hi_ri, count(*) AS n
    FROM dataset_rows_flat f WHERE f.dataset_id = p_dataset_id
  ),
  cfg AS (
    SELECT b.lo_ri, b.hi_ri, b.n,
           -- Under the cap there is no sampling to do: one block, everything.
           CASE WHEN b.n <= p_cap THEN 1 ELSE greatest(p_blocks, 1) END AS k
    FROM bounds b
  )
  SELECT
    (c.lo_ri + (g.b * ((c.hi_ri - c.lo_ri + 1)::numeric / c.k))::bigint) AS lo,
    -- `hi` is advisory: callers LIMIT to the per-block count, so a block that
    -- runs into a sparse stretch simply yields fewer rows rather than
    -- overrunning into the next block's territory.
    (c.lo_ri + ((g.b + 1) * ((c.hi_ri - c.lo_ri + 1)::numeric / c.k))::bigint) AS hi
  FROM cfg c, LATERAL generate_series(0, c.k - 1) AS g(b)
  WHERE c.n > 0;
$$;

COMMENT ON FUNCTION public.dataset_sample_blocks(uuid, int, int) IS
  'Stratified sampling primitive (sql/188): K contiguous row_index runs spread evenly across a dataset''s actual row_index range, or ONE block covering everything when the dataset is under the cap. Replaces hash-order sampling, whose rows are physically scattered — measured 2,296ms vs 41ms for the same 5,000 rows, because hash order is uncorrelated with heap order and the cost is buffer-cache residency, not row count. Deterministic: a pure function of (min row_index, max row_index, cap, blocks). Gap-tolerant, since callers take the next n rows at or after each `lo`.';

REVOKE ALL ON FUNCTION public.dataset_sample_blocks(uuid, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dataset_sample_blocks(uuid, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dataset_sample_blocks(uuid, int, int) TO service_role;

-- Bulk-row sampler over the block set. New name + row_index cursor rather than
-- a replacement, so the hash version stays callable for rollback and for the 19
-- functions not yet converted.
CREATE OR REPLACE FUNCTION public.sample_dataset_rows_blocks(
  p_dataset_id       uuid,
  p_after_row_index  bigint,   -- keyset cursor; -1 starts at the beginning
  p_limit            int,
  p_cap              int DEFAULT 50000,
  p_blocks           int DEFAULT 50,
  p_drop_keys        text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH blk AS (
    SELECT b.lo, b.hi, (p_cap::numeric / greatest(count(*) OVER (), 1))::int + 1 AS per_block
    FROM dataset_sample_blocks(p_dataset_id, p_cap, p_blocks) b
  ),
  page AS MATERIALIZED (
    SELECT x.id, x.row_index, x.data
    FROM blk, LATERAL (
      SELECT f.id, f.row_index,
             ((f.data - '_tx' - '_txv' - '_sub') - COALESCE(p_drop_keys, '{}'::text[])) AS data
      FROM dataset_rows_flat f
      WHERE f.dataset_id = p_dataset_id
        AND f.row_index >= blk.lo AND f.row_index < blk.hi
        AND f.row_index > p_after_row_index
      ORDER BY f.row_index
      LIMIT blk.per_block
    ) x
    ORDER BY x.row_index
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'row_index', row_index, 'data', data) ORDER BY row_index),
      '[]'::jsonb),
    'last_row_index', (SELECT max(row_index) FROM page)
  ) FROM page;
$$;

COMMENT ON FUNCTION public.sample_dataset_rows_blocks(uuid, bigint, int, int, int, text[]) IS
  'Bulk-row sampler over the sql/188 stratified block set — the sequential-read replacement for sample_dataset_rows. Pages by a single row_index cursor instead of (hash, id). Carries sql/186''s reserved-key strip and p_drop_keys unchanged. The hash version is retained for rollback and for the sampled_* functions not yet converted; both must not be mixed in one screen, because they select DIFFERENT ROWS.';

REVOKE ALL ON FUNCTION public.sample_dataset_rows_blocks(uuid, bigint, int, int, int, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sample_dataset_rows_blocks(uuid, bigint, int, int, int, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_dataset_rows_blocks(uuid, bigint, int, int, int, text[]) TO service_role;

COMMIT;
