-- 152_taxonomy_sidecar_drop.sql
--
-- ⚠️  DO NOT APPLY until ALL of the following are true (in order):
--   1. sql/151 applied to prod (embed RPCs + tsv-trigger fix).
--   2. The embed code (sql/151 companion commit) is DEPLOYED to prod.
--   3. scripts/backfill-taxonomy-embed.ts has run against prod AND been re-run
--      once AFTER the deploy (in case old code classified into the sidecar
--      between backfill and deploy — the script is idempotent).
--   4. scripts/_verify_taxembed.ts --mode parity --prod reports 0 failures.
--
-- Retires the taxonomy sidecar tables (sql/088 + sql/114): verdicts now live in
-- dataset_rows_flat.data._tx with rollups in dataset_state.analytics.taxonomy.
-- Also strips the transitional sidecar-fallback legs from the sql/151 RPCs
-- (blob-only from here on).
--
-- Ship the SAME commit/apply with the code cleanup checklist:
--   - lib/orgSnapshot.ts — remove dataset_row_taxonomy + dataset_row_field_taxonomy
--     from the snapshot manifest (verdicts ride with dataset_rows_flat now).
--   - lib/orgDelete.ts — remove both from ORG_SCOPED_TABLES.
--   - scripts/_verify_snapv2.ts (untracked) — drop the two-table count checks.
--   - docs/db/schema.sql — refreshed automatically by `npm run migrate`.

BEGIN;

-- ── Blob-only RPC bodies (drop the sidecar fallback legs) ────────────────────

