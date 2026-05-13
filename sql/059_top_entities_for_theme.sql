-- sql/059_top_entities_for_theme.sql
-- Theme-filtered entity rollup. Takes a theme's keyword list and field
-- keys, finds rows matching the theme in any of those fields, then joins
-- to entity_mentions and aggregates by canonical entity.
--
-- Called by /api/datasets/[id]/entities?theme=<id> to drive the theme
-- card's "Top entities" section.

CREATE OR REPLACE FUNCTION top_entities_for_theme(
  p_dataset_id   uuid,
  p_field_keys   text[],
  p_keywords     text[],
  p_source_field text DEFAULT NULL,
  p_limit        int DEFAULT 50
)
RETURNS TABLE(
  canonical     text,
  category      text,
  mentions      bigint,
  distinct_rows bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pattern text;
BEGIN
  IF p_keywords IS NULL OR cardinality(p_keywords) = 0 THEN
    RETURN;
  END IF;
  v_pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  RETURN QUERY
  WITH row_combined AS (
    SELECT drf.id AS row_id,
           string_agg(coalesce(drf.data ->> k, ''), ' ') AS combined
    FROM dataset_rows_flat drf, unnest(p_field_keys) AS k
    WHERE drf.dataset_id = p_dataset_id
    GROUP BY drf.id
  ),
  matching_rows AS (
    SELECT row_id FROM row_combined WHERE combined ~* v_pattern
  )
  SELECT
    em.canonical,
    em.category,
    count(*)::bigint                  AS mentions,
    count(DISTINCT em.row_id)::bigint AS distinct_rows
  FROM entity_mentions em
  JOIN matching_rows mr ON mr.row_id = em.row_id
  WHERE em.dataset_id = p_dataset_id
    AND (p_source_field IS NULL OR em.source_field = p_source_field)
  GROUP BY em.canonical, em.category
  ORDER BY mentions DESC
  LIMIT p_limit;
END;
$$;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'top_entities_for_theme' AS func, 'ready' AS status;
