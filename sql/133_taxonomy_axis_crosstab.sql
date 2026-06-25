-- 133_taxonomy_axis_crosstab.sql
-- Top-level (axis × scalar field) crosstab for the Dimension Compare view.
--
-- WHY: Dimension Compare defaulted to picking ONE axis (e.g. Product) and
-- comparing its level-2 sub-buckets (Steak, Chicken, …) across a field. Owner
-- wants a TOP-LEVEL default: compare all seven axes (Touchpoint, Attribute,
-- Product, …) against the field first, then drill into a single axis for its
-- subs. `taxonomy_crosstab` (sql/116) only does sub-level; this is its axis-level
-- sibling — one scan, UNION over the seven axes, returning the same shape but
-- with the axis name as the row key.
--
-- Counting semantics mirror `taxonomy_crosstab`: cnt = total sub-mentions in the
-- axis (count(*) over unnest of that axis's array), grouped by field value. So
-- an axis's total here equals the sum of its subs' totals in the sub-level
-- crosstab — the two levels reconcile exactly.

BEGIN;

DROP FUNCTION IF EXISTS taxonomy_axis_crosstab(uuid, text, bigint[]);

CREATE FUNCTION taxonomy_axis_crosstab(
  p_dataset_id uuid,
  p_field      text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(axis_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_field text; v_table text; v_cond text;
  v_axes  text[] := ARRAY['touchpoint','attribute','product','beverage','ambiance','context','outcome'];
  v_axis  text;
  v_union text := '';
BEGIN
  -- Same field/table resolution as taxonomy_crosstab: prefer the per-field
  -- taxonomy table scoped to the dataset's primary classified field, else the
  -- legacy whole-row table.
  v_field := taxonomy_primary_field(p_dataset_id);
  v_table := CASE WHEN v_field IS NOT NULL THEN 'dataset_row_field_taxonomy' ELSE 'dataset_row_taxonomy' END;
  v_cond  := CASE WHEN v_field IS NOT NULL THEN format(' AND t.field = %L', v_field) ELSE '' END;

  FOREACH v_axis IN ARRAY v_axes LOOP
    v_union := v_union
      || CASE WHEN v_union = '' THEN '' ELSE ' UNION ALL ' END
      || format(
           'SELECT %L::text AS axis_val,
                   COALESCE(f.data ->> $2, '''')::text AS field_val,
                   count(*)::bigint AS cnt
              FROM %I t
              JOIN dataset_rows_flat f
                ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
                   unnest(t.%I) AS sub
             WHERE t.dataset_id = $1 %s
               AND ($3 IS NULL OR t.row_id = ANY($3))
             GROUP BY f.data ->> $2',
           v_axis, v_table, 'axis_' || v_axis, v_cond
         );
  END LOOP;

  RETURN QUERY EXECUTE v_union USING p_dataset_id, p_field, p_row_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
