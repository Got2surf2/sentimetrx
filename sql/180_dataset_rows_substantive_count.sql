-- sql/180_dataset_rows_substantive_count.sql
-- Substantive denominator for Dimensions "% tagged".
--
-- The Dimensions header reads "N rows with text · X% tagged", where X% =
-- withSignal / rowsWithText (dataset_rows_with_text_count, sql/117). That
-- denominator counts every non-empty answer — including the ~45% "N/A" /
-- "Nothing" non-answers on a survey field — so a real signal rate reads
-- artificially low, the same denominator artifact the theme-fit strip had.
--
-- Dimension COUNTS are already clean (a non-answer doesn't classify into a
-- dimension), so this is a DENOMINATOR-ONLY fix: divide by the rows that carry
-- usable feedback (the stored substantive map, sql/178) instead of merely
-- non-empty rows. A cheap has-any-key count over the selected fields — the
-- substantive twin of dataset_rows_with_text_count. New function (no existing
-- caller), so deploy-order safe.
--
-- SECURITY DEFINER over raw rows -> service_role only (same posture as the
-- text-count sibling).

BEGIN;

CREATE OR REPLACE FUNCTION dataset_rows_with_substantive_count(
  p_dataset_id uuid,
  p_fields     text[]
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND f.substantive ?| p_fields;   -- substantive in ANY selected field
$$;

COMMENT ON FUNCTION dataset_rows_with_substantive_count(uuid, text[]) IS
  'Rows carrying usable feedback (substantive map, sql/178) in ANY of the selected fields — the substantive denominator for Dimensions "% tagged". Twin of dataset_rows_with_text_count (sql/117). sql/180.';

REVOKE ALL ON FUNCTION dataset_rows_with_substantive_count(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION dataset_rows_with_substantive_count(uuid, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION dataset_rows_with_substantive_count(uuid, text[]) TO service_role;

COMMIT;
