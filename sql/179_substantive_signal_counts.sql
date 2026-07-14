-- sql/179_substantive_signal_counts.sql
-- Substantive-aware theme-fit denominator for the metric strip (sql/178 flag).
--
-- The "Theme fit" strip led with `inThemes / all-non-empty` — but ~45% of a
-- survey field's answers are non-substantive ("N/A" / "Nothing"), so a correctly
-- tied theme model read "Diffuse 30%". The owner-confirmed fix leads with the
-- substantive fraction (`inThemes-among-substantive / substantive`) and reveals
-- the all-based number on hover. Both numerator AND denominator must be gated to
-- substantive — a denominator-only shortcut overstates fit ~6pts because ~12% of
-- keyword matches land on non-substantive rows.
--
-- The stored `substantive` map (sql/178) makes this a cheap has-key test:
--   * per-field denominator     : substantive ? <field>
--   * row substantive-in-scope  : substantive ?| <field_keys>   (numerator gate)
--
-- Two RPC families, matching signalStats' exact (<=50K) and sampled (>50K) paths:
--
--  (A) sampled_signal_counts (sql/166) — SAME signature (CREATE OR REPLACE), now
--      also returns `records_substantive` (per field) and `union_substantive`.
--      Old callers ignore the new keys; no rollout gate needed.
--  (B) count_nonempty_rows / count_theme_matches (sql/170) — each gains a
--      trailing `p_substantive_only boolean DEFAULT false`. DROP+CREATE (new
--      signature) but every existing 3/4-arg call still resolves via the
--      defaults, so pre-179 code + a post-179 database keep working during the
--      migrate-then-deploy window.
--
-- SECURITY DEFINER over raw rows -> service_role only (unchanged posture).

BEGIN;

-- (A) sampled_signal_counts: add substantive twin counts in the same pass ------
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
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS theme_counts
    FROM (SELECT ord, count(*) FILTER (WHERE hit) AS cnt FROM hits GROUP BY ord) t
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
    'n',                   (SELECT count(*) FROM page),
    'records',             (SELECT records             FROM rec),
    'records_substantive', (SELECT records_substantive FROM rec),
    'theme_counts',        (SELECT theme_counts        FROM theme_counts),
    'union_count',         (SELECT union_count             FROM union_cnt),
    'union_substantive',   (SELECT union_count_substantive FROM union_cnt),
    'last_hash',           (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',             (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED signal counts over idx_drf_sample (sql/160). Returns {n, records, records_substantive, theme_counts, union_count, union_substantive, last_hash, last_id}. records_substantive/union_substantive gate on the stored substantive map (sql/178/179) for the substantive theme-fit denominator. Used above the 50K cap; callers scale to total rows.';

REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_signal_counts(uuid, text[], jsonb, bigint, bigint, int) TO service_role;

-- (B) exact-path RPCs: optional substantive-only gate --------------------------
DROP FUNCTION IF EXISTS count_theme_matches(uuid, text[], text[], bigint[]);
CREATE FUNCTION count_theme_matches(
  p_dataset_id      uuid,
  p_field_keys      text[],
  p_keywords        text[],
  p_row_ids         bigint[] DEFAULT NULL,
  p_substantive_only boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pattern text;
  total bigint;
BEGIN
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  SELECT count(DISTINCT drf.id) INTO total
  FROM dataset_rows_flat drf,
       LATERAL unnest(p_field_keys) AS fk(key)
  WHERE drf.dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR drf.id = ANY(p_row_ids))
    AND (NOT p_substantive_only OR drf.substantive ?| p_field_keys)
    AND drf.data ->> fk.key IS NOT NULL
    AND drf.data ->> fk.key != ''
    AND drf.data ->> fk.key ~* pattern;

  RETURN total;
END;
$$;

DROP FUNCTION IF EXISTS count_nonempty_rows(uuid, text, bigint[]);
CREATE FUNCTION count_nonempty_rows(
  p_dataset_id      uuid,
  p_field           text,
  p_row_ids         bigint[] DEFAULT NULL,
  p_substantive_only boolean DEFAULT false
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR drf.id = ANY(p_row_ids))
    AND (CASE WHEN p_substantive_only
              THEN drf.substantive ? p_field
              ELSE NULLIF(btrim(drf.data ->> p_field), '') IS NOT NULL
         END);
$$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'count_theme_matches(uuid, text[], text[], bigint[], boolean)',
    'count_nonempty_rows(uuid, text, bigint[], boolean)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
