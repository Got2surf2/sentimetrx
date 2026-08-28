-- sql/194: Filter modal latency fix (owner report 2026-08-27: "filters should
-- be instantaneous" — ANES took ~41.5s to open).
--
-- Two changes:
--
-- 1) sampled_filter_options_blocks — parse each row's jsonb ONCE.
--    The sql/191 cells CTE was `fld CROSS JOIN page` with `data ->> field` per
--    cell, i.e. the row's jsonb re-parsed once PER FIELD. Measured on ANES
--    (125,897 rows, 51 filterable fields): ~80ms per field per 5K page, 41.5s
--    for the 50K walk — pure field-count-linear cost (0 fields = 114ms/page).
--    The rewrite explodes each row once via jsonb_each_text and hash-joins to
--    the requested field list. A field absent from every row now yields no
--    cells (v191 yielded all-NULL cells); the aggregate re-anchors on fld via
--    LEFT JOIN so its output row still appears with nonempty=0 / NULL min/max /
--    values=[] — the same wire result the Node caller saw before.
--
-- 2) dataset_state.filter_options — server-side cache of the computed options.
--    The walk's result only changes when the data or schema does, but the
--    route recomputed it on every first modal open per page load. The route
--    now stores {fingerprint, computedAt, options} and serves it back while
--    the fingerprint (row count + schema fields signature + last_synced_at)
--    still matches — a cache hit costs one head-count query (~150ms).
BEGIN;

CREATE OR REPLACE FUNCTION public.sampled_filter_options_blocks(p_dataset_id uuid, p_fields jsonb, p_after_row_index bigint, p_limit integer, p_cap integer DEFAULT 50000, p_blocks integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  WITH page AS MATERIALIZED (
    SELECT x.id, x.data, x.row_index
    FROM (
      -- ONE call to dataset_sample_blocks: it does a count(*) over the dataset,
      -- so calling it per scalar subquery multiplied the walk's cost.
      SELECT a.lo, a.hi, a.per_block
      FROM (
        SELECT b.lo, b.hi,
               greatest(p_cap / greatest(count(*) OVER (), 1), 1) AS per_block
        FROM dataset_sample_blocks(p_dataset_id, p_cap, p_blocks) b
      ) a
      -- Only blocks that can still contribute, and only as many as this page can
      -- consume. Without the bound every page reads per_block rows from ALL the
      -- blocks and discards ~90%.
      WHERE a.hi > p_after_row_index
      ORDER BY a.lo
      LIMIT (p_limit * p_blocks / greatest(p_cap, 1)) + 2
    ) blk, LATERAL (
      SELECT f.id, f.data, f.row_index
      FROM dataset_rows_flat f
      WHERE f.dataset_id = p_dataset_id
        AND f.row_index >= blk.lo AND f.row_index < blk.hi
      ORDER BY f.row_index
      LIMIT blk.per_block
    ) x
    -- Per-block LIMIT from the BLOCK START, cursor applied outside, so the
    -- sampled set is "the first per_block rows of each block" — a fixed set,
    -- independent of page size (sql/188 filtered inside the LATERAL, which let a
    -- block straddling a page boundary hand out a fresh per_block every page).
    WHERE x.row_index > p_after_row_index
    ORDER BY x.row_index
    LIMIT p_limit
  ),
  fld AS (
    SELECT (e ->> 'field') AS field, (e ->> 'type') AS type, ord
    FROM jsonb_array_elements(p_fields) WITH ORDINALITY AS x(e, ord)
  ),
  -- ONE jsonb parse per row (the sql/194 fix): explode to (key, value) pairs
  -- and join to the requested fields, instead of `data ->> field` re-parsing
  -- the row once per field (~80ms/field/5K-page on ANES's 51 fields).
  cells AS MATERIALIZED (
    SELECT fl.ord, fl.field, fl.type, kv.value AS raw
    FROM page p
    CROSS JOIN LATERAL jsonb_each_text(p.data) kv
    JOIN fld fl ON fl.field = kv.key
  ),
  agg AS (
    -- Anchor on fld (LEFT JOIN): a field with no cells on this page — absent
    -- key in every row — still emits its output row (nonempty=0, NULL min/max),
    -- matching the v191 all-NULL-cells result for the same case.
    SELECT fl.ord, fl.field, fl.type,
      -- non-empty = count_nonempty_rows (sql/161): trim, all-whitespace is blank
      count(*) FILTER (WHERE NULLIF(btrim(c.raw), '') IS NOT NULL) AS nonempty,
      -- numeric min/max = numeric_field_stats predicate (no trim)
      min(CASE WHEN fl.type = 'numeric' AND c.raw ~ '^-?[0-9]+\.?[0-9]*$' THEN c.raw::double precision END) AS num_min,
      max(CASE WHEN fl.type = 'numeric' AND c.raw ~ '^-?[0-9]+\.?[0-9]*$' THEN c.raw::double precision END) AS num_max,
      -- date min/max = legacy .order('data->>field') probe: raw lexical, blanks out
      min(CASE WHEN fl.type = 'date' AND c.raw IS NOT NULL AND c.raw <> '' THEN c.raw END) AS date_min,
      max(CASE WHEN fl.type = 'date' AND c.raw IS NOT NULL AND c.raw <> '' THEN c.raw END) AS date_max
    FROM fld fl LEFT JOIN cells c ON c.ord = fl.ord
    GROUP BY fl.ord, fl.field, fl.type
  ),
  vc AS (
    -- distinct value counts = count_field_values (raw data->>field, exclude
    -- null/''; NO trim). ONLY for categorical fields — the Filters modal value-
    -- filters categorical/numeric/date; open-ended is never a checkbox list.
    -- Capped per page at 2000 by frequency; the Node caller merges across pages
    -- and caps the final list at 500.
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
    'last_row_index', (SELECT max(row_index) FROM page)
  );
$$;

REVOKE ALL ON FUNCTION public.sampled_filter_options_blocks FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_filter_options_blocks FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_filter_options_blocks TO service_role;

-- 2) Server-side cache of the computed filter options (see header).
--    Shape: { fingerprint: text, computedAt: iso, fields: {<field>: option} }
ALTER TABLE public.dataset_state
  ADD COLUMN IF NOT EXISTS filter_options jsonb;

COMMENT ON COLUMN public.dataset_state.filter_options IS
  'Cache of the filter-options route''s computed per-field options: {fingerprint, computedAt, fields}. Fingerprint = row count + schema fields signature + last_synced_at; the route recomputes when it no longer matches (sql/194).';

COMMIT;
