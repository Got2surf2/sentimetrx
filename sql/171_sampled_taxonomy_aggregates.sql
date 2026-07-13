-- sql/171_sampled_taxonomy_aggregates.sql
-- Brief C PART 3 — taxonomy-family sampled twins (PERFORMANCE_REVIEW.md §7
-- fix-queue #4, deferred tail). The counts family (sql/169) and theme-counts
-- (sql/170) already have their sampled/filtered treatment; this closes the
-- last O(N) family on the /aggregate route: the five taxonomy_* RPCs
-- (taxonomy_sub_counts / group_stats / crosstab / date_series / axis_crosstab,
-- sql/164) unnest `data -> '_tx' -> 'f' -> <field> -> 'a'` over EVERY row and
-- 57014 at ~1M once a rollup is registered so taxonomy_field_or_primary
-- resolves a field (measured: taxonomy_sub_counts 8.1s at 1M — load-bearing).
--
-- Each gains a `sampled_taxonomy_*` twin that keyset-pages the deterministic
-- 50K sample (idx_drf_sample, sql/160) — the SAME sample the counts twins walk
-- (sql/169) and the metric strip counts over (sql/162/163) — so sampled
-- dimension charts agree with the client-side tiles. The caller
-- (lib/sampledTaxonomy.ts) pages to the cap, scales COUNTS by total/scanned and
-- reports UNSCALED sample statistics for means / medians / quartiles / stddev
-- (a uniform sample's mean/quantile is a direct estimate of the population
-- value — scaling them would be wrong).
--
-- Per-question resolution: each twin resolves its classified field via
-- taxonomy_field_or_primary(p_dataset_id, p_field_key) (sql/164) exactly like
-- the exact RPCs — the requested question when it has a stored rollup, else the
-- primary classified field — so the Charts/Stats source-field picker keeps
-- driving dimensions and the per-question work is not regressed. Resolved once
-- per page via a CTE cross-joined into the unnest; a NULL resolution (no
-- classified field) yields an empty unnest, matching the exact RPC's early
-- RETURN. Axis validation stays in the route (TAX_AXES) / the exact RPC — the
-- twins are pure LANGUAGE sql, same posture as the sql/169 counts twins.
--
-- p_row_ids narrows the NUMERATORS only (a filtered above-cap view whose
-- filtered ids are a subset of the 50K sample), never the page/denominator, so
-- filtered dimension charts scale correctly.
--
-- The keyset page CTE is byte-identical to sample_dataset_rows /
-- sampled_signal_counts / sql/169 (planner uses idx_drf_sample). MATERIALIZED
-- so the sample index is walked once per page, not once per downstream CTE.
--
-- SECURITY DEFINER over raw row data -> service_role only, same posture as the
-- exact taxonomy_* functions (sql/164) and the sql/160/162/163/169 sampled
-- family; routes enforce org access (getCallerOrgContext + dataset org check).

BEGIN;

-- 1. sampled_taxonomy_sub_counts — per-sub partial counts. ---------------------
CREATE OR REPLACE FUNCTION sampled_taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text,
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int,
  p_row_ids    bigint[] DEFAULT NULL,
  p_field_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
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
    SELECT sub::text AS v, count(*)::bigint AS n
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY sub
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(v, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 2. sampled_taxonomy_group_stats — raw (sub, value) pairs; the caller derives
--    n/min/max/mean/median/q1/q3/stddev per sub (percentiles can't be merged
--    across pages from partial aggregates, so values ride to Node).
CREATE OR REPLACE FUNCTION sampled_taxonomy_group_stats(
  p_dataset_id  uuid,
  p_axis        text,
  p_value_field text,
  p_after_hash  bigint,
  p_after_id    bigint,
  p_limit       int,
  p_row_ids     bigint[] DEFAULT NULL,
  p_field_key   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
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
    SELECT sub::text AS g,
           (page.data ->> p_value_field)::double precision AS x
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
      AND page.data ->> p_value_field IS NOT NULL
      AND page.data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(jsonb_build_array(g, x)) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 3. sampled_taxonomy_crosstab — per (sub, field_val) partial counts. ----------
CREATE OR REPLACE FUNCTION sampled_taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int,
  p_row_ids    bigint[] DEFAULT NULL,
  p_field_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
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
    SELECT sub::text AS s,
           COALESCE(page.data ->> p_field, '')::text AS fv,
           count(*)::bigint AS n
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(s, fv, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- 4. sampled_taxonomy_date_series — per (sub, bucket) count + metric sum/count
--    (avg is a mean, derived unscaled as sum/count; n scaled by the caller).
CREATE OR REPLACE FUNCTION sampled_taxonomy_date_series(
  p_dataset_id   uuid,
  p_axis         text,
  p_date_field   text,
  p_metric_field text,
  p_bucket       text,
  p_after_hash   bigint,
  p_after_id     bigint,
  p_limit        int,
  p_row_ids      bigint[] DEFAULT NULL,
  p_field_key    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $_$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
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
    SELECT sub::text AS s,
      CASE p_bucket
        WHEN 'week'    THEN to_char(date_trunc('week',    (page.data ->> p_date_field)::date), 'YYYY-MM-DD')
        WHEN 'month'   THEN to_char(date_trunc('month',   (page.data ->> p_date_field)::date), 'YYYY-MM')
        WHEN 'quarter' THEN to_char(date_trunc('quarter', (page.data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (page.data ->> p_date_field)::date))::text
        WHEN 'year'    THEN to_char(date_trunc('year',    (page.data ->> p_date_field)::date), 'YYYY')
        ELSE to_char((page.data ->> p_date_field)::date, 'YYYY-MM-DD')
      END AS bkt,
      count(*)::bigint AS n,
      sum((page.data ->> p_metric_field)::double precision)
        FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND page.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$') AS msum,
      count(*) FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND page.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')::bigint AS mn
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
      AND page.data ->> p_date_field IS NOT NULL
      AND (page.data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'buckets',   COALESCE((SELECT jsonb_agg(jsonb_build_array(s, bkt, n, msum, mn)) FROM b), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;

-- 5. sampled_taxonomy_axis_crosstab — per (axis, field_val) partial counts,
--    unnesting all axes (jsonb_each over the 'a' object). ----------------------
CREATE OR REPLACE FUNCTION sampled_taxonomy_axis_crosstab(
  p_dataset_id uuid,
  p_field      text,
  p_after_hash bigint,
  p_after_id   bigint,
  p_limit      int,
  p_row_ids    bigint[] DEFAULT NULL,
  p_field_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
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
    SELECT ax.key::text AS axv,
           COALESCE(page.data ->> p_field, '')::text AS fv,
           count(*)::bigint AS n
    FROM page, fld,
         jsonb_each(page.data -> '_tx' -> 'f' -> fld.f -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(axv, fv, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

-- ── grants: sampled taxonomy twins → service_role only ───────────────────────
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'sampled_taxonomy_sub_counts(uuid, text, bigint, bigint, int, bigint[], text)',
    'sampled_taxonomy_group_stats(uuid, text, text, bigint, bigint, int, bigint[], text)',
    'sampled_taxonomy_crosstab(uuid, text, text, bigint, bigint, int, bigint[], text)',
    'sampled_taxonomy_date_series(uuid, text, text, text, text, bigint, bigint, int, bigint[], text)',
    'sampled_taxonomy_axis_crosstab(uuid, text, bigint, bigint, int, bigint[], text)'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
