-- sql/113_get_rows_by_filters.sql
-- Combined Comments filter: return the rows matching ALL active facets
-- (theme keywords AND entity terms AND dimension tags) across a dataset's
-- comment scope. Powers the unified entity + dimension + theme filter bar in
-- the TextMine Comments tab.
--
-- Faceting semantics: AND *across* facets, OR *within* a facet. Theme/entity
-- matching reuses the same FTS prefilter + open-ended recheck as
-- get_rows_by_entity (sql/070) so counts/rows reconcile with the entity drill;
-- the theme and entity queries are independent websearch_to_tsquery strings
-- (OR of the selected themes' keywords / the selected entities' terms).
-- Dimension matching is an array-overlap test against the stored
-- dataset_row_taxonomy axis_<a> tags — one text[] of selected subs per axis,
-- OR'd across axes (an empty/NULL axis array contributes nothing).
--
-- Read-only, additive, SECURITY DEFINER. Org access is enforced by the
-- /comments route BEFORE this is called (it pairs dataset_id with org_id and
-- resolves the scope's member dataset ids).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_rows_by_filters(
  p_dataset_ids    uuid[],
  p_text_fields    jsonb,
  p_theme_query    text    DEFAULT NULL,
  p_entity_query   text    DEFAULT NULL,
  p_sub_touchpoint text[]  DEFAULT NULL,
  p_sub_attribute  text[]  DEFAULT NULL,
  p_sub_product    text[]  DEFAULT NULL,
  p_sub_beverage   text[]  DEFAULT NULL,
  p_sub_ambiance   text[]  DEFAULT NULL,
  p_sub_context    text[]  DEFAULT NULL,
  p_sub_outcome    text[]  DEFAULT NULL,
  p_has_dim        boolean DEFAULT false,
  p_limit          int     DEFAULT 200,
  p_offset         int     DEFAULT 0
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
      -- Theme facet: FTS prefilter on the GIN-indexed tsv + an open-ended
      -- recheck (so a keyword in a structured column doesn't match).
      AND (
        p_theme_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_theme_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_theme_query)
          )
        )
      )
      -- Entity facet: same prefilter + open-ended recheck, independent query.
      AND (
        p_entity_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_entity_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_entity_query)
          )
        )
      )
      -- Dimension facet: row carries a taxonomy tag overlapping any selected
      -- sub on any axis. axis_<a> && selected_subs is TRUE only when both are
      -- non-empty, so unselected axes never match.
      AND (
        NOT p_has_dim
        OR EXISTS (
          SELECT 1 FROM public.dataset_row_taxonomy t
          WHERE t.dataset_id = r.dataset_id
            AND t.row_id = r.id
            AND (
              (p_sub_touchpoint IS NOT NULL AND t.axis_touchpoint && p_sub_touchpoint) OR
              (p_sub_attribute  IS NOT NULL AND t.axis_attribute  && p_sub_attribute)  OR
              (p_sub_product    IS NOT NULL AND t.axis_product    && p_sub_product)    OR
              (p_sub_beverage   IS NOT NULL AND t.axis_beverage   && p_sub_beverage)   OR
              (p_sub_ambiance   IS NOT NULL AND t.axis_ambiance   && p_sub_ambiance)   OR
              (p_sub_context    IS NOT NULL AND t.axis_context    && p_sub_context)    OR
              (p_sub_outcome    IS NOT NULL AND t.axis_outcome    && p_sub_outcome)
            )
        )
      )
  )
  SELECT id, dataset_id, row_index, data, count(*) OVER() AS total_count
  FROM matched
  ORDER BY row_index
  LIMIT p_limit
  OFFSET p_offset;
$$;

COMMENT ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], boolean, int, int) IS
  'Comments matching ALL active facets (theme keywords AND entity terms AND dimension tags), OR within each facet. Theme/entity reuse the get_rows_by_entity FTS prefilter + open-ended recheck; dimension is an axis array-overlap on dataset_row_taxonomy. total_count is the window count for pagination.';

GRANT EXECUTE ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], boolean, int, int) TO service_role;

COMMIT;

-- Verify
SELECT 'get_rows_by_filters' AS object,
       CASE WHEN to_regprocedure('public.get_rows_by_filters(uuid[],jsonb,text,text,text[],text[],text[],text[],text[],text[],text[],boolean,int,int)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END AS status;
