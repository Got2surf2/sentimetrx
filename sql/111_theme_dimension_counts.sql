-- sql/111_theme_dimension_counts.sql
-- Theme × Dimension cross-tab: for the rows that match a theme's keywords,
-- break down which Dimension sub-buckets (across all 7 axes) those reviews
-- carry. Powers the "Dimensions" chip row on TextMine theme cards — the
-- classification-side analog of the existing entity "Items mentioned" row.
--
-- Match logic mirrors count_theme_matches (regex \m(kw1|kw2|…) over the
-- chosen text field keys); the matched row ids then join dataset_row_taxonomy
-- and unnest the axis_<a> text[] arrays. A review tagged product=[steak,seafood]
-- contributes to BOTH subs — consistent with the Dimensions tab rollup.
--
-- Read-only, additive. Org access is enforced by the /theme-counts route BEFORE
-- this is called (it resolves dataset_id -> org-scoped via the service client and
-- the dataset belongs to one org); scoped to a single p_dataset_id.

BEGIN;

CREATE OR REPLACE FUNCTION theme_dimension_counts(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords   text[],
  p_limit      int DEFAULT 8
)
RETURNS TABLE(axis text, sub text, count bigint) AS $$
DECLARE
  pattern text;
BEGIN
  -- Single word-boundary, case-insensitive alternation, same as count_theme_matches.
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT drf.id
      FROM dataset_rows_flat drf,
           LATERAL unnest(p_field_keys) AS fk(key)
     WHERE drf.dataset_id = p_dataset_id
       AND drf.data ->> fk.key IS NOT NULL
       AND drf.data ->> fk.key != ''
       AND drf.data ->> fk.key ~* pattern
  ),
  tagged AS (
    SELECT t.axis_touchpoint, t.axis_attribute, t.axis_product, t.axis_beverage,
           t.axis_ambiance, t.axis_context, t.axis_outcome
      FROM dataset_row_taxonomy t
      JOIN matched m ON m.id = t.row_id
     WHERE t.dataset_id = p_dataset_id
  ),
  expanded AS (
    SELECT 'touchpoint'::text AS ax, s::text AS sb FROM tagged, unnest(axis_touchpoint) s
    UNION ALL SELECT 'attribute', s::text FROM tagged, unnest(axis_attribute) s
    UNION ALL SELECT 'product',   s::text FROM tagged, unnest(axis_product)   s
    UNION ALL SELECT 'beverage',  s::text FROM tagged, unnest(axis_beverage)  s
    UNION ALL SELECT 'ambiance',  s::text FROM tagged, unnest(axis_ambiance)  s
    UNION ALL SELECT 'context',   s::text FROM tagged, unnest(axis_context)   s
    UNION ALL SELECT 'outcome',   s::text FROM tagged, unnest(axis_outcome)   s
  )
  SELECT ax AS axis, sb AS sub, count(*)::bigint AS count
    FROM expanded
   GROUP BY ax, sb
   ORDER BY count(*) DESC
   LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
