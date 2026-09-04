-- sql/201: segment_match_ids, 10x — compile the conditions to a native predicate.
--
-- sql/200's first cut evaluated `segment_row_matches(data, p_conds)` per row:
-- a per-row jsonb_array_elements + bool_and aggregate, plus the page CTE
-- materialized the full data blob for 20K wide survey rows. Measured on prod
-- ANES: ~6s per 20K page — functionally correct, but 7 pages ≈ 36s and each
-- page sat uncomfortably near the statement timeout.
--
-- This rewrite builds the WHERE clause ONCE per call with format() %L
-- literal-quoting (injection-safe: field names and values are always
-- literals; the only identifiers are our own columns) and lets the executor
-- evaluate it natively during the keyset scan — no per-row function calls,
-- no set expansion, no blob materialization. Same contract and semantics as
-- sql/200 (segment_row_matches stays as the executable spec of those
-- semantics; the unit fakes mirror it).

BEGIN;

CREATE OR REPLACE FUNCTION public.segment_match_ids(
  p_dataset_id uuid,
  p_conds jsonb,
  p_after_row_index bigint DEFAULT -1,
  p_limit integer DEFAULT 20000
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cond     jsonb;
  preds    text := 'true';
  vals     text[];
  scanned  bigint;
  last_ri  bigint;
  out_ids  jsonb;
BEGIN
  FOR cond IN SELECT * FROM jsonb_array_elements(COALESCE(p_conds, '[]'::jsonb)) LOOP
    IF cond ? 'values' THEN
      SELECT array_agg(x) INTO vals FROM jsonb_array_elements_text(cond->'values') AS t(x);
      preds := preds || format(' AND (data ->> %L) = ANY (%L::text[])', cond->>'field', vals);
    ELSE
      preds := preds || format(' AND drf_numeric_ok(data ->> %L)', cond->>'field');
      IF cond ? 'min' THEN
        preds := preds || format(' AND drf_to_numeric(data ->> %L) >= %L::numeric', cond->>'field', cond->>'min');
      END IF;
      IF cond ? 'max' THEN
        preds := preds || format(' AND drf_to_numeric(data ->> %L) <= %L::numeric', cond->>'field', cond->>'max');
      END IF;
    END IF;
  END LOOP;

  EXECUTE format(
    'WITH page AS (
       SELECT id, row_index, (%s) AS ok
       FROM dataset_rows_flat
       WHERE dataset_id = $1 AND row_index > $2
       ORDER BY row_index
       LIMIT $3
     )
     SELECT count(*),
            max(row_index),
            COALESCE(jsonb_agg(id ORDER BY id) FILTER (WHERE ok), ''[]''::jsonb)
     FROM page', preds)
  INTO scanned, last_ri, out_ids
  USING p_dataset_id, p_after_row_index, p_limit;

  RETURN jsonb_build_object('n_scanned', scanned, 'last_row_index', last_ri, 'ids', out_ids);
END
$$;

ALTER FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) OWNER TO postgres;

-- sql/190 lockdown: SECURITY DEFINER functions re-open to anon/authenticated
-- by DEFAULT on every CREATE — the REVOKE block is mandatory.
REVOKE ALL ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.segment_match_ids(uuid, jsonb, bigint, integer) TO service_role;

COMMIT;
