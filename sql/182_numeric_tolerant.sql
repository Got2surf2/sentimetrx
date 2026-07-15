-- 182_numeric_tolerant.sql
-- Align the SQL numeric filter with the field-type classifier.
--
-- The classifier (lib/datasetUtils.ts:185-188) types a field 'numeric' when
-- every value passes `!isNaN(Number(v.trim()))`. That accepts whitespace-padded
-- values (" 5"), a leading-dot decimal (".5"), scientific notation ("1e3"), and
-- a trailing dot ("5."). But the aggregate RPCs (sql/169) filtered values with
-- the STRICTER regex `^-?[0-9]+\.?[0-9]*$` on the UNTRIMMED string, which rejects
-- every one of those. Net effect: a field the UI accepts into the numeric VALUE
-- slot (e.g. a "Rating" column whose cells carry a stray leading space) produces
-- ZERO surviving rows in group_numeric_stats → the Charts "Average" bar renders
-- "No groups found." and Statistics/Distribution of the same field show blank.
--
-- Fix: centralize numeric detection in two IMMUTABLE helpers that mirror the
-- classifier's `Number(btrim(v))` semantics — btrim + a tolerant pattern that
-- accepts leading-dot / trailing-dot / scientific forms — and route every value
-- filter + cast in the exact RPCs and their sampled twins through them. Values
-- that are genuinely non-numeric ("1,000", "4/5", "4 stars") still fail both the
-- classifier (Number→NaN) and these helpers, so nothing spurious is admitted.
--
-- Signatures are unchanged, so CREATE OR REPLACE preserves the service_role
-- grants installed by sql/169. Date and categorical filters are untouched.

-- ── helpers: single source of truth for "is this text a number" ──────────────
CREATE OR REPLACE FUNCTION drf_numeric_ok(t text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT t IS NOT NULL
     AND btrim(t) ~ '^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$'
$$;

CREATE OR REPLACE FUNCTION drf_to_numeric(t text)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT btrim(t)::double precision
$$;

-- ============================================================
-- (A) Exact RPCs — recreated with the tolerant numeric filter.
-- ============================================================

-- group_numeric_stats ---------------------------------------------------------
CREATE OR REPLACE FUNCTION group_numeric_stats(
  p_dataset_id uuid,
  p_group_field text,
  p_value_field text,
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS TABLE(
  group_val text,
  n bigint,
  min_val double precision,
  max_val double precision,
  avg_val double precision,
  median_val double precision,
  stddev_val double precision
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      COALESCE(data ->> p_group_field, '')::text AS gv,
      drf_to_numeric(data ->> p_value_field) AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND drf_numeric_ok(data ->> p_value_field)
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
$$;

-- numeric_field_stats ---------------------------------------------------------
CREATE OR REPLACE FUNCTION numeric_field_stats(
  p_dataset_id uuid,
  p_field_key text,
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS TABLE(
  n bigint,
  min_val double precision,
  max_val double precision,
  avg_val double precision,
  median_val double precision,
  stddev_val double precision
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    stddev_samp(v) AS stddev_val
  FROM nums;
END;
$$;

-- date_series_stats (metric filter only) --------------------------------------
CREATE OR REPLACE FUNCTION date_series_stats(
  p_dataset_id uuid,
  p_date_field text,
  p_metric_field text DEFAULT NULL,
  p_bucket text DEFAULT 'day',
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS TABLE(
  bucket_date text,
  n bigint,
  avg_val double precision
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_bucket
      WHEN 'week' THEN to_char(date_trunc('week', (data ->> p_date_field)::date), 'YYYY-MM-DD')
      WHEN 'month' THEN to_char(date_trunc('month', (data ->> p_date_field)::date), 'YYYY-MM')
      WHEN 'quarter' THEN to_char(date_trunc('quarter', (data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (data ->> p_date_field)::date))::text
      WHEN 'year' THEN to_char(date_trunc('year', (data ->> p_date_field)::date), 'YYYY')
      ELSE to_char((data ->> p_date_field)::date, 'YYYY-MM-DD')
    END AS bucket_date,
    count(*)::bigint AS n,
    CASE
      WHEN p_metric_field IS NOT NULL AND p_metric_field != '' THEN
        avg(drf_to_numeric(data ->> p_metric_field)) FILTER (WHERE drf_numeric_ok(data ->> p_metric_field))
      ELSE NULL
    END AS avg_val
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_date_field IS NOT NULL
    AND data ->> p_date_field != ''
    AND (data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
  GROUP BY bucket_date
  ORDER BY bucket_date;
END;
$$;

-- ============================================================
-- (B) Sampled twins — same tolerant filter so the >50K path agrees
--     value-for-value with the exact path and the client 50K sample.
-- ============================================================

-- sampled_group_numeric_stats -------------------------------------------------
CREATE OR REPLACE FUNCTION sampled_group_numeric_stats(
  p_dataset_id  uuid,
  p_group_field text,
  p_value_field text,
  p_after_hash  bigint,
  p_after_id    bigint,
  p_limit       int,
  p_row_ids     bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  v AS (
    SELECT COALESCE(data ->> p_group_field, '')::text AS g,
           drf_to_numeric(data ->> p_value_field) AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND drf_numeric_ok(data ->> p_value_field)
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(jsonb_build_array(g, x)) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- sampled_date_series_stats (metric filter only) ------------------------------
CREATE OR REPLACE FUNCTION sampled_date_series_stats(
  p_dataset_id   uuid,
  p_date_field   text,
  p_metric_field text,
  p_bucket       text,
  p_after_hash   bigint,
  p_after_id     bigint,
  p_limit        int,
  p_row_ids      bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  b AS (
    SELECT
      CASE p_bucket
        WHEN 'week'    THEN to_char(date_trunc('week',    (data ->> p_date_field)::date), 'YYYY-MM-DD')
        WHEN 'month'   THEN to_char(date_trunc('month',   (data ->> p_date_field)::date), 'YYYY-MM')
        WHEN 'quarter' THEN to_char(date_trunc('quarter', (data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (data ->> p_date_field)::date))::text
        WHEN 'year'    THEN to_char(date_trunc('year',    (data ->> p_date_field)::date), 'YYYY')
        ELSE to_char((data ->> p_date_field)::date, 'YYYY-MM-DD')
      END AS bkt,
      count(*)::bigint AS n,
      sum(drf_to_numeric(data ->> p_metric_field))
        FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND drf_numeric_ok(data ->> p_metric_field)) AS msum,
      count(*) FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND drf_numeric_ok(data ->> p_metric_field))::bigint AS mn
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_date_field IS NOT NULL
      AND data ->> p_date_field != ''
      AND (data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'buckets',   COALESCE((SELECT jsonb_agg(jsonb_build_array(bkt, n, msum, mn)) FROM b), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- sampled_numeric_field_values ------------------------------------------------
CREATE OR REPLACE FUNCTION sampled_numeric_field_values(
  p_dataset_id uuid,
  p_field_key  text,
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  v AS (
    SELECT drf_to_numeric(data ->> p_field_key) AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND drf_numeric_ok(data ->> p_field_key)
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(x) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- helpers are internal; execute grant to service_role for parity with callers
GRANT EXECUTE ON FUNCTION drf_numeric_ok(text)  TO service_role;
GRANT EXECUTE ON FUNCTION drf_to_numeric(text)  TO service_role;
