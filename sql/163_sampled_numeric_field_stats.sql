-- sql/163_sampled_numeric_field_stats.sql
-- SAMPLED numeric field stats for datasets above the 50K sampling cap —
-- completes the metric strip's scale story (sql/162 fixed the counts; the
-- strip's ★ avg rating still came from numeric_field_stats /
-- field_aliased_avg, both FULL SCANS that blow the 8s statement timeout past
-- ~500K rows, so the rating silently vanished on large datasets).
--
-- Same design as sampled_signal_counts (sql/162): one keyset page over the
-- deterministic idx_drf_sample order (the SAME sample the bulk rows route
-- serves). Returns per-page n/sum/min/max so the caller pages under the
-- statement timeout and derives avg = sum/n. A uniform sample's mean is an
-- unbiased estimate of the all-rows mean, and the sample includes rating-only
-- rows — consistent with the "ratings = all reviews" principle; callers label
-- the result as sampled ("~" on the strip).
--
-- p_aliases: NULL = raw numeric cast (numeric_field_stats parity); non-NULL =
-- alias-mapped values (field_aliased_avg parity — remapped rating fields store
-- text labels like "Highly Satisfied" mapped to numbers via valueAliases).
-- Value predicates are byte-identical to those functions so sampled and exact
-- paths accept the same rows.
--
-- SECURITY DEFINER over raw row data -> service_role only, like sql/160/162.

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_numeric_field_stats(
  p_dataset_id  uuid,
  p_field       text,
  p_aliases     jsonb,     -- null = raw cast; else label->number map
  p_after_hash  bigint,    -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int        -- rows in this page
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
    SELECT CASE
      WHEN p_aliases IS NULL THEN
        CASE WHEN p.data ->> p_field ~ '^-?[0-9]+\.?[0-9]*$'
             THEN (p.data ->> p_field)::double precision END
      ELSE
        CASE WHEN (p_aliases ->> (p.data ->> p_field)) ~ '^-?[0-9]+\.?[0-9]*$'
             THEN (p_aliases ->> (p.data ->> p_field))::double precision END
    END AS x
    FROM page p
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'n',         (SELECT count(x) FROM v),
    'sum',       (SELECT sum(x)   FROM v),
    'min',       (SELECT min(x)   FROM v),
    'max',       (SELECT max(x)   FROM v),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_numeric_field_stats(uuid, text, jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED numeric field stats over the deterministic idx_drf_sample order (same sample as sample_dataset_rows). Returns {n_scanned, n, sum, min, max, last_hash, last_id}; callers page to the cap and derive avg = sum/n, labeled as sampled. Value predicates match numeric_field_stats (p_aliases null) / field_aliased_avg (p_aliases set) exactly. Used above the 50K cap where those full-scan aggregates exceed the 8s statement timeout (metric strip avg rating).';

REVOKE ALL ON FUNCTION public.sampled_numeric_field_stats(uuid, text, jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_numeric_field_stats(uuid, text, jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_numeric_field_stats(uuid, text, jsonb, bigint, bigint, int) TO service_role;

COMMIT;
