-- Phase 5: Server-side aggregation functions for charts
-- Run in Supabase SQL Editor after phase4_flat_rows.sql

-- ============================================================
-- 1. Crosstab counts (bar with colorBy, crosstab chart)
-- ============================================================
CREATE OR REPLACE FUNCTION crosstab_counts(
  p_dataset_id uuid,
  p_row_field text,
  p_col_field text,
  p_limit int DEFAULT 50
)
RETURNS TABLE(row_val text, col_val text, cnt bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(data ->> p_row_field, '')::text AS row_val,
    COALESCE(data ->> p_col_field, '')::text AS col_val,
    count(*)::bigint AS cnt
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND data ->> p_row_field IS NOT NULL
    AND data ->> p_row_field != ''
  GROUP BY data ->> p_row_field, data ->> p_col_field
  ORDER BY cnt DESC
  LIMIT p_limit * p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Group-by numeric stats (bullet split, dist split, gantt)
-- ============================================================
CREATE OR REPLACE FUNCTION group_numeric_stats(
  p_dataset_id uuid,
  p_group_field text,
  p_value_field text
)
RETURNS TABLE(
  group_val text,
  n bigint,
  min_val double precision,
  max_val double precision,
  avg_val double precision,
  median_val double precision,
  stddev_val double precision
) AS $$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      COALESCE(data ->> p_group_field, '')::text AS gv,
      (data ->> p_value_field)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND data ->> p_value_field IS NOT NULL
      AND data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT
    gv AS group_val,
    count(*)::bigint AS n,
    min(v) AS min_val,
    max(v) AS max_val,
    avg(v) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median_val,
    stddev_samp(v) AS stddev_val
  FROM grouped
  GROUP BY gv
  ORDER BY count(*) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Date-bucketed aggregation (timeseries chart)
-- ============================================================
CREATE OR REPLACE FUNCTION date_series_stats(
  p_dataset_id uuid,
  p_date_field text,
  p_metric_field text DEFAULT NULL,
  p_bucket text DEFAULT 'day'
)
RETURNS TABLE(
  bucket_date text,
  n bigint,
  avg_val double precision
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_bucket
      WHEN 'week' THEN to_char(date_trunc('week', (data ->> p_date_field)::date), 'YYYY-MM-DD')
      WHEN 'month' THEN to_char(date_trunc('month', (data ->> p_date_field)::date), 'YYYY-MM')
      ELSE to_char((data ->> p_date_field)::date, 'YYYY-MM-DD')
    END AS bucket_date,
    count(*)::bigint AS n,
    CASE
      WHEN p_metric_field IS NOT NULL AND p_metric_field != '' THEN
        avg((data ->> p_metric_field)::double precision)
      ELSE NULL
    END AS avg_val
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND data ->> p_date_field IS NOT NULL
    AND data ->> p_date_field != ''
    AND (data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
  GROUP BY bucket_date
  ORDER BY bucket_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Sampled row pairs (scatter chart)
-- ============================================================
CREATE OR REPLACE FUNCTION sample_row_pairs(
  p_dataset_id uuid,
  p_fields text[],
  p_limit int DEFAULT 10000
)
RETURNS TABLE(data jsonb) AS $$
BEGIN
  RETURN QUERY
  SELECT drf.data
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
  ORDER BY random()
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Done! Verify:
-- ============================================================
SELECT 'crosstab_counts' AS func, 'ready' AS status
UNION ALL SELECT 'group_numeric_stats', 'ready'
UNION ALL SELECT 'date_series_stats', 'ready'
UNION ALL SELECT 'sample_row_pairs', 'ready';
