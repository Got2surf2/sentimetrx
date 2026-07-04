-- 151_taxonomy_embed.sql
--
-- Taxonomy verdicts move INTO the row blob (2026-07-04).
--
-- WHY: the sidecar tables dataset_row_taxonomy (sql/088) + dataset_row_field_taxonomy
-- (sql/114) hold one row per (row, field) verdict — 128K rows exist pre-production,
-- and a single 1M-comment client dataset would mint 5–7M sidecar rows. Embedding the
-- verdict in dataset_rows_flat.data (consistent with ARCHITECTURE.md D2: the record
-- IS the blob) makes taxonomy lifecycle-coupled for free — backup, restore, clone,
-- and delete all ride with the row, so the 2026-07-03 "module missing from backups"
-- bug class becomes impossible for taxonomy.
--
-- EMBEDDED SHAPE — a reserved top-level `_tx` key in data:
--   data._tx = { "f": { "<fieldKey>": {
--     "a":  { "<axis>": ["sub", …], … },      -- only non-empty axes (7-axis ABSA)
--     "al": ["sub", …],                        -- subs that fired at alert/crisis
--     "as": [{axis,sub,item?,polarity,confidence,severity,evidence}, …],
--     "v": "v3", "by": "keyword", "m": "keyword-tier", "at": "<iso>"
--   } } }
-- fieldKey = taxonomyFieldKey(fields) (lib/dimensionFields.ts) — same key the
-- per-field sidecar used. NO version history: a re-classify overwrites the field's
-- block in place (owner decision 2026-07-03: the workflow is replace-then-spot-check).
--
-- ROLLUPS live in dataset_state.analytics->'taxonomy'->'fields'-><fieldKey>
-- (written by lib/taxonomyClassify at classify end via merge_dataset_analytics,
-- sql/145) so dashboards never scan blobs; `taxonomy_primary_field` below resolves
-- the Charts field from those rollups.
--
-- TRANSITION SAFETY — this migration is safe to apply BEFORE the code deploys:
-- every read RPC keeps a SIDECAR-FALLBACK leg (same pattern sql/115 used) chosen
-- per dataset: blob-classified datasets read the blob, everything else falls back
-- to the sidecar tables, so the deployed app keeps working unchanged. The fallback
-- legs and the sidecar tables die together in the later drop migration, which must
-- only run AFTER the code is deployed and the prod backfill has been verified.
--
-- ORDERING: the drf_tsv_trigger fix MUST precede any `_tx` write (backfill or
-- classify) — otherwise taxonomy labels/evidence would be indexed into full-text
-- search. The backfill UPDATE re-fires the fixed trigger, so tsv stays clean.
--
-- Multi-tenancy: dataset_rows_flat deliberately has no org_id (D2) — it scopes
-- through dataset_id, and every RPC here is dataset-scoped with org access enforced
-- by the calling route before the RPC runs (same contract as sql/105–133).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Full-text search must never index the reserved `_tx` block.
--    (jsonb_each_text serializes an object value to its JSON text — without the
--    skip, tag names, 'pos'/'neg', and evidence quotes become searchable tokens.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION drf_tsv_trigger() RETURNS TRIGGER AS $$
DECLARE
  txt TEXT := '';
  val TEXT;
  key TEXT;
BEGIN
  -- Concatenate all string values from the JSONB data column, skipping the
  -- reserved `_tx` taxonomy block (sql/151) so classification never pollutes FTS.
  FOR key, val IN SELECT k, v::text FROM jsonb_each_text(NEW.data) AS x(k, v) WHERE k <> '_tx'
  LOOP
    -- Skip very short values and numeric-only values
    IF length(val) > 2 AND val ~ '[a-zA-Z]' THEN
      txt := txt || ' ' || val;
    END IF;
  END LOOP;

  NEW.tsv := to_tsvector('english', COALESCE(txt, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Same skip in the search-result headline source (sql/031).
CREATE OR REPLACE FUNCTION search_dataset_rows(
  p_dataset_id UUID,
  p_query      TEXT,
  p_limit      INT DEFAULT 50,
  p_offset     INT DEFAULT 0
)
RETURNS TABLE(
  id         BIGINT,
  row_index  INT,
  data       JSONB,
  rank       REAL,
  headline   TEXT
) AS $$
DECLARE
  tsquery_val TSQUERY;
BEGIN
  tsquery_val := websearch_to_tsquery('english', p_query);

  RETURN QUERY
  SELECT
    r.id,
    r.row_index,
    r.data - '_tx' AS data,
    ts_rank_cd(r.tsv, tsquery_val)::REAL AS rank,
    ts_headline('english',
      (SELECT string_agg(v, ' | ')
       FROM jsonb_each_text(r.data) AS x(k, v)
       WHERE k <> '_tx' AND length(v) > 2 AND v ~ '[a-zA-Z]'),
      tsquery_val,
      'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=10, MaxFragments=2'
    ) AS headline
  FROM dataset_rows_flat r
  WHERE r.dataset_id = p_dataset_id
    AND r.tsv @@ tsquery_val
  ORDER BY rank DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Writer: batch-embed verdicts into the blob.
--    p_items = [{"id": <flat row id>, "tx": {<field block>}}, …]
--    Sets data._tx.f[<p_field_key>] = tx per row, preserving other fields' blocks
--    and every non-_tx key. The UPDATE fires the (fixed) tsv trigger per row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_taxonomy_verdicts(
  p_dataset_id uuid,
  p_field_key  text,
  p_items      jsonb
)
RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  WITH items AS (
    SELECT (it ->> 'id')::bigint AS id, it -> 'tx' AS tx
      FROM jsonb_array_elements(p_items) AS it
  ),
  updated AS (
    UPDATE dataset_rows_flat f
       SET data = f.data || jsonb_build_object('_tx',
                    COALESCE(f.data -> '_tx', '{}'::jsonb) || jsonb_build_object('f',
                      COALESCE(f.data -> '_tx' -> 'f', '{}'::jsonb)
                        || jsonb_build_object(p_field_key, i.tx)))
      FROM items i
     WHERE f.id = i.id
       AND f.dataset_id = p_dataset_id
    RETURNING f.id
  )
  SELECT count(*) FROM updated;
$$;

GRANT EXECUTE ON FUNCTION apply_taxonomy_verdicts(uuid, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Paged verdict read for one field — feeds lib/taxonomyRollup's aggregate
--    (rating + date come from the SAME row now; the sidecar version needed two
--    extra lookups per page). Bind-param field names support survey-question
--    keys with spaces/commas. Blob leg only: callers run on the new code path,
--    where blob rows exist for anything classified (fresh classify or backfill).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxonomy_rows_for_field(
  p_dataset_id   uuid,
  p_field_key    text,
  p_rating_field text DEFAULT NULL,
  p_date_field   text DEFAULT NULL,
  p_offset       int  DEFAULT 0,
  p_limit        int  DEFAULT 1000
)
RETURNS TABLE(row_id bigint, tx jsonb, rating_val text, date_val text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id,
         f.data -> '_tx' -> 'f' -> p_field_key,
         CASE WHEN p_rating_field IS NOT NULL THEN f.data ->> p_rating_field END,
         CASE WHEN p_date_field   IS NOT NULL THEN f.data ->> p_date_field   END
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (f.data -> '_tx' -> 'f') ? p_field_key
   ORDER BY f.id
   OFFSET p_offset
   LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION taxonomy_rows_for_field(uuid, text, text, text, int, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Drill-down: the rows behind a clicked tag (taxonomy/rows route).
--    Blob leg with sidecar fallback. Exactly one of (p_sub w/ p_axis), (p_axis
--    alone), (p_alert) selects the filter, mirroring the route's contract.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxonomy_drill_rows(
  p_dataset_id uuid,
  p_field_key  text,
  p_axis       text DEFAULT NULL,
  p_sub        text DEFAULT NULL,
  p_alert      text DEFAULT NULL,
  p_limit      int  DEFAULT 100
)
RETURNS TABLE(row_id bigint, data jsonb, tx jsonb, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blob boolean;
  v_col  text;
BEGIN
  IF p_axis IS NOT NULL AND p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;

  v_blob := EXISTS (
    SELECT 1 FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id AND (f.data -> '_tx' -> 'f') ? p_field_key
     LIMIT 1
  );

  IF v_blob THEN
    RETURN QUERY
    SELECT f.id,
           f.data - '_tx' AS data,
           f.data -> '_tx' -> 'f' -> p_field_key AS tx,
           count(*) OVER() AS total_count
      FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id
       AND (
         (p_alert IS NOT NULL AND (f.data -> '_tx' -> 'f' -> p_field_key -> 'al') ? p_alert)
         OR (p_alert IS NULL AND p_sub IS NOT NULL
             AND (f.data -> '_tx' -> 'f' -> p_field_key -> 'a' -> p_axis) ? p_sub)
         OR (p_alert IS NULL AND p_sub IS NULL AND p_axis IS NOT NULL
             AND jsonb_array_length(COALESCE(f.data -> '_tx' -> 'f' -> p_field_key -> 'a' -> p_axis, '[]'::jsonb)) > 0)
       )
     ORDER BY f.row_index
     LIMIT p_limit;
    RETURN;
  END IF;

  -- Sidecar fallback (pre-backfill datasets; leg dies in the drop migration).
  v_col := CASE WHEN p_axis IS NOT NULL THEN 'axis_' || p_axis END;
  RETURN QUERY EXECUTE format(
    'SELECT t.row_id,
            f.data - ''_tx'' AS data,
            jsonb_build_object(''a'', ''{}''::jsonb, ''al'', to_jsonb(t.alert_tags), ''as'', t.assertions) AS tx,
            count(*) OVER() AS total_count
       FROM dataset_row_field_taxonomy t
       JOIN dataset_rows_flat f ON f.id = t.row_id AND f.dataset_id = t.dataset_id
      WHERE t.dataset_id = $1
        AND t.field = $2
        AND CASE
              WHEN $3 IS NOT NULL THEN t.alert_tags @> ARRAY[$3]
              WHEN $4 IS NOT NULL THEN t.%I @> ARRAY[$4]
              ELSE t.%I <> ''{}''
            END
      ORDER BY f.row_index
      LIMIT $5',
    COALESCE(v_col, 'alert_tags'), COALESCE(v_col, 'alert_tags')
  ) USING p_dataset_id, p_field_key, p_alert, p_sub, p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION taxonomy_drill_rows(uuid, text, text, text, text, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Admin pilot counts (classified / alert rows for one field).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxonomy_counts(
  p_dataset_id uuid,
  p_field_key  text
)
RETURNS TABLE(classified bigint, alerts bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blob boolean;
BEGIN
  v_blob := EXISTS (
    SELECT 1 FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id AND (f.data -> '_tx' -> 'f') ? p_field_key
     LIMIT 1
  );
  IF v_blob THEN
    RETURN QUERY
    SELECT count(*)::bigint,
           count(*) FILTER (WHERE jsonb_array_length(COALESCE(f.data -> '_tx' -> 'f' -> p_field_key -> 'al', '[]'::jsonb)) > 0)::bigint
      FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id
       AND (f.data -> '_tx' -> 'f') ? p_field_key;
  ELSE
    RETURN QUERY
    SELECT count(*)::bigint,
           count(*) FILTER (WHERE t.alert_tags <> '{}')::bigint
      FROM dataset_row_field_taxonomy t
     WHERE t.dataset_id = p_dataset_id AND t.field = p_field_key;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION taxonomy_counts(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Primary-field resolution for Charts (no field selector there): the field
--    with the most classified rows, read from the stored rollups when the
--    dataset has classified-to-blob data, else from the sidecar (sql/115 logic).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxonomy_primary_field(p_dataset_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT e.key
       FROM dataset_state ds,
            jsonb_each(ds.analytics -> 'taxonomy' -> 'fields') AS e(key, val)
      WHERE ds.dataset_id = p_dataset_id
      ORDER BY COALESCE((e.val -> 'rollup' ->> 'classifiedRows')::bigint, 0) DESC, e.key
      LIMIT 1),
    (SELECT t.field
       FROM dataset_row_field_taxonomy t
      WHERE t.dataset_id = p_dataset_id
      GROUP BY t.field
      ORDER BY count(*) DESC, t.field
      LIMIT 1)
  );
$$;

-- Whether the primary field's verdicts live in the blob (new path) or still only
-- in the sidecar (pre-backfill). Shared branch condition for the aggregate RPCs.
CREATE OR REPLACE FUNCTION taxonomy_field_in_blob(p_dataset_id uuid, p_field_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id AND (f.data -> '_tx' -> 'f') ? p_field_key
     LIMIT 1
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Charts/Stats aggregate RPCs — same names/signatures as sql/116 (so the
--    /aggregate route and ChartsModule change ZERO code); internals gain a blob
--    leg. Sidecar legs (dynamic SQL, unchanged from 115/116) die in the drop
--    migration. p_row_ids = the view's filtered flat ids (row_id == flat id).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION taxonomy_sub_counts(
  p_dataset_id uuid,
  p_axis       text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(value text, count bigint) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    RETURN QUERY
    SELECT sub::text, count(*)::bigint
      FROM dataset_rows_flat f,
           jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
     WHERE f.dataset_id = p_dataset_id
       AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
     GROUP BY sub
     ORDER BY count(*) DESC;
    RETURN;
  END IF;

  v_col   := 'axis_' || p_axis;
  v_table := 'dataset_row_field_taxonomy';
  v_cond  := format(' AND t.field = %L', v_field);
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS value, count(*)::bigint AS count
       FROM %I t, unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
        AND ($2 IS NULL OR t.row_id = ANY($2))
      GROUP BY sub
      ORDER BY count(*) DESC', v_table, v_col, v_cond
  ) USING p_dataset_id, p_row_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_group_stats(
  p_dataset_id  uuid,
  p_axis        text,
  p_value_field text,
  p_row_ids     bigint[] DEFAULT NULL
)
RETURNS TABLE(
  group_val   text,
  n           bigint,
  min_val     double precision,
  max_val     double precision,
  avg_val     double precision,
  median_val  double precision,
  q1_val      double precision,
  q3_val      double precision,
  stddev_val  double precision
) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    RETURN QUERY
    WITH g AS (
      SELECT sub::text AS gv, (f.data ->> p_value_field)::double precision AS v
        FROM dataset_rows_flat f,
             jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
       WHERE f.dataset_id = p_dataset_id
         AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
         AND f.data ->> p_value_field IS NOT NULL
         AND f.data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
    )
    SELECT gv, count(*)::bigint,
           min(v), max(v), avg(v),
           percentile_cont(0.5)  WITHIN GROUP (ORDER BY v),
           percentile_cont(0.25) WITHIN GROUP (ORDER BY v),
           percentile_cont(0.75) WITHIN GROUP (ORDER BY v),
           stddev_samp(v)
      FROM g
     GROUP BY gv
     ORDER BY count(*) DESC;
    RETURN;
  END IF;

  v_col   := 'axis_' || p_axis;
  v_table := 'dataset_row_field_taxonomy';
  v_cond  := format(' AND t.field = %L', v_field);
  RETURN QUERY EXECUTE format(
    'WITH g AS (
       SELECT sub::text AS gv,
              (f.data ->> $2)::double precision AS v
         FROM %I t
         JOIN dataset_rows_flat f
           ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
              unnest(t.%I) AS sub
        WHERE t.dataset_id = $1 %s
          AND ($3 IS NULL OR t.row_id = ANY($3))
          AND f.data ->> $2 IS NOT NULL
          AND f.data ->> $2 ~ ''^-?[0-9]+\.?[0-9]*$''
     )
     SELECT gv AS group_val,
            count(*)::bigint AS n,
            min(v) AS min_val,
            max(v) AS max_val,
            avg(v) AS avg_val,
            percentile_cont(0.5)  WITHIN GROUP (ORDER BY v) AS median_val,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS q1_val,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS q3_val,
            stddev_samp(v) AS stddev_val
       FROM g
      GROUP BY gv
      ORDER BY count(*) DESC', v_table, v_col, v_cond
  ) USING p_dataset_id, p_value_field, p_row_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_crosstab(
  p_dataset_id uuid,
  p_axis       text,
  p_field      text,
  p_limit      int DEFAULT 50,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(sub_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    RETURN QUERY
    SELECT sub::text,
           COALESCE(f.data ->> p_field, '')::text,
           count(*)::bigint
      FROM dataset_rows_flat f,
           jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
     WHERE f.dataset_id = p_dataset_id
       AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
     GROUP BY sub, f.data ->> p_field
     ORDER BY count(*) DESC
     LIMIT p_limit * p_limit;
    RETURN;
  END IF;

  v_col   := 'axis_' || p_axis;
  v_table := 'dataset_row_field_taxonomy';
  v_cond  := format(' AND t.field = %L', v_field);
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS sub_val,
            COALESCE(f.data ->> $2, '''')::text AS field_val,
            count(*)::bigint AS cnt
       FROM %I t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
        AND ($4 IS NULL OR t.row_id = ANY($4))
      GROUP BY sub, f.data ->> $2
      ORDER BY count(*) DESC
      LIMIT $3', v_table, v_col, v_cond
  ) USING p_dataset_id, p_field, p_limit * p_limit, p_row_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_date_series(
  p_dataset_id   uuid,
  p_axis         text,
  p_date_field   text,
  p_metric_field text DEFAULT NULL,
  p_bucket       text DEFAULT 'day',
  p_row_ids      bigint[] DEFAULT NULL
)
RETURNS TABLE(
  sub_val     text,
  bucket_date text,
  n           bigint,
  avg_val     double precision
) AS $$
DECLARE
  v_col text; v_field text; v_table text; v_cond text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    RETURN QUERY
    SELECT sub::text,
           CASE p_bucket
             WHEN 'week'    THEN to_char(date_trunc('week',  (f.data ->> p_date_field)::date), 'YYYY-MM-DD')
             WHEN 'month'   THEN to_char(date_trunc('month', (f.data ->> p_date_field)::date), 'YYYY-MM')
             WHEN 'quarter' THEN to_char(date_trunc('quarter',(f.data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (f.data ->> p_date_field)::date))::text
             WHEN 'year'    THEN to_char(date_trunc('year',  (f.data ->> p_date_field)::date), 'YYYY')
             ELSE to_char((f.data ->> p_date_field)::date, 'YYYY-MM-DD')
           END,
           count(*)::bigint,
           CASE WHEN p_metric_field IS NOT NULL AND p_metric_field <> '' THEN
             avg((f.data ->> p_metric_field)::double precision) FILTER (WHERE f.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')
           END
      FROM dataset_rows_flat f,
           jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
     WHERE f.dataset_id = p_dataset_id
       AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
       AND f.data ->> p_date_field IS NOT NULL
       AND (f.data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
     GROUP BY 1, 2
     ORDER BY 1, 2;
    RETURN;
  END IF;

  v_col   := 'axis_' || p_axis;
  v_table := 'dataset_row_field_taxonomy';
  v_cond  := format(' AND t.field = %L', v_field);
  RETURN QUERY EXECUTE format(
    'SELECT sub::text AS sub_val,
            CASE $3
              WHEN ''week''    THEN to_char(date_trunc(''week'',  (f.data ->> $2)::date), ''YYYY-MM-DD'')
              WHEN ''month''   THEN to_char(date_trunc(''month'', (f.data ->> $2)::date), ''YYYY-MM'')
              WHEN ''quarter'' THEN to_char(date_trunc(''quarter'',(f.data ->> $2)::date), ''YYYY'') || ''-Q'' || extract(quarter from date_trunc(''quarter'', (f.data ->> $2)::date))::text
              WHEN ''year''    THEN to_char(date_trunc(''year'',  (f.data ->> $2)::date), ''YYYY'')
              ELSE to_char((f.data ->> $2)::date, ''YYYY-MM-DD'')
            END AS bucket_date,
            count(*)::bigint AS n,
            CASE WHEN $4 IS NOT NULL AND $4 != '''' THEN
              avg((f.data ->> $4)::double precision) FILTER (WHERE f.data ->> $4 ~ ''^-?[0-9]+\.?[0-9]*$'')
            ELSE NULL END AS avg_val
       FROM %I t
       JOIN dataset_rows_flat f
         ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
            unnest(t.%I) AS sub
      WHERE t.dataset_id = $1 %s
        AND ($5 IS NULL OR t.row_id = ANY($5))
        AND f.data ->> $2 IS NOT NULL
        AND (f.data ->> $2) ~ ''^\d{4}-\d{2}-\d{2}''
      GROUP BY sub, bucket_date
      ORDER BY sub, bucket_date', v_table, v_col, v_cond
  ) USING p_dataset_id, p_date_field, p_bucket, p_metric_field, p_row_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION taxonomy_axis_crosstab(
  p_dataset_id uuid,
  p_field      text,
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS TABLE(axis_val text, field_val text, cnt bigint) AS $$
DECLARE
  v_field text; v_cond text;
  v_axes  text[] := ARRAY['touchpoint','attribute','product','beverage','ambiance','context','outcome'];
  v_axis  text;
  v_union text := '';
BEGIN
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    -- One scan: jsonb_each over the axes object replaces the 7-way UNION.
    RETURN QUERY
    SELECT ax.key::text,
           COALESCE(f.data ->> p_field, '')::text,
           count(*)::bigint
      FROM dataset_rows_flat f,
           jsonb_each(f.data -> '_tx' -> 'f' -> v_field -> 'a') AS ax(key, subs),
           jsonb_array_elements_text(ax.subs) AS sub
     WHERE f.dataset_id = p_dataset_id
       AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
     GROUP BY ax.key, f.data ->> p_field;
    RETURN;
  END IF;

  v_cond := format(' AND t.field = %L', v_field);
  FOREACH v_axis IN ARRAY v_axes LOOP
    v_union := v_union
      || CASE WHEN v_union = '' THEN '' ELSE ' UNION ALL ' END
      || format(
           'SELECT %L::text AS axis_val,
                   COALESCE(f.data ->> $2, '''')::text AS field_val,
                   count(*)::bigint AS cnt
              FROM dataset_row_field_taxonomy t
              JOIN dataset_rows_flat f
                ON f.id = t.row_id AND f.dataset_id = t.dataset_id,
                   unnest(t.%I) AS sub
             WHERE t.dataset_id = $1 %s
               AND ($3 IS NULL OR t.row_id = ANY($3))
             GROUP BY f.data ->> $2',
           v_axis, 'axis_' || v_axis, v_cond
         );
  END LOOP;

  RETURN QUERY EXECUTE v_union USING p_dataset_id, p_field, p_row_ids;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Theme × Dimension chips (sql/111) — blob leg + sidecar fallback.
--    The legacy leg read the field-agnostic table; both legs now use the
--    dataset's primary classified field, so the two reconcile.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION theme_dimension_counts(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords   text[],
  p_limit      int DEFAULT 8
)
RETURNS TABLE(axis text, sub text, count bigint) AS $$
DECLARE
  pattern text;
  v_field text;
BEGIN
  -- Single word-boundary, case-insensitive alternation, same as count_theme_matches.
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;

  IF taxonomy_field_in_blob(p_dataset_id, v_field) THEN
    RETURN QUERY
    WITH matched AS (
      SELECT DISTINCT drf.id, drf.data
        FROM dataset_rows_flat drf,
             LATERAL unnest(p_field_keys) AS fk(key)
       WHERE drf.dataset_id = p_dataset_id
         AND drf.data ->> fk.key IS NOT NULL
         AND drf.data ->> fk.key != ''
         AND drf.data ->> fk.key ~* pattern
    )
    SELECT ax.key::text, sb::text, count(*)::bigint
      FROM matched m,
           jsonb_each(m.data -> '_tx' -> 'f' -> v_field -> 'a') AS ax(key, subs),
           jsonb_array_elements_text(ax.subs) AS sb
     GROUP BY ax.key, sb
     ORDER BY count(*) DESC
     LIMIT p_limit;
    RETURN;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT DISTINCT drf.id
      FROM dataset_rows_flat drf,
           LATERAL unnest(p_field_keys) AS fk(key)
     WHERE drf.dataset_id = p_dataset_id
       AND drf.data ->> fk.key IS NOT NULL
       AND drf.data ->> fk.key != ''
       AND drf.data ->> fk.key ~* pattern
  ),
  tagged AS (
    SELECT t.axis_touchpoint, t.axis_attribute, t.axis_product, t.axis_beverage,
           t.axis_ambiance, t.axis_context, t.axis_outcome
      FROM dataset_row_field_taxonomy t
      JOIN matched m ON m.id = t.row_id
     WHERE t.dataset_id = p_dataset_id
       AND t.field = v_field
  ),
  expanded AS (
    SELECT 'touchpoint'::text AS ax, s::text AS sb FROM tagged, unnest(axis_touchpoint) s
    UNION ALL SELECT 'attribute', s::text FROM tagged, unnest(axis_attribute) s
    UNION ALL SELECT 'product',   s::text FROM tagged, unnest(axis_product)   s
    UNION ALL SELECT 'beverage',  s::text FROM tagged, unnest(axis_beverage)  s
    UNION ALL SELECT 'ambiance',  s::text FROM tagged, unnest(axis_ambiance)  s
    UNION ALL SELECT 'context',   s::text FROM tagged, unnest(axis_context)   s
    UNION ALL SELECT 'outcome',   s::text FROM tagged, unnest(axis_outcome)   s
  )
  SELECT ax, sb, count(*)::bigint
    FROM expanded
   GROUP BY ax, sb
   ORDER BY count(*) DESC
   LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Combined Comments filter (sql/113) — dimension facet gains a blob leg.
--    Same signature; theme/entity facets unchanged. The dimension test resolves
--    the primary field once, then checks the blob when that field is embedded,
--    else the legacy sidecar (which was field-agnostic — pre-backfill behavior
--    is unchanged).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_rows_by_filters(
  p_dataset_ids    uuid[],
  p_text_fields    jsonb,
  p_theme_query    text    DEFAULT NULL,
  p_entity_query   text    DEFAULT NULL,
  p_sub_touchpoint text[]  DEFAULT NULL,
  p_sub_attribute  text[]  DEFAULT NULL,
  p_sub_product    text[]  DEFAULT NULL,
  p_sub_beverage   text[]  DEFAULT NULL,
  p_sub_ambiance   text[]  DEFAULT NULL,
  p_sub_context    text[]  DEFAULT NULL,
  p_sub_outcome    text[]  DEFAULT NULL,
  p_has_dim        boolean DEFAULT false,
  p_limit          int     DEFAULT 200,
  p_offset         int     DEFAULT 0
)
RETURNS TABLE(id bigint, dataset_id uuid, row_index int, data jsonb, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fields jsonb := '{}'::jsonb;  -- dataset_id -> primary field key (blob-classified datasets only)
  v_ds uuid;
  v_f  text;
BEGIN
  -- Resolve each dataset's blob field once (the comments scope is a handful of
  -- datasets at most). Datasets not in the map use the sidecar leg.
  IF p_has_dim THEN
    FOREACH v_ds IN ARRAY p_dataset_ids LOOP
      v_f := taxonomy_primary_field(v_ds);
      IF v_f IS NOT NULL AND taxonomy_field_in_blob(v_ds, v_f) THEN
        v_fields := v_fields || jsonb_build_object(v_ds::text, v_f);
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
      -- Theme facet: FTS prefilter on the GIN-indexed tsv + an open-ended
      -- recheck (so a keyword in a structured column doesn't match).
      AND (
        p_theme_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_theme_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_theme_query)
          )
        )
      )
      -- Entity facet: same prefilter + open-ended recheck, independent query.
      AND (
        p_entity_query IS NULL
        OR (
          r.tsv @@ websearch_to_tsquery('english', p_entity_query)
          AND (
            p_text_fields IS NULL
            OR to_tsvector('english', COALESCE(
                 (SELECT string_agg(r.data ->> fld, ' ')
                    FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
                 '')
               ) @@ websearch_to_tsquery('english', p_entity_query)
          )
        )
      )
      -- Dimension facet: blob axes when the dataset is embedded, else the
      -- legacy sidecar array-overlap. OR within the facet, per axis.
      AND (
        NOT p_has_dim
        OR (
          v_fields ? r.dataset_id::text
          AND (
            (p_sub_touchpoint IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'touchpoint') ?| p_sub_touchpoint) OR
            (p_sub_attribute  IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'attribute')  ?| p_sub_attribute)  OR
            (p_sub_product    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'product')    ?| p_sub_product)    OR
            (p_sub_beverage   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'beverage')   ?| p_sub_beverage)   OR
            (p_sub_ambiance   IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'ambiance')   ?| p_sub_ambiance)   OR
            (p_sub_context    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'context')    ?| p_sub_context)    OR
            (p_sub_outcome    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'outcome')    ?| p_sub_outcome)
          )
        )
        OR (
          NOT (v_fields ? r.dataset_id::text)
          AND EXISTS (
            SELECT 1 FROM public.dataset_row_taxonomy t
            WHERE t.dataset_id = r.dataset_id
              AND t.row_id = r.id
              AND (
                (p_sub_touchpoint IS NOT NULL AND t.axis_touchpoint && p_sub_touchpoint) OR
                (p_sub_attribute  IS NOT NULL AND t.axis_attribute  && p_sub_attribute)  OR
                (p_sub_product    IS NOT NULL AND t.axis_product    && p_sub_product)    OR
                (p_sub_beverage   IS NOT NULL AND t.axis_beverage   && p_sub_beverage)   OR
                (p_sub_ambiance   IS NOT NULL AND t.axis_ambiance   && p_sub_ambiance)   OR
                (p_sub_context    IS NOT NULL AND t.axis_context    && p_sub_context)    OR
                (p_sub_outcome    IS NOT NULL AND t.axis_outcome    && p_sub_outcome)
              )
          )
        )
      )
  )
  SELECT m.id, m.dataset_id, m.row_index, m.data - '_tx', count(*) OVER() AS total_count
  FROM matched m
  ORDER BY m.row_index
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], boolean, int, int) IS
  'Comments matching ALL active facets (theme keywords AND entity terms AND dimension tags), OR within each facet. Dimension facet reads embedded data._tx axes (sql/151) with a legacy dataset_row_taxonomy fallback for pre-backfill datasets. total_count is the window count for pagination.';

GRANT EXECUTE ON FUNCTION public.get_rows_by_filters(uuid[], jsonb, text, text, text[], text[], text[], text[], text[], text[], text[], boolean, int, int) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Pending rows (sql/117) — a row is pending when NEITHER the blob NOR the
--    sidecar has its verdict for the field key. (The sidecar leg keeps the
--    pre-push window sane: old deployed code still writes sidecars, and without
--    it every already-classified row would look pending. Leg dies in the drop
--    migration.) dataset_rows_with_text_count (sql/117) is unchanged — it never
--    referenced the taxonomy tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dataset_rows_pending_field_taxonomy(
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
     AND NOT ((f.data -> '_tx' -> 'f') ? p_field_key)
     AND t.row_id IS NULL
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   ORDER BY f.row_index
   LIMIT p_limit;
$$;

COMMIT;

-- Verify
SELECT 'apply_taxonomy_verdicts' AS object,
       CASE WHEN to_regprocedure('public.apply_taxonomy_verdicts(uuid,text,jsonb)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END AS status
UNION ALL
SELECT 'taxonomy_rows_for_field',
       CASE WHEN to_regprocedure('public.taxonomy_rows_for_field(uuid,text,text,text,int,int)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'taxonomy_drill_rows',
       CASE WHEN to_regprocedure('public.taxonomy_drill_rows(uuid,text,text,text,text,int)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'taxonomy_counts',
       CASE WHEN to_regprocedure('public.taxonomy_counts(uuid,text)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'taxonomy_field_in_blob',
       CASE WHEN to_regprocedure('public.taxonomy_field_in_blob(uuid,text)') IS NOT NULL
            THEN 'ready' ELSE 'MISSING' END;
