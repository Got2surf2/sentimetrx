-- 115_taxonomy_aggregates_per_field.sql
--
-- Make the Charts/Stats taxonomy aggregate RPCs read the PER-FIELD table
-- (dataset_row_field_taxonomy, sql/114) instead of the legacy field-agnostic
-- dataset_row_taxonomy — so chart dimensions reflect the same per-field data as
-- the Dimensions tab (which is now per-field/reactive).
--
-- Charts has no "analyzed field" selector (it's a separate page from TextMine,
-- no shared field state), so each RPC AUTO-RESOLVES the field: it uses the
-- dataset's PRIMARY classified field = the field with the most tagged rows in
-- dataset_row_field_taxonomy (= the field the user actually classified/analyzed).
-- If a dataset has no per-field rows yet (never re-classified after 114), it
-- FALLS BACK to the legacy dataset_row_taxonomy so nothing breaks.
--
-- Signatures are UNCHANGED (the field is resolved internally), so the /aggregate
-- route and ChartsModule need no changes — re-running this migration is the whole
-- change. CREATE OR REPLACE only (no DROP); requires sql/114 applied first.
--
-- Filters-awareness (restricting to the view's filtered rows) is a planned
-- follow-up — this pass is per-field only.
--
-- Read-only/additive, same axis-whitelist + org-gated-by-route guarantees as 105/106.

BEGIN;

-- Resolve a dataset's primary classified field (most tagged rows). NULL when the
-- dataset has no per-field taxonomy yet → callers fall back to the legacy table.
CREATE OR REPLACE FUNCTION taxonomy_primary_field(p_dataset_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT field
    FROM dataset_row_field_taxonomy
   WHERE dataset_id = p_dataset_id
   GROUP BY field
   ORDER BY count(*) DESC, field
   LIMIT 1;
$$;

-- ── 1. Sub counts for one axis ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text
)
RETURNS TABLE(value text, count bigint) AS $$
DECLARE
  v_col text;
  v_field text;
  v_table text;
  v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col   := 'axis_' || p_axis;
  v_field := taxonomy_primary_field(p_dataset_id);
  v_table := CASE WHEN v_field IS NOT NULL THEN 'dataset_row_field_taxonomy' ELSE 'dataset_row_taxonomy' END;
  v_cond  := CASE WHEN v_field IS NOT NULL THEN format(' AND t.field = %L', v_field) ELSE '' END;
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS value, count(*)::bigint AS count
       FROM %I t, unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
      GROUP BY sub
      ORDER BY count(*) DESC', v_table, v_col, v_cond
  ) USING p_dataset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Numeric stats per sub on one axis (+ quartiles, matching sql/106) ───
CREATE OR REPLACE FUNCTION taxonomy_group_stats(
  p_dataset_id  uuid,
  p_axis        text,
  p_value_field text
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
  v_col text;
  v_field text;
  v_table text;
  v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col   := 'axis_' || p_axis;
  v_field := taxonomy_primary_field(p_dataset_id);
  v_table := CASE WHEN v_field IS NOT NULL THEN 'dataset_row_field_taxonomy' ELSE 'dataset_row_taxonomy' END;
  v_cond  := CASE WHEN v_field IS NOT NULL THEN format(' AND t.field = %L', v_field) ELSE '' END;
  RETURN QUERY EXECUTE format(
    'WITH g AS (
       SELECT sub::text AS gv,
              (f.data ->> $2)::double precision AS v
         FROM %I t
         JOIN dataset_rows_flat f
           ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
              unnest(t.%I) AS sub
        WHERE t.dataset_id = $1 %s
          AND f.data ->> $2 IS NOT NULL
          AND f.data ->> $2 ~ ''^-?[0-9]+\.?[0-9]*$''
     )
     SELECT gv AS group_val,
            count(*)::bigint AS n,
            min(v) AS min_val,
            max(v) AS max_val,
            avg(v) AS avg_val,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY v) AS median_val,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS q1_val,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS q3_val,
            stddev_samp(v) AS stddev_val
       FROM g
      GROUP BY gv
      ORDER BY count(*) DESC', v_table, v_col, v_cond
  ) USING p_dataset_id, p_value_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. Crosstab: axis sub × a scalar field ────────────────────────────────
CREATE OR REPLACE FUNCTION taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_limit      int DEFAULT 50
)
RETURNS TABLE(sub_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_col text;
  v_field text;
  v_table text;
  v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col   := 'axis_' || p_axis;
  v_field := taxonomy_primary_field(p_dataset_id);
  v_table := CASE WHEN v_field IS NOT NULL THEN 'dataset_row_field_taxonomy' ELSE 'dataset_row_taxonomy' END;
  v_cond  := CASE WHEN v_field IS NOT NULL THEN format(' AND t.field = %L', v_field) ELSE '' END;
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS sub_val,
            COALESCE(f.data ->> $2, '''')::text AS field_val,
            count(*)::bigint AS cnt
       FROM %I t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
      GROUP BY sub, f.data ->> $2
      ORDER BY count(*) DESC
      LIMIT $3', v_table, v_col, v_cond
  ) USING p_dataset_id, p_field, p_limit * p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. date_series per axis sub (dimension × time) ────────────────────────
CREATE OR REPLACE FUNCTION taxonomy_date_series(
  p_dataset_id   uuid,
  p_axis         text,
  p_date_field   text,
  p_metric_field text DEFAULT NULL,
  p_bucket       text DEFAULT 'day'
)
RETURNS TABLE(
  sub_val     text,
  bucket_date text,
  n           bigint,
  avg_val     double precision
) AS $$
DECLARE
  v_col text;
  v_field text;
  v_table text;
  v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col   := 'axis_' || p_axis;
  v_field := taxonomy_primary_field(p_dataset_id);
  v_table := CASE WHEN v_field IS NOT NULL THEN 'dataset_row_field_taxonomy' ELSE 'dataset_row_taxonomy' END;
  v_cond  := CASE WHEN v_field IS NOT NULL THEN format(' AND t.field = %L', v_field) ELSE '' END;
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS sub_val,
            CASE $3
              WHEN ''week''    THEN to_char(date_trunc(''week'',  (f.data ->> $2)::date), ''YYYY-MM-DD'')
              WHEN ''month''   THEN to_char(date_trunc(''month'', (f.data ->> $2)::date), ''YYYY-MM'')
              WHEN ''quarter'' THEN to_char(date_trunc(''quarter'',(f.data ->> $2)::date), ''YYYY'') || ''-Q'' || extract(quarter from date_trunc(''quarter'', (f.data ->> $2)::date))::text
              WHEN ''year''    THEN to_char(date_trunc(''year'',  (f.data ->> $2)::date), ''YYYY'')
              ELSE to_char((f.data ->> $2)::date, ''YYYY-MM-DD'')
            END AS bucket_date,
            count(*)::bigint AS n,
            CASE WHEN $4 IS NOT NULL AND $4 != '''' THEN
              avg((f.data ->> $4)::double precision) FILTER (WHERE f.data ->> $4 ~ ''^-?[0-9]+\.?[0-9]*$'')
            ELSE NULL END AS avg_val
       FROM %I t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
        AND f.data ->> $2 IS NOT NULL
        AND (f.data ->> $2) ~ ''^\d{4}-\d{2}-\d{2}''
      GROUP BY sub, bucket_date
      ORDER BY sub, bucket_date', v_table, v_col, v_cond
  ) USING p_dataset_id, p_date_field, p_bucket, p_metric_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
