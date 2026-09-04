-- sql/200: subgroup (segment) matching in ONE SQL pass.
--
-- Ana's self-composed subgroups (`where` on query_data/read_comments)
-- resolved row-ids CLIENT-side: paged jsonb containment per categorical
-- value (64+ sequential round-trips for a 64K-row slice) plus a chunked
-- range narrow pulling row blobs. A 3-condition ANES subgroup took 5+
-- minutes and timed out (owner-hit 2026-09-04); the JS-side parallel-wave
-- rework got it to 33s — this pushes the whole filter into Postgres and
-- pages it by row_index, targeting a few seconds.
--
-- Semantics mirror lib/anaSegment.whereToFilters ≡ lib/filterUtils
-- applyFilters:
--   {field, values[]} — text equality against data->>field (blank never
--     matches; values come from count_field_values so they carry the
--     stored text rendering).
--   {field, min?/max?} — numeric range via the canonical drf_numeric_ok /
--     drf_to_numeric pair; non-numeric and blank rows are EXCLUDED, same
--     as the range filters' includeBlanks:false.
-- Conditions AND together. The caller (lib/anaSegment.resolveWhereRowIds)
-- pages this in concurrent waves and falls back to the JS scan path on
-- PGRST202, so an un-migrated database keeps working (deploy-order safe).

BEGIN;

-- Row-level predicate, split out for inlining and testability.
CREATE OR REPLACE FUNCTION public.segment_row_matches(p_data jsonb, p_conds jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(bool_and(
    CASE
      WHEN c ? 'values' THEN
        (p_data ->> (c->>'field')) = ANY (
          ARRAY(SELECT jsonb_array_elements_text(c->'values'))
        )
      ELSE
        drf_numeric_ok(p_data ->> (c->>'field'))
        AND (NOT c ? 'min' OR drf_to_numeric(p_data ->> (c->>'field')) >= (c->>'min')::numeric)
        AND (NOT c ? 'max' OR drf_to_numeric(p_data ->> (c->>'field')) <= (c->>'max')::numeric)
    END
  ), false)
  FROM jsonb_array_elements(p_conds) AS c;
$$;

-- One keyset page: scan p_limit rows of the dataset from p_after_row_index,
-- return the ids whose data matches every condition. Page shape mirrors the
-- sampled_*_blocks family (n_scanned / last_row_index cursor contract).
CREATE OR REPLACE FUNCTION public.segment_match_ids(
  p_dataset_id uuid,
  p_conds jsonb,
  p_after_row_index bigint DEFAULT -1,
  p_limit integer DEFAULT 20000
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.row_index, f.data
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND f.row_index > p_after_row_index
    ORDER BY f.row_index
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'last_row_index', (SELECT max(row_index) FROM page),
    'ids', COALESCE(
      (SELECT jsonb_agg(id ORDER BY id) FROM page WHERE segment_row_matches(data, p_conds)),
      '[]'::jsonb
    )
  );
$$;

ALTER FUNCTION public.segment_row_matches(jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) OWNER TO postgres;

-- sql/190 lockdown: SECURITY DEFINER functions re-open to anon/authenticated
-- by DEFAULT on every CREATE — the REVOKE block is mandatory.
REVOKE ALL ON FUNCTION public.segment_row_matches(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.segment_row_matches(jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_row_matches(jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) TO service_role;

COMMIT;
