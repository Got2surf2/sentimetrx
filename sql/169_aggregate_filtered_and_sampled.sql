-- sql/169_aggregate_filtered_and_sampled.sql
-- Brief C (counts family) — PERFORMANCE_REVIEW.md §7 fix-queue #4, folding in
-- the Brief F escalation (#1). Two concerns, one migration, one RPC family:
--
--  (A) FILTER-AWARENESS (Brief F escalation #1): the five scalar /aggregate
--      ops — crosstab_counts, group_numeric_stats, date_series_stats,
--      count_field_values, numeric_field_stats — took NO row-id/filter param,
--      so Charts rendered full-dataset numbers under a filtered UI (the
--      taxonomy family already honors filters via p_row_ids). Each gains
--      `p_row_ids bigint[] DEFAULT NULL` with the exact predicate the tax
--      family uses: `(p_row_ids IS NULL OR id = ANY(p_row_ids))`. Signature
--      change → DROP then CREATE (CREATE OR REPLACE cannot add an arg; a bare
--      overload would be ambiguous for PostgREST — same reasoning as sql/164).
--      DEFAULT NULL keeps every existing caller (signal-stats, analyticsCompute,
--      taxonomyRollup, filter-options legacy) byte-for-byte unchanged, and is
--      deploy-order safe: pre-migration code omits the arg; new code that sends
--      it to an un-migrated DB gets PGRST202 and the route drops it.
--
--  (B) SCALE (fix-queue #4): every one of those RPCs is an O(N) full jsonb
--      scan and 57014s at ~1M rows (measured, §2). Each gains a `sampled_*`
--      twin that keyset-pages the deterministic 50K sample (idx_drf_sample,
--      sql/160) — the SAME sample the bulk rows route serves and the metric
--      strip counts over (sql/162/163), so sampled charts agree with the
--      client-side tiles. Each page stays far under the 8s statement timeout;
--      the caller (lib/sampledAggregate.ts) pages to the cap, scales COUNTS by
--      total/scanned, and reports UNSCALED sample statistics for means /
--      medians / stddev (a uniform sample's mean/quantile is a direct estimate
--      of the population value — scaling them would be wrong). The twins ALSO
--      take p_row_ids so a filtered view of an above-cap dataset (the client's
--      filtered row-ids are themselves a subset of the 50K sample) is counted
--      over the sample walk with the denominator intact — the id filter narrows
--      the numerators, never the page/denominator.
--
-- Value predicates in every twin are byte-identical to the exact function so
-- sampled and exact paths accept the same rows; the keyset page CTE is
-- byte-identical to sample_dataset_rows / sampled_signal_counts so the planner
-- uses idx_drf_sample.
--
-- SECURITY DEFINER over raw row data -> service_role only, same posture as the
-- exact functions and the sql/160/162/163 sampled family; routes enforce org
-- access (getCallerOrgContext + dataset org check).

BEGIN;

-- ============================================================
-- (A) Exact scalar RPCs gain p_row_ids (filter-awareness)
-- ============================================================

-- 1. crosstab_counts ----------------------------------------------------------
DROP FUNCTION IF EXISTS crosstab_counts(uuid, text, text, int);
CREATE FUNCTION crosstab_counts(
  p_dataset_id uuid,
  p_row_field text,
  p_col_field text,
  p_limit int DEFAULT 50,
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS TABLE(row_val text, col_val text, cnt bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(data ->> p_row_field, '')::text AS row_val,
    COALESCE(data ->> p_col_field, '')::text AS col_val,
    count(*)::bigint AS cnt
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_row_field IS NOT NULL
    AND data ->> p_row_field != ''
  GROUP BY data ->> p_row_field, data ->> p_col_field
  ORDER BY cnt DESC
  LIMIT p_limit * p_limit;
END;
$$;

-- 2. group_numeric_stats ------------------------------------------------------
DROP FUNCTION IF EXISTS group_numeric_stats(uuid, text, text);
CREATE FUNCTION group_numeric_stats(
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
      (data ->> p_value_field)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
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
$$;

-- 3. date_series_stats --------------------------------------------------------
DROP FUNCTION IF EXISTS date_series_stats(uuid, text, text, text);
CREATE FUNCTION date_series_stats(
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
        avg((data ->> p_metric_field)::double precision) FILTER (WHERE data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')
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

-- 4. count_field_values -------------------------------------------------------
DROP FUNCTION IF EXISTS count_field_values(uuid, text, int);
CREATE FUNCTION count_field_values(
  p_dataset_id uuid,
  p_field_key text,
  p_limit int DEFAULT 200,
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS TABLE(value text, count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT
    (data ->> p_field_key)::text AS value,
    count(*)::bigint AS count
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_field_key IS NOT NULL
    AND data ->> p_field_key != ''
  GROUP BY data ->> p_field_key
  ORDER BY count(*) DESC
  LIMIT p_limit;
END;
$$;

-- 5. numeric_field_stats ------------------------------------------------------
DROP FUNCTION IF EXISTS numeric_field_stats(uuid, text);
CREATE FUNCTION numeric_field_stats(
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
    SELECT (data ->> p_field_key)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
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

-- ============================================================
-- (B) Sampled twins — keyset page over idx_drf_sample.
-- Each returns ONE page as jsonb: n_scanned (page rows walked, the scaling
-- denominator), the op's partial aggregate, and the (last_hash,last_id) cursor.
-- The page CTE is byte-identical to sample_dataset_rows/sampled_signal_counts
-- (planner uses idx_drf_sample). MATERIALIZED so the sample index is walked
-- once per page, not once per downstream CTE.
--
-- p_row_ids narrows the NUMERATORS only (matched inside each aggregate CTE),
-- never the page/denominator — so a filtered above-cap view scales correctly
-- (filtered_pop ≈ filtered_sample_matches × total / sample_scanned).
-- ============================================================

-- 1. sampled_crosstab_counts --------------------------------------------------
CREATE OR REPLACE FUNCTION sampled_crosstab_counts(
  p_dataset_id uuid,
  p_row_field  text,
  p_col_field  text,
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
  g AS (
    SELECT COALESCE(data ->> p_row_field, '')::text AS r,
           COALESCE(data ->> p_col_field, '')::text AS c,
           count(*)::bigint AS n
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_row_field IS NOT NULL
      AND data ->> p_row_field != ''
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(r, c, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 2. sampled_group_numeric_stats — raw (group, value) pairs; the caller derives
--    n/min/max/mean/median/stddev per group (percentiles can't be merged across
--    pages from partial aggregates, so the values ride to Node). ~one row per
--    numeric-valued page row.
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
           (data ->> p_value_field)::double precision AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND data ->> p_value_field IS NOT NULL
      AND data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(jsonb_build_array(g, x)) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 3. sampled_date_series_stats — per-bucket count + metric sum/count (avg is a
--    mean, derived unscaled as sum/count; n is scaled by the caller).
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
      sum((data ->> p_metric_field)::double precision)
        FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$') AS msum,
      count(*) FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')::bigint AS mn
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

-- 4. sampled_count_field_values — per-value partial counts.
CREATE OR REPLACE FUNCTION sampled_count_field_values(
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
  g AS (
    SELECT (data ->> p_field_key)::text AS v, count(*)::bigint AS n
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key != ''
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(v, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 5. sampled_numeric_field_values — raw numeric values; the caller derives
--    n/min/max/mean/median/stddev over the sample (median/stddev can't be
--    merged from partial aggregates). Distinct from sampled_numeric_field_stats
--    (sql/163), which is the metric-strip avg-only twin (n/sum/min/max, aliases).
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
    SELECT (data ->> p_field_key)::double precision AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(x) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- ── grants: exact (recreated) + sampled twins → service_role only ────────────
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'crosstab_counts(uuid, text, text, int, bigint[])',
    'group_numeric_stats(uuid, text, text, bigint[])',
    'date_series_stats(uuid, text, text, text, bigint[])',
    'count_field_values(uuid, text, int, bigint[])',
    'numeric_field_stats(uuid, text, bigint[])',
    'sampled_crosstab_counts(uuid, text, text, bigint, bigint, int, bigint[])',
    'sampled_group_numeric_stats(uuid, text, text, bigint, bigint, int, bigint[])',
    'sampled_date_series_stats(uuid, text, text, text, bigint, bigint, int, bigint[])',
    'sampled_count_field_values(uuid, text, bigint, bigint, int, bigint[])',
    'sampled_numeric_field_values(uuid, text, bigint, bigint, int, bigint[])'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
