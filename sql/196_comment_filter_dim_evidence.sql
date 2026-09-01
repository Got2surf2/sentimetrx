-- 196: get_rows_by_filters returns the matched dimension EVIDENCE per row.
--
-- The unified Comments filter (sql/113) strips `_tx` from returned rows, so a
-- dimension-filtered comment list had NOTHING to highlight — themes highlight
-- their keywords, entities their aliases, dimensions nothing (owner-reported
-- inconsistency, 2026-09-02). The classifier's evidence windows are the text
-- the tag actually hooked, so each row now carries `dim_evidence`: the DISTINCT
-- evidence strings of assertions matching the ACTIVE dimension filters, from
-- the same primary-field `_tx` block the filter itself matched against. The
-- client highlights those spans (locating them inside the full comment — never
-- quoting a window out of context, per the fixed-width-window rule).
--
-- Return type changes (new column) → DROP + CREATE, and per the sql/190
-- lockdown doctrine the REVOKE block is mandatory: a recreated SECURITY
-- DEFINER function re-opens PUBLIC/anon EXECUTE by default.

BEGIN;

DROP FUNCTION IF EXISTS public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], text[], boolean, integer, integer);

CREATE FUNCTION public.get_rows_by_filters(
  p_dataset_ids     uuid[],
  p_text_fields     jsonb,
  p_theme_query     text     DEFAULT NULL,
  p_entity_query    text     DEFAULT NULL,
  p_sub_touchpoint  text[]   DEFAULT NULL,
  p_sub_attribute   text[]   DEFAULT NULL,
  p_sub_product     text[]   DEFAULT NULL,
  p_sub_beverage    text[]   DEFAULT NULL,
  p_sub_ambiance    text[]   DEFAULT NULL,
  p_sub_context     text[]   DEFAULT NULL,
  p_sub_outcome     text[]   DEFAULT NULL,
  p_sub_emotion     text[]   DEFAULT NULL,
  p_has_dim         boolean  DEFAULT false,
  p_limit           integer  DEFAULT 200,
  p_offset          integer  DEFAULT 0
) RETURNS TABLE(id bigint, dataset_id uuid, row_index integer, data jsonb, dim_evidence text[], total_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_fields jsonb := '{}'::jsonb;  -- dataset_id -> primary field key
  v_ds uuid;
  v_f  text;
BEGIN
  IF p_has_dim THEN
    FOREACH v_ds IN ARRAY p_dataset_ids LOOP
      v_f := taxonomy_primary_field(v_ds);
      IF v_f IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object(v_ds::text, v_f);
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
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
      AND (
        NOT p_has_dim
        OR (
          v_fields ? r.dataset_id::text
          AND (
            (p_sub_touchpoint IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'touchpoint') ?| p_sub_touchpoint) OR
            (p_sub_attribute  IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'attribute')  ?| p_sub_attribute)  OR
            (p_sub_product    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'product')    ?| p_sub_product)    OR
            (p_sub_beverage   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'beverage')   ?| p_sub_beverage)   OR
            (p_sub_ambiance   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'ambiance')   ?| p_sub_ambiance)   OR
            (p_sub_context    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'context')    ?| p_sub_context)    OR
            (p_sub_outcome    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'outcome')    ?| p_sub_outcome)    OR
            (p_sub_emotion    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'emotion')    ?| p_sub_emotion)
          )
        )
      )
  )
  SELECT m.id, m.dataset_id, m.row_index, m.data - '_tx',
    CASE WHEN p_has_dim AND v_fields ? m.dataset_id::text THEN (
      SELECT array_agg(DISTINCT btrim(a ->> 'evidence'))
      FROM jsonb_array_elements(COALESCE(m.data -> '_tx' -> 'f' -> (v_fields ->> m.dataset_id::text) -> 'as', '[]'::jsonb)) AS a
      WHERE btrim(COALESCE(a ->> 'evidence', '')) <> ''
        AND (
          ((a ->> 'axis') = 'touchpoint' AND p_sub_touchpoint IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_touchpoint)) OR
          ((a ->> 'axis') = 'attribute'  AND p_sub_attribute  IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_attribute))  OR
          ((a ->> 'axis') = 'product'    AND p_sub_product    IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_product))    OR
          ((a ->> 'axis') = 'beverage'   AND p_sub_beverage   IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_beverage))   OR
          ((a ->> 'axis') = 'ambiance'   AND p_sub_ambiance   IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_ambiance))   OR
          ((a ->> 'axis') = 'context'    AND p_sub_context    IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_context))    OR
          ((a ->> 'axis') = 'outcome'    AND p_sub_outcome    IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_outcome))    OR
          ((a ->> 'axis') = 'emotion'    AND p_sub_emotion    IS NOT NULL AND (a ->> 'sub') = ANY(p_sub_emotion))
        )
    ) END AS dim_evidence,
    count(*) OVER() AS total_count
  FROM matched m
  ORDER BY m.row_index
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], text[], boolean, integer, integer) IS
  'Unified Comments filter (sql/113, evidence added sql/196): rows matching themes AND entities AND dimension tags. dim_evidence = the matched assertions'' distinct evidence strings from the primary-field _tx block (NULL when no dimension filter), so the client can highlight what the tag hooked. _tx itself stays stripped from data.';

-- sql/190 lockdown doctrine: a (re)created SECURITY DEFINER function re-opens
-- PUBLIC EXECUTE by default. Service-role only.
REVOKE ALL ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], text[], boolean, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], text[], boolean, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], text[], boolean, integer, integer) TO service_role;

COMMIT;
