-- sql/106_taxonomy_aggregates_v2.sql
-- Extends the taxonomy ("Dimensions") aggregation layer (sql/105) so more chart
-- types can group by a dimension axis:
--   1. taxonomy_group_stats gains q1_val/q3_val (quartiles) — lets the
--      Distribution chart render a precomputed box plot per sub (server-side,
--      since raw per-row values aren't shipped to the client).
--   2. taxonomy_date_series — new: dimension × time (one count/avg per sub per
--      time bucket), for the Time Series chart's "break down by" slot.
-- Read-only, additive. Same axis-whitelist + org-gated-by-route guarantees as 105.

-- ── 1. group_stats + quartiles ────────────────────────────────────────────
-- OUT columns change, so the function must be dropped before recreate.
DROP FUNCTION IF EXISTS taxonomy_group_stats(uuid, text, text);

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
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY v) AS median_val,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS q1_val,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS q3_val,
            stddev_samp(v) AS stddev_val
       FROM g
      GROUP BY gv
      ORDER BY count(*) DESC', v_col
  ) USING p_dataset_id, p_value_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 2. date_series per axis sub (dimension × time) ────────────────────────
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
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_col := 'axis_' || p_axis;
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
       FROM dataset_row_taxonomy t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1
        AND f.data ->> $2 IS NOT NULL
        AND (f.data ->> $2) ~ ''^\d{4}-\d{2}-\d{2}''
      GROUP BY sub, bucket_date
      ORDER BY sub, bucket_date', v_col
  ) USING p_dataset_id, p_date_field, p_bucket, p_metric_field;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
