-- sql/168_sampled_filter_options.sql
-- Single-pass SAMPLED filter-options for the Filters modal — replaces the
-- filter-options route's serial per-field aggregate RPCs.
--
-- WHY: app/api/datasets/[datasetId]/filter-options/route.ts looped every field
-- calling count_nonempty_rows + count_field_values + numeric_field_stats and
-- TWO PostgREST `.order('data->>field')` date probes — each a FULL SCAN. Fine to
-- ~50K rows; at 1M rows every one of those blows the DB's 8s statement_timeout
-- (57014), so the modal never opened on large datasets (perf review §2, §7
-- Brief B). count_field_values also capped distinct values at 200 by frequency,
-- so a rare categorical value (e.g. a low-volume location) was silently absent
-- from the list — the owner-reported "missing location values" bug.
--
-- WHAT: one keyset-paged pass over the SAME deterministic sample every other
-- sampled surface serves (smallest hash(id||dataset_id) first, idx_drf_sample,
-- sql/160) — so the modal's numbers agree with the metric strip and the loaded
-- TextMine sample. In a single heap visit per row it accumulates, per field:
--   * non-empty count            (count_nonempty_rows semantics, sql/161: btrim)
--   * distinct values w/ counts  (categorical only — count_field_values semantics:
--                                 raw data->>field, exclude null/'', NO trim —
--                                 capped per page by frequency; Node merges + caps 500)
--   * numeric min/max            (numeric_field_stats semantics: ^-?[0-9]+…$ )
--   * date (text) min/max        (the legacy .order('data->>field') probe: raw
--                                 lexical min/max of ISO date strings, blanks out)
--
-- Below the 50K cap the keyset walk naturally reaches every row = EXACT (and
-- returns up to 500 distinct values vs the old 200 — the missing-values fix).
-- Above it the caller pages to the cap and labels blanks/values "~" (sampled).
-- vs the old shape this trades (fields × ~5 full scans) for ONE scan of ≤50K
-- rows — no 57014 at 1M, measured.
--
-- The per-page value cap (2000, by frequency desc) bounds the page payload on
-- high-cardinality open-ended fields; a value common enough to land in the true
-- top-500 survives it in every unbiased page, so the merged top-500 is stable.
--
-- SECURITY DEFINER over raw row data -> service_role only, same posture as
-- sample_dataset_rows / sampled_signal_counts; routes enforce org access.

BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_filter_options(
  p_dataset_id  uuid,
  p_fields      jsonb,     -- [{"field":"loc","type":"categorical"}, ...] order preserved -> ord
  p_after_hash  bigint,    -- keyset cursor: (hash, id) strictly greater than this
  p_after_id    bigint,
  p_limit       int        -- rows in this page
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  fld AS (
    SELECT (e ->> 'field') AS field, (e ->> 'type') AS type, ord
    FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS x(e, ord)
  ),
  -- one (field, row) cell with the RAW extracted text value (untrimmed).
  cells AS MATERIALIZED (
    SELECT fl.ord, fl.field, fl.type, (p.data ->> fl.field) AS raw
    FROM fld fl CROSS JOIN page p
  ),
  agg AS (
    SELECT ord, field, type,
      -- non-empty = count_nonempty_rows (sql/161): trim, all-whitespace is blank
      count(*) FILTER (WHERE NULLIF(btrim(raw), '') IS NOT NULL) AS nonempty,
      -- numeric min/max = numeric_field_stats predicate (no trim)
      min(CASE WHEN type = 'numeric' AND raw ~ '^-?[0-9]+\.?[0-9]*$' THEN raw::double precision END) AS num_min,
      max(CASE WHEN type = 'numeric' AND raw ~ '^-?[0-9]+\.?[0-9]*$' THEN raw::double precision END) AS num_max,
      -- date min/max = legacy .order('data->>field') probe: raw lexical, blanks out
      min(CASE WHEN type = 'date' AND raw IS NOT NULL AND raw <> '' THEN raw END) AS date_min,
      max(CASE WHEN type = 'date' AND raw IS NOT NULL AND raw <> '' THEN raw END) AS date_max
    FROM cells
    GROUP BY ord, field, type
  ),
  vc AS (
    -- distinct value counts = count_field_values (raw data->>field, exclude
    -- null/''; NO trim). ONLY for categorical fields — the Filters modal value-
    -- filters categorical/numeric/date; open-ended is never a checkbox list, so
    -- counting its (high-cardinality free-text) distincts was pure waste and the
    -- ~40s-at-1M cost driver. Capped per page at 2000 by frequency; the Node
    -- caller merges across pages and caps the final list at 500.
    SELECT ord, field,
           jsonb_agg(jsonb_build_object('v', raw, 'c', c) ORDER BY rn) FILTER (WHERE rn <= 2000) AS values,
           count(*) AS distinct_n
    FROM (
      SELECT ord, field, raw, count(*) AS c,
             row_number() OVER (PARTITION BY ord ORDER BY count(*) DESC, raw) AS rn
      FROM cells
      WHERE type = 'categorical' AND raw IS NOT NULL AND raw <> ''
      GROUP BY ord, field, raw
    ) g
    GROUP BY ord, field
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'fields', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'ord',        a.ord,
        'nonempty',   a.nonempty,
        'num_min',    a.num_min,
        'num_max',    a.num_max,
        'date_min',   a.date_min,
        'date_max',   a.date_max,
        'values',     COALESCE(vc.values, '[]'::jsonb),
        'distinct_n', COALESCE(vc.distinct_n, 0)
      ) ORDER BY a.ord), '[]'::jsonb)
      FROM agg a LEFT JOIN vc ON vc.ord = a.ord
    ),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_filter_options(uuid, jsonb, bigint, bigint, int) IS
  'One keyset page of SAMPLED filter options over the deterministic idx_drf_sample order (same sample as sample_dataset_rows, sql/160). p_fields = [{"field","type"},…]; returns {n_scanned, fields:[{ord, nonempty, num_min, num_max, date_min, date_max, values:[{v,c}], distinct_n}], last_hash, last_id}. Per-field semantics match count_nonempty_rows (nonempty, btrim), count_field_values (values, raw — CATEGORICAL only), numeric_field_stats (numeric), and the legacy date .order probe. Values capped 2000/page by frequency; caller pages to the 50K cap, merges values, caps 500, and labels sampled above the cap. Replaces the filter-options route serial per-field full scans (57014 at 1M).';

REVOKE ALL ON FUNCTION public.sampled_filter_options(uuid, jsonb, bigint, bigint, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_filter_options(uuid, jsonb, bigint, bigint, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_filter_options(uuid, jsonb, bigint, bigint, int) TO service_role;

COMMIT;
