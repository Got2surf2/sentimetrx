-- sql/107_numeric_stats_present.sql
-- numeric_field_stats restricted to rows where a second field is non-empty.
-- Used by the TextMine metric strip's "avg rating": it must average over the
-- SAME population the strip counts as "records" — the rows that carry the
-- theme-source text (the analyzed reviews) — not every rated row. On review
-- datasets the text-less rows are mostly silent 5-stars that pull the plain
-- average above what the per-theme / per-dimension ratings actually reflect
-- (e.g. Cheddar's: all rated rows ★4.14 vs text-bearing rows ★3.90).
-- Read-only, additive.

CREATE OR REPLACE FUNCTION numeric_field_stats_present(
  p_dataset_id   uuid,
  p_field_key    text,
  p_present_field text
)
RETURNS TABLE(
  n           bigint,
  min_val     double precision,
  max_val     double precision,
  avg_val     double precision,
  median_val  double precision,
  stddev_val  double precision
) AS $$
BEGIN
  RETURN QUERY
  WITH v AS (
    SELECT (data ->> p_field_key)::double precision AS x
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
      AND COALESCE(btrim(data ->> p_present_field), '') <> ''
  )
  SELECT
    count(*)::bigint AS n,
    min(x) AS min_val,
    max(x) AS max_val,
    avg(x) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY x) AS median_val,
    stddev_samp(x) AS stddev_val
  FROM v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
