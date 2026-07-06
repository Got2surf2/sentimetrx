-- 158_emotion_axis.sql
-- Emotion-language flags as an 8th embedded axis (2026-07-06).
--
-- lib/emotionFlags.ts now emits keyword-tier `emotion` assertions
-- (disappointment / blame / churn intent) into data._tx.f[key].a.emotion
-- beside the 7 ABSA axes. The embed shape is unchanged — this migration only
-- widens the axis allow-lists so the read RPCs accept 'emotion':
--
--   1. taxonomy_sub_counts / taxonomy_group_stats / taxonomy_crosstab /
--      taxonomy_date_series / taxonomy_drill_rows — add 'emotion' to the
--      p_axis IN (...) guard. Bodies otherwise identical (axis is a jsonb
--      path key, so no other change is needed).
--   2. get_rows_by_filters — new p_sub_emotion facet param (TextMine unified
--      Comments filter). Signature changes, so the old function is DROPPED
--      first (CREATE OR REPLACE with a different arg list would create an
--      ambiguous overload for PostgREST).
--
-- taxonomy_axis_crosstab needs no change (jsonb_each over whatever axes the
-- block holds). The LLM extractor's closed vocabulary still excludes
-- 'emotion' — the axis is keyword-tier only until the LLM tier ships.
--
-- Existing rows are v3 (no emotion key) until re-classified; every reader
-- treats a missing axis as empty, so this is backward-compatible.

BEGIN;

-- ── 1. Axis-guard widening ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("value" "text", "count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT sub::text, count(*)::bigint
    FROM dataset_rows_flat f,
         jsonb_array_elements_text(f.data -> '_tx' -> 'f' -> v_field -> 'a' -> p_axis) AS sub
   WHERE f.dataset_id = p_dataset_id
     AND (p_row_ids IS NULL OR f.id = ANY(p_row_ids))
   GROUP BY sub
   ORDER BY count(*) DESC;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("group_val" "text", "n" bigint, "min_val" double precision, "max_val" double precision, "avg_val" double precision, "median_val" double precision, "q1_val" double precision, "q3_val" double precision, "stddev_val" double precision)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
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
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer DEFAULT 50, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("sub_val" "text", "field_val" "text", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
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
END;
$$;

CREATE OR REPLACE FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text" DEFAULT NULL::"text", "p_bucket" "text" DEFAULT 'day'::"text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("sub_val" "text", "bucket_date" "text", "n" bigint, "avg_val" double precision)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
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
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."taxonomy_drill_rows"("p_dataset_id" "uuid", "p_field_key" "text", "p_axis" "text" DEFAULT NULL::"text", "p_sub" "text" DEFAULT NULL::"text", "p_alert" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 100) RETURNS TABLE("row_id" bigint, "data" "jsonb", "tx" "jsonb", "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_axis IS NOT NULL AND p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
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
END;
$$;

-- ── 2. get_rows_by_filters: new p_sub_emotion facet ──────────────────────────
-- Different arg list = a new overload, so drop the old signature first.

DROP FUNCTION IF EXISTS "public"."get_rows_by_filters"("uuid"[], "jsonb", "text", "text", "text"[], "text"[], "text"[], "text"[], "text"[], "text"[], "text"[], boolean, integer, integer);

CREATE OR REPLACE FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text" DEFAULT NULL::"text", "p_entity_query" "text" DEFAULT NULL::"text", "p_sub_touchpoint" "text"[] DEFAULT NULL::"text"[], "p_sub_attribute" "text"[] DEFAULT NULL::"text"[], "p_sub_product" "text"[] DEFAULT NULL::"text"[], "p_sub_beverage" "text"[] DEFAULT NULL::"text"[], "p_sub_ambiance" "text"[] DEFAULT NULL::"text"[], "p_sub_context" "text"[] DEFAULT NULL::"text"[], "p_sub_outcome" "text"[] DEFAULT NULL::"text"[], "p_sub_emotion" "text"[] DEFAULT NULL::"text"[], "p_has_dim" boolean DEFAULT false, "p_limit" integer DEFAULT 200, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" bigint, "dataset_id" "uuid", "row_index" integer, "data" "jsonb", "total_count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_fields jsonb := '{}'::jsonb;  -- dataset_id -> primary field key
  v_ds uuid;
  v_f  text;
BEGIN
  IF p_has_dim THEN
    FOREACH v_ds IN ARRAY p_dataset_ids LOOP
      v_f := taxonomy_primary_field(v_ds);
      IF v_f IS NOT NULL THEN
        v_fields := v_fields || jsonb_build_object(v_ds::text, v_f);
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
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
            (p_sub_outcome    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'outcome')    ?| p_sub_outcome)    OR
            (p_sub_emotion    IS NOT NULL AND (r.data -> '_tx' -> 'f' -> (v_fields ->> r.dataset_id::text) -> 'a' -> 'emotion')    ?| p_sub_emotion)
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

ALTER FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) OWNER TO "postgres";

GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";

COMMENT ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) IS 'Comments matching ALL active facets (theme keywords AND entity terms AND dimension tags), OR within each facet. Dimension facet reads embedded data._tx axes (sql/151, emotion axis sql/158). total_count is the window count for pagination.';
COMMIT;
