-- sql/167_ana_filtered_sample.sql
-- Filter-aware deterministic sampling for the Ask Ana / ad-hoc report data
-- layer (lib/anaReportContext.loadAnaSample).
--
-- WHY (2026-07-13 performance review, docs/PERFORMANCE_REVIEW.md §2):
--   * The old fetch (`sample_row_pairs` = ORDER BY random() LIMIT n) sorts the
--     ENTIRE dataset partition to pick ~600 rows — measured 57014 (8s statement
--     timeout) at 1.03M rows, so Ask Ana errored outright on large datasets.
--   * It was also FILTER-BLIND: the app filtered in Node AFTER fetching ~600
--     rows, so a selective filter starved the sample (5% segment of 56K → ~30
--     analyzed rows; narrow filter → "No rows found" despite thousands of
--     matches), and the model was told a wrong denominator.
--
-- Design: walk the same deterministic sample order the whole platform uses
-- (idx_drf_sample, sql/160 — smallest uniform hash(id||dataset_id) first) in
-- keyset pages, applying the user's serialized filters IN SQL, returning up to
-- p_match_limit matching rows per page plus scan/match counts for honest
-- denominators. Each page is an index range scan + p_scan_limit heap fetches,
-- so per-statement cost is bounded regardless of dataset size (the caller caps
-- total scanned rows at the platform 50K sampling doctrine, ARCHITECTURE.md D6:
-- datasets at/below the cap get scanned in full = EXACT filtering; above it the
-- scan covers the deterministic 50K sample = the same population every other
-- sampled surface reports on).
--
-- Filter semantics mirror lib/filterUtils.applyFilters (the canonical client
-- filter), including cat include/exclude modes, blank handling, parseFloat
-- numeric parsing (leading-prefix, scientific notation included — real
-- Qualtrics-style exports store whole ID columns as "1.19152E+11"), and
-- daterange on epoch-millisecond bounds. One documented divergence from JS:
-- date parsing uses Postgres rules rather than the JS Date constructor;
-- unparseable dates resolve to the permissive side (row passes), and only on
-- already-approximate sampled populations.
--
-- SECURITY DEFINER returns raw row data -> execution stays service_role-only
-- (same posture as sql/160); the routes enforce org access before calling.

BEGIN;