CREATE OR REPLACE FUNCTION taxonomy_primary_field(p_dataset_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.key
    FROM dataset_state ds,
         jsonb_each(ds.analytics -> 'taxonomy' -> 'fields') AS e(key, val)
   WHERE ds.dataset_id = p_dataset_id
   ORDER BY COALESCE((e.val -> 'rollup' ->> 'classifiedRows')::bigint, 0) DESC, e.key
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION taxonomy_drill_rows(
  p_dataset_id uuid,
  p_field_key  text,
  p_axis       text DEFAULT NULL,
  p_sub        text DEFAULT NULL,
  p_alert      text DEFAULT NULL,
  p_limit      int  DEFAULT 100
)
RETURNS TABLE(row_id bigint, data jsonb, tx jsonb, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_axis IS NOT NULL AND p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  RETURN QUERY
  SELECT f.id,
         f.data - '_tx' AS data,
         f.data -> '_tx' -> 'f' -> p_field_key AS tx,
         count(*) OVER() AS total_count
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (
       (p_alert IS NOT NULL AND (f.data -> '_tx' -> 'f' -> p_field_key -> 'al') ? p_alert)
       OR (p_alert IS NULL AND p_sub IS NOT NULL
           AND (f.data -> '_tx' -> 'f' -> p_field_key -> 'a' -> p_axis) ? p_sub)
       OR (p_alert IS NULL AND p_sub IS NULL AND p_axis IS NOT NULL
           AND jsonb_array_length(COALESCE(f.data -> '_tx' -> 'f' -> p_field_key -> 'a' -> p_axis, '[]'::jsonb)) > 0)
     )
   ORDER BY f.row_index
   LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION taxonomy_counts(
  p_dataset_id uuid,
  p_field_key  text
)
RETURNS TABLE(classified bigint, alerts bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE jsonb_array_length(COALESCE(f.data -> '_tx' -> 'f' -> p_field_key -> 'al', '[]'::jsonb)) > 0)::bigint
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (f.data -> '_tx' -> 'f') ? p_field_key;
$$;

CREATE OR REPLACE FUNCTION taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(value text, count bigint) AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sub::text, count(*)::bigint
    FROM dataset_rows_flat f,
         jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
   WHERE f.dataset_id = p_dataset_id
     AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
   GROUP BY sub
   ORDER BY count(*) DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_group_stats(
  p_dataset_id  uuid,
  p_axis        text,
  p_value_field text,
  p_row_ids     bigint[] DEFAULT NULL
)
RETURNS TABLE(
  group_val   text,
  n           bigint,
  min_val     double precision,
  max_val     double precision,
  avg_val     double precision,
  median_val  double precision,
  q1_val      double precision,
  q3_val      double precision,
  stddev_val  double precision
) AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH g AS (
    SELECT sub::text AS gv, (f.data ->> p_value_field)::double precision AS v
      FROM dataset_rows_flat f,
           jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
     WHERE f.dataset_id = p_dataset_id
       AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
       AND f.data ->> p_value_field IS NOT NULL
       AND f.data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT gv, count(*)::bigint,
         min(v), max(v), avg(v),
         percentile_cont(0.5)  WITHIN GROUP (ORDER BY v),
         percentile_cont(0.25) WITHIN GROUP (ORDER BY v),
         percentile_cont(0.75) WITHIN GROUP (ORDER BY v),
         stddev_samp(v)
    FROM g
   GROUP BY gv
   ORDER BY count(*) DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_limit      int DEFAULT 50,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(sub_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sub::text,
         COALESCE(f.data ->> p_field, '')::text,
         count(*)::bigint
    FROM dataset_rows_flat f,
         jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
   WHERE f.dataset_id = p_dataset_id
     AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
   GROUP BY sub, f.data ->> p_field
   ORDER BY count(*) DESC
   LIMIT p_limit * p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_date_series(
  p_dataset_id   uuid,
  p_axis         text,
  p_date_field   text,
  p_metric_field text DEFAULT NULL,
  p_bucket       text DEFAULT 'day',
  p_row_ids      bigint[] DEFAULT NULL
)
RETURNS TABLE(
  sub_val     text,
  bucket_date text,
  n           bigint,
  avg_val     double precision
) AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sub::text,
         CASE p_bucket
           WHEN 'week'    THEN to_char(date_trunc('week',  (f.data ->> p_date_field)::date), 'YYYY-MM-DD')
           WHEN 'month'   THEN to_char(date_trunc('month', (f.data ->> p_date_field)::date), 'YYYY-MM')
           WHEN 'quarter' THEN to_char(date_trunc('quarter',(f.data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (f.data ->> p_date_field)::date))::text
           WHEN 'year'    THEN to_char(date_trunc('year',  (f.data ->> p_date_field)::date), 'YYYY')
           ELSE to_char((f.data ->> p_date_field)::date, 'YYYY-MM-DD')
         END,
         count(*)::bigint,
         CASE WHEN p_metric_field IS NOT NULL AND p_metric_field <> '' THEN
           avg((f.data ->> p_metric_field)::double precision) FILTER (WHERE f.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')
         END
    FROM dataset_rows_flat f,
         jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
   WHERE f.dataset_id = p_dataset_id
     AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
     AND f.data ->> p_date_field IS NOT NULL
     AND (f.data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
   GROUP BY 1, 2
   ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_axis_crosstab(
  p_dataset_id uuid,
  p_field      text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(axis_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_field text;
BEGIN
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT ax.key::text,
         COALESCE(f.data ->> p_field, '')::text,
         count(*)::bigint
    FROM dataset_rows_flat f,
         jsonb_each(f.data -> '_tx' -> 'f' -> v_field -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sub
   WHERE f.dataset_id = p_dataset_id
     AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
   GROUP BY ax.key, f.data ->> p_field;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION theme_dimension_counts(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords   text[],
  p_limit      int DEFAULT 8
)
RETURNS TABLE(axis text, sub text, count bigint) AS $$
DECLARE
  pattern text;
  v_field text;
BEGIN
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT drf.id, drf.data
      FROM dataset_rows_flat drf,
           LATERAL unnest(p_field_keys) AS fk(key)
     WHERE drf.dataset_id = p_dataset_id
       AND drf.data ->> fk.key IS NOT NULL
       AND drf.data ->> fk.key != ''
       AND drf.data ->> fk.key ~* pattern
  )
  SELECT ax.key::text, sb::text, count(*)::bigint
    FROM matched m,
         jsonb_each(m.data -> '_tx' -> 'f' -> v_field -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sb
   GROUP BY ax.key, sb
   ORDER BY count(*) DESC
   LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_rows_by_filters(
  p_dataset_ids    uuid[],
  p_text_fields    jsonb,
  p_theme_query    text    DEFAULT NULL,
  p_entity_query   text    DEFAULT NULL,
  p_sub_touchpoint text[]  DEFAULT NULL,
  p_sub_attribute  text[]  DEFAULT NULL,
  p_sub_product    text[]  DEFAULT NULL,
  p_sub_beverage   text[]  DEFAULT NULL,
  p_sub_ambiance   text[]  DEFAULT NULL,
  p_sub_context    text[]  DEFAULT NULL,
  p_sub_outcome    text[]  DEFAULT NULL,
  p_has_dim        boolean DEFAULT false,
  p_limit          int     DEFAULT 200,
  p_offset         int     DEFAULT 0
)
RETURNS TABLE(id bigint, dataset_id uuid, row_index int, data jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fields jsonb := '{}'::jsonb;  -- dataset_id -> primary field key
  v_ds uuid;
  v_f  text;
BEGIN
  IF p_has_dim THEN
    FOREACH v_ds IN ARRAY p_dataset_ids LOOP
      v_f := taxonomy_primary_field(v_ds);
      IF v_f IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object(v_ds::text, v_f);
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
      AND (
        p_theme_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_theme_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_theme_query)
          )
        )
      )
      AND (
        p_entity_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_entity_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_entity_query)
          )
        )
      )
      AND (
        NOT p_has_dim
        OR (
          v_fields ? r.dataset_id::text
          AND (
            (p_sub_touchpoint IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'touchpoint') ?| p_sub_touchpoint) OR
            (p_sub_attribute  IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'attribute')  ?| p_sub_attribute)  OR
            (p_sub_product    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'product')    ?| p_sub_product)    OR
            (p_sub_beverage   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'beverage')   ?| p_sub_beverage)   OR
            (p_sub_ambiance   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'ambiance')   ?| p_sub_ambiance)   OR
            (p_sub_context    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'context')    ?| p_sub_context)    OR
            (p_sub_outcome    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'outcome')    ?| p_sub_outcome)
          )
        )
      )
  )
  SELECT m.id, m.dataset_id, m.row_index, m.data - '_tx', count(*) OVER() AS total_count
  FROM matched m
  ORDER BY m.row_index
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION dataset_rows_pending_field_taxonomy(
  p_dataset_id uuid,
  p_field_key  text,
  p_fields     text[],
  p_limit      int DEFAULT 1000
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND NOT ((f.data -> '_tx' -> 'f') ? p_field_key)
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   ORDER BY f.row_index
   LIMIT p_limit;
$$;

-- ── Retire the sidecar tables ────────────────────────────────────────────────

DROP TABLE IF EXISTS dataset_row_field_taxonomy;
DROP TABLE IF EXISTS dataset_row_taxonomy;

COMMIT;

-- Verify
SELECT 'sidecar tables dropped' AS object,
       CASE WHEN to_regclass('public.dataset_row_taxonomy') IS NULL
             AND to_regclass('public.dataset_row_field_taxonomy') IS NULL
            THEN 'ready' ELSE 'STILL PRESENT' END AS status;
