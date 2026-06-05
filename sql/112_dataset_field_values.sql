-- sql/112_dataset_field_values.sql
-- Fetch one JSONB field's raw value for a set of flat-row ids. Used by the
-- Dimensions rollup to attach each classified row's rating without
-- interpolating the field key into a PostgREST select string — survey rating
-- fields have arbitrary keys (spaces, commas, apostrophes, "?"), which the
-- select-string parser can't handle. Passing the key as a bind parameter to
-- `data ->> p_field` is both safe (no injection) and key-agnostic. Alias
-- resolution + numeric parsing stay in JS (the caller has the valueAliases map).
--
-- Read-only, additive. Org access is enforced by the caller
-- (computeTaxonomyRollup pairs dataset_id with org_id before reaching here);
-- scoped to a single p_dataset_id and an explicit id list.

BEGIN;

CREATE OR REPLACE FUNCTION dataset_field_values(
  p_dataset_id uuid,
  p_field      text,
  p_ids        bigint[]
)
RETURNS TABLE(id bigint, val text) AS $$
  SELECT f.id, f.data ->> p_field AS val
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND f.id = ANY(p_ids)
     AND f.data ->> p_field IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMIT;