-- Exception-guarded timestamp parse (Postgres rules; NULL when unparseable).
CREATE OR REPLACE FUNCTION public.ana_try_parse_ts(p_val text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p_val::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;

-- Mirror of lib/filterUtils.applyFilters row predicate over SerializedFilters:
--   { "<field>": {"type":"cat","mode":"include"|"exclude","values":[...],
--                 "excludeBlanks":bool}
--   | {"type":"range","values":[lo,hi],"includeBlanks":bool}
--   | {"type":"daterange","values":[loMs,hiMs],"includeBlanks":bool} }
CREATE OR REPLACE FUNCTION public.ana_row_matches_filters(p_data jsonb, p_filters jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k        text;
  f        jsonb;
  v        text;
  is_blank boolean;
  n        numeric;
  ts       timestamptz;
BEGIN
  IF p_filters IS NULL OR p_filters = '{}'::jsonb THEN
    RETURN true;
  END IF;
  FOR k, f IN SELECT * FROM jsonb_each(p_filters) LOOP
    v := p_data->>k;
    is_blank := v IS NULL OR btrim(v) = '';

    IF f->>'type' = 'cat' THEN
      -- Blanks governed solely by excludeBlanks, regardless of mode.
      IF is_blank THEN
        IF COALESCE((f->>'excludeBlanks')::boolean, false) THEN RETURN false; END IF;
      ELSIF COALESCE(f->>'mode', 'include') = 'exclude' THEN
        IF f->'values' ? v THEN RETURN false; END IF;
      ELSE
        IF NOT (f->'values' ? v) THEN RETURN false; END IF;
      END IF;

    ELSIF f->>'type' = 'range' THEN
      -- parseFloat semantics: leading numeric prefix incl. scientific notation
      -- ("1.19152E+11" — real export data); no prefix -> NaN branch, which
      -- passes unless includeBlanks is literally false. POSIX regex: bracket
      -- expressions don't support \s, use [[:space:]].
      -- NB: substring() returns the FIRST parenthesized group, so the whole
      -- number is wrapped in one.
      n := substring(COALESCE(v, '') FROM '^[[:space:]]*(-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?)')::numeric;
      IF n IS NULL THEN
        IF (f->>'includeBlanks') = 'false' THEN RETURN false; END IF;
      ELSE
        IF n < (f->'values'->>0)::numeric OR n > (f->'values'->>1)::numeric THEN
          RETURN false;
        END IF;
      END IF;

    ELSIF f->>'type' = 'daterange' THEN
      -- Bounds are epoch MILLISECONDS (JS Date.getTime()).
      IF is_blank THEN
        IF (f->>'includeBlanks') = 'false' THEN RETURN false; END IF;
      ELSE
        ts := public.ana_try_parse_ts(v);
        IF ts IS NULL THEN
          IF (f->>'includeBlanks') = 'false' THEN RETURN false; END IF;
        ELSE
          IF extract(epoch FROM ts) * 1000 < (f->'values'->>0)::numeric
             OR extract(epoch FROM ts) * 1000 > (f->'values'->>1)::numeric THEN
            RETURN false;
          END IF;
        END IF;
      END IF;
    END IF;
    -- Unknown filter types pass (matches applyFilters' `return true` default).
  END LOOP;
  RETURN true;
END $$;

-- Keyset page over the deterministic sample order with SQL-side filtering.
-- Scans exactly p_scan_limit rows past the cursor (bounded statement cost),
-- returns up to p_match_limit matching rows plus counts and the cursor of the
-- last SCANNED row (so the caller advances through the sample regardless of
-- how sparse the matches are). AS MATERIALIZED: without it the planner inlines
-- the CTE and re-derives the scan per aggregate (the sql/162 lesson).
CREATE OR REPLACE FUNCTION public.sampled_filtered_rows(
  p_dataset_id  uuid,
  p_filters     jsonb,
  p_after_hash  bigint,
  p_after_id    bigint,
  p_scan_limit  int,
  p_match_limit int
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH scan AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_scan_limit
  ), matched AS MATERIALIZED (
    SELECT s.id, s.data, s.h
    FROM scan s
    WHERE public.ana_row_matches_filters(s.data, p_filters)
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM scan),
    'n_matched', (SELECT count(*) FROM matched),
    'rows', COALESCE(
      (SELECT jsonb_agg(m.data ORDER BY m.h, m.id)
       FROM (SELECT id, data, h FROM matched ORDER BY h, id LIMIT p_match_limit) m),
      '[]'::jsonb),
    'last_hash', (SELECT h  FROM scan ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM scan ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.sampled_filtered_rows(uuid, jsonb, bigint, bigint, int, int) IS
  'Filter-aware page over the deterministic sample order (idx_drf_sample). Scans p_scan_limit rows past the (p_after_hash,p_after_id) cursor, applies ana_row_matches_filters (mirror of lib/filterUtils.applyFilters), returns {n_scanned, n_matched, rows: up to p_match_limit matching data blobs, last_hash, last_id (of the last SCANNED row)}. Callers page until enough matches or the D6 scan cap. Ask Ana / ad-hoc report data layer (docs/PERFORMANCE_REVIEW.md §2).';

REVOKE ALL ON FUNCTION public.ana_try_parse_ts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ana_row_matches_filters(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_filtered_rows(uuid, jsonb, bigint, bigint, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sampled_filtered_rows(uuid, jsonb, bigint, bigint, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sampled_filtered_rows(uuid, jsonb, bigint, bigint, int, int) TO service_role;

COMMIT;
