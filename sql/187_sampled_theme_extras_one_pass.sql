-- sql/187_sampled_theme_extras_one_pass.sql
-- One walk of the sample instead of two, for the /theme-counts extras (2026-08-15).
--
-- WHY. A cold /theme-counts on a dataset above the 50K cap walks the SAME 50,000
-- sampled rows THREE separate times — counts (13.4s) + co-occurrence (9.1s) +
-- dimensions (10.9s) = 33.4s, measured on the 128,619-row Outback dataset. Each
-- walk re-pays the dominant cost, which is NOT cpu and NOT the algorithm:
--
--   EXPLAIN (ANALYZE, BUFFERS) on one 5,000-row page:
--     Outback    (128,619 rows)  shared hit=2096 read=2967   1,895ms
--     Carrabba's  (56,117 rows)  shared hit=5052 read=11        28ms
--
-- Same rows scanned, same buffers touched, 67x apart — the difference is purely
-- buffer-cache residency. The sample is the 50K rows with the smallest
-- hash(id||dataset_id), and hash order is uncorrelated with physical order, so
-- the sample is scattered at random across a ~922MB heap (2GB with TOAST). The
-- bigger the dataset, the less of that footprint stays cached and the more of
-- the walk becomes random disk I/O. (This is also why "O(sample) => flat cost"
-- in sql/160's header does not hold in practice: measured 1.68x slower for a
-- 2.3x bigger dataset, both scanning exactly 50,000 rows.)
--
-- The corollary is that the number of WALKS matters far more than the work done
-- per row. This migration merges the two extras into one page function so the
-- scattered read happens once, not twice.
--
-- Each half keeps its ORIGINAL matching semantics verbatim rather than being
-- unified, so no published number moves: co-occurrence still matches against the
-- fields concatenated into one string (sql/173 `rc.combined`), dimensions still
-- match per-field. Those differ subtly on multi-field theme sets and this
-- migration is not the place to change either.
--
-- p_want_pairs / p_want_dims let a caller skip a half it does not need; both
-- default true so the shape matches the two functions this replaces. The
-- originals are LEFT IN PLACE — they are still referenced by the pre-deploy code
-- path and by lib/sampledThemeExtras' individual helpers, and dropping them
-- would break a rollback.

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_theme_extras_page(
  p_dataset_id  uuid,
  p_field_keys  text[],
  p_themes      jsonb,     -- [{"id","keywords":[...]}, ...] keywords = prebuilt fragments
  p_after_hash  bigint,
  p_after_id    bigint,
  p_limit       int,
  p_want_pairs  boolean DEFAULT true,
  p_want_dims   boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH page AS MATERIALIZED (
    -- The one scattered walk. Everything below reads from this.
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  -- ── co-occurrence half: sql/173 semantics (fields concatenated) ──────────
  rc AS (
    SELECT page.id, string_agg(coalesce(page.data ->> k, ''), ' ') AS combined
    FROM page, unnest(p_field_keys) AS k
    WHERE p_want_pairs
    GROUP BY page.id
  ),
  rt AS (
    SELECT rc.id, array_agg(tp.tid) AS tids
    FROM rc JOIN tp ON rc.combined ~* tp.pat
    GROUP BY rc.id HAVING count(*) >= 2
  ),
  pc AS (
    SELECT a AS ta, b AS tb, count(*)::bigint AS n
    FROM rt, LATERAL unnest(tids) AS a, LATERAL unnest(tids) AS b
    WHERE a <> b GROUP BY a, b
  ),
  -- ── dimensions half: sql/173 semantics (per-field match) ────────────────
  fld AS (SELECT taxonomy_primary_field(p_dataset_id) AS f),
  matched AS (
    SELECT DISTINCT tp.tid, page.id, page.data
    FROM page, tp, unnest(p_field_keys) AS fk(key)
    WHERE p_want_dims
      AND page.data ->> fk.key IS NOT NULL
      AND page.data ->> fk.key != ''
      AND page.data ->> fk.key ~* tp.pat
  ),
  dims AS (
    SELECT m.tid, ax.key::text AS axis, sb::text AS sub, count(*)::bigint AS cnt
    FROM matched m, fld,
         jsonb_each(m.data -> '_tx' -> 'f' -> fld.f -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sb
    GROUP BY m.tid, ax.key, sb
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'pairs',     COALESCE((SELECT jsonb_agg(jsonb_build_array(ta, tb, n)) FROM pc), '[]'::jsonb),
    'dims',      COALESCE((SELECT jsonb_agg(jsonb_build_array(tid, axis, sub, cnt)) FROM dims), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_theme_extras_page(uuid, text[], jsonb, bigint, bigint, int, boolean, boolean) IS
  'One keyset page of BOTH /theme-counts extras — the co-occurrence pair counts and the per-theme Dimensions breakdown — over the deterministic idx_drf_sample order, from a single walk of the page. Replaces paging sampled_theme_cooccurrence_page and sampled_theme_dimension_page separately (sql/173), which walked the same 50K scattered rows twice. The walk, not the per-row work, is the cost: the sample is hash-ordered and therefore physically scattered, so its cost is dominated by buffer-cache residency (measured 2,967 disk reads / 1,895ms on a 128K dataset vs 11 reads / 28ms on a 56K one, same 5,000 rows). Each half preserves its original matching semantics exactly (pairs match on the concatenated fields, dims per-field) so no published number moves. Returns {n_scanned, pairs, dims, last_hash, last_id}.';

REVOKE ALL ON FUNCTION public.sampled_theme_extras_page(uuid, text[], jsonb, bigint, bigint, int, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_theme_extras_page(uuid, text[], jsonb, bigint, bigint, int, boolean, boolean) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_theme_extras_page(uuid, text[], jsonb, bigint, bigint, int, boolean, boolean) TO service_role;

COMMIT;
