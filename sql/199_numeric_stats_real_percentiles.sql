-- sql/199: numeric_field_stats returns REAL p25/p75.
--
-- The analytics snapshot's SQL path (lib/analyticsCompute summarizeField)
-- stored p25 = median = p75 for every numeric field because this function
-- only computed percentile_cont(0.5) and the TS caller copied median_val into
-- both quartiles ("approximate"). Found via ea_football's degenerate stored
-- percentiles (2026-09-02, Data Story bands had to recompute quartiles from
-- rows to route around it). Same WITHIN GROUP pass now yields all three.
--
-- Return-shape change requires DROP + CREATE (extra OUT columns). Existing
-- callers read named fields (n / min_val / ... / median_val), so the two new
-- columns are inert for them; lib/analyticsCompute reads p25_val/p75_val with
-- a median fallback, so code deployed before this migration applies keeps
-- today's behavior (deploy-order safe in both directions).

BEGIN;

DROP FUNCTION IF EXISTS public.numeric_field_stats(uuid, text, bigint[]);

CREATE FUNCTION public.numeric_field_stats(
  p_dataset_id uuid,
  p_field_key text,
  p_row_ids bigint[] DEFAULT NULL::bigint[]
) RETURNS TABLE(
  n bigint,
  min_val double precision,
  max_val double precision,
  avg_val double precision,
  median_val double precision,
  stddev_val double precision,
  p25_val double precision,
  p75_val double precision
)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH nums AS (
    SELECT drf_to_numeric(data ->> p_field_key) AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND drf_numeric_ok(data ->> p_field_key)
  )
  SELECT
    count(*)::bigint AS n,
    min(v) AS min_val,
    max(v) AS max_val,
    avg(v) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median_val,
    stddev_samp(v) AS stddev_val,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS p25_val,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS p75_val
  FROM nums;
END;
$$;

ALTER FUNCTION public.numeric_field_stats(uuid, text, bigint[]) OWNER TO postgres;

-- sql/190 lockdown: SECURITY DEFINER functions re-open to anon/authenticated
-- by DEFAULT on every CREATE — the REVOKE block is mandatory.
REVOKE ALL ON FUNCTION public.numeric_field_stats(uuid, text, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.numeric_field_stats(uuid, text, bigint[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.numeric_field_stats(uuid, text, bigint[]) TO service_role;

COMMIT;
