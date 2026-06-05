-- sql/108_taxonomy_pending_rows.sql
-- Returns the rows of a dataset that still need taxonomy ("Dimensions")
-- classification — i.e. flat rows with NO dataset_row_taxonomy entry yet —
-- so the auto-classify safety net (lib/reviewSync) can keep Dimensions current
-- after each review sync without re-scanning the whole dataset.
--
-- IMPORTANT: filters to rows whose text field is NON-EMPTY. The keyword
-- classifier skips text-less rows (star-only reviews) and never writes a
-- taxonomy row for them; if we returned those here they'd be "pending" forever
-- and the LIMIT-window would never advance past them to the genuinely new rows.
-- Excluding them also keeps the "reviews classified" KPI = text-bearing rows.
--
-- Read-only, additive. Anti-join uses dataset_rows_flat(dataset_id,row_index)
-- + dataset_row_taxonomy UNIQUE(dataset_id,row_id) indexes. Org access is
-- enforced by the caller (sync flow already verified source ownership).

BEGIN;

CREATE OR REPLACE FUNCTION dataset_rows_pending_taxonomy(
  p_dataset_id uuid,
  p_text_field text,
  p_limit      int DEFAULT 1000
)
RETURNS TABLE(id bigint, data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
    LEFT JOIN dataset_row_taxonomy t
      ON t.dataset_id = f.dataset_id AND t.row_id = f.id
   WHERE f.dataset_id = p_dataset_id
     AND t.row_id IS NULL
     AND COALESCE(btrim(f.data ->> p_text_field), '') <> ''
   ORDER BY f.row_index
   LIMIT p_limit;
$$;

COMMIT;
