-- sql/164_taxonomy_aggregates_per_question.sql
-- Per-QUESTION dimension aggregates for Charts/Stats (2026-07-12).
--
-- WHY: the taxonomy substrate is per-field everywhere else — the _tx embed
-- stores one block per field key, stored rollups are keyed by question, the
-- Dimensions tab and theme-card chips pass field keys. The ONE surface still
-- pinned to a single question was the Charts/Stats chart aggregates: these
-- five read RPCs resolved their field INTERNALLY via taxonomy_primary_field
-- (most classified rows wins), so on a dataset with BOTH questions classified
-- (e.g. Liked MOST + Liked LEAST) dimension charts silently showed whichever
-- had more classified rows, with no way to switch. This mirrors the same-day
-- per-question theme fix (themeSetForField): the Charts/Stats source-field
-- picker now drives dimensions too.
--
-- WHAT: each RPC gains `p_field_key text DEFAULT NULL`. NULL/'' or a field
-- with no stored rollup entry -> taxonomy_primary_field, exactly the old
-- behavior (same fallback contract as themes' "never-mined field falls back
-- to the active set"). The signatures change, so the old ones are DROPPED
-- first (CREATE OR REPLACE with a different arg list would create ambiguous
-- overloads for PostgREST). Deploy-order safe both ways: already-deployed
-- code omits p_field_key -> the default preserves old behavior; new code
-- against an unmigrated database gets PGRST202 and the aggregate route
-- retries without the param.
--
-- Bodies are otherwise byte-identical to sql/158 (the emotion-axis widening).

BEGIN;

-- Shared resolver: the requested question when it has a stored rollup
-- (i.e. has actually been classified), else the primary classified field.
CREATE OR REPLACE FUNCTION taxonomy_field_or_primary(p_dataset_id uuid, p_field_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_field_key, '') <> '' AND EXISTS (
           SELECT 1 FROM dataset_state ds
            WHERE ds.dataset_id = p_dataset_id
              AND ds.analytics -> 'taxonomy' -> 'fields' ? p_field_key)
      THEN p_field_key
    ELSE taxonomy_primary_field(p_dataset_id)
  END;
$$;

DROP FUNCTION IF EXISTS taxonomy_sub_counts(uuid, text, bigint[]);
DROP FUNCTION IF EXISTS taxonomy_group_stats(uuid, text, text, bigint[]);
DROP FUNCTION IF EXISTS taxonomy_crosstab(uuid, text, text, integer, bigint[]);
DROP FUNCTION IF EXISTS taxonomy_date_series(uuid, text, text, text, text, bigint[]);
DROP FUNCTION IF EXISTS taxonomy_axis_crosstab(uuid, text, bigint[]);

CREATE FUNCTION taxonomy_sub_counts(p_dataset_id uuid, p_axis text, p_row_ids bigint[] DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS TABLE(value text, count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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
$$;

CREATE FUNCTION taxonomy_group_stats(p_dataset_id uuid, p_axis text, p_value_field text, p_row_ids bigint[] DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS TABLE(group_val text, n bigint, min_val double precision, max_val double precision, avg_val double precision, median_val double precision, q1_val double precision, q3_val double precision, stddev_val double precision)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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
$_$;

CREATE FUNCTION taxonomy_crosstab(p_dataset_id uuid, p_axis text, p_field text, p_limit integer DEFAULT 50, p_row_ids bigint[] DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS TABLE(sub_val text, field_val text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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
$$;

CREATE FUNCTION taxonomy_date_series(p_dataset_id uuid, p_axis text, p_date_field text, p_metric_field text DEFAULT NULL, p_bucket text DEFAULT 'day', p_row_ids bigint[] DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS TABLE(sub_val text, bucket_date text, n bigint, avg_val double precision)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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
$_$;

CREATE FUNCTION taxonomy_axis_crosstab(p_dataset_id uuid, p_field text, p_row_ids bigint[] DEFAULT NULL, p_field_key text DEFAULT NULL)
RETURNS TABLE(axis_val text, field_val text, cnt bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field text;
BEGIN
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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
$$;

COMMENT ON FUNCTION taxonomy_field_or_primary(uuid, text) IS
  'Chart-aggregate field resolution: the requested question when it has a stored taxonomy rollup (has been classified), else taxonomy_primary_field — the pre-sql/164 behavior. Mirrors the per-question theme fallback (themeSetForField).';

COMMIT;
