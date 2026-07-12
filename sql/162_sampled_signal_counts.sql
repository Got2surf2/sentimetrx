-- sql/162_sampled_signal_counts.sql
-- Single-pass SAMPLED signal counts for datasets above the 50K sampling cap.
--
-- WHY: the metric strip / theme counts were computed by count_nonempty_rows
-- (sql/161) + count_theme_matches (phase4) — each a FULL SCAN of the dataset's
-- rows. A 14-theme dataset = 16 independent full scans per compute. Fine to
-- ~50K rows; at 785K rows each scan reads ~1.4GB of jsonb and blows the 8s
-- DB statement_timeout, so the strip 500s (prod, 2026-07-11 — persisted even
-- after VACUUM; it's raw volume, not bloat). Everything else above the cap
-- follows the platform sampling doctrine (deterministic 50K sample via the
-- idx_drf_sample expression index, sql/160) — signal counts were the one
-- surface still scanning the whole table.
--
-- WHAT: one keyset-paged pass over the SAME deterministic sample the bulk
-- rows route serves (smallest hash(id||dataset_id) first — so the strip's
-- numbers agree with the client-side tiles computed over the loaded sample),
-- evaluating EVERYTHING in a single heap visit per row:
--   * per-field non-empty counts   (count_nonempty_rows semantics, sql/161)
--   * per-theme match counts       (count_theme_matches semantics, phase4)
--   * union count (row matches ANY theme — the theme-fit numerator)
-- vs. the old shape this trades 16 full scans of N rows for ONE scan of the
-- 50K sample: ~250x less I/O on a 785K dataset, and each page stays far under
-- the statement timeout. Callers scale the sampled counts to the dataset's
-- total row count and label the result as sampled.
--
-- The regex build is byte-identical to count_theme_matches so the sampled
-- and exact paths count the same language. The keyset walk is byte-identical
-- to sample_dataset_rows (sql/160) so the planner uses idx_drf_sample.
--
-- SECURITY DEFINER over raw row data -> service_role only, same posture as
-- sample_dataset_rows / count_theme_matches; routes enforce org access.

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_signal_counts(
  p_dataset_id  uuid,
  p_field_keys  text[],
  p_themes      jsonb,     -- [{"keywords": ["slow service", ...]}, ...] (order preserved in output)
  p_after_hash  bigint,    -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int        -- rows in this page
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  -- MATERIALIZED is load-bearing on pats/page/hits: single-referenced CTEs get
  -- inlined (PG12+), which re-built every theme's regex pattern once per
  -- (row x theme) — ~380ms of string_agg per 2K-row page (measured) — and
  -- would re-walk the sample index per consumer. Materialize = build patterns
  -- once, fetch the page once, evaluate each regex once per (row, theme).
  WITH pats AS MATERIALIZED (
    SELECT t.ord,
           (SELECT string_agg('(?:^|\W)' || regexp_replace(kw, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\w*', '|')
              FROM jsonb_array_elements_text(t.elem -> 'keywords') AS kw
             WHERE btrim(kw) <> '') AS pattern
    FROM jsonb_array_elements(p_themes) WITH ORDINALITY AS t(elem, ord)
  ),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  rec AS (
    -- per-field non-empty counts, aligned to p_field_keys order
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS records
    FROM (
      SELECT fk.ord,
             count(*) FILTER (WHERE NULLIF(btrim(p.data ->> fk.fld), '') IS NOT NULL) AS cnt
      FROM unnest(p_field_keys) WITH ORDINALITY AS fk(fld, ord)
      LEFT JOIN page p ON true
      GROUP BY fk.ord
    ) r
  ),
  hits AS MATERIALIZED (
    -- one boolean per (row, theme): does the row match the theme in any field?
    SELECT p.id, pt.ord,
           (pt.pattern IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(p_field_keys) AS fld
              WHERE p.data ->> fld IS NOT NULL AND p.data ->> fld ~* pt.pattern
           )) AS hit
    FROM page p CROSS JOIN pats pt
  ),
  theme_counts AS (
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS theme_counts
    FROM (SELECT ord, count(*) FILTER (WHERE hit) AS cnt FROM hits GROUP BY ord) t
  ),
  union_cnt AS (
    SELECT count(*) AS union_count
    FROM (SELECT id FROM hits WHERE hit GROUP BY id) u
  )
  SELECT jsonb_build_object(
    'n',            (SELECT count(*) FROM page),
    'records',      (SELECT records      FROM rec),
    'theme_counts', (SELECT theme_counts FROM theme_counts),
    'union_count',  (SELECT union_count  FROM union_cnt),
    'last_hash',    (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',      (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED signal counts over the deterministic idx_drf_sample order (same sample as sample_dataset_rows, sql/160). Returns {n, records: per-field non-empty counts, theme_counts: per-theme match counts, union_count: rows matching any theme, last_hash, last_id}. Semantics match count_nonempty_rows (sql/161) and count_theme_matches (phase4) exactly. Used above the 50K cap where per-theme full scans exceed the 8s statement timeout; callers scale to total rows and label results as sampled.';

REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) TO service_role;

COMMIT;
