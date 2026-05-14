-- sql/070_entity_open_ended_match.sql
-- Entity bug fix: restrict full-text entity matching to open-ended fields.
--
-- dataset_rows_flat.tsv (031) is built from EVERY string value in data —
-- including structured columns like `location`. So an entity that is also a
-- location label ("Tampa") matched every review *located* in Tampa (780 rows
-- for Fleming's), not the reviews that actually *mention* Tampa in their prose
-- (46 rows). count_entity_terms and the rows-by-entity drill-down both rode
-- the global tsv, so counts were inflated and drill-down returned reviews with
-- no textual connection to the entity.
--
-- Fix: the GIN-indexed tsv stays the fast prefilter (an open-ended-only match
-- is always a subset of the full-row match), then an exact recheck rebuilds a
-- tsvector from only the caller-supplied open-ended field keys and re-applies
-- the query. Real entities ("Filet Mignon", only ever in prose) are unchanged;
-- structured-column false matches are dropped.
--
-- p_text_fields: jsonb map { "<dataset_id>": ["review_text", ...] }, the
-- entity-eligible open-ended fields per dataset (lib/entityFilter.ts builds
-- it from schema_config). NULL = legacy behaviour (match the full tsv) so the
-- function stays safe to call from un-updated code.

-- ── count_entity_terms — drop the 3-arg form, recreate with p_text_fields ───
-- Can't CREATE OR REPLACE into a new arg list: a 3-arg call would then be
-- ambiguous between the old function and the new one's default. Drop first.
DROP FUNCTION IF EXISTS public.count_entity_terms(uuid[], text[], text);

CREATE OR REPLACE FUNCTION public.count_entity_terms(
  p_dataset_ids  uuid[],
  p_terms        text[],
  p_theme_query  text  DEFAULT NULL,
  p_text_fields  jsonb DEFAULT NULL
)
RETURNS TABLE(term text, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.term,
    count(r.id) AS row_count
  FROM unnest(p_terms) AS t(term)
  LEFT JOIN public.dataset_rows_flat r
    ON  r.dataset_id = ANY(p_dataset_ids)
    AND r.tsv @@ websearch_to_tsquery('english', t.term)          -- GIN-indexed prefilter
    AND (
      p_text_fields IS NULL
      OR to_tsvector('english', COALESCE(
           (SELECT string_agg(r.data ->> fld, ' ')
              FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
           '')
         ) @@ websearch_to_tsquery('english', t.term)            -- exact recheck: open-ended fields only
    )
    AND (
      p_theme_query IS NULL
      OR r.tsv @@ websearch_to_tsquery('english', p_theme_query)  -- theme keywords stay on the full row
    )
  GROUP BY t.term;
$$;

COMMENT ON FUNCTION public.count_entity_terms(uuid[], text[], text, jsonb) IS
  'Live full-text row counts for entity catalog terms. tsv prefilter + exact recheck against p_text_fields (open-ended fields per dataset) so counts reflect reviews that mention an entity, not rows that merely carry it as a structured label. p_text_fields NULL = legacy full-tsv match.';

GRANT EXECUTE ON FUNCTION public.count_entity_terms(uuid[], text[], text, jsonb) TO service_role;

-- ── get_rows_by_entity — the drill-down read, same open-ended recheck ───────
-- Replaces the ad-hoc .textSearch('tsv', ...) the app ran against the global
-- tsv. count(*) OVER() carries the total so the caller still gets {rows,total}
-- in one round trip.
CREATE OR REPLACE FUNCTION public.get_rows_by_entity(
  p_dataset_ids  uuid[],
  p_query        text,
  p_text_fields  jsonb DEFAULT NULL,
  p_limit        int   DEFAULT 100,
  p_offset       int   DEFAULT 0
)
RETURNS TABLE(id bigint, dataset_id uuid, row_index int, data jsonb, total_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
      AND r.tsv @@ websearch_to_tsquery('english', p_query)        -- GIN-indexed prefilter
      AND (
        p_text_fields IS NULL
        OR to_tsvector('english', COALESCE(
             (SELECT string_agg(r.data ->> fld, ' ')
                FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
             '')
           ) @@ websearch_to_tsquery('english', p_query)          -- exact recheck: open-ended fields only
      )
  )
  SELECT id, dataset_id, row_index, data, count(*) OVER() AS total_count
  FROM matched
  ORDER BY row_index
  LIMIT p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_rows_by_entity(uuid[], text, jsonb, int, int) IS
  'Rows that mention one catalog entity across a scope. Same tsv-prefilter + open-ended recheck as count_entity_terms. total_count is the full match size (window count) for pagination.';

GRANT EXECUTE ON FUNCTION public.get_rows_by_entity(uuid[], text, jsonb, int, int) TO service_role;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'count_entity_terms(4-arg)' AS object,
       CASE WHEN to_regprocedure('public.count_entity_terms(uuid[],text[],text,jsonb)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'get_rows_by_entity' AS object,
       CASE WHEN to_regprocedure('public.get_rows_by_entity(uuid[],text,jsonb,int,int)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END AS status;
