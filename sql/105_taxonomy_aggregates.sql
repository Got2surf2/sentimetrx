-- sql/105_taxonomy_aggregates.sql
-- Server-side aggregation over the taxonomy ("Dimensions") tags so Charts can
-- group/average by a dimension axis without shipping per-row tags to the client
-- (client re-derivation of the 250+ keyword dictionary is ~30s/50K rows — too
-- slow). These mirror the scalar aggregate RPCs (group_numeric_stats /
-- crosstab_counts / count_field_values) but UNNEST the multi-value axis_<a>
-- text[] arrays from dataset_row_taxonomy, joining dataset_rows_flat for the
-- scalar value/column field. A review tagged product=[steak,seafood] counts in
-- BOTH subs — matching the Dimensions tab rollup exactly.
--
-- Read-only, additive. Org access is enforced by the /aggregate route BEFORE
-- these are called (it verifies dataset_id -> org_id); the functions are scoped
-- to a single p_dataset_id. p_axis is validated against the fixed 7-axis
-- whitelist before being interpolated as a column name (no injection surface).

-- ── 1. Sub counts for one axis (field_counts analog) ──────────────────────
CREATE OR REPLACE FUNCTION taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text
)
RETURNS TABLE(value text, count bigint) AS $$
DECLARE
  v_col text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col := 'axis_' || p_axis;
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS value, count(*)::bigint AS count
       FROM dataset_row_taxonomy t, unnest(t.%I) AS sub
      WHERE t.dataset_id = $1
      GROUP BY sub
      ORDER BY count(*) DESC', v_col
  ) USING p_dataset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. Numeric stats per sub on one axis (group_numeric_stats analog) ──────
--    Powers "avg rating by Dimension". Joins flat for the value field.
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
  stddev_val  double precision
) AS $$
DECLARE
  v_col text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col := 'axis_' || p_axis;
  RETURN QUERY EXECUTE format(
    'WITH g AS (
       SELECT sub::text AS gv,
              (f.data ->> $2)::double precision AS v
         FROM dataset_row_taxonomy t
         JOIN dataset_rows_flat f
           ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
              unnest(t.%I) AS sub
        WHERE t.dataset_id = $1
          AND f.data ->> $2 IS NOT NULL
          AND f.data ->> $2 ~ ''^-?[0-9]+\.?[0-9]*$''
     )
     SELECT gv AS group_val,
            count(*)::bigint AS n,
            min(v) AS min_val,
            max(v) AS max_val,
            avg(v) AS avg_val,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median_val,
            stddev_samp(v) AS stddev_val
       FROM g
      GROUP BY gv
      ORDER BY count(*) DESC', v_col
  ) USING p_dataset_id, p_value_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. Crosstab: axis sub × a scalar field (crosstab_counts analog) ───────
--    Returns generic (sub_val, field_val, cnt); the route maps sub onto the
--    row or column axis depending on which side the dimension was selected.
CREATE OR REPLACE FUNCTION taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_limit      int DEFAULT 50
)
RETURNS TABLE(sub_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_col text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col := 'axis_' || p_axis;
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS sub_val,
            COALESCE(f.data ->> $2, '''')::text AS field_val,
            count(*)::bigint AS cnt
       FROM dataset_row_taxonomy t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1
      GROUP BY sub, f.data ->> $2
      ORDER BY count(*) DESC
      LIMIT $3', v_col
  ) USING p_dataset_id, p_field, p_limit * p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
