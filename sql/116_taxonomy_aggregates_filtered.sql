-- 116_taxonomy_aggregates_filtered.sql
--
-- Make the Charts taxonomy aggregate RPCs FILTER-AWARE: accept an optional
-- p_row_ids bigint[] and, when present, restrict the aggregate to those rows.
-- The client already computes the view's filtered rows (applyFilters); it passes
-- their flat ids here so chart dimensions reflect the active filters — completing
-- the "view-level" behavior (sql/115 added per-field; this adds filters).
--
--   p_row_ids NULL  → whole dataset (fast path, no filters active)
--   p_row_ids = […]  → only those dataset_rows_flat ids (= dataset_row_*_taxonomy.row_id)
--
-- Adds the param to all 4 RPCs (DROP + CREATE — the signature changes). Keeps the
-- per-field auto-resolution from sql/115 (reads dataset_row_field_taxonomy for the
-- primary classified field, legacy fallback). taxonomy_primary_field (sql/115) is
-- reused unchanged. Requires sql/114 + sql/115 applied first. Route passes
-- p_row_ids only for tax_* ops when filters are active; existing param names are
-- unchanged so non-filtered calls still resolve (p_row_ids defaults NULL).
--
-- Note on sampling: the client caps rows at 50K (RowsContext SAMPLE_CAP), so for
-- datasets > 50K the filtered id set is a sample — consistent with how regular
-- (non-dimension) charts already aggregate from the same client-side sample.

BEGIN;

DROP FUNCTION IF EXISTS taxonomy_sub_counts(uuid, text);
DROP FUNCTION IF EXISTS taxonomy_group_stats(uuid, text, text);
DROP FUNCTION IF EXISTS taxonomy_crosstab(uuid, text, text, int);
DROP FUNCTION IF EXISTS taxonomy_date_series(uuid, text, text, text, text);

-- ── 1. Sub counts ─────────────────────────────────────────────────────────
CREATE FUNCTION taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(value text, count bigint) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
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
        AND ($2 IS NULL OR t.row_id = ANY($2))
      GROUP BY sub
      ORDER BY count(*) DESC', v_table, v_col, v_cond
  ) USING p_dataset_id, p_row_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Numeric stats per sub (+ quartiles) ────────────────────────────────
CREATE FUNCTION taxonomy_group_stats(
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
  v_col text; v_field text; v_table text; v_cond text;
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
          AND ($3 IS NULL OR t.row_id = ANY($3))
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
  ) USING p_dataset_id, p_value_field, p_row_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. Crosstab: axis sub × scalar field ──────────────────────────────────
CREATE FUNCTION taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_limit      int DEFAULT 50,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(sub_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
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
        AND ($4 IS NULL OR t.row_id = ANY($4))
      GROUP BY sub, f.data ->> $2
      ORDER BY count(*) DESC
      LIMIT $3', v_table, v_col, v_cond
  ) USING p_dataset_id, p_field, p_limit * p_limit, p_row_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. date_series per axis sub (dimension × time) ────────────────────────
CREATE FUNCTION taxonomy_date_series(
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
  v_col text; v_field text; v_table text; v_cond text;
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
        AND ($5 IS NULL OR t.row_id = ANY($5))
        AND f.data ->> $2 IS NOT NULL
        AND (f.data ->> $2) ~ ''^\d{4}-\d{2}-\d{2}''
      GROUP BY sub, bucket_date
      ORDER BY sub, bucket_date', v_table, v_col, v_cond
  ) USING p_dataset_id, p_date_field, p_bucket, p_metric_field, p_row_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
