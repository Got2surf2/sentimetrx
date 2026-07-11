-- 161: count_nonempty_rows — parameterized non-empty count for one field.
--
-- WHY: several server paths counted a field's non-empty rows by splicing the
-- raw column name into a PostgREST filter (`.not('data->' + field, ...)`).
-- Survey column names are full question sentences — a COMMA in the name is a
-- PostgREST filter separator, so the filter silently matched NOTHING (count 0,
-- no error). Broke the dataset metric strip (comments · signals · theme fit),
-- the theme-counts denominator, and filter-modal blank counts for any dataset
-- with names like "What, if anything, did you like LEAST ...?" (2026-07-11,
-- found on the BFG GuestLens upload). The field is a bind PARAMETER here, so
-- any column name is safe. Mirrors count_theme_matches conventions.

BEGIN;

CREATE OR REPLACE FUNCTION public.count_nonempty_rows("p_dataset_id" "uuid", "p_field" "text") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  SELECT count(*)
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND NULLIF(btrim(drf.data ->> p_field), '') IS NOT NULL;
$$;

COMMIT;
