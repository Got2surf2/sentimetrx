-- sql/181_sampled_signal_theme_substantive.sql
-- Per-theme substantive match counts on the SAMPLED path (sql/166/179).
--
-- The two-count model (owner 2026-07-14) puts every theme-prevalence % on the
-- substantive comment base: prevalence = (substantive rows matching the theme) /
-- (substantive comments). sql/179 gave the strip its substantive numbers by
-- adding `records_substantive` (per-field denominator) and `union_substantive`
-- (rows matching ANY theme AND substantive) — enough for the strip's single
-- "Theme fit". But the per-theme PREVALENCE bars (Charts / TextMine distribution
-- / Statistics, via the /theme-counts route) need a PER-THEME substantive
-- numerator, which sampled_signal_counts did not return.
--
-- Above the 50K cap the exact per-theme count_theme_matches(p_substantive_only)
-- full-scans and 57014s, so the count must come from the same single sampled
-- pass. This adds `theme_counts_substantive` (per theme, hit AND substantive-in-
-- scope) alongside the existing `theme_counts`. CREATE OR REPLACE, same
-- signature — old callers ignore the new key, so no rollout gate is needed and
-- the migrate-then-deploy window is safe.
--
-- SECURITY DEFINER over raw rows -> service_role only (unchanged posture).

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_signal_counts(
  p_dataset_id  uuid,
  p_field_keys  text[],
  p_themes      jsonb,
  p_after_hash  bigint,
  p_after_id    bigint,
  p_limit       int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pats AS MATERIALIZED (
    SELECT t.ord,
           CASE WHEN t.elem ? 'patterns' THEN
             (SELECT string_agg('(?:^|\W)(?:' || pat || ')', '|')
                FROM jsonb_array_elements_text(t.elem -> 'patterns') AS pat
               WHERE btrim(pat) <> '')
           ELSE
             (SELECT string_agg('(?:^|\W)' || regexp_replace(kw, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\w*', '|')
                FROM jsonb_array_elements_text(t.elem -> 'keywords') AS kw
               WHERE btrim(kw) <> '')
           END AS pattern
    FROM jsonb_array_elements(p_themes) WITH ORDINALITY AS t(elem, ord)
  ),
  page AS MATERIALIZED (
    SELECT f.id, f.data, f.substantive,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  rec AS (
    -- per-field non-empty + substantive counts, aligned to p_field_keys order
    SELECT COALESCE(jsonb_agg(cnt     ORDER BY ord), '[]'::jsonb) AS records,
           COALESCE(jsonb_agg(cnt_sub ORDER BY ord), '[]'::jsonb) AS records_substantive
    FROM (
      SELECT fk.ord,
             count(*) FILTER (WHERE NULLIF(btrim(p.data ->> fk.fld), '') IS NOT NULL) AS cnt,
             count(*) FILTER (WHERE p.substantive ? fk.fld)                           AS cnt_sub
      FROM unnest(p_field_keys) WITH ORDINALITY AS fk(fld, ord)
      LEFT JOIN page p ON true
      GROUP BY fk.ord
    ) r
  ),
  hits AS MATERIALIZED (
    SELECT p.id, pt.ord,
           (pt.pattern IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(p_field_keys) AS fld
              WHERE p.data ->> fld IS NOT NULL AND p.data ->> fld ~* pt.pattern
           )) AS hit,
           (p.substantive ?| p_field_keys) AS sub
    FROM page p CROSS JOIN pats pt
  ),
  theme_counts AS (
    -- per-theme all-match counts AND the substantive twin (hit AND substantive),
    -- both aligned to theme order. The substantive twin is the prevalence-bar
    -- numerator; the all count stays for any non-substantive consumer.
    SELECT COALESCE(jsonb_agg(cnt     ORDER BY ord), '[]'::jsonb) AS theme_counts,
           COALESCE(jsonb_agg(cnt_sub ORDER BY ord), '[]'::jsonb) AS theme_counts_substantive
    FROM (
      SELECT ord,
             count(*) FILTER (WHERE hit)           AS cnt,
             count(*) FILTER (WHERE hit AND sub)   AS cnt_sub
      FROM hits GROUP BY ord
    ) t
  ),
  union_cnt AS (
    SELECT count(*) FILTER (WHERE any_hit)             AS union_count,
           count(*) FILTER (WHERE any_hit AND any_sub) AS union_count_substantive
    FROM (
      SELECT id, bool_or(hit) AS any_hit, bool_or(sub) AS any_sub
      FROM hits GROUP BY id
    ) u
  )
  SELECT jsonb_build_object(
    'n',                        (SELECT count(*) FROM page),
    'records',                  (SELECT records             FROM rec),
    'records_substantive',      (SELECT records_substantive FROM rec),
    'theme_counts',             (SELECT theme_counts             FROM theme_counts),
    'theme_counts_substantive', (SELECT theme_counts_substantive FROM theme_counts),
    'union_count',              (SELECT union_count             FROM union_cnt),
    'union_substantive',        (SELECT union_count_substantive FROM union_cnt),
    'last_hash',                (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',                  (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED signal counts over idx_drf_sample (sql/160). Returns {n, records, records_substantive, theme_counts, theme_counts_substantive, union_count, union_substantive, last_hash, last_id}. The *_substantive keys gate on the stored substantive map (sql/178) for the two-count model: records_substantive/union_substantive feed the strip, theme_counts_substantive feeds the per-theme prevalence bars. Used above the 50K cap; callers scale to total rows. sql/181.';

REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) TO service_role;

COMMIT;
