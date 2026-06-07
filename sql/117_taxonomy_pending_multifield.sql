-- 117_taxonomy_pending_multifield.sql
--
-- Multi-field Dimensions: the Dimensions view can now analyze a SET of open-ended
-- fields at once (like Themes concatenates selected fields). The set is stored
-- under a combined key `taxonomyFieldKey(fields)` = sorted, ' + '-joined (a single
-- field is just its own name, so existing rows stay valid).
--
-- The two helper RPCs that decide "has text" / "pending" must therefore consider
-- ANY of the selected real fields (the combined key isn't a real JSONB column),
-- while still matching the per-field table on the combined key. Generalize both
-- to take p_fields text[] (the real fields, for the non-empty check) plus, for
-- pending, p_field_key (the combined key, for the taxonomy-table match).
--
-- "Has real text" uses the same whitespace/control-stripping test as the
-- classifier (see sql/116 note). Requires sql/114. DROP+CREATE (signatures change);
-- all callers (taxonomy route, classifyPendingRows) updated in the same change.

BEGIN;

DROP FUNCTION IF EXISTS dataset_rows_with_text_count(uuid, text);
DROP FUNCTION IF EXISTS dataset_rows_pending_field_taxonomy(uuid, text, int);

-- Count rows with real text in ANY of the selected fields (the reconciling
-- "rows with text" denominator for the combined classification).
CREATE FUNCTION dataset_rows_with_text_count(
  p_dataset_id uuid,
  p_fields     text[]
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     );
$$;

-- Rows with text in any selected field that lack a taxonomy entry for the combined
-- key — drives the per-combination drift "classify the new rows" nudge.
CREATE FUNCTION dataset_rows_pending_field_taxonomy(
  p_dataset_id uuid,
  p_field_key  text,
  p_fields     text[],
  p_limit      int DEFAULT 1000
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
    LEFT JOIN dataset_row_field_taxonomy t
      ON t.dataset_id = f.dataset_id AND t.row_id = f.id AND t.field = p_field_key
   WHERE f.dataset_id = p_dataset_id
     AND t.row_id IS NULL
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   ORDER BY f.row_index
   LIMIT p_limit;
$$;

COMMIT;
