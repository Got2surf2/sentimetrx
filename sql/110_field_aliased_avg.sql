-- sql/110_field_aliased_avg.sql
-- Average of a "remapped" rating field — one whose stored values are text
-- labels ("Highly Satisfied"…) mapped to numbers via the field's valueAliases
-- ({"Highly Satisfied":"5", …}). numeric_field_stats can't help here: it casts
-- the RAW value, which is the label, so it filters everything out. This applies
-- the alias map first (label → number) then averages. Mirrors what the client
-- does for remapped rating fields; powers the TextMine metric strip's avg ★.
-- Optional present_field restricts to the analyzed population (text-bearing rows),
-- consistent with numeric_field_stats_present; pass '' for no filter.
-- Read-only, additive.

BEGIN;

CREATE OR REPLACE FUNCTION field_aliased_avg(
  p_dataset_id    uuid,
  p_field         text,
  p_present_field text,
  p_aliases       jsonb
)
RETURNS TABLE(
  n          bigint,
  avg_val    double precision,
  min_val    double precision,
  max_val    double precision
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (
    SELECT (p_aliases ->> (data ->> p_field))::double precision AS x
      FROM dataset_rows_flat
     WHERE dataset_id = p_dataset_id
       AND (p_aliases ->> (data ->> p_field)) ~ '^-?[0-9]+\.?[0-9]*$'
       AND (p_present_field = '' OR COALESCE(btrim(data ->> p_present_field), '') <> '')
  )
  SELECT count(*)::bigint AS n, avg(x) AS avg_val, min(x) AS min_val, max(x) AS max_val
    FROM v;
$$;

COMMIT;
