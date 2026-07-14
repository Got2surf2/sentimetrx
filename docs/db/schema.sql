


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ana_try_parse_ts"("p_val" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
BEGIN
  RETURN p_val::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END $$;


ALTER FUNCTION "public"."ana_try_parse_ts"("p_val" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_entity_mention_counts"("p_scope_type" "text", "p_scope_id" "uuid", "p_row_total" bigint, "p_sampled" boolean, "p_counts" "jsonb") RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH upd AS (
    UPDATE entity_catalog ec
    SET mention_count           = (p_counts ->> ec.slug)::int,
        mention_count_sampled   = p_sampled,
        mention_count_row_total = p_row_total,
        mention_count_at        = now()
    FROM jsonb_object_keys(p_counts) AS k(slug)
    WHERE ec.scope_type = p_scope_type
      AND ec.scope_id   = p_scope_id
      AND ec.slug       = k.slug
    RETURNING 1
  )
  SELECT count(*)::int FROM upd;
$$;


ALTER FUNCTION "public"."apply_entity_mention_counts"("p_scope_type" "text", "p_scope_id" "uuid", "p_row_total" bigint, "p_sampled" boolean, "p_counts" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_entity_mention_counts"("p_scope_type" "text", "p_scope_id" "uuid", "p_row_total" bigint, "p_sampled" boolean, "p_counts" "jsonb") IS 'Batched write of getEntitiesWithCounts'' computed mention counts back onto entity_catalog (keyed by slug), with the scope row-total staleness key. sql/172.';



CREATE OR REPLACE FUNCTION "public"."apply_taxonomy_verdicts"("p_dataset_id" "uuid", "p_field_key" "text", "p_items" "jsonb") RETURNS bigint
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."apply_taxonomy_verdicts"("p_dataset_id" "uuid", "p_field_key" "text", "p_items" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."archive_dataset"("p_dataset_id" "uuid", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Copy rows to archive tables
  INSERT INTO archived_dataset_rows (dataset_id, batch_index, rows, row_count, source_ref, created_at)
  SELECT dataset_id, batch_index, rows, row_count, source_ref, created_at
  FROM dataset_rows WHERE dataset_id = p_dataset_id;

  INSERT INTO archived_dataset_rows_flat (dataset_id, row_index, data, created_at)
  SELECT dataset_id, row_index, data, created_at
  FROM dataset_rows_flat WHERE dataset_id = p_dataset_id;

  -- Delete from primary tables
  DELETE FROM dataset_rows_flat WHERE dataset_id = p_dataset_id;
  DELETE FROM dataset_rows WHERE dataset_id = p_dataset_id;

  -- Mark dataset as archived
  UPDATE datasets SET
    status = 'archived',
    archived_at = now(),
    archived_by = p_user_id,
    updated_at = now()
  WHERE id = p_dataset_id;
END;
$$;


ALTER FUNCTION "public"."archive_dataset"("p_dataset_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) RETURNS TABLE("bot_id" "uuid", "session_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    bot_id,
    count(DISTINCT session_id)::bigint AS session_count
  FROM bot_conversation_turns
  WHERE bot_id = ANY(p_bot_ids)
  GROUP BY bot_id;
$$;


ALTER FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."campaign_unsubscribe"("p_token" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  UPDATE campaign_respondents
  SET status = 'unsubscribed'
  WHERE unsubscribe_token = p_token
    AND status != 'unsubscribed';
  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."campaign_unsubscribe"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer DEFAULT 60000) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_now    TIMESTAMPTZ := now();
  v_count  INT;
  v_reset  TIMESTAMPTZ;
BEGIN
  INSERT INTO rate_limit_buckets(key, count, reset_at)
  VALUES (p_key, 1, v_now + (p_window_ms::text || ' ms')::interval)
  ON CONFLICT (key) DO UPDATE SET
    count    = CASE
                 WHEN rate_limit_buckets.reset_at < v_now THEN 1
                 ELSE rate_limit_buckets.count + 1
               END,
    reset_at = CASE
                 WHEN rate_limit_buckets.reset_at < v_now
                   THEN v_now + (p_window_ms::text || ' ms')::interval
                 ELSE rate_limit_buckets.reset_at
               END
  RETURNING count, reset_at INTO v_count, v_reset;

  RETURN jsonb_build_object(
    'limited',   v_count > p_max_requests,
    'remaining', GREATEST(0, p_max_requests - v_count),
    'reset_at',  v_reset
  );
END;
$$;


ALTER FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_rate_limit_buckets"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM rate_limit_buckets
  WHERE reset_at < now() - interval '1 hour';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_rate_limit_buckets"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_theme_cooccurrence_matrix"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  result jsonb;
BEGIN
  IF p_themes IS NULL OR jsonb_array_length(p_themes) = 0 THEN
    RETURN '{}'::jsonb;
  END IF;

  WITH theme_patterns AS (
    SELECT
      (theme->>'id') AS theme_id,
      '\m(' || (
        SELECT string_agg(kw, '|')
        FROM jsonb_array_elements_text(theme->'keywords') AS kw
        WHERE kw <> ''
      ) || ')' AS pattern
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  row_combined AS (
    SELECT
      drf.id,
      string_agg(coalesce(drf.data ->> k, ''), ' ') AS combined_text
    FROM dataset_rows_flat drf, unnest(p_field_keys) AS k
    WHERE drf.dataset_id = p_dataset_id
    GROUP BY drf.id
  ),
  row_themes AS (
    SELECT
      rc.id AS row_id,
      array_agg(tp.theme_id) AS theme_ids
    FROM row_combined rc
    JOIN theme_patterns tp ON rc.combined_text ~* tp.pattern
    GROUP BY rc.id
    HAVING count(*) >= 2  -- A row with only 1 matched theme has no pairs to emit
  ),
  pair_counts AS (
    SELECT
      a AS theme_a,
      b AS theme_b,
      count(*) AS pair_count
    FROM row_themes,
         LATERAL unnest(theme_ids) AS a,
         LATERAL unnest(theme_ids) AS b
    WHERE a != b
    GROUP BY a, b
  ),
  by_a AS (
    SELECT theme_a, jsonb_object_agg(theme_b, pair_count) AS bs
    FROM pair_counts
    GROUP BY theme_a
  )
  SELECT coalesce(jsonb_object_agg(theme_a, bs), '{}'::jsonb)
    INTO result
  FROM by_a;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."compute_theme_cooccurrence_matrix"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text" DEFAULT NULL::"text", "p_text_fields" "jsonb" DEFAULT NULL::"jsonb") RETURNS TABLE("term" "text", "row_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT
    t.term,
    count(r.id) AS row_count
  FROM unnest(p_terms) AS t(term)
  LEFT JOIN public.dataset_rows_flat r
    ON  r.dataset_id = ANY(p_dataset_ids)
    AND r.tsv @@ websearch_to_tsquery('english', t.term)          -- GIN-indexed prefilter
    AND (
      p_text_fields IS NULL
      OR to_tsvector('english', COALESCE(
           (SELECT string_agg(r.data ->> fld, ' ')
              FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
           '')
         ) @@ websearch_to_tsquery('english', t.term)            -- exact recheck: open-ended fields only
    )
    AND (
      p_theme_query IS NULL
      OR r.tsv @@ websearch_to_tsquery('english', p_theme_query)  -- theme keywords stay on the full row
    )
  GROUP BY t.term;
$$;


ALTER FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "jsonb") IS 'Live full-text row counts for entity catalog terms. tsv prefilter + exact recheck against p_text_fields (open-ended fields per dataset) so counts reflect reviews that mention an entity, not rows that merely carry it as a structured label. p_text_fields NULL = legacy full-tsv match.';



CREATE OR REPLACE FUNCTION "public"."count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_limit" integer DEFAULT 200, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("value" "text", "count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (data ->> p_field_key)::text AS value,
    count(*)::bigint AS count
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_field_key IS NOT NULL
    AND data ->> p_field_key != ''
  GROUP BY data ->> p_field_key
  ORDER BY count(*) DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_nonempty_rows"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT count(*)
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR drf.id = ANY(p_row_ids))
    AND NULLIF(btrim(drf.data ->> p_field), '') IS NOT NULL;
$$;


ALTER FUNCTION "public"."count_nonempty_rows"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_theme_intersection"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords_a" "text"[], "p_keywords_b" "text"[]) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  pattern_a text;
  pattern_b text;
  total bigint;
BEGIN
  IF array_length(p_keywords_a, 1) IS NULL OR array_length(p_keywords_b, 1) IS NULL THEN
    RETURN 0;
  END IF;

  pattern_a := '\m(' || array_to_string(p_keywords_a, '|') || ')';
  pattern_b := '\m(' || array_to_string(p_keywords_b, '|') || ')';

  SELECT count(DISTINCT drf.id) INTO total
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND EXISTS (
      SELECT 1 FROM unnest(p_field_keys) AS k
      WHERE drf.data ->> k IS NOT NULL
        AND drf.data ->> k != ''
        AND drf.data ->> k ~* pattern_a
    )
    AND EXISTS (
      SELECT 1 FROM unnest(p_field_keys) AS k
      WHERE drf.data ->> k IS NOT NULL
        AND drf.data ->> k != ''
        AND drf.data ->> k ~* pattern_b
    );

  RETURN total;
END;
$$;


ALTER FUNCTION "public"."count_theme_intersection"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords_a" "text"[], "p_keywords_b" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_theme_matches"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  pattern text;
  total bigint;
BEGIN
  -- Build a single regex pattern: \m(kw1|kw2|kw3) (word boundary, case-insensitive)
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  SELECT count(DISTINCT drf.id) INTO total
  FROM dataset_rows_flat drf,
       LATERAL unnest(p_field_keys) AS fk(key)
  WHERE drf.dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR drf.id = ANY(p_row_ids))
    AND drf.data ->> fk.key IS NOT NULL
    AND drf.data ->> fk.key != ''
    AND drf.data ->> fk.key ~* pattern;

  RETURN total;
END;
$$;


ALTER FUNCTION "public"."count_theme_matches"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_limit" integer DEFAULT 50, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("row_val" "text", "col_val" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(data ->> p_row_field, '')::text AS row_val,
    COALESCE(data ->> p_col_field, '')::text AS col_val,
    count(*)::bigint AS cnt
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_row_field IS NOT NULL
    AND data ->> p_row_field != ''
  GROUP BY data ->> p_row_field, data ->> p_col_field
  ORDER BY cnt DESC
  LIMIT p_limit * p_limit;
END;
$$;


ALTER FUNCTION "public"."crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_client_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT client_id FROM public.users WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."current_client_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_org_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."current_org_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dataset_field_values"("p_dataset_id" "uuid", "p_field" "text", "p_ids" bigint[]) RETURNS TABLE("id" bigint, "val" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT f.id, f.data ->> p_field AS val
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND f.id = ANY(p_ids)
     AND f.data ->> p_field IS NOT NULL;
$$;


ALTER FUNCTION "public"."dataset_field_values"("p_dataset_id" "uuid", "p_field" "text", "p_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field" "text", "p_limit" integer DEFAULT 1000) RETURNS TABLE("id" bigint, "data" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
    LEFT JOIN dataset_row_field_taxonomy t
      ON t.dataset_id = f.dataset_id AND t.row_id = f.id AND t.field = p_field
   WHERE f.dataset_id = p_dataset_id
     AND t.row_id IS NULL
     -- "Has real text" must match the keyword classifier, which strips control
     -- chars + whitespace before deciding a row is empty. A plain btrim (spaces
     -- only) counts tab/newline/control-only rows as text → they'd be "pending"
     -- forever (the classifier writes no row for them). Strip all whitespace +
     -- control chars and check what's left.
     AND COALESCE(regexp_replace(f.data ->> p_field, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
   ORDER BY f.row_index
   LIMIT p_limit;
$$;


ALTER FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field_key" "text", "p_fields" "text"[], "p_limit" integer DEFAULT 1000, "p_after_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("id" bigint, "data" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (p_after_id IS NULL OR f.id > p_after_id)
     AND NOT ((f.data -> '_tx' -> 'f') ? p_field_key)
     AND EXISTS (
       SELECT 1 FROM unnest(p_fields) AS fld
        WHERE COALESCE(regexp_replace(f.data ->> fld, '[[:space:][:cntrl:]]+', '', 'g'), '') <> ''
     )
   -- legacy calls keep row_index order; keyset calls page by id
   ORDER BY CASE WHEN p_after_id IS NULL THEN f.row_index END, f.id
   LIMIT p_limit;
$$;


ALTER FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field_key" "text", "p_fields" "text"[], "p_limit" integer, "p_after_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dataset_rows_pending_taxonomy"("p_dataset_id" "uuid", "p_text_field" "text", "p_limit" integer DEFAULT 1000) RETURNS TABLE("id" bigint, "data" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT f.id, f.data
    FROM dataset_rows_flat f
    LEFT JOIN dataset_row_taxonomy t
      ON t.dataset_id = f.dataset_id AND t.row_id = f.id
   WHERE f.dataset_id = p_dataset_id
     AND t.row_id IS NULL
     AND COALESCE(btrim(f.data ->> p_text_field), '') <> ''
   ORDER BY f.row_index
   LIMIT p_limit;
$$;


ALTER FUNCTION "public"."dataset_rows_pending_taxonomy"("p_dataset_id" "uuid", "p_text_field" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dataset_rows_with_text_count"("p_dataset_id" "uuid", "p_field" "text") RETURNS bigint
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT count(*)
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     -- Same "has real text" test as the classifier (strip whitespace + control),
     -- so this denominator == rows the classifier actually tags. Avoids a
     -- perpetual "N rows aren't tagged" drift nudge for whitespace-only rows.
     AND COALESCE(regexp_replace(f.data ->> p_field, '[[:space:][:cntrl:]]+', '', 'g'), '') <> '';
$$;


ALTER FUNCTION "public"."dataset_rows_with_text_count"("p_dataset_id" "uuid", "p_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text" DEFAULT NULL::"text", "p_bucket" "text" DEFAULT 'day'::"text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("bucket_date" "text", "n" bigint, "avg_val" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_bucket
      WHEN 'week' THEN to_char(date_trunc('week', (data ->> p_date_field)::date), 'YYYY-MM-DD')
      WHEN 'month' THEN to_char(date_trunc('month', (data ->> p_date_field)::date), 'YYYY-MM')
      WHEN 'quarter' THEN to_char(date_trunc('quarter', (data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (data ->> p_date_field)::date))::text
      WHEN 'year' THEN to_char(date_trunc('year', (data ->> p_date_field)::date), 'YYYY')
      ELSE to_char((data ->> p_date_field)::date, 'YYYY-MM-DD')
    END AS bucket_date,
    count(*)::bigint AS n,
    CASE
      WHEN p_metric_field IS NOT NULL AND p_metric_field != '' THEN
        avg((data ->> p_metric_field)::double precision) FILTER (WHERE data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')
      ELSE NULL
    END AS avg_val
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
    AND data ->> p_date_field IS NOT NULL
    AND data ->> p_date_field != ''
    AND (data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
  GROUP BY bucket_date
  ORDER BY bucket_date;
END;
$_$;


ALTER FUNCTION "public"."date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE dataset_state
  SET analytics = COALESCE(analytics, '{}'::jsonb) - p_key
  WHERE dataset_id = p_dataset_id;
$$;


ALTER FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") IS 'Atomically removes one top-level key from dataset_state.analytics. Replaces a racy read-modify-write.';



CREATE OR REPLACE FUNCTION "public"."drf_tsv_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."drf_tsv_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."extract_theme_topical_words"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_extra_excludes" "text"[] DEFAULT ARRAY[]::"text"[], "p_max_results" integer DEFAULT 5) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  pattern text;
  result jsonb;
BEGIN
  IF array_length(p_keywords, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';

  WITH matching_rows AS (
    SELECT DISTINCT drf.id, drf.data
    FROM dataset_rows_flat drf
    WHERE drf.dataset_id = p_dataset_id
      AND EXISTS (
        SELECT 1 FROM unnest(p_field_keys) AS k
        WHERE drf.data ->> k IS NOT NULL
          AND drf.data ->> k != ''
          AND drf.data ->> k ~* pattern
      )
  ),
  row_text AS (
    SELECT mr.id,
           string_agg(lower(coalesce(mr.data ->> k, '')), ' ') AS combined_text
    FROM matching_rows mr, unnest(p_field_keys) AS k
    GROUP BY mr.id
  ),
  -- Tokenize each row's text into (word, position) tuples. WITH ORDINALITY
  -- numbers the tokens 1..N in document order.
  tokens AS (
    SELECT rt.id, tk.word, tk.pos
    FROM row_text rt,
         LATERAL unnest(regexp_split_to_array(rt.combined_text, '[^a-z0-9'']+'))
           WITH ORDINALITY AS tk(word, pos)
    WHERE tk.word IS NOT NULL AND tk.word != ''
  ),
  -- Positions where a keyword stem appears (regex-matched, same word-
  -- boundary semantics as count_theme_matches).
  kw_positions AS (
    SELECT id, pos FROM tokens WHERE word ~* pattern
  ),
  -- The ±2 window: every token within 2 positions of a keyword hit,
  -- excluding the keyword position itself. A token sitting between two
  -- nearby keywords gets credited to both (matches old client behavior).
  window_words AS (
    SELECT t.word
    FROM tokens t
    JOIN kw_positions kp ON t.id = kp.id
    WHERE t.pos BETWEEN kp.pos - 2 AND kp.pos + 2
      AND t.pos != kp.pos
  ),
  filtered AS (
    SELECT word, count(*) AS cnt
    FROM window_words
    WHERE length(word) >= 3
      AND word !~ '^[0-9]+$'
      AND word !~* pattern                   -- exclude keyword stems
      AND NOT (word = ANY(p_extra_excludes))
      AND word NOT IN (
        -- Stopwords + sentiment adjectives, kept in sync with the
        -- client-side lists. If you edit one, edit the other.
        'a','an','the','this','that','these','those',
        'i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs','myself','yourself','itself','themselves',
        'is','are','was','were','be','been','being','am','have','has','had','do','does','did','done','doing','will','would','should','could','can','may','might','must','shall',
        'get','got','gets','getting','go','goes','went','going','gone','come','came','comes','coming','make','made','makes','making','take','took','takes','taking','give','gave','gives','giving','say','said','says','saying','see','saw','sees','seeing','seen','know','knew','knows','knowing','known','think','thought','thinks','thinking','feel','felt','feels','want','wanted','wants','need','needed','needs','try','tried','tries','use','used','uses','find','found','finds','put','puts','let','lets','keep','kept','keeps','seem','seemed','seems','look','looked','looks','looking','tell','told','tells','telling','ask','asked','asks','asking','show','showed','shows','call','called','calls','calling',
        'in','on','at','to','for','of','with','by','from','about','as','into','through','onto','upon','over','under','between','after','before','during','since','until','while','within','without','around','near',
        'and','or','nor','but','so','because','if','when','then','than','though','although','however','also','plus','yet','still','either','neither','whether',
        'very','really','quite','just','too','still','even','only','always','never','sometimes','often','rarely','usually','almost','nearly','already','probably','definitely','actually','basically','literally','barely','simply','exactly','especially',
        'highly','absolutely','completely','totally','extremely','incredibly','remarkably','thoroughly','truly','genuinely','particularly','specifically','consistently','frequently','occasionally','constantly','perfectly','utterly','fully','entirely','clearly','obviously','certainly','surely','strongly','heavily','deeply','widely',
        'here','there','where','everywhere','anywhere','somewhere','now','today','tonight','tomorrow','yesterday','soon','later','earlier','ever',
        'how','what','which','who','whom','whose','why',
        'all','some','any','many','much','more','most','less','least','few','several','enough','little','lot','lots',
        'other','others','another','same','different','similar','such','own','new','old','first','last','next','recent',
        'not','no','yes','none','nothing','anything','something','everything',
        'one','two','three','four','five','six','seven','eight','nine','ten','time','times','day','days','night','nights','minute','minutes','hour','hours','week','weeks','month','months','year','years',
        'way','ways','thing','things','place','people','person','someone','everyone','anyone',
        'back','again','ago',
        -- Sentiment adjectives — covered by sentiment color, not topical
        'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','exceptional','satisfying','refreshing','favorite','love','loved','recommend',
        'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'
      )
    GROUP BY word
    ORDER BY count(*) DESC
    LIMIT p_max_results
  )
  SELECT coalesce(jsonb_agg(jsonb_build_array(word, cnt)), '[]'::jsonb)
    INTO result
  FROM filtered;

  RETURN result;
END;
$_$;


ALTER FUNCTION "public"."extract_theme_topical_words"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_extra_excludes" "text"[], "p_max_results" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."field_aliased_avg"("p_dataset_id" "uuid", "p_field" "text", "p_present_field" "text", "p_aliases" "jsonb") RETURNS TABLE("n" bigint, "avg_val" double precision, "min_val" double precision, "max_val" double precision)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  WITH v AS (
    SELECT (p_aliases ->> (data ->> p_field))::double precision AS x
      FROM dataset_rows_flat
     WHERE dataset_id = p_dataset_id
       AND (p_aliases ->> (data ->> p_field)) ~ '^-?[0-9]+\.?[0-9]*$'
       AND (p_present_field = '' OR COALESCE(btrim(data ->> p_present_field), '') <> '')
  )
  SELECT count(*)::bigint AS n, avg(x) AS avg_val, min(x) AS min_val, max(x) AS max_val
    FROM v;
$_$;


ALTER FUNCTION "public"."field_aliased_avg"("p_dataset_id" "uuid", "p_field" "text", "p_present_field" "text", "p_aliases" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_slug          text;
  v_collection_id uuid;
  v_dataset_id    uuid;
BEGIN
  v_slug := slugify(p_brand_tag);
  IF v_slug IS NULL OR v_slug = '' THEN
    RETURN NULL;
  END IF;

  -- Fast path: already exists.
  SELECT id INTO v_collection_id
  FROM collections
  WHERE org_id = p_org_id AND kind = 'brand' AND slug = v_slug;
  IF FOUND THEN
    RETURN v_collection_id;
  END IF;

  -- Create the virtual dataset that represents the collection.
  INSERT INTO datasets (org_id, name, source, created_by, status, visibility)
  VALUES (p_org_id, trim(p_brand_tag), 'collection', p_created_by, 'active', 'private')
  RETURNING id INTO v_dataset_id;

  -- Empty dataset_state so the brand-collection is never in a no-state
  -- limbo. rebuildBrandSchema() (app side) fills the real merged schema
  -- once the AFTER trigger has synced collection_members.
  INSERT INTO dataset_state (dataset_id, schema_config)
  VALUES (v_dataset_id, '{"fields":[],"autoDetected":false,"version":1}'::jsonb);

  -- Create the collections linking row. ON CONFLICT covers the race where
  -- two datasets with the same brand_tag insert concurrently.
  INSERT INTO collections (dataset_id, org_id, created_by, kind, slug)
  VALUES (v_dataset_id, p_org_id, p_created_by, 'brand', v_slug)
  ON CONFLICT (org_id, slug) WHERE kind = 'brand'
  DO NOTHING
  RETURNING id INTO v_collection_id;

  IF v_collection_id IS NULL THEN
    -- Lost the race: another tx created it. Drop our orphan virtual
    -- dataset (cascades the dataset_state row) and return the winner.
    DELETE FROM datasets WHERE id = v_dataset_id;
    SELECT id INTO v_collection_id
    FROM collections
    WHERE org_id = p_org_id AND kind = 'brand' AND slug = v_slug;
  END IF;

  RETURN v_collection_id;
END;
$$;


ALTER FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") IS 'Returns collections.id for a brand, creating the virtual dataset + collections row on first call. Idempotent, concurrency-safe. Called by the 062 trigger and the 061 backfill.';



CREATE OR REPLACE FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;


ALTER FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb" DEFAULT NULL::"jsonb", "p_limit" integer DEFAULT 100, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" bigint, "dataset_id" "uuid", "row_index" integer, "data" "jsonb", "total_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH matched AS (
    SELECT r.id, r.dataset_id, r.row_index, r.data
    FROM public.dataset_rows_flat r
    WHERE r.dataset_id = ANY(p_dataset_ids)
      AND r.tsv @@ websearch_to_tsquery('english', p_query)        -- GIN-indexed prefilter
      AND (
        p_text_fields IS NULL
        OR to_tsvector('english', COALESCE(
             (SELECT string_agg(r.data ->> fld, ' ')
                FROM jsonb_array_elements_text(p_text_fields -> (r.dataset_id::text)) AS fld),
             '')
           ) @@ websearch_to_tsquery('english', p_query)          -- exact recheck: open-ended fields only
      )
  )
  SELECT id, dataset_id, row_index, data, count(*) OVER() AS total_count
  FROM matched
  ORDER BY row_index
  LIMIT p_limit
  OFFSET p_offset;
$$;


ALTER FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb", "p_limit" integer, "p_offset" integer) IS 'Rows that mention one catalog entity across a scope. Same tsv-prefilter + open-ended recheck as count_entity_terms. total_count is the full match size (window count) for pagination.';



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


COMMENT ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) IS 'Comments matching ALL active facets (theme keywords AND entity terms AND dimension tags), OR within each facet. Dimension facet reads embedded data._tx axes (sql/151, emotion axis sql/158). total_count is the window count for pagination.';



CREATE OR REPLACE FUNCTION "public"."get_study_response_stats_for_user"("p_study_ids" "uuid"[]) RETURNS TABLE("study_id" "uuid", "total_responses" bigint, "complete_count" bigint, "promoters" bigint, "passives" bigint, "detractors" bigint, "avg_experience" double precision, "avg_nps" double precision, "last_response_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT srs.study_id, srs.total_responses, srs.complete_count,
         srs.promoters, srs.passives, srs.detractors,
         srs.exp_sum / NULLIF(srs.exp_n, 0) AS avg_experience,
         srs.nps_sum / NULLIF(srs.nps_n, 0) AS avg_nps,
         srs.last_response_at
  FROM study_response_stats_live srs
  WHERE srs.study_id = ANY(p_study_ids)
    AND srs.study_id IN (
      SELECT s.id FROM studies s
      WHERE s.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
         OR EXISTS (
           SELECT 1 FROM users u2 JOIN organizations o ON o.id = u2.org_id
           WHERE u2.id = auth.uid() AND o.is_admin_org
         )
    );
$$;


ALTER FUNCTION "public"."get_study_response_stats_for_user"("p_study_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("group_val" "text", "n" bigint, "min_val" double precision, "max_val" double precision, "avg_val" double precision, "median_val" double precision, "stddev_val" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      COALESCE(data ->> p_group_field, '')::text AS gv,
      (data ->> p_value_field)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND data ->> p_value_field IS NOT NULL
      AND data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT
    gv AS group_val,
    count(*)::bigint AS n,
    min(v) AS min_val,
    max(v) AS max_val,
    avg(v) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median_val,
    stddev_samp(v) AS stddev_val
  FROM grouped
  GROUP BY gv
  ORDER BY count(*) DESC;
END;
$_$;


ALTER FUNCTION "public"."group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer DEFAULT 1) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO agent_probe_quota (agent_id, probe_id, probe_version, answered_count)
  VALUES (p_agent_id, p_probe_id, p_probe_version, p_delta)
  ON CONFLICT (agent_id, probe_id, probe_version)
  DO UPDATE SET answered_count = agent_probe_quota.answered_count + p_delta
  RETURNING answered_count INTO v_count;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer) IS 'Atomically bumps the answered-quota counter for a research probe version and returns the new count. chatCore assignment reads agent_probe_quota vs sampling.target_n; this keeps quota O(1) per answer (sql/154 counter pattern).';



CREATE OR REPLACE FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid" DEFAULT NULL::"uuid", "p_delta" integer DEFAULT 1) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_counter integer;
BEGIN
  IF p_topic_id IS NOT NULL THEN
    UPDATE pulseiq_topics
    SET response_count = COALESCE(response_count, 0) + p_delta
    WHERE id = p_topic_id AND town_hall_id = p_session_id;
  END IF;

  UPDATE pulseiq_sessions
  SET response_counter = COALESCE(response_counter, 0) + p_delta
  WHERE id = p_session_id
  RETURNING response_counter INTO v_counter;

  RETURN v_counter;
END;
$$;


ALTER FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid", "p_delta" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid", "p_delta" integer) IS 'Atomically bumps pulseiq_sessions.response_counter (+ the tagged topic''s response_count) per stored assistant reply. Returns the new session total. Replaces per-turn COUNT queries in chatCore (2026-07-04).';



CREATE OR REPLACE FUNCTION "public"."is_platform_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.organizations o ON o.id = u.org_id
    WHERE u.id = auth.uid() AND o.is_admin_org
  )
$$;


ALTER FUNCTION "public"."is_platform_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."knowledge_tsv_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
             setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."knowledge_tsv_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 1) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "similarity" double precision)
    LANGUAGE "sql" STABLE
    AS $$
  SELECT c.id, c.title, c.content,
         (1 - (c.embedding <=> p_embedding))::double precision AS similarity
  FROM agent_knowledge_chunks c
  WHERE c.bot_id = p_bot_id
    AND c.embedding IS NOT NULL
    AND (p_exclude_id IS NULL OR c.id <> p_exclude_id)
  ORDER BY c.embedding <=> p_embedding ASC
  LIMIT GREATEST(p_limit, 1);
$$;


ALTER FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid", "p_limit" integer) IS 'Nearest agent_knowledge_chunks rows to p_embedding by cosine similarity (1 - cosine distance), bot-scoped. Powers the near-duplicate guard in the answer-a-question flow. Read-only.';



CREATE OR REPLACE FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE dataset_state
  SET analytics = COALESCE(analytics, '{}'::jsonb) || p_patch
  WHERE dataset_id = p_dataset_id;
$$;


ALTER FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") IS 'Atomically shallow-merges a patch into dataset_state.analytics (top-level keys), preserving keys not in the patch. Replaces a racy read-modify-write.';



CREATE OR REPLACE FUNCTION "public"."numeric_field_stats"("p_dataset_id" "uuid", "p_field_key" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS TABLE("n" bigint, "min_val" double precision, "max_val" double precision, "avg_val" double precision, "median_val" double precision, "stddev_val" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY
  WITH nums AS (
    SELECT (data ->> p_field_key)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT
    count(*)::bigint AS n,
    min(v) AS min_val,
    max(v) AS max_val,
    avg(v) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median_val,
    stddev_samp(v) AS stddev_val
  FROM nums;
END;
$_$;


ALTER FUNCTION "public"."numeric_field_stats"("p_dataset_id" "uuid", "p_field_key" "text", "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."numeric_field_stats_present"("p_dataset_id" "uuid", "p_field_key" "text", "p_present_field" "text") RETURNS TABLE("n" bigint, "min_val" double precision, "max_val" double precision, "avg_val" double precision, "median_val" double precision, "stddev_val" double precision)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
BEGIN
  RETURN QUERY
  WITH v AS (
    SELECT (data ->> p_field_key)::double precision AS x
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
      AND COALESCE(btrim(data ->> p_present_field), '') <> ''
  )
  SELECT
    count(*)::bigint AS n,
    min(x) AS min_val,
    max(x) AS max_val,
    avg(x) AS avg_val,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY x) AS median_val,
    stddev_samp(x) AS stddev_val
  FROM v;
END;
$_$;


ALTER FUNCTION "public"."numeric_field_stats_present"("p_dataset_id" "uuid", "p_field_key" "text", "p_present_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) RETURNS TABLE("org_id" "uuid", "user_count" bigint, "study_count" bigint, "response_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH ids AS (
    SELECT unnest(p_org_ids) AS org_id
  ),
  uc AS (
    SELECT u.org_id, count(*)::bigint AS cnt
    FROM users u
    WHERE u.org_id = ANY(p_org_ids)
    GROUP BY u.org_id
  ),
  sc AS (
    SELECT s.org_id, count(*)::bigint AS cnt
    FROM studies s
    WHERE s.org_id = ANY(p_org_ids)
    GROUP BY s.org_id
  ),
  rc AS (
    SELECT s.org_id, count(*)::bigint AS cnt
    FROM responses r
    JOIN studies s ON s.id = r.study_id
    WHERE s.org_id = ANY(p_org_ids)
    GROUP BY s.org_id
  )
  SELECT
    ids.org_id,
    COALESCE(uc.cnt, 0) AS user_count,
    COALESCE(sc.cnt, 0) AS study_count,
    COALESCE(rc.cnt, 0) AS response_count
  FROM ids
  LEFT JOIN uc ON uc.org_id = ids.org_id
  LEFT JOIN sc ON sc.org_id = ids.org_id
  LEFT JOIN rc ON rc.org_id = ids.org_id;
$$;


ALTER FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_policy_qualifiers"() RETURNS TABLE("tablename" "text", "policyname" "text", "qual" "text", "with_check" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog', 'pg_temp'
    AS $$
  SELECT
    p.tablename::text,
    p.policyname::text,
    p.qual::text,
    p.with_check::text
  FROM pg_policies p
  WHERE p.schemaname = 'public'
$$;


ALTER FUNCTION "public"."public_policy_qualifiers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_tables_rls_status"() RETURNS TABLE("table_name" "text", "rls_enabled" boolean)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$                                         
    SELECT c.relname::text, c.relrowsecurity                                                
    FROM pg_class c                                                                
    JOIN pg_namespace n ON n.oid = c.relnamespace                                           
    WHERE n.nspname = 'public' AND c.relkind = 'r'                                          
    ORDER BY c.relname;                                                                     
  $$;


ALTER FUNCTION "public"."public_tables_rls_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_study_response_stats"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- No-op since sql/174: study_response_stats_live is maintained live by the
  -- responses trigger. Retained as a stub so any lingering caller (the
  -- pre-deploy /api/respond) is harmless; safe to drop once no caller remains.
  RETURN;
END;
$$;


ALTER FUNCTION "public"."refresh_study_response_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_dataset"("p_dataset_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  -- Copy rows back from archive
  INSERT INTO dataset_rows (dataset_id, batch_index, rows, row_count, source_ref, created_at)
  SELECT dataset_id, batch_index, rows, row_count, source_ref, created_at
  FROM archived_dataset_rows WHERE dataset_id = p_dataset_id;

  INSERT INTO dataset_rows_flat (dataset_id, row_index, data, created_at)
  SELECT dataset_id, row_index, data, created_at
  FROM archived_dataset_rows_flat WHERE dataset_id = p_dataset_id;

  -- Clean up archive
  DELETE FROM archived_dataset_rows_flat WHERE dataset_id = p_dataset_id;
  DELETE FROM archived_dataset_rows WHERE dataset_id = p_dataset_id;

  -- Restore dataset status
  UPDATE datasets SET
    status = 'active',
    archived_at = NULL,
    archived_by = NULL,
    updated_at = now()
  WHERE id = p_dataset_id;
END;
$$;


ALTER FUNCTION "public"."restore_dataset"("p_dataset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sample_dataset_rows"("p_dataset_id" "uuid", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH page AS (
    SELECT f.id, f.row_index, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'rows', COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'row_index', row_index, 'data', data) ORDER BY h, id),
      '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  ) FROM page;
$$;


ALTER FUNCTION "public"."sample_dataset_rows"("p_dataset_id" "uuid", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sample_dataset_rows"("p_dataset_id" "uuid", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) IS 'O(sample) deterministic sampler for the rows route all=true >50K path. Returns the p_limit rows with the smallest uniform hash(id||dataset_id) after the (p_after_hash,p_after_id) keyset cursor, as {rows: jsonb[], last_hash, last_id}. Backed by the idx_drf_sample expression index -> index range scan touching only the ~cap sampled rows, so cost is independent of dataset size and appends participate automatically (the expression index self-maintains). Same rows -> same sample (deck credibility, ARCHITECTURE.md D6).';



CREATE OR REPLACE FUNCTION "public"."sample_row_pairs"("p_dataset_id" "uuid", "p_fields" "text"[], "p_limit" integer DEFAULT 10000) RETURNS TABLE("data" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT drf.data
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
  ORDER BY random()
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."sample_row_pairs"("p_dataset_id" "uuid", "p_fields" "text"[], "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_count_entity_terms"("p_dataset_id" "uuid", "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  WITH page AS MATERIALIZED (
    SELECT f.id, f.tsv, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  matched AS (
    SELECT t.term, count(*)::bigint AS n
    FROM unnest(p_terms) AS t(term)
    JOIN page
      ON page.tsv @@ websearch_to_tsquery('english', t.term)          -- tsv prefilter (matches count_entity_terms)
     AND (
       p_text_fields IS NULL
       OR to_tsvector('english', COALESCE(
            (SELECT string_agg(page.data ->> fld, ' ') FROM unnest(p_text_fields) AS fld), '')
          ) @@ websearch_to_tsquery('english', t.term)               -- exact recheck: open-ended fields only
     )
     AND (
       p_theme_query IS NULL
       OR page.tsv @@ websearch_to_tsquery('english', p_theme_query)  -- theme keywords stay on the full row
     )
    GROUP BY t.term
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'counts',    COALESCE((SELECT jsonb_agg(jsonb_build_array(term, n)) FROM matched), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_count_entity_terms"("p_dataset_id" "uuid", "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sampled_count_entity_terms"("p_dataset_id" "uuid", "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) IS 'Sampled twin of count_entity_terms (sql/070) for ONE dataset — keyset-pages the 50K idx_drf_sample and matches terms per page (same tsv-prefilter + open-ended recheck) so entity counts never 57014 at 1M. Caller pages to the cap + scales by total/scanned. sql/172.';



CREATE OR REPLACE FUNCTION "public"."sampled_count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  g AS (
    SELECT (data ->> p_field_key)::text AS v, count(*)::bigint AS n
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key != ''
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(v, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  g AS (
    SELECT COALESCE(data ->> p_row_field, '')::text AS r,
           COALESCE(data ->> p_col_field, '')::text AS c,
           count(*)::bigint AS n
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_row_field IS NOT NULL
      AND data ->> p_row_field != ''
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(r, c, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  b AS (
    SELECT
      CASE p_bucket
        WHEN 'week'    THEN to_char(date_trunc('week',    (data ->> p_date_field)::date), 'YYYY-MM-DD')
        WHEN 'month'   THEN to_char(date_trunc('month',   (data ->> p_date_field)::date), 'YYYY-MM')
        WHEN 'quarter' THEN to_char(date_trunc('quarter', (data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (data ->> p_date_field)::date))::text
        WHEN 'year'    THEN to_char(date_trunc('year',    (data ->> p_date_field)::date), 'YYYY')
        ELSE to_char((data ->> p_date_field)::date, 'YYYY-MM-DD')
      END AS bkt,
      count(*)::bigint AS n,
      sum((data ->> p_metric_field)::double precision)
        FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$') AS msum,
      count(*) FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')::bigint AS mn
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_date_field IS NOT NULL
      AND data ->> p_date_field != ''
      AND (data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'buckets',   COALESCE((SELECT jsonb_agg(jsonb_build_array(bkt, n, msum, mn)) FROM b), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_filter_options"("p_dataset_id" "uuid", "p_fields" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."sampled_filter_options"("p_dataset_id" "uuid", "p_fields" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sampled_filter_options"("p_dataset_id" "uuid", "p_fields" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) IS 'One keyset page of SAMPLED filter options over the deterministic idx_drf_sample order (same sample as sample_dataset_rows, sql/160). p_fields = [{"field","type"},…]; returns {n_scanned, fields:[{ord, nonempty, num_min, num_max, date_min, date_max, values:[{v,c}], distinct_n}], last_hash, last_id}. Per-field semantics match count_nonempty_rows (nonempty, btrim), count_field_values (values, raw — CATEGORICAL only), numeric_field_stats (numeric), and the legacy date .order probe. Values capped 2000/page by frequency; caller pages to the 50K cap, merges values, caps 500, and labels sampled above the cap. Replaces the filter-options route serial per-field full scans (57014 at 1M).';



CREATE OR REPLACE FUNCTION "public"."sampled_filtered_rows"("p_dataset_id" "uuid", "p_filters" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_scan_limit" integer, "p_match_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."sampled_filtered_rows"("p_dataset_id" "uuid", "p_filters" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_scan_limit" integer, "p_match_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sampled_filtered_rows"("p_dataset_id" "uuid", "p_filters" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_scan_limit" integer, "p_match_limit" integer) IS 'Filter-aware page over the deterministic sample order (idx_drf_sample). Scans p_scan_limit rows past the (p_after_hash,p_after_id) cursor, applies ana_row_matches_filters (mirror of lib/filterUtils.applyFilters), returns {n_scanned, n_matched, rows: up to p_match_limit matching data blobs, last_hash, last_id (of the last SCANNED row)}. Callers page until enough matches or the D6 scan cap. Ask Ana / ad-hoc report data layer (docs/PERFORMANCE_REVIEW.md §2).';



CREATE OR REPLACE FUNCTION "public"."sampled_group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  v AS (
    SELECT COALESCE(data ->> p_group_field, '')::text AS g,
           (data ->> p_value_field)::double precision AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_group_field IS NOT NULL
      AND data ->> p_group_field != ''
      AND data ->> p_value_field IS NOT NULL
      AND data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(jsonb_build_array(g, x)) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_numeric_field_stats"("p_dataset_id" "uuid", "p_field" "text", "p_aliases" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  v AS (
    SELECT CASE
      WHEN p_aliases IS NULL THEN
        CASE WHEN p.data ->> p_field ~ '^-?[0-9]+\.?[0-9]*$'
             THEN (p.data ->> p_field)::double precision END
      ELSE
        CASE WHEN (p_aliases ->> (p.data ->> p_field)) ~ '^-?[0-9]+\.?[0-9]*$'
             THEN (p_aliases ->> (p.data ->> p_field))::double precision END
    END AS x
    FROM page p
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'n',         (SELECT count(x) FROM v),
    'sum',       (SELECT sum(x)   FROM v),
    'min',       (SELECT min(x)   FROM v),
    'max',       (SELECT max(x)   FROM v),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_numeric_field_stats"("p_dataset_id" "uuid", "p_field" "text", "p_aliases" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sampled_numeric_field_stats"("p_dataset_id" "uuid", "p_field" "text", "p_aliases" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) IS 'One keyset page of SAMPLED numeric field stats over the deterministic idx_drf_sample order (same sample as sample_dataset_rows). Returns {n_scanned, n, sum, min, max, last_hash, last_id}; callers page to the cap and derive avg = sum/n, labeled as sampled. Value predicates match numeric_field_stats (p_aliases null) / field_aliased_avg (p_aliases set) exactly. Used above the 50K cap where those full-scan aggregates exceed the 8s statement timeout (metric strip avg rating).';



CREATE OR REPLACE FUNCTION "public"."sampled_numeric_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[]) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  v AS (
    SELECT (data ->> p_field_key)::double precision AS x
    FROM page
    WHERE (p_row_ids IS NULL OR id = ANY(p_row_ids))
      AND data ->> p_field_key IS NOT NULL
      AND data ->> p_field_key ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(x) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_numeric_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_signal_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  -- MATERIALIZED is load-bearing on pats/page/hits: single-referenced CTEs get
  -- inlined (PG12+), which re-built every theme's regex pattern once per
  -- (row x theme) — ~380ms of string_agg per 2K-row page (measured) — and
  -- would re-walk the sample index per consumer. Materialize = build patterns
  -- once, fetch the page once, evaluate each regex once per (row, theme).
  WITH pats AS MATERIALIZED (
    SELECT t.ord,
           CASE WHEN t.elem ? 'patterns' THEN
             -- Prebuilt canonical fragments (lib/themeUtils.kwPatternFragment),
             -- used verbatim: each already carries its own \w* stem suffixes
             -- and word-gap quantifiers. Only the word-start anchor is added.
             (SELECT string_agg('(?:^|\W)(?:' || pat || ')', '|')
                FROM jsonb_array_elements_text(t.elem -> 'patterns') AS pat
               WHERE btrim(pat) <> '')
           ELSE
             -- Legacy build: escape each raw keyword, exact-adjacency phrases.
             (SELECT string_agg('(?:^|\W)' || regexp_replace(kw, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\w*', '|')
                FROM jsonb_array_elements_text(t.elem -> 'keywords') AS kw
               WHERE btrim(kw) <> '')
           END AS pattern
    FROM jsonb_array_elements(p_themes) WITH ORDINALITY AS t(elem, ord)
  ),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  rec AS (
    -- per-field non-empty counts, aligned to p_field_keys order
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS records
    FROM (
      SELECT fk.ord,
             count(*) FILTER (WHERE NULLIF(btrim(p.data ->> fk.fld), '') IS NOT NULL) AS cnt
      FROM unnest(p_field_keys) WITH ORDINALITY AS fk(fld, ord)
      LEFT JOIN page p ON true
      GROUP BY fk.ord
    ) r
  ),
  hits AS MATERIALIZED (
    -- one boolean per (row, theme): does the row match the theme in any field?
    SELECT p.id, pt.ord,
           (pt.pattern IS NOT NULL AND EXISTS (
              SELECT 1 FROM unnest(p_field_keys) AS fld
              WHERE p.data ->> fld IS NOT NULL AND p.data ->> fld ~* pt.pattern
           )) AS hit
    FROM page p CROSS JOIN pats pt
  ),
  theme_counts AS (
    SELECT COALESCE(jsonb_agg(cnt ORDER BY ord), '[]'::jsonb) AS theme_counts
    FROM (SELECT ord, count(*) FILTER (WHERE hit) AS cnt FROM hits GROUP BY ord) t
  ),
  union_cnt AS (
    SELECT count(*) AS union_count
    FROM (SELECT id FROM hits WHERE hit GROUP BY id) u
  )
  SELECT jsonb_build_object(
    'n',            (SELECT count(*) FROM page),
    'records',      (SELECT records      FROM rec),
    'theme_counts', (SELECT theme_counts FROM theme_counts),
    'union_count',  (SELECT union_count  FROM union_cnt),
    'last_hash',    (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',      (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_signal_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sampled_signal_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) IS 'One keyset page of SAMPLED signal counts over the deterministic idx_drf_sample order (same sample as sample_dataset_rows, sql/160). Theme elements may carry prebuilt "patterns" (lib/themeUtils.kwPatternFragment — canonical matching semantics, sql/166) used verbatim; falls back to the legacy escaped-keyword build when absent. Returns {n, records, theme_counts, union_count, last_hash, last_id}. Used above the 50K cap; callers scale to total rows and label results as sampled.';



CREATE OR REPLACE FUNCTION "public"."sampled_taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  g AS (
    SELECT ax.key::text AS axv,
           COALESCE(page.data ->> p_field, '')::text AS fv,
           count(*)::bigint AS n
    FROM page, fld,
         jsonb_each(page.data -> '_tx' -> 'f' -> fld.f -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(axv, fv, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  g AS (
    SELECT sub::text AS s,
           COALESCE(page.data ->> p_field, '')::text AS fv,
           count(*)::bigint AS n
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(s, fv, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  b AS (
    SELECT sub::text AS s,
      CASE p_bucket
        WHEN 'week'    THEN to_char(date_trunc('week',    (page.data ->> p_date_field)::date), 'YYYY-MM-DD')
        WHEN 'month'   THEN to_char(date_trunc('month',   (page.data ->> p_date_field)::date), 'YYYY-MM')
        WHEN 'quarter' THEN to_char(date_trunc('quarter', (page.data ->> p_date_field)::date), 'YYYY') || '-Q' || extract(quarter from date_trunc('quarter', (page.data ->> p_date_field)::date))::text
        WHEN 'year'    THEN to_char(date_trunc('year',    (page.data ->> p_date_field)::date), 'YYYY')
        ELSE to_char((page.data ->> p_date_field)::date, 'YYYY-MM-DD')
      END AS bkt,
      count(*)::bigint AS n,
      sum((page.data ->> p_metric_field)::double precision)
        FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND page.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$') AS msum,
      count(*) FILTER (WHERE p_metric_field IS NOT NULL AND p_metric_field != '' AND page.data ->> p_metric_field ~ '^-?[0-9]+\.?[0-9]*$')::bigint AS mn
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
      AND page.data ->> p_date_field IS NOT NULL
      AND (page.data ->> p_date_field) ~ '^\d{4}-\d{2}-\d{2}'
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'buckets',   COALESCE((SELECT jsonb_agg(jsonb_build_array(s, bkt, n, msum, mn)) FROM b), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  v AS (
    SELECT sub::text AS g,
           (page.data ->> p_value_field)::double precision AS x
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
      AND page.data ->> p_value_field IS NOT NULL
      AND page.data ->> p_value_field ~ '^-?[0-9]+\.?[0-9]*$'
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'vals',      COALESCE((SELECT jsonb_agg(jsonb_build_array(g, x)) FROM v), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  WITH fld AS (SELECT taxonomy_field_or_primary(p_dataset_id, p_field_key) AS f),
  page AS MATERIALIZED (
    SELECT f.id, f.data,
           (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint) AS h
    FROM dataset_rows_flat f
    WHERE f.dataset_id = p_dataset_id
      AND ( (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id )
          > (p_after_hash, p_after_id)
    ORDER BY (('x' || substr(md5(f.id::text || f.dataset_id::text), 1, 8))::bit(32)::bigint), f.id
    LIMIT p_limit
  ),
  g AS (
    SELECT sub::text AS v, count(*)::bigint AS n
    FROM page, fld,
         jsonb_array_elements_text(page.data -> '_tx' -> 'f' -> fld.f -> 'a' -> p_axis) AS sub
    WHERE (p_row_ids IS NULL OR page.id = ANY(p_row_ids))
    GROUP BY sub
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'groups',    COALESCE((SELECT jsonb_agg(jsonb_build_array(v, n)) FROM g), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_theme_cooccurrence_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  rc AS (
    SELECT page.id, string_agg(coalesce(page.data ->> k, ''), ' ') AS combined
    FROM page, unnest(p_field_keys) AS k
    GROUP BY page.id
  ),
  rt AS (
    SELECT rc.id, array_agg(tp.tid) AS tids
    FROM rc JOIN tp ON rc.combined ~* tp.pat
    GROUP BY rc.id HAVING count(*) >= 2
  ),
  pc AS (
    SELECT a AS ta, b AS tb, count(*)::bigint AS n
    FROM rt, LATERAL unnest(tids) AS a, LATERAL unnest(tids) AS b
    WHERE a <> b GROUP BY a, b
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'pairs',     COALESCE((SELECT jsonb_agg(jsonb_build_array(ta, tb, n)) FROM pc), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_theme_cooccurrence_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_theme_dimension_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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
  fld AS (SELECT taxonomy_primary_field(p_dataset_id) AS f),
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  matched AS (   -- (theme, row) where the row's text matches the theme
    SELECT DISTINCT tp.tid, page.id, page.data
    FROM page, tp, unnest(p_field_keys) AS fk(key)
    WHERE page.data ->> fk.key IS NOT NULL
      AND page.data ->> fk.key != ''
      AND page.data ->> fk.key ~* tp.pat
  ),
  dims AS (
    SELECT m.tid, ax.key::text AS axis, sb::text AS sub, count(*)::bigint AS cnt
    FROM matched m, fld,
         jsonb_each(m.data -> '_tx' -> 'f' -> fld.f -> 'a') AS ax(key, subs),
         jsonb_array_elements_text(ax.subs) AS sb
    GROUP BY m.tid, ax.key, sb
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'dims',      COALESCE((SELECT jsonb_agg(jsonb_build_array(tid, axis, sub, cnt)) FROM dims), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$$;


ALTER FUNCTION "public"."sampled_theme_dimension_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sampled_theme_topical_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_extra_excludes" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
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
  tp AS (
    SELECT (theme->>'id') AS tid,
           '\m(' || (SELECT string_agg(kw, '|') FROM jsonb_array_elements_text(theme->'keywords') AS kw WHERE kw <> '') || ')' AS pat
    FROM jsonb_array_elements(p_themes) AS theme
    WHERE jsonb_array_length(theme->'keywords') > 0
  ),
  row_text AS (
    SELECT page.id, string_agg(lower(coalesce(page.data ->> k, '')), ' ') AS combined
    FROM page, unnest(p_field_keys) AS k
    GROUP BY page.id
  ),
  tokens AS (
    SELECT rt.id, tk.word, tk.pos
    FROM row_text rt,
         LATERAL unnest(regexp_split_to_array(rt.combined, '[^a-z0-9'']+')) WITH ORDINALITY AS tk(word, pos)
    WHERE tk.word IS NOT NULL AND tk.word != ''
  ),
  kw_positions AS (   -- token positions where each theme's keywords hit
    SELECT tp.tid, tp.pat, t.id, t.pos
    FROM tokens t JOIN tp ON t.word ~* tp.pat
  ),
  window_words AS (   -- ±2 window per (theme, keyword-hit), excluding the hit position
    SELECT kp.tid, kp.pat, t.word
    FROM tokens t
    JOIN kw_positions kp ON t.id = kp.id
    WHERE t.pos BETWEEN kp.pos - 2 AND kp.pos + 2 AND t.pos <> kp.pos
  ),
  filtered AS (
    SELECT tid, word, count(*)::bigint AS cnt
    FROM window_words ww
    WHERE length(word) >= 3
      AND word !~ '^[0-9]+$'
      AND word !~* ww.pat                          -- exclude that theme's own keyword stems
      AND NOT (word = ANY(p_extra_excludes))
      AND NOT (word = ANY(topical_stopwords()))
    GROUP BY tid, word
  )
  SELECT jsonb_build_object(
    'n_scanned', (SELECT count(*) FROM page),
    'words',     COALESCE((SELECT jsonb_agg(jsonb_build_array(tid, word, cnt)) FROM filtered), '[]'::jsonb),
    'last_hash', (SELECT h  FROM page ORDER BY h DESC, id DESC LIMIT 1),
    'last_id',   (SELECT id FROM page ORDER BY h DESC, id DESC LIMIT 1)
  );
$_$;


ALTER FUNCTION "public"."sampled_theme_topical_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_extra_excludes" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_dataset_rows"("p_dataset_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" bigint, "row_index" integer, "data" "jsonb", "rank" real, "headline" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."search_dataset_rows"("p_dataset_id" "uuid", "p_query" "text", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_knowledge_chunks"("p_bot_id" "uuid", "p_query" "text", "p_limit" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "metadata" "jsonb", "rank" real)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  tsquery_val TSQUERY;
BEGIN
  -- Build tsquery from user input (handles multi-word gracefully)
  tsquery_val := plainto_tsquery('english', p_query);

  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.content,
    c.metadata,
    (
      -- Blend full-text rank (0-1) with trigram similarity (0-1)
      COALESCE(ts_rank_cd(c.tsv, tsquery_val), 0) * 2.0 +
      COALESCE(similarity(c.content, p_query), 0) +
      COALESCE(similarity(c.title, p_query), 0) * 1.5
    )::REAL AS rank
  FROM bot_knowledge_chunks c
  WHERE c.bot_id = p_bot_id
    AND (
      c.tsv @@ tsquery_val
      OR similarity(c.content, p_query) > 0.05
      OR similarity(c.title, p_query) > 0.1
    )
  ORDER BY rank DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_knowledge_chunks"("p_bot_id" "uuid", "p_query" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_knowledge_semantic"("p_bot_id" "uuid", "p_query" "text", "p_embedding" "public"."vector" DEFAULT NULL::"public"."vector", "p_limit" integer DEFAULT 5) RETURNS TABLE("id" "uuid", "title" "text", "content" "text", "metadata" "jsonb", "rank" real, "confidence" real)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$                                   
  DECLARE tsquery_val TSQUERY; max_rank REAL;                           
  BEGIN                                                        
    tsquery_val := plainto_tsquery('english', p_query);                 
    RETURN QUERY                                               
    WITH scored AS (                                                  
      SELECT c.id, c.title, c.content, c.metadata,
        (CASE WHEN p_embedding IS NOT NULL AND c.embedding IS NOT NULL  
          THEN (1.0 - (c.embedding <=> p_embedding)) * 4.0 ELSE 0 END 
         + COALESCE(ts_rank_cd(c.tsv, tsquery_val), 0) * 2.0            
         + COALESCE(similarity(c.content, p_query), 0)                  
         + COALESCE(similarity(c.title, p_query), 0) * 1.5)::REAL AS    
  rank                                                                  
      FROM bot_knowledge_chunks c                                       
      WHERE c.bot_id = p_bot_id                                       
        AND ((p_embedding IS NOT NULL AND c.embedding IS NOT NULL AND   
  (c.embedding <=> p_embedding) < 0.5)                               
             OR c.tsv @@ tsquery_val                                    
             OR similarity(c.content, p_query) > 0.05          
             OR similarity(c.title, p_query) > 0.1)                     
    )                                              
    SELECT s.id, s.title, s.content, s.metadata, s.rank,                
      LEAST(s.rank / 8.5, 1.0)::REAL AS confidence             
    FROM scored s ORDER BY s.rank DESC LIMIT p_limit;                   
  END;                                               
  $$;


ALTER FUNCTION "public"."search_knowledge_semantic"("p_bot_id" "uuid", "p_query" "text", "p_embedding" "public"."vector", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_brand_collection_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_new_tag        text;
  v_old_tag        text;
  v_new_collection uuid;
BEGIN
  -- Collections themselves are never branded.
  IF NEW.source = 'collection' THEN
    RETURN NEW;
  END IF;

  v_new_tag := nullif(trim(coalesce(NEW.brand_tag, '')), '');
  IF TG_OP = 'UPDATE' THEN
    v_old_tag := nullif(trim(coalesce(OLD.brand_tag, '')), '');
  ELSE
    v_old_tag := NULL;
  END IF;

  -- brand_tag unchanged -> leave brand_collection_id alone.
  IF v_new_tag IS NOT DISTINCT FROM v_old_tag THEN
    RETURN NEW;
  END IF;

  IF v_new_tag IS NOT NULL THEN
    v_new_collection := find_or_create_brand_collection(
      NEW.org_id, v_new_tag, NEW.created_by
    );
  ELSE
    v_new_collection := NULL;  -- tag cleared
  END IF;

  NEW.brand_collection_id := v_new_collection;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_brand_collection_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."slugify"("p_input" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT trim(both '_' from
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(trim(coalesce(p_input, ''))),
          '^(the|a|an)\s+', ''        -- strip leading article
        ),
        '[''`’]', '', 'g'             -- strip apostrophes / curly quotes
      ),
      '[^a-z0-9]+', '_', 'g'          -- non-alphanumeric runs -> underscore
    )
  );
$$;


ALTER FUNCTION "public"."slugify"("p_input" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."slugify"("p_input" "text") IS 'Canonical slug for brand names. Strips leading articles + apostrophes, lowercases, underscores non-alphanumerics. Used for brand-collection dedup.';



CREATE OR REPLACE FUNCTION "public"."srs_apply_delta"("p_study_id" "uuid", "p_sign" integer, "p_status" "text", "p_sentiment" "text", "p_exp" integer, "p_nps" integer, "p_completed" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_study_id IS NULL THEN RETURN; END IF;
  INSERT INTO study_response_stats_live AS s (
    study_id, total_responses, complete_count, promoters, passives, detractors,
    exp_sum, exp_n, nps_sum, nps_n, last_response_at
  ) VALUES (
    p_study_id,
    p_sign,
    p_sign * (CASE WHEN p_status = 'complete' OR p_status IS NULL THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('positive', 'promoter')  THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('neutral',  'passive')   THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('negative', 'detractor') THEN 1 ELSE 0 END),
    p_sign * COALESCE(p_exp, 0),  p_sign * (CASE WHEN p_exp IS NOT NULL THEN 1 ELSE 0 END),
    p_sign * COALESCE(p_nps, 0),  p_sign * (CASE WHEN p_nps IS NOT NULL THEN 1 ELSE 0 END),
    CASE WHEN p_sign > 0 THEN p_completed ELSE NULL END
  )
  ON CONFLICT (study_id) DO UPDATE SET
    total_responses  = s.total_responses  + EXCLUDED.total_responses,
    complete_count   = s.complete_count   + EXCLUDED.complete_count,
    promoters        = s.promoters        + EXCLUDED.promoters,
    passives         = s.passives         + EXCLUDED.passives,
    detractors       = s.detractors       + EXCLUDED.detractors,
    exp_sum          = s.exp_sum          + EXCLUDED.exp_sum,
    exp_n            = s.exp_n            + EXCLUDED.exp_n,
    nps_sum          = s.nps_sum          + EXCLUDED.nps_sum,
    nps_n            = s.nps_n            + EXCLUDED.nps_n,
    -- last_response_at only advances on inserts (a delete can't cheaply
    -- recompute the max without a scan — acceptable staleness for a rare event).
    last_response_at = CASE WHEN p_sign > 0
                         THEN GREATEST(s.last_response_at, p_completed)
                         ELSE s.last_response_at END;
END;
$$;


ALTER FUNCTION "public"."srs_apply_delta"("p_study_id" "uuid", "p_sign" integer, "p_status" "text", "p_sentiment" "text", "p_exp" integer, "p_nps" integer, "p_completed" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) RETURNS TABLE("study_id" "uuid", "total_responses" bigint, "complete_count" bigint, "promoters" bigint, "passives" bigint, "detractors" bigint, "avg_experience" double precision, "avg_nps" double precision, "last_response_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    r.study_id,
    count(*)::bigint AS total_responses,
    count(*) FILTER (WHERE r.status = 'complete' OR r.status IS NULL)::bigint AS complete_count,
    count(*) FILTER (WHERE r.sentiment IN ('positive', 'promoter'))::bigint AS promoters,
    count(*) FILTER (WHERE r.sentiment IN ('neutral',  'passive' ))::bigint AS passives,
    count(*) FILTER (WHERE r.sentiment IN ('negative', 'detractor'))::bigint AS detractors,
    avg(r.experience_score) FILTER (WHERE r.experience_score IS NOT NULL) AS avg_experience,
    avg(r.nps_score)        FILTER (WHERE r.nps_score        IS NOT NULL) AS avg_nps,
    max(r.completed_at) AS last_response_at
  FROM responses r
  WHERE r.study_id = ANY(p_study_ids)
  GROUP BY r.study_id;
$$;


ALTER FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_brand_collection_members"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_old_collection uuid;
  v_new_collection uuid;
BEGIN
  IF NEW.source = 'collection' THEN
    RETURN NULL;
  END IF;

  v_new_collection := NEW.brand_collection_id;
  IF TG_OP = 'UPDATE' THEN
    v_old_collection := OLD.brand_collection_id;
  ELSE
    v_old_collection := NULL;
  END IF;

  -- No membership change needed.
  IF v_old_collection IS NOT DISTINCT FROM v_new_collection THEN
    RETURN NULL;
  END IF;

  -- Leave the old brand-collection.
  IF v_old_collection IS NOT NULL THEN
    DELETE FROM collection_members
    WHERE collection_id = v_old_collection
      AND dataset_id    = NEW.id;
  END IF;

  -- Join the new brand-collection.
  IF v_new_collection IS NOT NULL THEN
    INSERT INTO collection_members (collection_id, dataset_id, label, sort_order)
    VALUES (v_new_collection, NEW.id, NEW.name, 0)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."sync_brand_collection_members"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS TABLE("axis_val" "text", "field_val" "text", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_field text;
BEGIN
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
  IF v_field IS NULL THEN RETURN; END IF;
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
END;
$$;


ALTER FUNCTION "public"."taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_counts"("p_dataset_id" "uuid", "p_field_key" "text") RETURNS TABLE("classified" bigint, "alerts" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT count(*)::bigint,
         count(*) FILTER (WHERE jsonb_array_length(COALESCE(f.data -> '_tx' -> 'f' -> p_field_key -> 'al', '[]'::jsonb)) > 0)::bigint
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (f.data -> '_tx' -> 'f') ? p_field_key;
$$;


ALTER FUNCTION "public"."taxonomy_counts"("p_dataset_id" "uuid", "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer DEFAULT 50, "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS TABLE("sub_val" "text", "field_val" "text", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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


ALTER FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text" DEFAULT NULL::"text", "p_bucket" "text" DEFAULT 'day'::"text", "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS TABLE("sub_val" "text", "bucket_date" "text", "n" bigint, "avg_val" double precision)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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


ALTER FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


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


ALTER FUNCTION "public"."taxonomy_drill_rows"("p_dataset_id" "uuid", "p_field_key" "text", "p_axis" "text", "p_sub" "text", "p_alert" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_field_in_blob"("p_dataset_id" "uuid", "p_field_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM dataset_rows_flat f
     WHERE f.dataset_id = p_dataset_id AND (f.data -> '_tx' -> 'f') ? p_field_key
     LIMIT 1
  );
$$;


ALTER FUNCTION "public"."taxonomy_field_in_blob"("p_dataset_id" "uuid", "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT CASE
    WHEN COALESCE(p_field_key, '') <> '' AND EXISTS (
           SELECT 1 FROM dataset_state ds
            WHERE ds.dataset_id = p_dataset_id
              AND ds.analytics -> 'taxonomy' -> 'fields' ? p_field_key)
      THEN p_field_key
    ELSE taxonomy_primary_field(p_dataset_id)
  END;
$$;


ALTER FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") IS 'Chart-aggregate field resolution: the requested question when it has a stored taxonomy rollup (has been classified), else taxonomy_primary_field — the pre-sql/164 behavior. Mirrors the per-question theme fallback (themeSetForField).';



CREATE OR REPLACE FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS TABLE("group_val" "text", "n" bigint, "min_val" double precision, "max_val" double precision, "avg_val" double precision, "median_val" double precision, "q1_val" double precision, "q3_val" double precision, "stddev_val" double precision)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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


ALTER FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_primary_field"("p_dataset_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT e.key
    FROM dataset_state ds,
         jsonb_each(ds.analytics -> 'taxonomy' -> 'fields') AS e(key, val)
   WHERE ds.dataset_id = p_dataset_id
   ORDER BY COALESCE((e.val -> 'rollup' ->> 'classifiedRows')::bigint, 0) DESC, e.key
   LIMIT 1;
$$;


ALTER FUNCTION "public"."taxonomy_primary_field"("p_dataset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_rows_for_field"("p_dataset_id" "uuid", "p_field_key" "text", "p_rating_field" "text" DEFAULT NULL::"text", "p_date_field" "text" DEFAULT NULL::"text", "p_offset" integer DEFAULT 0, "p_limit" integer DEFAULT 1000, "p_after_id" bigint DEFAULT NULL::bigint) RETURNS TABLE("row_id" bigint, "tx" "jsonb", "rating_val" "text", "date_val" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT f.id,
         f.data -> '_tx' -> 'f' -> p_field_key,
         CASE WHEN p_rating_field IS NOT NULL THEN f.data ->> p_rating_field END,
         CASE WHEN p_date_field   IS NOT NULL THEN f.data ->> p_date_field   END
    FROM dataset_rows_flat f
   WHERE f.dataset_id = p_dataset_id
     AND (f.data -> '_tx' -> 'f') ? p_field_key
     AND (p_after_id IS NULL OR f.id > p_after_id)
   ORDER BY f.id
   OFFSET CASE WHEN p_after_id IS NULL THEN p_offset ELSE 0 END
   LIMIT p_limit;
$$;


ALTER FUNCTION "public"."taxonomy_rows_for_field"("p_dataset_id" "uuid", "p_field_key" "text", "p_rating_field" "text", "p_date_field" "text", "p_offset" integer, "p_limit" integer, "p_after_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[] DEFAULT NULL::bigint[], "p_field_key" "text" DEFAULT NULL::"text") RETURNS TABLE("value" "text", "count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_field text;
BEGIN
  IF p_axis NOT IN ('touchpoint','attribute','product','beverage','ambiance','context','outcome','emotion') THEN
    RAISE EXCEPTION 'invalid axis: %', p_axis;
  END IF;
  v_field := taxonomy_field_or_primary(p_dataset_id, p_field_key);
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


ALTER FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[], "p_field_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."theme_dimension_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_limit" integer DEFAULT 8) RETURNS TABLE("axis" "text", "sub" "text", "count" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  pattern text;
  v_field text;
BEGIN
  pattern := '\m(' || array_to_string(p_keywords, '|') || ')';
  v_field := taxonomy_primary_field(p_dataset_id);
  IF v_field IS NULL THEN RETURN; END IF;
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
END;
$$;


ALTER FUNCTION "public"."theme_dimension_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."topical_stopwords"() RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT ARRAY[
'a','an','the','this','that','these','those',
'i','me','my','mine','we','us','our','ours','you','your','yours','he','him','his','she','her','hers','it','its','they','them','their','theirs','myself','yourself','itself','themselves',
'is','are','was','were','be','been','being','am','have','has','had','do','does','did','done','doing','will','would','should','could','can','may','might','must','shall',
'get','got','gets','getting','go','goes','went','going','gone','come','came','comes','coming','make','made','makes','making','take','took','takes','taking','give','gave','gives','giving','say','said','says','saying','see','saw','sees','seeing','seen','know','knew','knows','knowing','known','think','thought','thinks','thinking','feel','felt','feels','want','wanted','wants','need','needed','needs','try','tried','tries','use','used','uses','find','found','finds','put','puts','let','lets','keep','kept','keeps','seem','seemed','seems','look','looked','looks','looking','tell','told','tells','telling','ask','asked','asks','asking','show','showed','shows','call','called','calls','calling',
'in','on','at','to','for','of','with','by','from','about','as','into','through','onto','upon','over','under','between','after','before','during','since','until','while','within','without','around','near',
'and','or','nor','but','so','because','if','when','then','than','though','although','however','also','plus','yet','still','either','neither','whether',
'very','really','quite','just','too','still','even','only','always','never','sometimes','often','rarely','usually','almost','nearly','already','probably','definitely','actually','basically','literally','barely','simply','exactly','especially',
'highly','absolutely','completely','totally','extremely','incredibly','remarkably','thoroughly','truly','genuinely','particularly','specifically','consistently','frequently','occasionally','constantly','perfectly','utterly','fully','entirely','clearly','obviously','certainly','surely','strongly','heavily','deeply','widely',
'here','there','where','everywhere','anywhere','somewhere','now','today','tonight','tomorrow','yesterday','soon','later','earlier','ever',
'how','what','which','who','whom','whose','why',
'all','some','any','many','much','more','most','less','least','few','several','enough','little','lot','lots',
'other','others','another','same','different','similar','such','own','new','old','first','last','next','recent',
'not','no','yes','none','nothing','anything','something','everything',
'one','two','three','four','five','six','seven','eight','nine','ten','time','times','day','days','night','nights','minute','minutes','hour','hours','week','weeks','month','months','year','years',
'way','ways','thing','things','place','people','person','someone','everyone','anyone',
'back','again','ago',
'good','great','excellent','amazing','awesome','fantastic','wonderful','perfect','best','delicious','tasty','fresh','friendly','nice','lovely','clean','quick','fast','warm','crispy','tender','flavorful','juicy','rich','creamy','attentive','helpful','polite','outstanding','superb','incredible','comfortable','cozy','pleasant','enjoyable','reasonable','generous','authentic','exceptional','satisfying','refreshing','favorite','love','loved','recommend',
'bad','terrible','horrible','awful','worst','poor','slow','cold','bland','dry','stale','rude','dirty','expensive','overpriced','small','loud','noisy','crowded','long','soggy','burnt','undercooked','overcooked','raw','greasy','salty','bitter','tasteless','mediocre','disappointing','disgusting','uncomfortable','unfriendly','unprofessional','filthy','gross','lukewarm','watery','tough','chewy','rubbery','hard','wrong','missing','broken','ignored','waited','annoyed','frustrated','underwhelming','overrated'
  ]::text[];
$$;


ALTER FUNCTION "public"."topical_stopwords"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_agent_org"("p_agent_id" "uuid", "p_to_org" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_to_org IS NULL THEN
    RAISE EXCEPTION 'transfer_agent_org: target org is null';
  END IF;

  UPDATE agents              SET org_id = p_to_org WHERE id     = p_agent_id;
  UPDATE conversations       SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE conversation_turns  SET org_id = p_to_org
    WHERE conversation_id IN (SELECT id FROM conversations WHERE bot_id = p_agent_id);
  UPDATE logged_questions    SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE conversation_reviews SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_change_log    SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_impressions   SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_study_cache   SET org_id = p_to_org WHERE bot_id = p_agent_id;
END;
$$;


ALTER FUNCTION "public"."transfer_agent_org"("p_agent_id" "uuid", "p_to_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_recording_org"("p_recording_id" "uuid", "p_from_org" "uuid", "p_to_org" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_dataset_id uuid;
BEGIN
  -- Lock + verify the recording is actually in the claimed source org. Pairing
  -- on org_id here is the cross-tenant guard: a wrong p_from_org finds nothing.
  SELECT dataset_id INTO v_dataset_id
  FROM recordings
  WHERE id = p_recording_id AND org_id = p_from_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recording % not found in org %', p_recording_id, p_from_org;
  END IF;

  -- Children (each paired with from_org). recording_files also carries the
  -- <org_id>/<recording_id>/... storage paths → rewrite the org prefix so the
  -- columns match where the route just moved the objects.
  UPDATE recording_files
     SET org_id = p_to_org,
         storage_path = replace(storage_path, p_from_org::text || '/', p_to_org::text || '/'),
         audio_storage_path = CASE
           WHEN audio_storage_path IS NULL THEN NULL
           ELSE replace(audio_storage_path, p_from_org::text || '/', p_to_org::text || '/')
         END
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  UPDATE recording_transcripts SET org_id = p_to_org
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  UPDATE recording_extractions SET org_id = p_to_org
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  -- Derived dataset (1:1). dataset_rows_flat has no org_id — it's keyed by
  -- dataset_id, so it follows the dataset automatically.
  IF v_dataset_id IS NOT NULL THEN
    UPDATE datasets SET org_id = p_to_org
     WHERE id = v_dataset_id AND org_id = p_from_org;
  END IF;

  UPDATE recordings SET org_id = p_to_org
   WHERE id = p_recording_id AND org_id = p_from_org;
END;
$$;


ALTER FUNCTION "public"."transfer_recording_org"("p_recording_id" "uuid", "p_from_org" "uuid", "p_to_org" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_study_response_stats"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM srs_apply_delta(NEW.study_id, 1, NEW.status, NEW.sentiment, NEW.experience_score, NEW.nps_score, NEW.completed_at);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM srs_apply_delta(OLD.study_id, -1, OLD.status, OLD.sentiment, OLD.experience_score, OLD.nps_score, OLD.completed_at);
  ELSE -- UPDATE: reverse OLD, apply NEW (handles a study_id change too)
    PERFORM srs_apply_delta(OLD.study_id, -1, OLD.status, OLD.sentiment, OLD.experience_score, OLD.nps_score, OLD.completed_at);
    PERFORM srs_apply_delta(NEW.study_id, 1, NEW.status, NEW.sentiment, NEW.experience_score, NEW.nps_score, NEW.completed_at);
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trg_study_response_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_action_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_type" "text" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "resource_name" "text",
    "target_org_id" "uuid",
    "target_org_name" "text",
    "initiated_by" "uuid",
    "initiated_by_email" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."admin_action_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_change_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "actor_id" "uuid",
    "actor_email" "text",
    "action" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "before" "jsonb",
    "after" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bot_change_log_action_check" CHECK (("action" = ANY (ARRAY['create'::"text", 'update'::"text", 'delete'::"text", 'status_change'::"text", 'knowledge_added'::"text", 'knowledge_cleared'::"text", 'import'::"text"])))
);


ALTER TABLE "public"."agent_change_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_conversation_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"(),
    "since" timestamp with time zone NOT NULL,
    "session_count" integer DEFAULT 0 NOT NULL,
    "turn_count" integer DEFAULT 0 NOT NULL,
    "report" "text" DEFAULT ''::"text" NOT NULL,
    "theme_drift" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."agent_conversation_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_crawl_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "base_urls" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "queue" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "visited" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "page_cap" integer DEFAULT 300 NOT NULL,
    "pages_crawled" integer DEFAULT 0 NOT NULL,
    "chunks_added" integer DEFAULT 0 NOT NULL,
    "near_dup_skipped" integer DEFAULT 0 NOT NULL,
    "budget_skipped" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_crawl_jobs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'done'::"text", 'error'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."agent_crawl_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_impressions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "visitor_id" "text",
    "source" "text",
    "medium" "text",
    "campaign" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_impressions" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_impressions" IS 'Widget-open beacon for agents. One row per public-widget mount, written fire-and-forget by POST /api/bots/[id]/impression. The ONLY source of true invocation counts: conversation turns are written only after the first user message, so opens that never become conversations are otherwise invisible. Powers the open->engaged response rate on the agent card + Agent Study report.';



CREATE TABLE IF NOT EXISTS "public"."agent_kb_page_hashes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "last_crawled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_kb_page_hashes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_knowledge_chunks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "tsv" "tsvector",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "embedding" "public"."vector"(1536)
);


ALTER TABLE "public"."agent_knowledge_chunks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_probe_quota" (
    "agent_id" "uuid" NOT NULL,
    "probe_id" "text" NOT NULL,
    "probe_version" integer NOT NULL,
    "answered_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."agent_probe_quota" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_probe_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "probe_id" "text" NOT NULL,
    "probe_version" integer NOT NULL,
    "outcome" "text" NOT NULL,
    "asked_wording" "text",
    "asked_turn" integer,
    "ask_context" "jsonb",
    "answer_text" "text",
    "followup_text" "text",
    "coded" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_probe_responses_outcome_check" CHECK (("outcome" = ANY (ARRAY['asked_answered'::"text", 'asked_declined'::"text", 'asked_ignored'::"text", 'never_fit'::"text", 'quota_closed'::"text"])))
);


ALTER TABLE "public"."agent_probe_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_readout_cache" (
    "bot_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cache_key" "text" NOT NULL,
    "analysis" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_readout_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_readout_cache" IS 'Memoized Agent Conversation Readout analysis object, one row per bot. cache_key is a content hash over normalized-pair count + focus catalog + report title; a mismatch triggers recompute so the cache self-heals when conversations or config change. Written service-role-only from lib/agentReadout.ts. Mirrors agent_study_cache.';



COMMENT ON COLUMN "public"."agent_readout_cache"."cache_key" IS 'Content hash: normalized-pair turn_count + focus catalog + readout title. Stale key -> recompute. Mirrors agent_study_cache.cache_key.';



CREATE TABLE IF NOT EXISTS "public"."agent_session_personas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "persona" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "demographics" "jsonb",
    "name" "text"
);


ALTER TABLE "public"."agent_session_personas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."agent_session_personas"."name" IS 'First name extracted via lib/nameExtractor.ts (post-response AI scan). Null if no name was given or could not be reliably extracted. Populated fire-and-forget from lib/chatCore.ts on user_turn_count == 2 (retry once at 5) and only when currently null — once set, no further extraction calls for this session.';



CREATE TABLE IF NOT EXISTS "public"."agent_study_cache" (
    "bot_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "cache_key" "text" NOT NULL,
    "analysis" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_study_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_study_cache" IS 'Memoized Tier-2 (AI) Agent Study analysis object, one row per bot. cache_key is a content hash over turn_count + focus/intent config; a mismatch triggers recompute so the cache self-heals when conversations or config change. Written service-role-only from lib/agentStudy.ts.';



COMMENT ON COLUMN "public"."agent_study_cache"."cache_key" IS 'Content hash: normalized-pair turn_count + focus catalog + intent catalog. Stale key -> recompute. Mirrors the signalStats row_count+model-hash freshness pattern.';



CREATE TABLE IF NOT EXISTS "public"."agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "system_prompt" "text" DEFAULT ''::"text" NOT NULL,
    "knowledge_base" "text" DEFAULT ''::"text" NOT NULL,
    "training_urls" "text"[] DEFAULT '{}'::"text"[],
    "conversation_count" bigint DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "last_session_at" timestamp with time zone,
    "review_interval_hours" integer,
    "last_reviewed_at" timestamp with time zone,
    "next_review_at" timestamp with time zone,
    "personality" "text" DEFAULT ''::"text" NOT NULL,
    "faq" "jsonb" DEFAULT '[]'::"jsonb",
    "facts" "jsonb" DEFAULT '[]'::"jsonb",
    "guardrails" "jsonb" DEFAULT '[]'::"jsonb",
    "opponents" "jsonb" DEFAULT '[]'::"jsonb",
    "contrast_mode" "text" DEFAULT 'user_triggered'::"text" NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "negative_content_mode" "text" DEFAULT 'deflect'::"text" NOT NULL,
    "sensitive_topics" "text"[] DEFAULT '{}'::"text"[],
    "focus_topics" "text"[] DEFAULT '{}'::"text"[],
    "deflection_enabled" boolean DEFAULT true,
    "deflection_message" "text" DEFAULT ''::"text" NOT NULL,
    "ask_profile" boolean DEFAULT false,
    "profile_question" "text" DEFAULT ''::"text" NOT NULL,
    "intents" "jsonb" DEFAULT '[]'::"jsonb",
    "demographic_inference" boolean DEFAULT false,
    "focuses" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "probe_focus_enabled" boolean DEFAULT false NOT NULL,
    "brand_tag" "text",
    "research_probes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "capability" "text" DEFAULT 'standard'::"text" NOT NULL,
    "capability_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "agents_capability_check" CHECK (("capability" = ANY (ARRAY['standard'::"text", 'super'::"text"]))),
    CONSTRAINT "bots_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."agents" OWNER TO "postgres";


COMMENT ON COLUMN "public"."agents"."focuses" IS 'Array of {slug, label, description, enabled} objects. When non-empty, the chat route classifies each assistant reply against the list and appends focus:<slug> entries to bot_conversation_turns.content_flags. Parallel to but distinct from `intents` (which are user-side signal detection).';



COMMENT ON COLUMN "public"."agents"."probe_focus_enabled" IS 'When true, lib/chatCore.ts fires lib/probeFocusClassifier.classifyProbeFocuses on every user turn (post-insert, fire-and-forget) and tags content_flags with topic:<slug>. Mirrors the assistant-side focus classifier. Disabled by default — opt-in per bot to control AI cost.';



COMMENT ON COLUMN "public"."agents"."brand_tag" IS 'Free-text brand label. Resolves (via find_or_create_brand_collection) to the brand collection whose entity_catalog this agent''s curated entities roll up into. Phase 3 of the shared brand-correction layer.';



COMMENT ON COLUMN "public"."agents"."research_probes" IS 'Research-probe library (BOTS.md §14.4): [{id, version, construct, mode: verbatim|concept, question, answer_schema, follow_up, tag_hooks, eligibility{min_user_turns, sentiment_gate, topic_triggers, topic_exclusions, channels}, sampling{sample_pct, target_n, cooldown_days, field_start, field_end}, enabled}]. Any wording change MUST bump version. While any probe is enabled the public widget shows the §14.3 disclosure line.';



CREATE TABLE IF NOT EXISTS "public"."ai_consent_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "action" "text" NOT NULL,
    "prev_value" boolean NOT NULL,
    "new_value" boolean NOT NULL,
    "ip" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_consent_audit_action_check" CHECK (("action" = ANY (ARRAY['enable'::"text", 'disable'::"text"])))
);


ALTER TABLE "public"."ai_consent_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archived_dataset_rows" (
    "id" bigint NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "batch_index" integer DEFAULT 0 NOT NULL,
    "rows" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "row_count" integer DEFAULT 0,
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."archived_dataset_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archived_dataset_rows_flat" (
    "id" bigint NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "row_index" integer DEFAULT 0 NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."archived_dataset_rows_flat" OWNER TO "postgres";


ALTER TABLE "public"."archived_dataset_rows_flat" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."archived_dataset_rows_flat_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."archived_dataset_rows" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."archived_dataset_rows_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."bot_change_log" WITH ("security_invoker"='true') AS
 SELECT "id",
    "bot_id",
    "org_id",
    "actor_id",
    "actor_email",
    "action",
    "summary",
    "before",
    "after",
    "metadata",
    "created_at"
   FROM "public"."agent_change_log";


ALTER VIEW "public"."bot_change_log" OWNER TO "postgres";


COMMENT ON VIEW "public"."bot_change_log" IS 'Phase 3 backward-compat view. Underlying table renamed to agent_change_log in sql/079.';



CREATE OR REPLACE VIEW "public"."bot_conversation_reviews" WITH ("security_invoker"='true') AS
 SELECT "id",
    "bot_id",
    "reviewed_at",
    "since",
    "session_count",
    "turn_count",
    "report",
    "theme_drift",
    "created_at"
   FROM "public"."agent_conversation_reviews";


ALTER VIEW "public"."bot_conversation_reviews" OWNER TO "postgres";


COMMENT ON VIEW "public"."bot_conversation_reviews" IS 'Phase 3 backward-compat view. Underlying table renamed to agent_conversation_reviews in sql/079.';



CREATE TABLE IF NOT EXISTS "public"."bot_conversation_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "turn_number" integer DEFAULT 0 NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "content_en" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "content_flags" "jsonb",
    "source" "text" DEFAULT 'normal'::"text" NOT NULL,
    "sentiment" "text",
    "sentiment_score" real,
    CONSTRAINT "bot_conversation_turns_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."bot_conversation_turns" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."bot_knowledge_chunks" WITH ("security_invoker"='true') AS
 SELECT "id",
    "bot_id",
    "title",
    "content",
    "metadata",
    "tsv",
    "created_at",
    "embedding"
   FROM "public"."agent_knowledge_chunks";


ALTER VIEW "public"."bot_knowledge_chunks" OWNER TO "postgres";


COMMENT ON VIEW "public"."bot_knowledge_chunks" IS 'Phase 3 backward-compat view. Underlying table renamed to agent_knowledge_chunks in sql/079.';



CREATE OR REPLACE VIEW "public"."bot_session_personas" WITH ("security_invoker"='true') AS
 SELECT "id",
    "bot_id",
    "session_id",
    "persona",
    "created_at",
    "updated_at",
    "demographics"
   FROM "public"."agent_session_personas";


ALTER VIEW "public"."bot_session_personas" OWNER TO "postgres";


COMMENT ON VIEW "public"."bot_session_personas" IS 'Phase 3 backward-compat view. Underlying table renamed to agent_session_personas in sql/079.';



CREATE OR REPLACE VIEW "public"."bots" WITH ("security_invoker"='true') AS
 SELECT "id",
    "org_id",
    "name",
    "slug",
    "status",
    "config",
    "system_prompt",
    "knowledge_base",
    "training_urls",
    "conversation_count",
    "created_by",
    "created_at",
    "updated_at",
    "last_session_at",
    "review_interval_hours",
    "last_reviewed_at",
    "next_review_at",
    "personality",
    "faq",
    "facts",
    "guardrails",
    "opponents",
    "contrast_mode",
    "subject",
    "negative_content_mode",
    "sensitive_topics",
    "focus_topics",
    "deflection_enabled",
    "deflection_message",
    "ask_profile",
    "profile_question",
    "intents",
    "demographic_inference",
    "focuses"
   FROM "public"."agents";


ALTER VIEW "public"."bots" OWNER TO "postgres";


COMMENT ON VIEW "public"."bots" IS 'Phase 3 backward-compat view. Underlying table renamed to agents in sql/079. Drop this view once all code references migrate to agents.';



CREATE TABLE IF NOT EXISTS "public"."campaign_emails" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "sequence" smallint DEFAULT 0 NOT NULL,
    "subject" "text" NOT NULL,
    "body_html" "text" NOT NULL,
    "body_text" "text",
    "send_delay_hours" integer DEFAULT 0,
    "send_to" "text" DEFAULT 'all'::"text" NOT NULL,
    "is_thank_you" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "send_time" time without time zone,
    "send_timezone" "text" DEFAULT 'America/New_York'::"text",
    "sms_body" "text",
    CONSTRAINT "campaign_emails_send_to_check" CHECK (("send_to" = ANY (ARRAY['all'::"text", 'non_responders'::"text", 'incompletes'::"text"])))
);


ALTER TABLE "public"."campaign_emails" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_respondents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "fields" "jsonb" DEFAULT '{}'::"jsonb",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sent_at" timestamp with time zone,
    "opened_at" timestamp with time zone,
    "clicked_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "response_id" "uuid",
    "unsubscribe_token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text"),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "recipient_guid" "text" NOT NULL,
    "phone" "text",
    CONSTRAINT "campaign_respondents_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'opened'::"text", 'clicked'::"text", 'completed'::"text", 'bounced'::"text", 'unsubscribed'::"text"])))
);


ALTER TABLE "public"."campaign_respondents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL,
    "scheduled_at" timestamp with time zone NOT NULL,
    "executed_at" timestamp with time zone,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "campaign_schedules_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."campaign_schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaign_send_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "respondent_id" "uuid" NOT NULL,
    "email_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_msg_id" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "error_message" "text",
    "sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "schedule_id" "uuid",
    CONSTRAINT "campaign_send_log_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'delivered'::"text", 'opened'::"text", 'clicked'::"text", 'bounced'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."campaign_send_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "study_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "study_url" "text" NOT NULL,
    "hidden_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "target_responses" integer,
    "email_provider" "text" DEFAULT 'resend'::"text" NOT NULL,
    "email_config" "jsonb" DEFAULT '{}'::"jsonb",
    "send_thank_you" boolean DEFAULT false,
    "send_incomplete" boolean DEFAULT false,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "channel" "text" DEFAULT 'email'::"text",
    "sms_config" "jsonb" DEFAULT '{}'::"jsonb",
    CONSTRAINT "campaigns_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'sms'::"text", 'both'::"text"]))),
    CONSTRAINT "campaigns_email_provider_check" CHECK (("email_provider" = ANY (ARRAY['resend'::"text", 'sendgrid'::"text", 'ses'::"text", 'smtp'::"text"]))),
    CONSTRAINT "campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'scheduled'::"text", 'active'::"text", 'paused'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "clients_plan_check" CHECK (("plan" = ANY (ARRAY['trial'::"text", 'active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."collection_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "collection_id" "uuid" NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."collection_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."collections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "kind" "text" DEFAULT 'manual'::"text" NOT NULL,
    "slug" "text",
    "rules" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "purpose" "text",
    CONSTRAINT "collections_kind_check" CHECK (("kind" = ANY (ARRAY['manual'::"text", 'brand'::"text"]))),
    CONSTRAINT "collections_purpose_check" CHECK ((("purpose" IS NULL) OR ("purpose" = ANY (ARRAY['community'::"text", 'competitive'::"text", 'brand_360'::"text"]))))
);


ALTER TABLE "public"."collections" OWNER TO "postgres";


COMMENT ON COLUMN "public"."collections"."kind" IS 'manual = user-curated analytical grouping (today''s behaviour). brand = auto-curated by datasets.brand_tag; represents a real-world brand and owns an entity catalog.';



COMMENT ON COLUMN "public"."collections"."slug" IS 'Canonical slug (slugify(name)) for brand-collections. NULL for manual collections. Unique per org among brand-collections.';



COMMENT ON COLUMN "public"."collections"."rules" IS 'Brand-level config applied to member datasets: entity-discovery settings, future structured tagging rules, score maps. Empty {} = defaults. Unused on manual collections.';



COMMENT ON COLUMN "public"."collections"."purpose" IS 'Report purpose typing (community|competitive|brand_360); drives which report the card offers. NULL = legacy, show all.';



CREATE TABLE IF NOT EXISTS "public"."conversation_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "reasons" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversation_reviews_status_check" CHECK (("status" = ANY (ARRAY['approved'::"text", 'excluded'::"text"])))
);


ALTER TABLE "public"."conversation_reviews" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversation_reviews" IS 'Human-in-the-loop review decisions for agent conversations. A row exists only when a human acted: approved (clear an auto-flagged troll/bot/off-topic conversation → include in reports) or excluded (confirm junk → never in reports). No row = clean. Auto-flagging is computed live in lib/conversationReview.ts and not persisted. Service-role writes only.';



CREATE TABLE IF NOT EXISTS "public"."conversation_turns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "turn_number" integer NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "content_en" "text",
    "language" "text",
    "source" "text" DEFAULT 'normal'::"text" NOT NULL,
    "content_flags" "jsonb",
    "sentiment" "text",
    "sentiment_score" real,
    "ai_thinking" "jsonb",
    "topic_id" "uuid",
    "skipped" boolean,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "town_hall_id" "uuid",
    CONSTRAINT "conversation_turns_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'system'::"text"])))
);


ALTER TABLE "public"."conversation_turns" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversation_turns" IS 'Turns within a conversation. Superset shape of bot_conversation_turns + townhall_turns. Phase 3 dark; populated by dual-write once DUAL_WRITE_PHASE3 flag flips on.';



COMMENT ON COLUMN "public"."conversation_turns"."source" IS 'Turn provenance. Values from bots: normal, deflect, silence_probe. Values from PulseIQ: guide, clarifier, detected_theme, custom, deflect, standby, language_switch, system, revisit. Source values are not constrained here — the route owns the vocabulary during dual-write.';



COMMENT ON COLUMN "public"."conversation_turns"."topic_id" IS 'Reference to town_hall_topics(id) when the turn was assigned to a topic by PulseIQ-side matching. NULL for 1:1 bot conversations. Renamed from theme_id in sql/080 (Phase 5 commit 5) to match the rest of the convergence nomenclature.';



CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "participant_id" "text",
    "language" "text",
    "source" "text",
    "medium" "text",
    "campaign" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "turn_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


COMMENT ON TABLE "public"."conversations" IS 'One participant talking to a bot over a session. Phase 3 dark; populated by dual-write from /api/bots/[id]/chat once the DUAL_WRITE_PHASE3 flag flips on. Independent of any town hall — town_hall_conversations joins one to a town hall when applicable.';



COMMENT ON COLUMN "public"."conversations"."session_id" IS 'Widget-side session UUID (text, matches bot_conversation_turns.session_id). Phase 3 carries the legacy session id to make backfill from bot_conversation_turns trivial; future surfaces may use conversations.id directly.';



COMMENT ON COLUMN "public"."conversations"."participant_id" IS 'Town-hall participant identifier when the conversation is part of a town hall (PulseIQ-side concept). NULL for 1:1 bot chats.';



CREATE TABLE IF NOT EXISTS "public"."dataset_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "rows" "jsonb" NOT NULL,
    "row_count" integer NOT NULL,
    "batch_index" integer DEFAULT 0 NOT NULL,
    "source_ref" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."dataset_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dataset_rows_flat" (
    "id" bigint NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "row_index" integer DEFAULT 0 NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tsv" "tsvector",
    "dedup_key" "text"
);


ALTER TABLE "public"."dataset_rows_flat" OWNER TO "postgres";


ALTER TABLE "public"."dataset_rows_flat" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."dataset_rows_flat_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."dataset_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "schema_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "theme_model" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "saved_charts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "saved_stats" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "filter_state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "analytics" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "session_state" "jsonb"
);


ALTER TABLE "public"."dataset_state" OWNER TO "postgres";


COMMENT ON COLUMN "public"."dataset_state"."session_state" IS 'Saved workspace state: {activeTab, subTab, selectedFields, chartConfigs, filterState, etc.}';



CREATE TABLE IF NOT EXISTS "public"."datasets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "source" "text" DEFAULT 'upload'::"text" NOT NULL,
    "study_id" "uuid",
    "org_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "row_count" integer DEFAULT 0 NOT NULL,
    "last_synced_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ana_library" "text",
    "archived_at" timestamp with time zone,
    "archived_by" "uuid",
    "brand_tag" "text",
    "brand_collection_id" "uuid",
    "taxonomy_enabled" boolean DEFAULT false NOT NULL,
    "taxonomy_suppressed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."datasets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."datasets"."brand_tag" IS 'User-facing brand name typed on the dataset (e.g. "Capital Grille"). The trigger in 062 normalises this via slugify() and find-or-creates the brand-collection.';



COMMENT ON COLUMN "public"."datasets"."brand_collection_id" IS 'The brand-collection this dataset belongs to (collections.id, kind=brand). Set by the 062 trigger from brand_tag. NULL = dataset has no brand; entity catalog is dataset-scoped.';



COMMENT ON COLUMN "public"."datasets"."taxonomy_suppressed" IS 'Dimensions opt-out: AI detected non-food-service data → hide the restaurant taxonomy even for google_reviews. Only overrides the source proxy, not an explicit taxonomy_enabled/org capability.';



CREATE TABLE IF NOT EXISTS "public"."deck_download_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "deck_name" "text" NOT NULL,
    "deck_variant" "text",
    "user_id" "uuid",
    "org_id" "uuid",
    "downloaded_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deck_download_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entity_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "uuid" NOT NULL,
    "canonical" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "sample_count" integer DEFAULT 1 NOT NULL,
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'discovered'::"text" NOT NULL,
    "hidden" boolean DEFAULT false NOT NULL,
    "provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "mention_count" integer,
    "mention_count_sampled" boolean,
    "mention_count_row_total" bigint,
    "mention_count_at" timestamp with time zone,
    CONSTRAINT "entity_catalog_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['dataset'::"text", 'collection'::"text", 'bot'::"text"]))),
    CONSTRAINT "entity_catalog_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'document'::"text", 'crawl'::"text", 'transcript'::"text", 'conversation'::"text", 'survey'::"text", 'review'::"text", 'discovered'::"text"])))
);


ALTER TABLE "public"."entity_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_catalog" IS 'Flat list of canonical entities per scope (dataset or collection). Discovered from a Haiku NER sample. Counts are NOT stored — computed live via full-text search at filter time. Populated by lib/entityDiscovery.ts.';



COMMENT ON COLUMN "public"."entity_catalog"."sample_count" IS 'How many times discovery samples have surfaced this entity. A discovery-frequency hint, NOT a dataset mention count. Real counts come from runtime full-text search.';



COMMENT ON COLUMN "public"."entity_catalog"."source" IS 'Source-kind that OWNS the canonical spelling (its authority). manual>document>crawl (authoritative) > transcript>conversation>survey>review>discovered (corroborating). Only authoritative kinds may set/override a canonical (lib/correction/provenance.ts).';



COMMENT ON COLUMN "public"."entity_catalog"."hidden" IS 'Soft-delete flag. Hidden rows are excluded from cloud / compare / drill-down reads but persist so re-discovery does not resurface them. Toggle from the Schema tab.';



COMMENT ON COLUMN "public"."entity_catalog"."provenance" IS 'Per-row source trail, keyed by source-kind: { "<kind>": { count, refs[] } }. Maintained by the catalog writers; read by the correction glossary to keep only authoritative-sourced canonicals.';



COMMENT ON COLUMN "public"."entity_catalog"."mention_count" IS 'Cached live full-text mention count (entity mentions across the scope''s open-ended fields), served by getEntitiesWithCounts default reads. NULL = not yet computed. Keyed by mention_count_row_total; recomputed in the background when the scope row total changes. sql/172.';



COMMENT ON COLUMN "public"."entity_catalog"."mention_count_sampled" IS 'TRUE when mention_count was estimated over the 50K idx_drf_sample and scaled (dataset above the cap) — the UI shows a "~". sql/172.';



COMMENT ON COLUMN "public"."entity_catalog"."mention_count_row_total" IS 'Scope total row count when mention_count was written (staleness key, mirrors signal-stats row_count keying). sql/172.';



CREATE TABLE IF NOT EXISTS "public"."entity_catalog_refresh" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "uuid" NOT NULL,
    "triggered_by" "text" NOT NULL,
    "triggered_by_user" "uuid",
    "triggered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sample_size" integer,
    "datasets_sampled" "uuid"[],
    "entities_before" integer,
    "entities_after" integer,
    "entities_new" integer,
    "haiku_cost_est_cents" integer,
    "duration_ms" integer,
    "error" "text",
    CONSTRAINT "entity_catalog_refresh_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['dataset'::"text", 'collection'::"text", 'bot'::"text"]))),
    CONSTRAINT "entity_catalog_refresh_triggered_by_check" CHECK (("triggered_by" = ANY (ARRAY['initial'::"text", 'incremental'::"text", 'manual'::"text", 'cron'::"text"])))
);


ALTER TABLE "public"."entity_catalog_refresh" OWNER TO "postgres";


COMMENT ON TABLE "public"."entity_catalog_refresh" IS 'Append-only audit log of entity-discovery runs. One row per run (initial / incremental / manual / cron). Drives the "last refreshed" UI + cost tracking.';



CREATE TABLE IF NOT EXISTS "public"."invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'hex'::"text") NOT NULL,
    "email" "text",
    "role" "text" DEFAULT 'owner'::"text",
    "created_by" "uuid",
    "used_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "org_id" "uuid",
    CONSTRAINT "invites_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."logged_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "conversation_id" "uuid",
    "turn_id" "uuid",
    "user_message" "text" NOT NULL,
    "language" "text",
    "classification" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "resolved_by" "uuid",
    "resolved_at" timestamp with time zone,
    "notes" "text",
    "suggested_kb_addition" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'agent'::"text" NOT NULL,
    "external_contact" "jsonb",
    "answer_text" "text",
    "batch_label" "text",
    "batch_id" "uuid",
    "original_comment" "text",
    "draft_response" "text",
    CONSTRAINT "logged_questions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'answered'::"text", 'referred'::"text", 'n_a'::"text"])))
);


ALTER TABLE "public"."logged_questions" OWNER TO "postgres";


COMMENT ON TABLE "public"."logged_questions" IS 'Durable record of user questions the bot couldn''t or didn''t answer. Populated fire-and-forget from lib/chatCore.ts at three capture points: deflect, kb_miss, ai_uncertain. Status lifecycle: open -> answered|referred|n_a. Generic across every bot; NOWOCATS PM-2 record is the driving use case. See docs/BOTS.md § 9.x.';



COMMENT ON COLUMN "public"."logged_questions"."classification" IS 'Free-text classification — today: deflect | kb_miss | ai_uncertain. Future per spec: clarification, intent:ASK variants, manual.';



COMMENT ON COLUMN "public"."logged_questions"."suggested_kb_addition" IS 'Optional — when an admin reviews the question and proposes content the KB should add, the proposal lives here. Future: integrate with bot_change_log so KB additions that resolve a logged question get cross-linked.';



CREATE TABLE IF NOT EXISTS "public"."mco_handoff_sessions" (
    "code" "text" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "source_session_id" "text" NOT NULL,
    "messages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:15:00'::interval) NOT NULL
);


ALTER TABLE "public"."mco_handoff_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."mco_handoff_sessions" IS 'Kiosk → phone handoff for /demo/mco. Public code-gated handoff, no auth. 15-min TTL. Service-role only (no client policies). See docs/MCO_AGENT.md § Handoff.';



CREATE TABLE IF NOT EXISTS "public"."org_features" (
    "org_id" "uuid" NOT NULL,
    "feature" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "quota_per_month" integer,
    "enabled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "enabled_by" "uuid"
);


ALTER TABLE "public"."org_features" OWNER TO "postgres";


COMMENT ON TABLE "public"."org_features" IS 'Org-level feature gates with monthly quotas. Default for every member of the org. Per-user overrides live in user_features.';



COMMENT ON COLUMN "public"."org_features"."quota_per_month" IS 'Per-feature monthly cap on units consumed (e.g. recordings processed). NULL = unlimited. Usage counted against usage_logs scoped to the calendar month.';



CREATE TABLE IF NOT EXISTS "public"."org_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "resource_name" "text",
    "from_org_id" "uuid",
    "from_org_name" "text",
    "to_org_id" "uuid" NOT NULL,
    "to_org_name" "text",
    "initiated_by" "uuid",
    "initiated_by_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_transfers_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['bot'::"text", 'study'::"text", 'dataset'::"text", 'townhall_session'::"text", 'recording'::"text"])))
);


ALTER TABLE "public"."org_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'active'::"text",
    "is_admin_org" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "logo_url" "text",
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "ai_key_mode" "text" DEFAULT 'platform'::"text" NOT NULL,
    "ai_api_key" "text",
    "ai_api_key_set_at" timestamp with time zone,
    "ai_api_key_set_by" "uuid",
    "ai_provider" "text" DEFAULT 'anthropic'::"text" NOT NULL,
    "limits" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "organizations_ai_key_mode_check" CHECK (("ai_key_mode" = ANY (ARRAY['off'::"text", 'platform'::"text", 'byo'::"text"]))),
    CONSTRAINT "organizations_ai_provider_check" CHECK (("ai_provider" = ANY (ARRAY['anthropic'::"text", 'openai'::"text"]))),
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['trial'::"text", 'active'::"text", 'suspended'::"text"]))),
    CONSTRAINT "organizations_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'suspended'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."ai_key_mode" IS 'AI routing mode. off = no AI calls allowed for this org under any circumstance (server enforces). platform = use Sentimetrx env keys (default). byo = use ai_api_key + ai_provider.';



COMMENT ON COLUMN "public"."organizations"."ai_api_key" IS 'Raw Anthropic API key for BYO orgs. Read only via service-role; never exposed to clients. RLS keeps this column out of normal org SELECTs (only super-admins should see set_at / set_by metadata via dedicated admin endpoints).';



COMMENT ON COLUMN "public"."organizations"."ai_provider" IS 'Provider for the BYOK key. Ignored when ai_key_mode != byo. OpenAI BYOK covers LLM + embeddings + moderation. Anthropic BYOK covers LLM only; embeddings/moderation fall back to platform OPENAI_API_KEY.';



COMMENT ON COLUMN "public"."organizations"."limits" IS 'Opt-in per-org limits. Key: review_records_monthly (int) = max review records downloadable per calendar month across Google + Tripadvisor. Empty {} = unlimited.';



CREATE TABLE IF NOT EXISTS "public"."pulseiq_session_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "town_hall_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."pulseiq_session_conversations" OWNER TO "postgres";


COMMENT ON TABLE "public"."pulseiq_session_conversations" IS 'Join table linking conversations to town halls. A conversation joins zero or one town halls; a town hall has many conversations. Allows retroactive cohort views (e.g. add existing Sarina chats to the June town hall post-hoc).';



CREATE TABLE IF NOT EXISTS "public"."pulseiq_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "cohort_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "discussion_guide" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "response_target" integer DEFAULT 50 NOT NULL,
    "started_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_theme_detection_at" timestamp with time zone,
    "response_counter" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "town_halls_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'paused'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."pulseiq_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."pulseiq_sessions" IS 'Cohort wrapper around a bot. A town hall has its own slug + cohort config + analysis layer; the bot it points at is unchanged. Phase 3 dark; activated in Phase 5/6.';



COMMENT ON COLUMN "public"."pulseiq_sessions"."bot_id" IS 'The bot serving this town hall. ON DELETE RESTRICT prevents accidental bot deletion while a town hall references it.';



CREATE TABLE IF NOT EXISTS "public"."pulseiq_topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "town_hall_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text",
    "question" "text" NOT NULL,
    "follow_up_angles" "text"[],
    "keywords" "text"[],
    "state" "text" DEFAULT 'active'::"text" NOT NULL,
    "source" "text" DEFAULT 'seed'::"text" NOT NULL,
    "response_target" integer DEFAULT 5 NOT NULL,
    "response_count" integer DEFAULT 0 NOT NULL,
    "mention_count" integer DEFAULT 0 NOT NULL,
    "example_quote" "text",
    "sort_order" integer,
    "detected_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "round_number" integer,
    CONSTRAINT "town_hall_topics_source_check" CHECK (("source" = ANY (ARRAY['seed'::"text", 'auto_detected'::"text", 'manual'::"text"]))),
    CONSTRAINT "town_hall_topics_state_check" CHECK (("state" = ANY (ARRAY['active'::"text", 'pending'::"text", 'detected'::"text", 'paused'::"text", 'parked'::"text", 'completed'::"text", 'rejected'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."pulseiq_topics" OWNER TO "postgres";


COMMENT ON TABLE "public"."pulseiq_topics" IS 'Per-town-hall topic pool. Seed topics are inserted at town-hall create (from bots.focuses or a curated set); auto_detected topics are appended by the Phase-5 cohort theme-detection cron. The chat handler pulls from this table when serving a town-hall conversation.';



COMMENT ON COLUMN "public"."pulseiq_topics"."round_number" IS 'Round-based pacing: which round this topic belongs to (1-indexed). NULL = open-conversation pacing. Round 1 seeds active, later rounds seed paused until the moderator advances.';



CREATE TABLE IF NOT EXISTS "public"."question_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "bot_id" "uuid" NOT NULL,
    "label" "text",
    "source_kind" "text" DEFAULT 'paste'::"text" NOT NULL,
    "share_token" "text",
    "share_enabled" boolean DEFAULT false NOT NULL,
    "share_expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."question_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limit_buckets" (
    "key" "text" NOT NULL,
    "count" integer NOT NULL,
    "reset_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."rate_limit_buckets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recording_config_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recording_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "version_number" integer NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "change_note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recording_config_versions_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'analysis'::"text"])))
);


ALTER TABLE "public"."recording_config_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."recording_config_versions" IS 'Config snapshot history for a recording. Auto-snapshot on each analysis run (source=analysis) + manual "Save version" (source=manual). See docs/RECORDINGS.md § 2.8.';



CREATE TABLE IF NOT EXISTS "public"."recording_extractions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recording_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "unit_type" "text" NOT NULL,
    "topic" "text",
    "payload" "jsonb" NOT NULL,
    "start_sec" integer,
    "end_sec" integer,
    "source_file" "text",
    "confidence" numeric(3,2),
    "flagged_for_review" boolean DEFAULT false NOT NULL,
    "flag_reason" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recording_extractions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recording_extractions"."payload" IS 'Shape depends on unit_type. qa_pair: {question,asker_name?,answer,panelist_name?,question_typology}. quote / action_item shapes in docs/RECORDINGS.md § 2.4.';



COMMENT ON COLUMN "public"."recording_extractions"."flag_reason" IS 'Why the row is flagged for human review. Today: low_confidence, curator_questioned (Sonnet 4.6 second-pass disagreed), cross_vendor_disagreement (hybrid ASR), panel_to_panel_suspect.';



CREATE TABLE IF NOT EXISTS "public"."recording_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recording_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "original_filename" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "duration_sec" integer,
    "is_video" boolean NOT NULL,
    "audio_storage_path" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "upload_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "file_role" "text" DEFAULT 'media'::"text" NOT NULL,
    CONSTRAINT "recording_files_file_role_check" CHECK (("file_role" = ANY (ARRAY['media'::"text", 'slides'::"text", 'document'::"text"]))),
    CONSTRAINT "recording_files_upload_status_check" CHECK (("upload_status" = ANY (ARRAY['pending'::"text", 'uploaded'::"text", 'extracted'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."recording_files" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recording_files"."file_role" IS 'media = audio/video (transcribed); slides = presentation deck (PDF, vision-read → presentation_outline); document = brief/reference doc (stored, not pipeline-processed). Default media.';



CREATE TABLE IF NOT EXISTS "public"."recording_transcripts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recording_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "vendor" "text" NOT NULL,
    "language_detected" "text",
    "segments" "jsonb" NOT NULL,
    "raw_response" "jsonb",
    "word_count" integer,
    "duration_sec" integer,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "recording_transcripts_vendor_check" CHECK (("vendor" = ANY (ARRAY['whisper'::"text", 'deepgram'::"text", 'hybrid'::"text"])))
);


ALTER TABLE "public"."recording_transcripts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."recording_transcripts"."segments" IS 'JSONB array of {start,end,speaker?,text,confidence?}. When the source was multi-file, each segment also carries source_file + source_offset for the future audio-playback viewer.';



CREATE TABLE IF NOT EXISTS "public"."recordings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "dataset_id" "uuid",
    "name" "text" NOT NULL,
    "session_type" "text" NOT NULL,
    "meeting_date" "date",
    "location" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "setup_inputs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "asr_strategy" "text" DEFAULT 'auto'::"text" NOT NULL,
    "asr_vendor_chosen" "text",
    "status" "text" DEFAULT 'uploading'::"text" NOT NULL,
    "error_message" "text",
    "source_duration_sec" integer,
    "source_size_bytes" bigint,
    "cost_cents" integer DEFAULT 0 NOT NULL,
    "coverage_report" "jsonb",
    "share_token" "text",
    "share_enabled" boolean DEFAULT false NOT NULL,
    "share_expires_at" timestamp with time zone,
    "share_password_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "analysis_summary" "jsonb",
    "meeting_profile" "jsonb",
    "phase_map" "jsonb",
    "presentation_outline" "jsonb",
    "proceedings_summary" "jsonb",
    "entity_map" "jsonb",
    "brand_tag" "text",
    "underlying_agent_id" "uuid",
    "share_verbatim" boolean DEFAULT false NOT NULL,
    "analysis_org" "text" DEFAULT 'Datanautix'::"text" NOT NULL,
    "analysts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "objectives" "jsonb",
    "setup_provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "confidentiality_class" "text" DEFAULT 'client_confidential'::"text" NOT NULL,
    "signoff" "jsonb",
    "analyzed_config_version" integer,
    "live_summary" "jsonb",
    "live_transcript" "text",
    "audio_channels" smallint,
    "capture_stereo" boolean,
    "channel_labels" "jsonb",
    "draft" boolean DEFAULT false NOT NULL,
    "speaker_names" "jsonb",
    "respan_log" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "qa_stale" boolean DEFAULT false NOT NULL,
    CONSTRAINT "recordings_asr_strategy_check" CHECK (("asr_strategy" = ANY (ARRAY['auto'::"text", 'whisper'::"text", 'deepgram'::"text", 'hybrid'::"text"]))),
    CONSTRAINT "recordings_confidentiality_class_check" CHECK (("confidentiality_class" = ANY (ARRAY['public'::"text", 'internal'::"text", 'client_confidential'::"text", 'restricted'::"text"]))),
    CONSTRAINT "recordings_session_type_check" CHECK (("session_type" = ANY (ARRAY['qa'::"text", 'focus_group'::"text", 'general_meeting'::"text", 'interview'::"text", 'lecture'::"text"]))),
    CONSTRAINT "recordings_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'awaiting_media'::"text", 'uploading'::"text", 'queued'::"text", 'extracting'::"text", 'transcribing'::"text", 'transcribed'::"text", 'analyzing'::"text", 'rendering'::"text", 'complete'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."recordings" OWNER TO "postgres";


COMMENT ON TABLE "public"."recordings" IS 'One row per uploaded meeting recording. Owns pipeline state, share token, cost accumulator, and the back-reference to the derived datasets row. See docs/RECORDINGS.md.';



COMMENT ON COLUMN "public"."recordings"."setup_inputs" IS 'Per session_type payload. qa: {panel:[{name,role}], agenda:[string], ground_truth_url?:string}. focus_group / interview / general_meeting / lecture shapes documented in docs/RECORDINGS.md § 2.1.';



COMMENT ON COLUMN "public"."recordings"."share_token" IS 'Random 24-char URL-safe token granting public read access at /r/<token>. NULL until POST /api/recordings/[id]/share is called. Rotating issues a new token and 404s the old one.';



COMMENT ON COLUMN "public"."recordings"."analysis_summary" IS 'Meeting-level synthesis from the analyze pass third step (docs/RECORDINGS.md §3.5): { executive_summary, headline, sentiment_overall, sentiment_breakdown, topic_summaries[], decisions[], generated_at, model }. Action items live as action_item extraction rows, not here. Written by analyzeRecording + reanalyzeRecording(scope=all); null for recordings analyzed before 2026-06.';



COMMENT ON COLUMN "public"."recordings"."meeting_profile" IS 'Meeting-type config (docs/RECORDINGS.md): { preset_id, phases:[{kind,label,analysis,expected}], has_slides }. NULL = the implicit town_hall_qa preset (single Q&A phase over the whole transcript) = legacy behavior.';



COMMENT ON COLUMN "public"."recordings"."phase_map" IS 'Detected + user-edited meeting phases: { phases:[{kind,label,start_sec,end_sec,confidence?}], detected_at, model, edited_by_user }. Computed post-transcription, adjustable at the transcribed review gate. NULL/absent => whole transcript treated as one Q&A phase.';



COMMENT ON COLUMN "public"."recordings"."presentation_outline" IS 'AI-vision read of the uploaded slide deck (file_role=slides): { slides:[{slide_number,title,key_points,figures,presenter,notes}], source_filename, page_count, generated_at, model }. Ground-truth seed for proceedings_summary. NULL when no slides uploaded or vision unavailable.';



COMMENT ON COLUMN "public"."recordings"."proceedings_summary" IS 'Neutral summary of the presentation phase (docs/RECORDINGS.md): { overview, items:[{title,presenter,what_was_presented,key_figures,slide_refs}], generated_at, model }. NULL for Q&A-only meetings or on graceful-degrade.';



COMMENT ON COLUMN "public"."recordings"."analysis_org" IS 'Org performing the analysis (consulting brand), default Datanautix. Printed on report/deck. NOT the client brand — see brand_tag.';



COMMENT ON COLUMN "public"."recordings"."analysts" IS 'Analyst(s) from analysis_org: [{name, member_id?}]. member_id set when the analyst is an app user, absent for free-text names.';



COMMENT ON COLUMN "public"."recordings"."objectives" IS '{summary:string, questions:[string]} — meeting objectives, AI-proposed from uploaded docs then edited. Steers the synthesis pass.';



COMMENT ON COLUMN "public"."recordings"."setup_provenance" IS 'Maps a pre-filled setup field (agenda/panel/glossary/objectives) to the source document filename it was extracted from. {} when typed by hand.';



COMMENT ON COLUMN "public"."recordings"."confidentiality_class" IS 'Distribution classification stamped on exports: public | internal | client_confidential (default) | restricted.';



COMMENT ON COLUMN "public"."recordings"."signoff" IS '{approved_by, approved_by_member_id?, approved_at, note?} — analyst sign-off; NULL until the report is approved for distribution.';



COMMENT ON COLUMN "public"."recordings"."analyzed_config_version" IS 'recording_config_versions.version_number whose snapshot produced the current analysis_summary. Drives the "Config vN" footer stamp.';



COMMENT ON COLUMN "public"."recordings"."audio_channels" IS 'Detected channel layout of the extracted audio: 1=mono, 2=true stereo (per-channel speaker separation). NULL=not yet extracted. Set by lib/recordings/extract.ts.';



COMMENT ON COLUMN "public"."recordings"."capture_stereo" IS 'TRUE when the live recorder deliberately captured a 2-channel split-mic source. extract.ts then preserves stereo if the file has ≥2 channels, skipping the dual-mono guard. Set by the live capture client.';



COMMENT ON COLUMN "public"."recordings"."channel_labels" IS 'Optional names for stereo capture channels, indexed by channel: [leftName, rightName]. Shown in the report transcript in place of Mic 1·L / Mic 2·R. Set by the live capture Mic check.';



COMMENT ON COLUMN "public"."recordings"."draft" IS 'TRUE = report is an unreviewed AI draft (DRAFT watermark + pending-review banner in report & exports). Set when analysis runs (generate checkbox, default on); cleared by "Mark as reviewed".';



COMMENT ON COLUMN "public"."recordings"."speaker_names" IS 'Map of diarized speaker label (e.g. "Speaker 0" / "S1") -> human name, for the transcript/report. Set via /api/recordings/[id]/speaker-names. Distinct from channel_labels (stereo per-mic names).';



COMMENT ON COLUMN "public"."recordings"."respan_log" IS 'Append-only log of targeted span re-transcribes: [{start_sec,end_sec,vendor,at}]. Reset to [] on a full re-transcribe. Drives the Coverage tab "already re-extracted" marker.';



COMMENT ON COLUMN "public"."recordings"."qa_stale" IS 'True when the transcript changed (span re-transcribe) without a Q&A re-run, so the pairs are out of date. Cleared by the analyze pass.';



CREATE TABLE IF NOT EXISTS "public"."reddit_source_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reddit_source_id" "uuid" NOT NULL,
    "thread_id" "text" NOT NULL,
    "subreddit" "text" NOT NULL,
    "title" "text" NOT NULL,
    "author" "text",
    "score" integer DEFAULT 0 NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "permalink" "text",
    "created_utc" timestamp with time zone,
    "selected" boolean DEFAULT true NOT NULL,
    "total_pulled" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reddit_source_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reddit_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "dataset_id" "uuid",
    "search_query" "text" NOT NULL,
    "subreddits" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "total_posts" integer DEFAULT 0 NOT NULL,
    "total_comments" integer DEFAULT 0 NOT NULL,
    "error_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reddit_sources_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'downloading'::"text", 'done'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."reddit_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reo_gold_review" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "source_dataset_id" "uuid",
    "source_row_id" bigint,
    "ext_review_id" "text",
    "rating" integer,
    "review_text" "text" NOT NULL,
    "proposed" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "gold" "jsonb",
    "reviewer_note" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "reviewed_at" timestamp with time zone,
    "reviewed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reo_gold_review" OWNER TO "postgres";


COMMENT ON TABLE "public"."reo_gold_review" IS 'REO (Restaurant Experience Ontology) gold set, one row per review. proposed=draft/AI labels, gold=human truth. Admin-only eval tooling (2026-06-08).';



CREATE TABLE IF NOT EXISTS "public"."responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "study_id" "uuid" NOT NULL,
    "study_guid" "text" NOT NULL,
    "client_id" "uuid",
    "sentiment" "text",
    "experience_score" smallint,
    "nps_score" smallint,
    "payload" "jsonb" NOT NULL,
    "completed_at" timestamp with time zone,
    "duration_sec" integer,
    "ip_hash" "text",
    "org_id" "uuid",
    "status" "text" DEFAULT 'complete'::"text",
    "session_id" "text",
    "fp_hash" "text",
    "content_flags" "jsonb",
    CONSTRAINT "responses_experience_score_check" CHECK ((("experience_score" >= 1) AND ("experience_score" <= 5))),
    CONSTRAINT "responses_nps_score_check" CHECK ((("nps_score" >= 1) AND ("nps_score" <= 5))),
    CONSTRAINT "responses_sentiment_check" CHECK ((("sentiment" = ANY (ARRAY['positive'::"text", 'neutral'::"text", 'negative'::"text", 'promoter'::"text", 'passive'::"text", 'detractor'::"text"])) OR ("sentiment" IS NULL)))
);


ALTER TABLE "public"."responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_downloads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "review_source_id" "uuid",
    "dataset_id" "uuid",
    "source" "text" DEFAULT 'google'::"text" NOT NULL,
    "records" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "review_downloads_source_check" CHECK (("source" = ANY (ARRAY['google'::"text", 'tripadvisor'::"text"])))
);


ALTER TABLE "public"."review_downloads" OWNER TO "postgres";


COMMENT ON TABLE "public"."review_downloads" IS 'Append-only ledger of review-record downloads (Google + Tripadvisor). One row per sync that ingested rows. Doubles as billing record + monthly-cap counter. Written by lib/reviewSync.ts via the service role.';



CREATE TABLE IF NOT EXISTS "public"."review_source_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_source_id" "uuid" NOT NULL,
    "place_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "address" "text",
    "city" "text",
    "state" "text",
    "zip" "text",
    "rating" numeric(2,1),
    "review_count" integer DEFAULT 0 NOT NULL,
    "selected" boolean DEFAULT false NOT NULL,
    "last_review_id" "text",
    "last_review_date" timestamp with time zone,
    "total_pulled" integer DEFAULT 0 NOT NULL,
    "last_synced_at" timestamp with time zone,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."review_source_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."review_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "dataset_id" "uuid",
    "brand_name" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "sync_frequency_hours" integer DEFAULT 24 NOT NULL,
    "last_synced_at" timestamp with time zone,
    "next_sync_at" timestamp with time zone,
    "error_message" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'google'::"text" NOT NULL,
    CONSTRAINT "review_sources_source_check" CHECK (("source" = ANY (ARRAY['google'::"text", 'tripadvisor'::"text"]))),
    CONSTRAINT "review_sources_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'searching'::"text", 'active'::"text", 'paused'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."review_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_views" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "dataset_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "kind" "text" DEFAULT 'view'::"text" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "filter_config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "frozen" "jsonb",
    "source_view_name" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "saved_views_kind_check" CHECK (("kind" = ANY (ARRAY['view'::"text", 'snapshot'::"text"]))),
    CONSTRAINT "saved_views_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'org'::"text"])))
);


ALTER TABLE "public"."saved_views" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schema_migrations" (
    "filename" "text" NOT NULL,
    "sha256" "text" NOT NULL,
    "applied_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "applied_by" "text",
    "note" "text"
);


ALTER TABLE "public"."schema_migrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."schema_migrations" IS 'Applied-migration ledger. One row per sql/ file that has run against this database. Written by scripts/apply-migration.ts.';



CREATE TABLE IF NOT EXISTS "public"."sentry_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "unresolved_count" integer NOT NULL,
    "issues" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "error" "text"
);


ALTER TABLE "public"."sentry_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_health" (
    "service" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "tier" integer DEFAULT 2 NOT NULL,
    "balance_usd" numeric,
    "balance_raw" "jsonb",
    "status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "checked_at" timestamp with time zone,
    "last_error_at" timestamp with time zone,
    "last_error_code" "text",
    "last_error_msg" "text",
    "last_alerted_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_health_status_check" CHECK (("status" = ANY (ARRAY['ok'::"text", 'low'::"text", 'critical'::"text", 'error'::"text", 'unknown'::"text"]))),
    CONSTRAINT "service_health_tier_check" CHECK (("tier" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."service_health" OWNER TO "postgres";


COMMENT ON TABLE "public"."service_health" IS 'One row per external vendor account; platform credit/health state. Tier-1 rows carry a polled balance_usd; tier-2 rows carry last credit-error only. Written by lib/serviceHealth.ts (service role), read by /admin/health + the service-balance cron.';



CREATE TABLE IF NOT EXISTS "public"."shared_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'hex'::"text") NOT NULL,
    "type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "created_by" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "last_accessed_at" timestamp with time zone,
    "metadata" "jsonb",
    "org_id" "uuid" NOT NULL,
    CONSTRAINT "shared_links_type_check" CHECK (("type" = ANY (ARRAY['study'::"text", 'campaign'::"text", 'townhall'::"text", 'conversation'::"text", 'analytics'::"text", 'agent_study'::"text"])))
);


ALTER TABLE "public"."shared_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_alert_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "rule_type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "channels" "jsonb" DEFAULT '[]'::"jsonb",
    "enabled" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."social_alert_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_alerts_sent" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "rule_id" "uuid",
    "channel" "text" NOT NULL,
    "target" "text" NOT NULL,
    "subject" "text",
    "body" "text",
    "comment_ids" "uuid"[],
    "sent_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."social_alerts_sent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "post_id" "text" NOT NULL,
    "post_text" "text",
    "comment_id" "text" NOT NULL,
    "parent_comment_id" "text",
    "author_name" "text",
    "author_id" "text",
    "text" "text" NOT NULL,
    "sentiment" "text",
    "flags" "jsonb" DEFAULT '[]'::"jsonb",
    "is_hidden" boolean DEFAULT false,
    "is_deleted" boolean DEFAULT false,
    "is_reply" boolean DEFAULT false,
    "replied_at" timestamp with time zone,
    "our_reply" "text",
    "platform_created_at" timestamp with time zone,
    "ingested_at" timestamp with time zone DEFAULT "now"(),
    "is_handled" boolean DEFAULT false,
    "sentiment_score" numeric
);


ALTER TABLE "public"."social_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "platform" "text" NOT NULL,
    "account_id" "text" NOT NULL,
    "account_name" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "token_expires_at" timestamp with time zone,
    "connected_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "social_connections_platform_check" CHECK (("platform" = ANY (ARRAY['facebook'::"text", 'instagram'::"text"])))
);


ALTER TABLE "public"."social_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_dm_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "connection_id" "uuid",
    "platform" "text" NOT NULL,
    "recipient_id" "text" NOT NULL,
    "recipient_name" "text",
    "trigger_comment_id" "uuid",
    "intent" "text",
    "template" "text",
    "message_text" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."social_dm_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_moderation_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "comment_id" "uuid",
    "action" "text" NOT NULL,
    "reply_text" "text",
    "performed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "social_moderation_log_action_check" CHECK (("action" = ANY (ARRAY['hide'::"text", 'unhide'::"text", 'delete'::"text", 'reply'::"text", 'ai_reply'::"text", 'dm'::"text"])))
);


ALTER TABLE "public"."social_moderation_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."studies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "guid" "text" NOT NULL,
    "client_id" "uuid",
    "created_by" "uuid",
    "name" "text" NOT NULL,
    "bot_name" "text" NOT NULL,
    "bot_emoji" "text" DEFAULT '💬'::"text",
    "status" "text" DEFAULT 'draft'::"text",
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "org_id" "uuid" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text",
    "slug" "text",
    CONSTRAINT "studies_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'paused'::"text", 'closed'::"text"]))),
    CONSTRAINT "studies_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'public'::"text"])))
);


ALTER TABLE "public"."studies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."study_response_stats_live" (
    "study_id" "uuid" NOT NULL,
    "total_responses" bigint DEFAULT 0 NOT NULL,
    "complete_count" bigint DEFAULT 0 NOT NULL,
    "promoters" bigint DEFAULT 0 NOT NULL,
    "passives" bigint DEFAULT 0 NOT NULL,
    "detractors" bigint DEFAULT 0 NOT NULL,
    "exp_sum" double precision DEFAULT 0 NOT NULL,
    "exp_n" bigint DEFAULT 0 NOT NULL,
    "nps_sum" double precision DEFAULT 0 NOT NULL,
    "nps_n" bigint DEFAULT 0 NOT NULL,
    "last_response_at" timestamp with time zone
);


ALTER TABLE "public"."study_response_stats_live" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."study_stats" AS
 SELECT "s"."id" AS "study_id",
    "s"."guid",
    "s"."org_id",
    "s"."created_by",
    "count"("r"."id") AS "total_responses",
    "round"("avg"("r"."nps_score"), 1) AS "avg_nps",
    "round"("avg"("r"."experience_score"), 1) AS "avg_experience",
    "count"(
        CASE
            WHEN ("r"."sentiment" = 'promoter'::"text") THEN 1
            ELSE NULL::integer
        END) AS "promoters",
    "count"(
        CASE
            WHEN ("r"."sentiment" = 'passive'::"text") THEN 1
            ELSE NULL::integer
        END) AS "passives",
    "count"(
        CASE
            WHEN ("r"."sentiment" = 'detractor'::"text") THEN 1
            ELSE NULL::integer
        END) AS "detractors",
    "max"("r"."completed_at") AS "last_response_at"
   FROM ("public"."studies" "s"
     LEFT JOIN "public"."responses" "r" ON (("r"."study_id" = "s"."id")))
  GROUP BY "s"."id", "s"."guid", "s"."org_id", "s"."created_by";


ALTER VIEW "public"."study_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."townhall_participant_responses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid",
    "participant_id" "text" NOT NULL,
    "psychographics" "jsonb" DEFAULT '{}'::"jsonb",
    "demographics" "jsonb" DEFAULT '{}'::"jsonb",
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "town_hall_id" "uuid",
    CONSTRAINT "townhall_participant_responses_substrate_check" CHECK ((("session_id" IS NOT NULL) OR ("town_hall_id" IS NOT NULL)))
);


ALTER TABLE "public"."townhall_participant_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."usage_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid",
    "event_type" "text" NOT NULL,
    "model" "text" NOT NULL,
    "provider" "text" DEFAULT 'anthropic'::"text" NOT NULL,
    "tier" "text" DEFAULT 'fast'::"text" NOT NULL,
    "input_tokens" integer DEFAULT 0 NOT NULL,
    "output_tokens" integer DEFAULT 0 NOT NULL,
    "cache_read_tokens" integer DEFAULT 0 NOT NULL,
    "cache_creation_tokens" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "cost_cents" integer
);


ALTER TABLE "public"."usage_logs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."usage_logs"."cost_cents" IS 'Flat cost in cents for non-token usage (e.g. ASR transcription). NULL = cost derived from tokens.';



CREATE TABLE IF NOT EXISTS "public"."user_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "event_name" "text" NOT NULL,
    "event_category" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_events" IS 'Append-only stream of meaningful user actions for stickiness analysis and pilot outreach. Writes go through lib/userEvents.ts::recordEvent (service-role). Best-effort: never blocks user flow on a failed insert.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "client_id" "uuid",
    "email" "text" NOT NULL,
    "full_name" "text",
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "org_id" "uuid",
    "features" "jsonb" DEFAULT '{}'::"jsonb",
    "disabled" boolean DEFAULT false,
    "ai_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['platform_admin'::"text", 'owner'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."ai_enabled" IS 'User-level opt-in for AI features. Org ai_key_mode is the ceiling; this is the per-user decision. Always defaults to false on user creation.';



CREATE OR REPLACE VIEW "public"."user_activity_summary" AS
 SELECT "u"."id" AS "user_id",
    "u"."email",
    "u"."full_name",
    "u"."org_id",
    "o"."name" AS "org_name",
    "u"."created_at" AS "user_created_at",
    "u"."disabled",
    "count"("ue".*) AS "total_events",
    "count"(DISTINCT "date_trunc"('day'::"text", "ue"."created_at")) AS "active_days",
    "max"("ue"."created_at") AS "last_active_at",
    "min"("ue"."created_at") AS "first_active_at",
    "count"(*) FILTER (WHERE ("ue"."created_at" > ("now"() - '7 days'::interval))) AS "events_7d",
    "count"(*) FILTER (WHERE ("ue"."created_at" > ("now"() - '30 days'::interval))) AS "events_30d",
    "count"(DISTINCT "date_trunc"('day'::"text", "ue"."created_at")) FILTER (WHERE ("ue"."created_at" > ("now"() - '7 days'::interval))) AS "active_days_7d",
    "count"(DISTINCT "date_trunc"('day'::"text", "ue"."created_at")) FILTER (WHERE ("ue"."created_at" > ("now"() - '30 days'::interval))) AS "active_days_30d"
   FROM (("public"."users" "u"
     LEFT JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
     LEFT JOIN "public"."user_events" "ue" ON (("ue"."user_id" = "u"."id")))
  GROUP BY "u"."id", "u"."email", "u"."full_name", "u"."org_id", "o"."name", "u"."created_at", "u"."disabled";


ALTER VIEW "public"."user_activity_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."user_activity_summary" IS 'One row per user with rollups for stickiness + inactivity outreach. Drives /admin/activity.';



CREATE TABLE IF NOT EXISTS "public"."user_favorites" (
    "user_id" "uuid" NOT NULL,
    "resource_type" "text" NOT NULL,
    "resource_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_favorites_resource_type_check" CHECK (("resource_type" = ANY (ARRAY['bot'::"text", 'study'::"text", 'dataset'::"text", 'campaign'::"text", 'townhall_session'::"text", 'recording'::"text"])))
);


ALTER TABLE "public"."user_favorites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_features" (
    "user_id" "uuid" NOT NULL,
    "feature" "text" NOT NULL,
    "enabled" boolean,
    "quota_per_month" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_features" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_features" IS 'Per-user feature overrides. enabled IS NULL means inherit from org_features; otherwise this row wins. quota_per_month overrides similarly.';



CREATE TABLE IF NOT EXISTS "public"."user_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "review_source_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_logins" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "method" "text" NOT NULL,
    "ip" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "user_logins_method_check" CHECK (("method" = ANY (ARRAY['password'::"text", 'magic'::"text", 'sso'::"text", 'invite'::"text"])))
);


ALTER TABLE "public"."user_logins" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."user_login_summary" AS
 SELECT "user_id",
    "org_id",
    "count"(*) FILTER (WHERE ("created_at" > ("now"() - '30 days'::interval))) AS "logins_30d",
    "count"(*) FILTER (WHERE ("created_at" > ("now"() - '7 days'::interval))) AS "logins_7d",
    "max"("created_at") AS "last_login_at",
    "max"("method") AS "last_method"
   FROM "public"."user_logins"
  GROUP BY "user_id", "org_id";


ALTER VIEW "public"."user_login_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source" "text" NOT NULL,
    "svix_id" "text" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "webhook_events_source_check" CHECK (("source" = 'resend'::"text"))
);


ALTER TABLE "public"."webhook_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."webhook_events" IS 'Append-only idempotency ledger for inbound signed webhooks. UNIQUE (source, svix_id) is the dedup key. Service role only; no auth-client reads.';



ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_crawl_jobs"
    ADD CONSTRAINT "agent_crawl_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_impressions"
    ADD CONSTRAINT "agent_impressions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_kb_page_hashes"
    ADD CONSTRAINT "agent_kb_page_hashes_agent_id_url_key" UNIQUE ("agent_id", "url");



ALTER TABLE ONLY "public"."agent_kb_page_hashes"
    ADD CONSTRAINT "agent_kb_page_hashes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_probe_quota"
    ADD CONSTRAINT "agent_probe_quota_pkey" PRIMARY KEY ("agent_id", "probe_id", "probe_version");



ALTER TABLE ONLY "public"."agent_probe_responses"
    ADD CONSTRAINT "agent_probe_responses_agent_id_session_id_probe_id_key" UNIQUE ("agent_id", "session_id", "probe_id");



ALTER TABLE ONLY "public"."agent_probe_responses"
    ADD CONSTRAINT "agent_probe_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_readout_cache"
    ADD CONSTRAINT "agent_readout_cache_pkey" PRIMARY KEY ("bot_id");



ALTER TABLE ONLY "public"."agent_study_cache"
    ADD CONSTRAINT "agent_study_cache_pkey" PRIMARY KEY ("bot_id");



ALTER TABLE ONLY "public"."ai_consent_audit"
    ADD CONSTRAINT "ai_consent_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archived_dataset_rows_flat"
    ADD CONSTRAINT "archived_dataset_rows_flat_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archived_dataset_rows"
    ADD CONSTRAINT "archived_dataset_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_change_log"
    ADD CONSTRAINT "bot_change_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_conversation_reviews"
    ADD CONSTRAINT "bot_conversation_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bot_conversation_turns"
    ADD CONSTRAINT "bot_conversation_turns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_knowledge_chunks"
    ADD CONSTRAINT "bot_knowledge_chunks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_session_personas"
    ADD CONSTRAINT "bot_session_personas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "bots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "bots_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."campaign_emails"
    ADD CONSTRAINT "campaign_emails_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_respondents"
    ADD CONSTRAINT "campaign_respondents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_respondents"
    ADD CONSTRAINT "campaign_respondents_recipient_guid_key" UNIQUE ("recipient_guid");



ALTER TABLE ONLY "public"."campaign_respondents"
    ADD CONSTRAINT "campaign_respondents_unsubscribe_token_key" UNIQUE ("unsubscribe_token");



ALTER TABLE ONLY "public"."campaign_schedules"
    ADD CONSTRAINT "campaign_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaign_send_log"
    ADD CONSTRAINT "campaign_send_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."collection_members"
    ADD CONSTRAINT "collection_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_reviews"
    ADD CONSTRAINT "conversation_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dataset_rows_flat"
    ADD CONSTRAINT "dataset_rows_flat_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dataset_rows"
    ADD CONSTRAINT "dataset_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dataset_state"
    ADD CONSTRAINT "dataset_state_dataset_id_key" UNIQUE ("dataset_id");



ALTER TABLE ONLY "public"."dataset_state"
    ADD CONSTRAINT "dataset_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deck_download_log"
    ADD CONSTRAINT "deck_download_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_catalog"
    ADD CONSTRAINT "entity_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_catalog_refresh"
    ADD CONSTRAINT "entity_catalog_refresh_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."entity_catalog"
    ADD CONSTRAINT "entity_catalog_uniq" UNIQUE ("scope_type", "scope_id", "slug");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mco_handoff_sessions"
    ADD CONSTRAINT "mco_handoff_sessions_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."org_features"
    ADD CONSTRAINT "org_features_pkey" PRIMARY KEY ("org_id", "feature");



ALTER TABLE ONLY "public"."org_transfers"
    ADD CONSTRAINT "org_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."question_batches"
    ADD CONSTRAINT "question_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."question_batches"
    ADD CONSTRAINT "question_batches_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."rate_limit_buckets"
    ADD CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."recording_config_versions"
    ADD CONSTRAINT "recording_config_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recording_config_versions"
    ADD CONSTRAINT "recording_config_versions_recording_id_version_number_key" UNIQUE ("recording_id", "version_number");



ALTER TABLE ONLY "public"."recording_extractions"
    ADD CONSTRAINT "recording_extractions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recording_files"
    ADD CONSTRAINT "recording_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recording_transcripts"
    ADD CONSTRAINT "recording_transcripts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recording_transcripts"
    ADD CONSTRAINT "recording_transcripts_recording_id_key" UNIQUE ("recording_id");



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_share_token_key" UNIQUE ("share_token");



ALTER TABLE ONLY "public"."reddit_source_threads"
    ADD CONSTRAINT "reddit_source_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reddit_sources"
    ADD CONSTRAINT "reddit_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reo_gold_review"
    ADD CONSTRAINT "reo_gold_review_org_id_ext_review_id_key" UNIQUE ("org_id", "ext_review_id");



ALTER TABLE ONLY "public"."reo_gold_review"
    ADD CONSTRAINT "reo_gold_review_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_downloads"
    ADD CONSTRAINT "review_downloads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_source_locations"
    ADD CONSTRAINT "review_source_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."review_sources"
    ADD CONSTRAINT "review_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("filename");



ALTER TABLE ONLY "public"."sentry_snapshots"
    ADD CONSTRAINT "sentry_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_health"
    ADD CONSTRAINT "service_health_pkey" PRIMARY KEY ("service");



ALTER TABLE ONLY "public"."shared_links"
    ADD CONSTRAINT "shared_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_links"
    ADD CONSTRAINT "shared_links_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."social_alert_rules"
    ADD CONSTRAINT "social_alert_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_alerts_sent"
    ADD CONSTRAINT "social_alerts_sent_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_comments"
    ADD CONSTRAINT "social_comments_comment_id_key" UNIQUE ("comment_id");



ALTER TABLE ONLY "public"."social_comments"
    ADD CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_dm_log"
    ADD CONSTRAINT "social_dm_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."social_moderation_log"
    ADD CONSTRAINT "social_moderation_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."studies"
    ADD CONSTRAINT "studies_guid_key" UNIQUE ("guid");



ALTER TABLE ONLY "public"."studies"
    ADD CONSTRAINT "studies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."study_response_stats_live"
    ADD CONSTRAINT "study_response_stats_live_pkey" PRIMARY KEY ("study_id");



ALTER TABLE ONLY "public"."pulseiq_session_conversations"
    ADD CONSTRAINT "town_hall_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pulseiq_topics"
    ADD CONSTRAINT "town_hall_topics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pulseiq_sessions"
    ADD CONSTRAINT "town_halls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."townhall_participant_responses"
    ADD CONSTRAINT "townhall_participant_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."usage_logs"
    ADD CONSTRAINT "usage_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("user_id", "resource_type", "resource_id");



ALTER TABLE ONLY "public"."user_features"
    ADD CONSTRAINT "user_features_pkey" PRIMARY KEY ("user_id", "feature");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_user_id_location_id_key" UNIQUE ("user_id", "location_id");



ALTER TABLE ONLY "public"."user_logins"
    ADD CONSTRAINT "user_logins_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_events"
    ADD CONSTRAINT "webhook_events_source_svix_id_key" UNIQUE ("source", "svix_id");



CREATE INDEX "admin_action_log_created_idx" ON "public"."admin_action_log" USING "btree" ("created_at" DESC);



CREATE INDEX "admin_action_log_resource_idx" ON "public"."admin_action_log" USING "btree" ("resource_type", "resource_id");



CREATE INDEX "admin_action_log_target_org_idx" ON "public"."admin_action_log" USING "btree" ("target_org_id");



CREATE INDEX "agent_impressions_bot_created_idx" ON "public"."agent_impressions" USING "btree" ("bot_id", "created_at" DESC);



CREATE INDEX "agent_readout_cache_org_idx" ON "public"."agent_readout_cache" USING "btree" ("org_id");



CREATE INDEX "agent_session_personas_name_idx" ON "public"."agent_session_personas" USING "btree" ("bot_id", "name") WHERE ("name" IS NOT NULL);



CREATE INDEX "agent_study_cache_org_idx" ON "public"."agent_study_cache" USING "btree" ("org_id");



CREATE INDEX "ai_consent_audit_org_id_idx" ON "public"."ai_consent_audit" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "ai_consent_audit_user_id_idx" ON "public"."ai_consent_audit" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "bot_change_log_bot_id_created_at_idx" ON "public"."agent_change_log" USING "btree" ("bot_id", "created_at" DESC);



CREATE INDEX "bot_change_log_org_id_created_at_idx" ON "public"."agent_change_log" USING "btree" ("org_id", "created_at" DESC);



CREATE UNIQUE INDEX "collections_brand_slug_uniq" ON "public"."collections" USING "btree" ("org_id", "slug") WHERE ("kind" = 'brand'::"text");



CREATE UNIQUE INDEX "conversation_reviews_bot_session_idx" ON "public"."conversation_reviews" USING "btree" ("bot_id", "session_id");



CREATE INDEX "conversation_reviews_org_idx" ON "public"."conversation_reviews" USING "btree" ("org_id", "status");



CREATE INDEX "conversation_turns_conv_created_idx" ON "public"."conversation_turns" USING "btree" ("conversation_id", "created_at");



CREATE UNIQUE INDEX "conversation_turns_conv_turn_idx" ON "public"."conversation_turns" USING "btree" ("conversation_id", "turn_number");



CREATE INDEX "conversation_turns_org_created_idx" ON "public"."conversation_turns" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "conversations_bot_created_idx" ON "public"."conversations" USING "btree" ("bot_id", "created_at" DESC);



CREATE UNIQUE INDEX "conversations_bot_session_idx" ON "public"."conversations" USING "btree" ("bot_id", "session_id");



CREATE INDEX "conversations_org_created_idx" ON "public"."conversations" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "datasets_brand_collection_idx" ON "public"."datasets" USING "btree" ("brand_collection_id") WHERE ("brand_collection_id" IS NOT NULL);



CREATE INDEX "entity_catalog_refresh_scope_idx" ON "public"."entity_catalog_refresh" USING "btree" ("scope_type", "scope_id", "triggered_at" DESC);



CREATE INDEX "entity_catalog_scope_category_idx" ON "public"."entity_catalog" USING "btree" ("scope_type", "scope_id", "category");



CREATE INDEX "entity_catalog_scope_count_idx" ON "public"."entity_catalog" USING "btree" ("scope_type", "scope_id", "sample_count" DESC);



CREATE INDEX "entity_catalog_scope_visible_idx" ON "public"."entity_catalog" USING "btree" ("scope_type", "scope_id") WHERE ("hidden" = false);



CREATE INDEX "idx_adr_dataset" ON "public"."archived_dataset_rows" USING "btree" ("dataset_id");



CREATE INDEX "idx_adrf_dataset" ON "public"."archived_dataset_rows_flat" USING "btree" ("dataset_id");



CREATE INDEX "idx_agent_crawl_jobs_agent" ON "public"."agent_crawl_jobs" USING "btree" ("agent_id", "status", "created_at" DESC);



CREATE INDEX "idx_akph_agent" ON "public"."agent_kb_page_hashes" USING "btree" ("agent_id");



CREATE INDEX "idx_apr_analytics" ON "public"."agent_probe_responses" USING "btree" ("org_id", "agent_id", "probe_id", "probe_version", "outcome");



CREATE INDEX "idx_bot_reviews_bot" ON "public"."agent_conversation_reviews" USING "btree" ("bot_id", "reviewed_at" DESC);



CREATE INDEX "idx_bot_session_persona_bot" ON "public"."agent_session_personas" USING "btree" ("bot_id");



CREATE UNIQUE INDEX "idx_bot_session_persona_unique" ON "public"."agent_session_personas" USING "btree" ("bot_id", "session_id");



CREATE INDEX "idx_bot_turns_bot" ON "public"."bot_conversation_turns" USING "btree" ("bot_id", "created_at" DESC);



CREATE INDEX "idx_bot_turns_session" ON "public"."bot_conversation_turns" USING "btree" ("bot_id", "session_id", "turn_number");



CREATE INDEX "idx_bot_turns_session_id" ON "public"."bot_conversation_turns" USING "btree" ("session_id");



CREATE INDEX "idx_bots_org" ON "public"."agents" USING "btree" ("org_id");



CREATE INDEX "idx_bots_slug" ON "public"."agents" USING "btree" ("slug");



CREATE INDEX "idx_campaigns_org" ON "public"."campaigns" USING "btree" ("org_id");



CREATE INDEX "idx_campaigns_status" ON "public"."campaigns" USING "btree" ("org_id", "status");



CREATE INDEX "idx_campaigns_study" ON "public"."campaigns" USING "btree" ("study_id");



CREATE INDEX "idx_collection_members_collection" ON "public"."collection_members" USING "btree" ("collection_id");



CREATE INDEX "idx_collection_members_dataset" ON "public"."collection_members" USING "btree" ("dataset_id");



CREATE INDEX "idx_collections_dataset" ON "public"."collections" USING "btree" ("dataset_id");



CREATE INDEX "idx_collections_org" ON "public"."collections" USING "btree" ("org_id");



CREATE INDEX "idx_conversation_turns_town_hall" ON "public"."conversation_turns" USING "btree" ("town_hall_id", "created_at") WHERE ("town_hall_id" IS NOT NULL);



CREATE INDEX "idx_dataset_rows_batch" ON "public"."dataset_rows" USING "btree" ("dataset_id", "batch_index");



CREATE INDEX "idx_dataset_rows_dataset_batch" ON "public"."dataset_rows" USING "btree" ("dataset_id", "batch_index");



CREATE INDEX "idx_dataset_rows_dataset_id" ON "public"."dataset_rows" USING "btree" ("dataset_id");



CREATE INDEX "idx_dataset_rows_ds" ON "public"."dataset_rows" USING "btree" ("dataset_id");



CREATE UNIQUE INDEX "idx_dataset_rows_flat_dedup" ON "public"."dataset_rows_flat" USING "btree" ("dataset_id", "dedup_key");



CREATE INDEX "idx_dataset_state_dataset_id" ON "public"."dataset_state" USING "btree" ("dataset_id");



CREATE INDEX "idx_dataset_state_ds" ON "public"."dataset_state" USING "btree" ("dataset_id");



CREATE INDEX "idx_datasets_created" ON "public"."datasets" USING "btree" ("created_by");



CREATE INDEX "idx_datasets_created_by" ON "public"."datasets" USING "btree" ("created_by");



CREATE INDEX "idx_datasets_org" ON "public"."datasets" USING "btree" ("org_id");



CREATE INDEX "idx_datasets_org_id" ON "public"."datasets" USING "btree" ("org_id");



CREATE INDEX "idx_datasets_status" ON "public"."datasets" USING "btree" ("status");



CREATE INDEX "idx_datasets_study" ON "public"."datasets" USING "btree" ("study_id");



CREATE INDEX "idx_datasets_study_id" ON "public"."datasets" USING "btree" ("study_id");



CREATE INDEX "idx_deck_download_log_recent" ON "public"."deck_download_log" USING "btree" ("deck_name", "downloaded_at" DESC);



CREATE INDEX "idx_drf_data_gin" ON "public"."dataset_rows_flat" USING "gin" ("data");



CREATE INDEX "idx_drf_dataset" ON "public"."dataset_rows_flat" USING "btree" ("dataset_id");



CREATE INDEX "idx_drf_dataset_idx" ON "public"."dataset_rows_flat" USING "btree" ("dataset_id", "row_index");



CREATE INDEX "idx_drf_id_keyset" ON "public"."dataset_rows_flat" USING "btree" ("dataset_id", "id");



COMMENT ON INDEX "public"."idx_drf_id_keyset" IS 'Backs the classify id-keyset (WHERE dataset_id = X AND id > cursor ORDER BY id) — without it the planner walks the PK filtering dataset_id per row, which times out past ~1M total rows. sql/165.';



CREATE INDEX "idx_drf_sample" ON "public"."dataset_rows_flat" USING "btree" ("dataset_id", (((('x'::"text" || "substr"("md5"((("id")::"text" || ("dataset_id")::"text")), 1, 8)))::bit(32))::bigint), "id");



CREATE INDEX "idx_drf_tsv" ON "public"."dataset_rows_flat" USING "gin" ("tsv");



CREATE UNIQUE INDEX "idx_email_sequence_campaign" ON "public"."campaign_emails" USING "btree" ("campaign_id", "sequence");



CREATE INDEX "idx_entity_catalog_bot_scope" ON "public"."entity_catalog" USING "btree" ("scope_id") WHERE ("scope_type" = 'bot'::"text");



CREATE INDEX "idx_knowledge_bot" ON "public"."agent_knowledge_chunks" USING "btree" ("bot_id");



CREATE INDEX "idx_knowledge_embedding" ON "public"."agent_knowledge_chunks" USING "hnsw" ("embedding" "public"."vector_cosine_ops");



CREATE INDEX "idx_knowledge_trgm" ON "public"."agent_knowledge_chunks" USING "gin" ("content" "public"."gin_trgm_ops");



CREATE INDEX "idx_knowledge_tsv" ON "public"."agent_knowledge_chunks" USING "gin" ("tsv");



CREATE INDEX "idx_mco_handoff_sessions_expires" ON "public"."mco_handoff_sessions" USING "btree" ("expires_at");



CREATE INDEX "idx_org_transfers_actor" ON "public"."org_transfers" USING "btree" ("initiated_by", "created_at" DESC);



CREATE INDEX "idx_org_transfers_from_org" ON "public"."org_transfers" USING "btree" ("from_org_id", "created_at" DESC);



CREATE INDEX "idx_org_transfers_resource" ON "public"."org_transfers" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "idx_org_transfers_to_org" ON "public"."org_transfers" USING "btree" ("to_org_id", "created_at" DESC);



CREATE INDEX "idx_organizations_status" ON "public"."organizations" USING "btree" ("status");



CREATE INDEX "idx_rate_limit_reset" ON "public"."rate_limit_buckets" USING "btree" ("reset_at");



CREATE INDEX "idx_rds_dataset" ON "public"."reddit_sources" USING "btree" ("dataset_id");



CREATE INDEX "idx_rds_org" ON "public"."reddit_sources" USING "btree" ("org_id");



CREATE UNIQUE INDEX "idx_respondent_email_campaign" ON "public"."campaign_respondents" USING "btree" ("campaign_id", "email");



CREATE INDEX "idx_respondents_campaign" ON "public"."campaign_respondents" USING "btree" ("campaign_id");



CREATE INDEX "idx_respondents_guid" ON "public"."campaign_respondents" USING "btree" ("recipient_guid");



CREATE INDEX "idx_respondents_status" ON "public"."campaign_respondents" USING "btree" ("campaign_id", "status");



CREATE INDEX "idx_responses_client" ON "public"."responses" USING "btree" ("client_id");



CREATE INDEX "idx_responses_completed" ON "public"."responses" USING "btree" ("study_id", "completed_at");



CREATE INDEX "idx_responses_fp_hash" ON "public"."responses" USING "btree" ("study_id", "fp_hash");



CREATE INDEX "idx_responses_ip_status" ON "public"."responses" USING "btree" ("study_id", "ip_hash", "status");



CREATE INDEX "idx_responses_nps" ON "public"."responses" USING "btree" ("study_id", "nps_score");



CREATE INDEX "idx_responses_org" ON "public"."responses" USING "btree" ("org_id");



CREATE INDEX "idx_responses_sentiment" ON "public"."responses" USING "btree" ("study_id", "sentiment");



CREATE INDEX "idx_responses_session_id" ON "public"."responses" USING "btree" ("session_id");



CREATE INDEX "idx_responses_status" ON "public"."responses" USING "btree" ("study_id", "status");



CREATE INDEX "idx_responses_study" ON "public"."responses" USING "btree" ("study_id");



CREATE INDEX "idx_responses_study_date" ON "public"."responses" USING "btree" ("study_id", "completed_at" DESC);



CREATE INDEX "idx_responses_study_sentiment" ON "public"."responses" USING "btree" ("study_id", "sentiment");



CREATE INDEX "idx_responses_study_status" ON "public"."responses" USING "btree" ("study_id", "status");



CREATE INDEX "idx_rs_dataset" ON "public"."review_sources" USING "btree" ("dataset_id");



CREATE INDEX "idx_rs_next_sync" ON "public"."review_sources" USING "btree" ("next_sync_at") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_rs_org" ON "public"."review_sources" USING "btree" ("org_id");



CREATE INDEX "idx_rsl_place" ON "public"."review_source_locations" USING "btree" ("place_id");



CREATE INDEX "idx_rsl_source" ON "public"."review_source_locations" USING "btree" ("review_source_id");



CREATE UNIQUE INDEX "idx_rsl_source_place" ON "public"."review_source_locations" USING "btree" ("review_source_id", "place_id");



CREATE INDEX "idx_rst_source" ON "public"."reddit_source_threads" USING "btree" ("reddit_source_id");



CREATE UNIQUE INDEX "idx_rst_source_thread" ON "public"."reddit_source_threads" USING "btree" ("reddit_source_id", "thread_id");



CREATE INDEX "idx_saved_views_dataset" ON "public"."saved_views" USING "btree" ("dataset_id", "kind");



CREATE INDEX "idx_saved_views_org" ON "public"."saved_views" USING "btree" ("org_id");



CREATE INDEX "idx_schedules_pending" ON "public"."campaign_schedules" USING "btree" ("status", "scheduled_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_send_log_campaign" ON "public"."campaign_send_log" USING "btree" ("campaign_id");



CREATE INDEX "idx_send_log_respondent" ON "public"."campaign_send_log" USING "btree" ("respondent_id");



CREATE INDEX "idx_shared_links_org" ON "public"."shared_links" USING "btree" ("org_id");



CREATE INDEX "idx_shared_links_target" ON "public"."shared_links" USING "btree" ("target_id");



CREATE INDEX "idx_shared_links_token" ON "public"."shared_links" USING "btree" ("token");



CREATE INDEX "idx_social_alert_rules_org" ON "public"."social_alert_rules" USING "btree" ("org_id");



CREATE INDEX "idx_social_alerts_sent_org" ON "public"."social_alerts_sent" USING "btree" ("org_id", "sent_at" DESC);



CREATE INDEX "idx_social_comments_connection" ON "public"."social_comments" USING "btree" ("connection_id", "platform_created_at" DESC);



CREATE INDEX "idx_social_comments_org" ON "public"."social_comments" USING "btree" ("org_id", "ingested_at" DESC);



CREATE INDEX "idx_social_comments_platform_id" ON "public"."social_comments" USING "btree" ("comment_id");



CREATE INDEX "idx_social_connections_org" ON "public"."social_connections" USING "btree" ("org_id");



CREATE INDEX "idx_social_dm_log_org" ON "public"."social_dm_log" USING "btree" ("org_id", "sent_at" DESC);



CREATE INDEX "idx_social_mod_log_org" ON "public"."social_moderation_log" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "idx_studies_client" ON "public"."studies" USING "btree" ("client_id");



CREATE INDEX "idx_studies_guid" ON "public"."studies" USING "btree" ("guid");



CREATE INDEX "idx_studies_org" ON "public"."studies" USING "btree" ("org_id");



CREATE UNIQUE INDEX "idx_studies_slug" ON "public"."studies" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "idx_studies_visibility" ON "public"."studies" USING "btree" ("org_id", "visibility");



CREATE INDEX "idx_th_responses_session" ON "public"."townhall_participant_responses" USING "btree" ("session_id");



CREATE INDEX "idx_ul_source" ON "public"."user_locations" USING "btree" ("review_source_id");



CREATE INDEX "idx_ul_user" ON "public"."user_locations" USING "btree" ("user_id");



CREATE INDEX "idx_usage_logs_created" ON "public"."usage_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_usage_logs_org" ON "public"."usage_logs" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "idx_usage_logs_resource" ON "public"."usage_logs" USING "btree" ("resource_type", "resource_id", "created_at" DESC);



CREATE INDEX "idx_user_logins_org_recent" ON "public"."user_logins" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "idx_user_logins_user_recent" ON "public"."user_logins" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_users_disabled" ON "public"."users" USING "btree" ("disabled") WHERE ("disabled" = true);



CREATE INDEX "idx_users_org" ON "public"."users" USING "btree" ("org_id");



CREATE INDEX "logged_questions_batch_idx" ON "public"."logged_questions" USING "btree" ("batch_id") WHERE ("batch_id" IS NOT NULL);



CREATE INDEX "logged_questions_bot_created_idx" ON "public"."logged_questions" USING "btree" ("bot_id", "created_at" DESC);



CREATE INDEX "logged_questions_bot_source_idx" ON "public"."logged_questions" USING "btree" ("bot_id", "source", "created_at" DESC);



CREATE INDEX "logged_questions_org_status_idx" ON "public"."logged_questions" USING "btree" ("org_id", "status", "created_at" DESC);



CREATE INDEX "logged_questions_session_idx" ON "public"."logged_questions" USING "btree" ("session_id");



CREATE INDEX "org_features_feature_enabled_idx" ON "public"."org_features" USING "btree" ("feature") WHERE "enabled";



CREATE INDEX "pulseiq_session_conversations_conv_idx" ON "public"."pulseiq_session_conversations" USING "btree" ("conversation_id");



CREATE UNIQUE INDEX "pulseiq_session_conversations_pair_idx" ON "public"."pulseiq_session_conversations" USING "btree" ("town_hall_id", "conversation_id");



CREATE INDEX "pulseiq_sessions_bot_idx" ON "public"."pulseiq_sessions" USING "btree" ("bot_id");



CREATE INDEX "pulseiq_sessions_org_created_idx" ON "public"."pulseiq_sessions" USING "btree" ("org_id", "created_at" DESC);



CREATE UNIQUE INDEX "pulseiq_sessions_slug_idx" ON "public"."pulseiq_sessions" USING "btree" ("slug");



CREATE INDEX "pulseiq_topics_hall_state_idx" ON "public"."pulseiq_topics" USING "btree" ("town_hall_id", "state");



CREATE INDEX "pulseiq_topics_org_idx" ON "public"."pulseiq_topics" USING "btree" ("org_id");



CREATE INDEX "pulseiq_topics_round_idx" ON "public"."pulseiq_topics" USING "btree" ("town_hall_id", "round_number");



CREATE INDEX "question_batches_bot_idx" ON "public"."question_batches" USING "btree" ("bot_id", "created_at" DESC);



CREATE INDEX "question_batches_share_token_idx" ON "public"."question_batches" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "recording_config_versions_org_idx" ON "public"."recording_config_versions" USING "btree" ("org_id");



CREATE INDEX "recording_config_versions_recording_idx" ON "public"."recording_config_versions" USING "btree" ("recording_id", "version_number" DESC);



CREATE INDEX "recording_extractions_flagged_idx" ON "public"."recording_extractions" USING "btree" ("recording_id") WHERE "flagged_for_review";



CREATE INDEX "recording_extractions_org_idx" ON "public"."recording_extractions" USING "btree" ("org_id");



CREATE INDEX "recording_extractions_recording_idx" ON "public"."recording_extractions" USING "btree" ("recording_id", "sort_order");



CREATE INDEX "recording_extractions_topic_idx" ON "public"."recording_extractions" USING "btree" ("recording_id", "topic");



CREATE INDEX "recording_files_org_idx" ON "public"."recording_files" USING "btree" ("org_id");



CREATE INDEX "recording_files_recording_idx" ON "public"."recording_files" USING "btree" ("recording_id", "sort_order");



CREATE INDEX "recording_transcripts_org_idx" ON "public"."recording_transcripts" USING "btree" ("org_id");



CREATE INDEX "recordings_dataset_idx" ON "public"."recordings" USING "btree" ("dataset_id") WHERE ("dataset_id" IS NOT NULL);



CREATE INDEX "recordings_org_idx" ON "public"."recordings" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "recordings_share_token_idx" ON "public"."recordings" USING "btree" ("share_token") WHERE ("share_token" IS NOT NULL);



CREATE INDEX "recordings_status_active_idx" ON "public"."recordings" USING "btree" ("status") WHERE ("status" <> ALL (ARRAY['draft'::"text", 'awaiting_media'::"text", 'transcribed'::"text", 'complete'::"text", 'failed'::"text", 'cancelled'::"text"]));



CREATE INDEX "reo_gold_review_org_status_idx" ON "public"."reo_gold_review" USING "btree" ("org_id", "status");



CREATE INDEX "review_downloads_org_created_idx" ON "public"."review_downloads" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "sentry_snapshots_captured_idx" ON "public"."sentry_snapshots" USING "btree" ("captured_at" DESC);



CREATE UNIQUE INDEX "townhall_participant_responses_legacy_unique" ON "public"."townhall_participant_responses" USING "btree" ("session_id", "participant_id") WHERE ("session_id" IS NOT NULL);



CREATE UNIQUE INDEX "townhall_participant_responses_phase3_unique" ON "public"."townhall_participant_responses" USING "btree" ("town_hall_id", "participant_id") WHERE ("town_hall_id" IS NOT NULL);



CREATE INDEX "townhall_participant_responses_town_hall_idx" ON "public"."townhall_participant_responses" USING "btree" ("town_hall_id") WHERE ("town_hall_id" IS NOT NULL);



CREATE INDEX "user_events_name_idx" ON "public"."user_events" USING "btree" ("event_name", "created_at" DESC);



CREATE INDEX "user_events_org_idx" ON "public"."user_events" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "user_events_user_idx" ON "public"."user_events" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "user_favorites_user_type_created_idx" ON "public"."user_favorites" USING "btree" ("user_id", "resource_type", "created_at" DESC);



CREATE OR REPLACE TRIGGER "campaign_emails_updated_at" BEFORE UPDATE ON "public"."campaign_emails" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "dataset_state_updated_at" BEFORE UPDATE ON "public"."dataset_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "datasets_updated_at" BEFORE UPDATE ON "public"."datasets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "saved_views_updated_at" BEFORE UPDATE ON "public"."saved_views" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "studies_updated_at" BEFORE UPDATE ON "public"."studies" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "study_response_stats_maintain" AFTER INSERT OR DELETE OR UPDATE ON "public"."responses" FOR EACH ROW EXECUTE FUNCTION "public"."trg_study_response_stats"();



CREATE OR REPLACE TRIGGER "trg_drf_tsv" BEFORE INSERT OR UPDATE OF "data" ON "public"."dataset_rows_flat" FOR EACH ROW EXECUTE FUNCTION "public"."drf_tsv_trigger"();



CREATE OR REPLACE TRIGGER "trg_knowledge_tsv" BEFORE INSERT OR UPDATE OF "title", "content" ON "public"."agent_knowledge_chunks" FOR EACH ROW EXECUTE FUNCTION "public"."knowledge_tsv_trigger"();



CREATE OR REPLACE TRIGGER "trg_set_brand_collection_id" BEFORE INSERT OR UPDATE OF "brand_tag" ON "public"."datasets" FOR EACH ROW EXECUTE FUNCTION "public"."set_brand_collection_id"();



CREATE OR REPLACE TRIGGER "trg_sync_brand_collection_members" AFTER INSERT OR UPDATE OF "brand_tag" ON "public"."datasets" FOR EACH ROW EXECUTE FUNCTION "public"."sync_brand_collection_members"();



ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admin_action_log"
    ADD CONSTRAINT "admin_action_log_target_org_id_fkey" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_crawl_jobs"
    ADD CONSTRAINT "agent_crawl_jobs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_impressions"
    ADD CONSTRAINT "agent_impressions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_kb_page_hashes"
    ADD CONSTRAINT "agent_kb_page_hashes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_probe_quota"
    ADD CONSTRAINT "agent_probe_quota_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_probe_responses"
    ADD CONSTRAINT "agent_probe_responses_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_readout_cache"
    ADD CONSTRAINT "agent_readout_cache_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_study_cache"
    ADD CONSTRAINT "agent_study_cache_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_consent_audit"
    ADD CONSTRAINT "ai_consent_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_consent_audit"
    ADD CONSTRAINT "ai_consent_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_change_log"
    ADD CONSTRAINT "bot_change_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_change_log"
    ADD CONSTRAINT "bot_change_log_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_conversation_reviews"
    ADD CONSTRAINT "bot_conversation_reviews_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bot_conversation_turns"
    ADD CONSTRAINT "bot_conversation_turns_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_knowledge_chunks"
    ADD CONSTRAINT "bot_knowledge_chunks_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_session_personas"
    ADD CONSTRAINT "bot_session_personas_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "bots_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "bots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_emails"
    ADD CONSTRAINT "campaign_emails_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_respondents"
    ADD CONSTRAINT "campaign_respondents_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_respondents"
    ADD CONSTRAINT "campaign_respondents_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaign_schedules"
    ADD CONSTRAINT "campaign_schedules_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_schedules"
    ADD CONSTRAINT "campaign_schedules_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."campaign_emails"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_send_log"
    ADD CONSTRAINT "campaign_send_log_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_send_log"
    ADD CONSTRAINT "campaign_send_log_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "public"."campaign_emails"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_send_log"
    ADD CONSTRAINT "campaign_send_log_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "public"."campaign_respondents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaign_send_log"
    ADD CONSTRAINT "campaign_send_log_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."campaign_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collection_members"
    ADD CONSTRAINT "collection_members_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collection_members"
    ADD CONSTRAINT "collection_members_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."collections"
    ADD CONSTRAINT "collections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."conversation_reviews"
    ADD CONSTRAINT "conversation_reviews_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_reviews"
    ADD CONSTRAINT "conversation_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversation_turns"
    ADD CONSTRAINT "conversation_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dataset_rows"
    ADD CONSTRAINT "dataset_rows_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dataset_rows_flat"
    ADD CONSTRAINT "dataset_rows_flat_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dataset_state"
    ADD CONSTRAINT "dataset_state_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dataset_state"
    ADD CONSTRAINT "dataset_state_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_brand_collection_id_fkey" FOREIGN KEY ("brand_collection_id") REFERENCES "public"."collections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."datasets"
    ADD CONSTRAINT "datasets_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deck_download_log"
    ADD CONSTRAINT "deck_download_log_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deck_download_log"
    ADD CONSTRAINT "deck_download_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."entity_catalog_refresh"
    ADD CONSTRAINT "entity_catalog_refresh_triggered_by_user_fkey" FOREIGN KEY ("triggered_by_user") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invites"
    ADD CONSTRAINT "invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."question_batches"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."logged_questions"
    ADD CONSTRAINT "logged_questions_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "public"."conversation_turns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_features"
    ADD CONSTRAINT "org_features_enabled_by_fkey" FOREIGN KEY ("enabled_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."org_features"
    ADD CONSTRAINT "org_features_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_transfers"
    ADD CONSTRAINT "org_transfers_from_org_id_fkey" FOREIGN KEY ("from_org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_transfers"
    ADD CONSTRAINT "org_transfers_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."org_transfers"
    ADD CONSTRAINT "org_transfers_to_org_id_fkey" FOREIGN KEY ("to_org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_ai_api_key_set_by_fkey" FOREIGN KEY ("ai_api_key_set_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."question_batches"
    ADD CONSTRAINT "question_batches_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recording_config_versions"
    ADD CONSTRAINT "recording_config_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recording_config_versions"
    ADD CONSTRAINT "recording_config_versions_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recording_extractions"
    ADD CONSTRAINT "recording_extractions_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recording_files"
    ADD CONSTRAINT "recording_files_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recording_transcripts"
    ADD CONSTRAINT "recording_transcripts_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recordings"
    ADD CONSTRAINT "recordings_underlying_agent_id_fkey" FOREIGN KEY ("underlying_agent_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reddit_source_threads"
    ADD CONSTRAINT "reddit_source_threads_reddit_source_id_fkey" FOREIGN KEY ("reddit_source_id") REFERENCES "public"."reddit_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reddit_sources"
    ADD CONSTRAINT "reddit_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reddit_sources"
    ADD CONSTRAINT "reddit_sources_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reddit_sources"
    ADD CONSTRAINT "reddit_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."responses"
    ADD CONSTRAINT "responses_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_downloads"
    ADD CONSTRAINT "review_downloads_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."review_downloads"
    ADD CONSTRAINT "review_downloads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_downloads"
    ADD CONSTRAINT "review_downloads_review_source_id_fkey" FOREIGN KEY ("review_source_id") REFERENCES "public"."review_sources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."review_source_locations"
    ADD CONSTRAINT "review_source_locations_review_source_id_fkey" FOREIGN KEY ("review_source_id") REFERENCES "public"."review_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."review_sources"
    ADD CONSTRAINT "review_sources_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."review_sources"
    ADD CONSTRAINT "review_sources_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."review_sources"
    ADD CONSTRAINT "review_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_views"
    ADD CONSTRAINT "saved_views_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_links"
    ADD CONSTRAINT "shared_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."shared_links"
    ADD CONSTRAINT "shared_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_alert_rules"
    ADD CONSTRAINT "social_alert_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_alerts_sent"
    ADD CONSTRAINT "social_alerts_sent_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "public"."social_alert_rules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."social_comments"
    ADD CONSTRAINT "social_comments_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."social_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_comments"
    ADD CONSTRAINT "social_comments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_connected_by_fkey" FOREIGN KEY ("connected_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."social_connections"
    ADD CONSTRAINT "social_connections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_dm_log"
    ADD CONSTRAINT "social_dm_log_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."social_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."social_dm_log"
    ADD CONSTRAINT "social_dm_log_trigger_comment_id_fkey" FOREIGN KEY ("trigger_comment_id") REFERENCES "public"."social_comments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."social_moderation_log"
    ADD CONSTRAINT "social_moderation_log_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."social_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."social_moderation_log"
    ADD CONSTRAINT "social_moderation_log_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."studies"
    ADD CONSTRAINT "studies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."studies"
    ADD CONSTRAINT "studies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."studies"
    ADD CONSTRAINT "studies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."study_response_stats_live"
    ADD CONSTRAINT "study_response_stats_live_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "public"."studies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulseiq_session_conversations"
    ADD CONSTRAINT "town_hall_conversations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulseiq_session_conversations"
    ADD CONSTRAINT "town_hall_conversations_town_hall_id_fkey" FOREIGN KEY ("town_hall_id") REFERENCES "public"."pulseiq_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulseiq_topics"
    ADD CONSTRAINT "town_hall_topics_town_hall_id_fkey" FOREIGN KEY ("town_hall_id") REFERENCES "public"."pulseiq_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pulseiq_sessions"
    ADD CONSTRAINT "town_halls_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "public"."agents"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."pulseiq_sessions"
    ADD CONSTRAINT "town_halls_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."townhall_participant_responses"
    ADD CONSTRAINT "townhall_participant_responses_town_hall_id_fkey" FOREIGN KEY ("town_hall_id") REFERENCES "public"."pulseiq_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."usage_logs"
    ADD CONSTRAINT "usage_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_events"
    ADD CONSTRAINT "user_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_features"
    ADD CONSTRAINT "user_features_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."review_source_locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_review_source_id_fkey" FOREIGN KEY ("review_source_id") REFERENCES "public"."review_sources"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_logins"
    ADD CONSTRAINT "user_logins_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_logins"
    ADD CONSTRAINT "user_logins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



CREATE POLICY "acj_org_read" ON "public"."agent_crawl_jobs" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "admin org reads service_health" ON "public"."service_health" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true)))));



ALTER TABLE "public"."admin_action_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_action_log_admin_read" ON "public"."admin_action_log" FOR SELECT TO "authenticated" USING ("public"."is_platform_admin"());



ALTER TABLE "public"."agent_change_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_conversation_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_crawl_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_impressions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_impressions_org_read" ON "public"."agent_impressions" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."agent_kb_page_hashes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_knowledge_chunks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_probe_quota" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_probe_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_readout_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_readout_cache_org_read" ON "public"."agent_readout_cache" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."agent_session_personas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_study_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agent_study_cache_org_read" ON "public"."agent_study_cache" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."agents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_consent_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_consent_audit_self_read" ON "public"."ai_consent_audit" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "akph_org_read" ON "public"."agent_kb_page_hashes" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "apq_org_read" ON "public"."agent_probe_quota" FOR SELECT USING (("agent_id" IN ( SELECT "agents"."id"
   FROM "public"."agents"
  WHERE ("agents"."org_id" = ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "apr_org_read" ON "public"."agent_probe_responses" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."archived_dataset_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."archived_dataset_rows_flat" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_change_log_org_read" ON "public"."agent_change_log" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



ALTER TABLE "public"."bot_conversation_turns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bot_reviews_org_read" ON "public"."agent_conversation_reviews" FOR SELECT USING (("bot_id" IN ( SELECT "agents"."id"
   FROM "public"."agents"
  WHERE ("agents"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "bot_turns_org_read" ON "public"."bot_conversation_turns" FOR SELECT USING (("bot_id" IN ( SELECT "agents"."id"
   FROM "public"."agents"
  WHERE ("agents"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "bots_org_read" ON "public"."agents" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "bots_org_write" ON "public"."agents" USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."campaign_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_respondents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaign_send_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_delete" ON "public"."campaigns" FOR DELETE USING (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"())));



CREATE POLICY "campaigns_insert" ON "public"."campaigns" FOR INSERT WITH CHECK (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"())));



CREATE POLICY "campaigns_select" ON "public"."campaigns" FOR SELECT USING (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"())));



CREATE POLICY "campaigns_update" ON "public"."campaigns" FOR UPDATE USING (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"())));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT USING (("public"."is_platform_admin"() OR ("id" = "public"."current_client_id"())));



ALTER TABLE "public"."collection_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "collection_members_org" ON "public"."collection_members" USING (("collection_id" IN ( SELECT "collections"."id"
   FROM "public"."collections"
  WHERE ("collections"."org_id" = ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



ALTER TABLE "public"."collections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "collections_org" ON "public"."collections" USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."conversation_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_reviews_org_read" ON "public"."conversation_reviews" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."conversation_turns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversation_turns_org_read" ON "public"."conversation_turns" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_org_read" ON "public"."conversations" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



CREATE POLICY "creator can delete datasets" ON "public"."datasets" FOR DELETE USING ((("created_by" = "auth"."uid"()) OR "public"."is_platform_admin"()));



CREATE POLICY "creator can insert dataset_rows" ON "public"."dataset_rows" FOR INSERT WITH CHECK (("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."created_by" = "auth"."uid"()))));



CREATE POLICY "creator can insert datasets" ON "public"."datasets" FOR INSERT WITH CHECK ((("created_by" = "auth"."uid"()) AND ("org_id" = "public"."current_org_id"())));



CREATE POLICY "creator can update datasets" ON "public"."datasets" FOR UPDATE USING ((("created_by" = "auth"."uid"()) OR "public"."is_platform_admin"()));



CREATE POLICY "creator can upsert dataset_state" ON "public"."dataset_state" USING ((("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."created_by" = "auth"."uid"()))) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."dataset_rows" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dataset_rows_flat" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dataset_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."datasets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deck_download_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "emails_delete" ON "public"."campaign_emails" FOR DELETE USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "emails_insert" ON "public"."campaign_emails" FOR INSERT WITH CHECK (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "emails_select" ON "public"."campaign_emails" FOR SELECT USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "emails_update" ON "public"."campaign_emails" FOR UPDATE USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



ALTER TABLE "public"."entity_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entity_catalog_refresh" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invites_admin_all" ON "public"."invites" USING ("public"."is_platform_admin"());



CREATE POLICY "invites_insert_admin" ON "public"."invites" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "invites_public_read" ON "public"."invites" FOR SELECT USING (true);



ALTER TABLE "public"."logged_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "logged_questions_org_read" ON "public"."logged_questions" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."mco_handoff_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org members can insert dataset_rows" ON "public"."dataset_rows" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."datasets" "d"
     JOIN "public"."users" "u" ON (("u"."org_id" = "d"."org_id")))
  WHERE (("d"."id" = "dataset_rows"."dataset_id") AND ("u"."id" = "auth"."uid"())))));



CREATE POLICY "org members can insert dataset_state" ON "public"."dataset_state" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."datasets" "d"
     JOIN "public"."users" "u" ON (("u"."org_id" = "d"."org_id")))
  WHERE (("d"."id" = "dataset_state"."dataset_id") AND ("u"."id" = "auth"."uid"())))));



CREATE POLICY "org members can read datasets" ON "public"."datasets" FOR SELECT USING ((("org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()));



CREATE POLICY "org members can update dataset_state" ON "public"."dataset_state" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM ("public"."datasets" "d"
     JOIN "public"."users" "u" ON (("u"."org_id" = "d"."org_id")))
  WHERE (("d"."id" = "dataset_state"."dataset_id") AND ("u"."id" = "auth"."uid"())))));



CREATE POLICY "org members read bots" ON "public"."agents" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "org members read campaigns" ON "public"."campaigns" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "org members read collection_members" ON "public"."collection_members" FOR SELECT USING (("collection_id" IN ( SELECT "c"."id"
   FROM ("public"."collections" "c"
     JOIN "public"."datasets" "d" ON (("d"."id" = "c"."dataset_id")))
  WHERE ("d"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "org members read collections" ON "public"."collections" FOR SELECT USING (("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "org members read dataset_rows_flat" ON "public"."dataset_rows_flat" FOR SELECT USING (("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "org members read dataset_state" ON "public"."dataset_state" FOR SELECT USING (("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "org members read datasets" ON "public"."datasets" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "org members read responses" ON "public"."responses" FOR SELECT USING (("study_id" IN ( SELECT "studies"."id"
   FROM "public"."studies"
  WHERE ("studies"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



CREATE POLICY "org members read review_downloads" ON "public"."review_downloads" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "org members read studies" ON "public"."studies" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."org_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_features_org_read" ON "public"."org_features" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."org_transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_transfers_admin_read" ON "public"."org_transfers" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND "o"."is_admin_org"))));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs_insert_admin" ON "public"."organizations" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "orgs_select" ON "public"."organizations" FOR SELECT USING (("public"."is_platform_admin"() OR ("id" = "public"."current_org_id"())));



CREATE POLICY "orgs_update_admin" ON "public"."organizations" FOR UPDATE USING ("public"."is_platform_admin"());



CREATE POLICY "persona_org_read" ON "public"."agent_session_personas" FOR SELECT USING (("bot_id" IN ( SELECT "agents"."id"
   FROM "public"."agents"
  WHERE ("agents"."org_id" IN ( SELECT "users"."org_id"
           FROM "public"."users"
          WHERE ("users"."id" = "auth"."uid"()))))));



ALTER TABLE "public"."pulseiq_session_conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pulseiq_session_conversations_org_read" ON "public"."pulseiq_session_conversations" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



ALTER TABLE "public"."pulseiq_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pulseiq_sessions_org_read" ON "public"."pulseiq_sessions" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



ALTER TABLE "public"."pulseiq_topics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "pulseiq_topics_org_read" ON "public"."pulseiq_topics" FOR SELECT TO "authenticated" USING ((("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
   FROM ("public"."users" "u"
     JOIN "public"."organizations" "o" ON (("o"."id" = "u"."org_id")))
  WHERE (("u"."id" = "auth"."uid"()) AND ("o"."is_admin_org" = true))))));



ALTER TABLE "public"."question_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "question_batches_org_read" ON "public"."question_batches" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."rate_limit_buckets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read dataset_rows via dataset org" ON "public"."dataset_rows" FOR SELECT USING ((("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."org_id" = "public"."current_org_id"()))) OR "public"."is_platform_admin"()));



CREATE POLICY "read dataset_state via dataset org" ON "public"."dataset_state" FOR SELECT USING ((("dataset_id" IN ( SELECT "datasets"."id"
   FROM "public"."datasets"
  WHERE ("datasets"."org_id" = "public"."current_org_id"()))) OR "public"."is_platform_admin"()));



ALTER TABLE "public"."recording_config_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recording_config_versions_org_read" ON "public"."recording_config_versions" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."recording_extractions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recording_extractions_org_read" ON "public"."recording_extractions" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."recording_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recording_files_org_read" ON "public"."recording_files" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."recording_transcripts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recording_transcripts_org_read" ON "public"."recording_transcripts" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."recordings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recordings_org_read" ON "public"."recordings" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



ALTER TABLE "public"."reddit_source_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reddit_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reo_gold_review" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "reo_gold_review_org_read" ON "public"."reo_gold_review" FOR SELECT USING (("org_id" = ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "respondents_delete" ON "public"."campaign_respondents" FOR DELETE USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "respondents_insert" ON "public"."campaign_respondents" FOR INSERT WITH CHECK (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "respondents_select" ON "public"."campaign_respondents" FOR SELECT USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "respondents_update" ON "public"."campaign_respondents" FOR UPDATE USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



ALTER TABLE "public"."responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "responses_insert_public" ON "public"."responses" FOR INSERT WITH CHECK (true);



CREATE POLICY "responses_select" ON "public"."responses" FOR SELECT USING (("public"."is_platform_admin"() OR ("study_id" IN ( SELECT "studies"."id"
   FROM "public"."studies"
  WHERE (("studies"."org_id" = "public"."current_org_id"()) AND (("studies"."visibility" = 'public'::"text") OR ("studies"."created_by" = "auth"."uid"())))))));



ALTER TABLE "public"."review_downloads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_source_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_views" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saved_views_delete" ON "public"."saved_views" FOR DELETE USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND ("created_by" = "auth"."uid"()))));



CREATE POLICY "saved_views_insert" ON "public"."saved_views" FOR INSERT WITH CHECK (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND ("created_by" = "auth"."uid"()))));



CREATE POLICY "saved_views_select" ON "public"."saved_views" FOR SELECT USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND (("visibility" = 'org'::"text") OR ("created_by" = "auth"."uid"())))));



CREATE POLICY "saved_views_update" ON "public"."saved_views" FOR UPDATE USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND ("created_by" = "auth"."uid"()))));



CREATE POLICY "schedules_insert" ON "public"."campaign_schedules" FOR INSERT WITH CHECK (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "schedules_select" ON "public"."campaign_schedules" FOR SELECT USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



CREATE POLICY "schedules_update" ON "public"."campaign_schedules" FOR UPDATE USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



ALTER TABLE "public"."schema_migrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schema_migrations_admin_read" ON "public"."schema_migrations" FOR SELECT TO "authenticated" USING ("public"."is_platform_admin"());



CREATE POLICY "send_log_select" ON "public"."campaign_send_log" FOR SELECT USING (("campaign_id" IN ( SELECT "campaigns"."id"
   FROM "public"."campaigns"
  WHERE (("campaigns"."org_id" = "public"."current_org_id"()) OR "public"."is_platform_admin"()))));



ALTER TABLE "public"."sentry_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sentry_snapshots_admin_read" ON "public"."sentry_snapshots" FOR SELECT TO "authenticated" USING ("public"."is_platform_admin"());



ALTER TABLE "public"."service_health" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shared_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_alert_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_alerts_sent" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_dm_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_moderation_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."studies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "studies_delete" ON "public"."studies" FOR DELETE USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND ("created_by" = "auth"."uid"()))));



CREATE POLICY "studies_insert" ON "public"."studies" FOR INSERT WITH CHECK (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"())));



CREATE POLICY "studies_select" ON "public"."studies" FOR SELECT USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND (("visibility" = 'public'::"text") OR ("created_by" = "auth"."uid"())))));



CREATE POLICY "studies_update" ON "public"."studies" FOR UPDATE USING (("public"."is_platform_admin"() OR (("org_id" = "public"."current_org_id"()) AND ("created_by" = "auth"."uid"()))));



ALTER TABLE "public"."study_response_stats_live" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "study_response_stats_live_org_select" ON "public"."study_response_stats_live" FOR SELECT TO "authenticated" USING (("study_id" IN ( SELECT "s"."id"
   FROM "public"."studies" "s"
  WHERE (("s"."org_id" = ( SELECT "u"."org_id"
           FROM "public"."users" "u"
          WHERE ("u"."id" = "auth"."uid"()))) OR (EXISTS ( SELECT 1
           FROM ("public"."users" "u2"
             JOIN "public"."organizations" "o" ON (("o"."id" = "u2"."org_id")))
          WHERE (("u2"."id" = "auth"."uid"()) AND "o"."is_admin_org")))))));



CREATE POLICY "th_responses_anon_insert" ON "public"."townhall_participant_responses" FOR INSERT WITH CHECK (true);



ALTER TABLE "public"."townhall_participant_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usage_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "usage_logs_org_read" ON "public"."usage_logs" FOR SELECT USING (("org_id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "user reads own org" ON "public"."organizations" FOR SELECT USING (("id" IN ( SELECT "users"."org_id"
   FROM "public"."users"
  WHERE ("users"."id" = "auth"."uid"()))));



CREATE POLICY "user reads own row" ON "public"."users" FOR SELECT USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."user_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_favorites" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_favorites_self_delete" ON "public"."user_favorites" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_favorites_self_insert" ON "public"."user_favorites" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_favorites_self_read" ON "public"."user_favorites" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_features" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_features_self_read" ON "public"."user_features" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_logins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_insert_admin" ON "public"."users" FOR INSERT WITH CHECK ("public"."is_platform_admin"());



CREATE POLICY "users_select" ON "public"."users" FOR SELECT USING (("public"."is_platform_admin"() OR ("org_id" = "public"."current_org_id"()) OR ("id" = "auth"."uid"())));



ALTER TABLE "public"."webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "webhook_events_no_read" ON "public"."webhook_events" FOR SELECT USING (false);



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ana_row_matches_filters"("p_data" "jsonb", "p_filters" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ana_try_parse_ts"("p_val" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ana_try_parse_ts"("p_val" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ana_try_parse_ts"("p_val" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ana_try_parse_ts"("p_val" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_entity_mention_counts"("p_scope_type" "text", "p_scope_id" "uuid", "p_row_total" bigint, "p_sampled" boolean, "p_counts" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_entity_mention_counts"("p_scope_type" "text", "p_scope_id" "uuid", "p_row_total" bigint, "p_sampled" boolean, "p_counts" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_taxonomy_verdicts"("p_dataset_id" "uuid", "p_field_key" "text", "p_items" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_taxonomy_verdicts"("p_dataset_id" "uuid", "p_field_key" "text", "p_items" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_taxonomy_verdicts"("p_dataset_id" "uuid", "p_field_key" "text", "p_items" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."archive_dataset"("p_dataset_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."archive_dataset"("p_dataset_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_dataset"("p_dataset_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."bot_session_counts_for_ids"("p_bot_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."campaign_unsubscribe"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."campaign_unsubscribe"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."campaign_unsubscribe"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_key" "text", "p_max_requests" integer, "p_window_ms" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_rate_limit_buckets"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_buckets"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_buckets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limit_buckets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_theme_cooccurrence_matrix"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_theme_cooccurrence_matrix"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_theme_cooccurrence_matrix"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_entity_terms"("p_dataset_ids" "uuid"[], "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_nonempty_rows"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_nonempty_rows"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."count_theme_intersection"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords_a" "text"[], "p_keywords_b" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."count_theme_intersection"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords_a" "text"[], "p_keywords_b" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_theme_intersection"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords_a" "text"[], "p_keywords_b" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_theme_matches"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_theme_matches"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."current_client_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_client_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_client_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_org_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."current_org_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_org_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."dataset_field_values"("p_dataset_id" "uuid", "p_field" "text", "p_ids" bigint[]) TO "anon";
GRANT ALL ON FUNCTION "public"."dataset_field_values"("p_dataset_id" "uuid", "p_field" "text", "p_ids" bigint[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dataset_field_values"("p_dataset_id" "uuid", "p_field" "text", "p_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field_key" "text", "p_fields" "text"[], "p_limit" integer, "p_after_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field_key" "text", "p_fields" "text"[], "p_limit" integer, "p_after_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_field_taxonomy"("p_dataset_id" "uuid", "p_field_key" "text", "p_fields" "text"[], "p_limit" integer, "p_after_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."dataset_rows_pending_taxonomy"("p_dataset_id" "uuid", "p_text_field" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_taxonomy"("p_dataset_id" "uuid", "p_text_field" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."dataset_rows_pending_taxonomy"("p_dataset_id" "uuid", "p_text_field" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."dataset_rows_with_text_count"("p_dataset_id" "uuid", "p_field" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."dataset_rows_with_text_count"("p_dataset_id" "uuid", "p_field" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dataset_rows_with_text_count"("p_dataset_id" "uuid", "p_field" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_dataset_analytics_key"("p_dataset_id" "uuid", "p_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."drf_tsv_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."drf_tsv_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."drf_tsv_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_theme_topical_words"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_extra_excludes" "text"[], "p_max_results" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."extract_theme_topical_words"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_extra_excludes" "text"[], "p_max_results" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_theme_topical_words"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_extra_excludes" "text"[], "p_max_results" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."field_aliased_avg"("p_dataset_id" "uuid", "p_field" "text", "p_present_field" "text", "p_aliases" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."field_aliased_avg"("p_dataset_id" "uuid", "p_field" "text", "p_present_field" "text", "p_aliases" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."field_aliased_avg"("p_dataset_id" "uuid", "p_field" "text", "p_present_field" "text", "p_aliases" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_or_create_brand_collection"("p_org_id" "uuid", "p_brand_tag" "text", "p_created_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_auth_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rows_by_entity"("p_dataset_ids" "uuid"[], "p_query" "text", "p_text_fields" "jsonb", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_rows_by_filters"("p_dataset_ids" "uuid"[], "p_text_fields" "jsonb", "p_theme_query" "text", "p_entity_query" "text", "p_sub_touchpoint" "text"[], "p_sub_attribute" "text"[], "p_sub_product" "text"[], "p_sub_beverage" "text"[], "p_sub_ambiance" "text"[], "p_sub_context" "text"[], "p_sub_outcome" "text"[], "p_sub_emotion" "text"[], "p_has_dim" boolean, "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_study_response_stats_for_user"("p_study_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_study_response_stats_for_user"("p_study_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_study_response_stats_for_user"("p_study_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_row_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_probe_answered"("p_agent_id" "uuid", "p_probe_id" "text", "p_probe_version" integer, "p_delta" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid", "p_delta" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid", "p_delta" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_pulseiq_response_counter"("p_session_id" "uuid", "p_topic_id" "uuid", "p_delta" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_platform_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."knowledge_tsv_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."knowledge_tsv_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."knowledge_tsv_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."match_agent_knowledge_embedding"("p_bot_id" "uuid", "p_embedding" "public"."vector", "p_exclude_id" "uuid", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_dataset_analytics"("p_dataset_id" "uuid", "p_patch" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."numeric_field_stats"("p_dataset_id" "uuid", "p_field_key" "text", "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."numeric_field_stats"("p_dataset_id" "uuid", "p_field_key" "text", "p_row_ids" bigint[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."numeric_field_stats_present"("p_dataset_id" "uuid", "p_field_key" "text", "p_present_field" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."numeric_field_stats_present"("p_dataset_id" "uuid", "p_field_key" "text", "p_present_field" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."numeric_field_stats_present"("p_dataset_id" "uuid", "p_field_key" "text", "p_present_field" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."org_stats_for_ids"("p_org_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."public_policy_qualifiers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_policy_qualifiers"() TO "anon";
GRANT ALL ON FUNCTION "public"."public_policy_qualifiers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_policy_qualifiers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."public_tables_rls_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_tables_rls_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."public_tables_rls_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_tables_rls_status"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_study_response_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_study_response_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_study_response_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."restore_dataset"("p_dataset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."restore_dataset"("p_dataset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_dataset"("p_dataset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sample_dataset_rows"("p_dataset_id" "uuid", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sample_dataset_rows"("p_dataset_id" "uuid", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sample_row_pairs"("p_dataset_id" "uuid", "p_fields" "text"[], "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sample_row_pairs"("p_dataset_id" "uuid", "p_fields" "text"[], "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sample_row_pairs"("p_dataset_id" "uuid", "p_fields" "text"[], "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_count_entity_terms"("p_dataset_id" "uuid", "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_count_entity_terms"("p_dataset_id" "uuid", "p_terms" "text"[], "p_theme_query" "text", "p_text_fields" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_count_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_crosstab_counts"("p_dataset_id" "uuid", "p_row_field" "text", "p_col_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_date_series_stats"("p_dataset_id" "uuid", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_filter_options"("p_dataset_id" "uuid", "p_fields" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_filter_options"("p_dataset_id" "uuid", "p_fields" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_filtered_rows"("p_dataset_id" "uuid", "p_filters" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_scan_limit" integer, "p_match_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_filtered_rows"("p_dataset_id" "uuid", "p_filters" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_scan_limit" integer, "p_match_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_group_numeric_stats"("p_dataset_id" "uuid", "p_group_field" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_numeric_field_stats"("p_dataset_id" "uuid", "p_field" "text", "p_aliases" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_numeric_field_stats"("p_dataset_id" "uuid", "p_field" "text", "p_aliases" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_numeric_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_numeric_field_values"("p_dataset_id" "uuid", "p_field_key" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_signal_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_signal_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_theme_cooccurrence_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_theme_cooccurrence_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_theme_dimension_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_theme_dimension_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sampled_theme_topical_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_extra_excludes" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sampled_theme_topical_page"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_themes" "jsonb", "p_extra_excludes" "text"[], "p_after_hash" bigint, "p_after_id" bigint, "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_dataset_rows"("p_dataset_id" "uuid", "p_query" "text", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_dataset_rows"("p_dataset_id" "uuid", "p_query" "text", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_dataset_rows"("p_dataset_id" "uuid", "p_query" "text", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_knowledge_chunks"("p_bot_id" "uuid", "p_query" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_knowledge_chunks"("p_bot_id" "uuid", "p_query" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_knowledge_chunks"("p_bot_id" "uuid", "p_query" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_knowledge_semantic"("p_bot_id" "uuid", "p_query" "text", "p_embedding" "public"."vector", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_knowledge_semantic"("p_bot_id" "uuid", "p_query" "text", "p_embedding" "public"."vector", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_knowledge_semantic"("p_bot_id" "uuid", "p_query" "text", "p_embedding" "public"."vector", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_brand_collection_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_brand_collection_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_brand_collection_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."slugify"("p_input" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."slugify"("p_input" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."slugify"("p_input" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."srs_apply_delta"("p_study_id" "uuid", "p_sign" integer, "p_status" "text", "p_sentiment" "text", "p_exp" integer, "p_nps" integer, "p_completed" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."srs_apply_delta"("p_study_id" "uuid", "p_sign" integer, "p_status" "text", "p_sentiment" "text", "p_exp" integer, "p_nps" integer, "p_completed" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."study_stats_for_ids"("p_study_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_brand_collection_members"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_brand_collection_members"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_brand_collection_members"() TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_axis_crosstab"("p_dataset_id" "uuid", "p_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_counts"("p_dataset_id" "uuid", "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_counts"("p_dataset_id" "uuid", "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_counts"("p_dataset_id" "uuid", "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_crosstab"("p_dataset_id" "uuid", "p_axis" "text", "p_field" "text", "p_limit" integer, "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_date_series"("p_dataset_id" "uuid", "p_axis" "text", "p_date_field" "text", "p_metric_field" "text", "p_bucket" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_drill_rows"("p_dataset_id" "uuid", "p_field_key" "text", "p_axis" "text", "p_sub" "text", "p_alert" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_drill_rows"("p_dataset_id" "uuid", "p_field_key" "text", "p_axis" "text", "p_sub" "text", "p_alert" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_drill_rows"("p_dataset_id" "uuid", "p_field_key" "text", "p_axis" "text", "p_sub" "text", "p_alert" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_field_in_blob"("p_dataset_id" "uuid", "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_field_in_blob"("p_dataset_id" "uuid", "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_field_in_blob"("p_dataset_id" "uuid", "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_field_or_primary"("p_dataset_id" "uuid", "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_group_stats"("p_dataset_id" "uuid", "p_axis" "text", "p_value_field" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_primary_field"("p_dataset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_primary_field"("p_dataset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_primary_field"("p_dataset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_rows_for_field"("p_dataset_id" "uuid", "p_field_key" "text", "p_rating_field" "text", "p_date_field" "text", "p_offset" integer, "p_limit" integer, "p_after_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_rows_for_field"("p_dataset_id" "uuid", "p_field_key" "text", "p_rating_field" "text", "p_date_field" "text", "p_offset" integer, "p_limit" integer, "p_after_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_rows_for_field"("p_dataset_id" "uuid", "p_field_key" "text", "p_rating_field" "text", "p_date_field" "text", "p_offset" integer, "p_limit" integer, "p_after_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."taxonomy_sub_counts"("p_dataset_id" "uuid", "p_axis" "text", "p_row_ids" bigint[], "p_field_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."theme_dimension_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."theme_dimension_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."theme_dimension_counts"("p_dataset_id" "uuid", "p_field_keys" "text"[], "p_keywords" "text"[], "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."topical_stopwords"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."topical_stopwords"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_agent_org"("p_agent_id" "uuid", "p_to_org" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_agent_org"("p_agent_id" "uuid", "p_to_org" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_agent_org"("p_agent_id" "uuid", "p_to_org" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."transfer_recording_org"("p_recording_id" "uuid", "p_from_org" "uuid", "p_to_org" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transfer_recording_org"("p_recording_id" "uuid", "p_from_org" "uuid", "p_to_org" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_study_response_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_study_response_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_study_response_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."admin_action_log" TO "anon";
GRANT ALL ON TABLE "public"."admin_action_log" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_action_log" TO "service_role";



GRANT ALL ON TABLE "public"."agent_change_log" TO "anon";
GRANT ALL ON TABLE "public"."agent_change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_change_log" TO "service_role";



GRANT ALL ON TABLE "public"."agent_conversation_reviews" TO "anon";
GRANT ALL ON TABLE "public"."agent_conversation_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_conversation_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."agent_crawl_jobs" TO "anon";
GRANT ALL ON TABLE "public"."agent_crawl_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_crawl_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."agent_impressions" TO "anon";
GRANT ALL ON TABLE "public"."agent_impressions" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_impressions" TO "service_role";



GRANT ALL ON TABLE "public"."agent_kb_page_hashes" TO "anon";
GRANT ALL ON TABLE "public"."agent_kb_page_hashes" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_kb_page_hashes" TO "service_role";



GRANT ALL ON TABLE "public"."agent_knowledge_chunks" TO "anon";
GRANT ALL ON TABLE "public"."agent_knowledge_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_knowledge_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."agent_probe_quota" TO "anon";
GRANT ALL ON TABLE "public"."agent_probe_quota" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_probe_quota" TO "service_role";



GRANT ALL ON TABLE "public"."agent_probe_responses" TO "anon";
GRANT ALL ON TABLE "public"."agent_probe_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_probe_responses" TO "service_role";



GRANT ALL ON TABLE "public"."agent_readout_cache" TO "anon";
GRANT ALL ON TABLE "public"."agent_readout_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_readout_cache" TO "service_role";



GRANT ALL ON TABLE "public"."agent_session_personas" TO "anon";
GRANT ALL ON TABLE "public"."agent_session_personas" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_session_personas" TO "service_role";



GRANT ALL ON TABLE "public"."agent_study_cache" TO "anon";
GRANT ALL ON TABLE "public"."agent_study_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_study_cache" TO "service_role";



GRANT ALL ON TABLE "public"."agents" TO "anon";
GRANT ALL ON TABLE "public"."agents" TO "authenticated";
GRANT ALL ON TABLE "public"."agents" TO "service_role";



GRANT ALL ON TABLE "public"."ai_consent_audit" TO "anon";
GRANT ALL ON TABLE "public"."ai_consent_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_consent_audit" TO "service_role";



GRANT ALL ON TABLE "public"."archived_dataset_rows" TO "anon";
GRANT ALL ON TABLE "public"."archived_dataset_rows" TO "authenticated";
GRANT ALL ON TABLE "public"."archived_dataset_rows" TO "service_role";



GRANT ALL ON TABLE "public"."archived_dataset_rows_flat" TO "anon";
GRANT ALL ON TABLE "public"."archived_dataset_rows_flat" TO "authenticated";
GRANT ALL ON TABLE "public"."archived_dataset_rows_flat" TO "service_role";



GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_flat_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_flat_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_flat_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."archived_dataset_rows_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."bot_change_log" TO "anon";
GRANT ALL ON TABLE "public"."bot_change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_change_log" TO "service_role";



GRANT ALL ON TABLE "public"."bot_conversation_reviews" TO "anon";
GRANT ALL ON TABLE "public"."bot_conversation_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_conversation_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."bot_conversation_turns" TO "anon";
GRANT ALL ON TABLE "public"."bot_conversation_turns" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_conversation_turns" TO "service_role";



GRANT ALL ON TABLE "public"."bot_knowledge_chunks" TO "anon";
GRANT ALL ON TABLE "public"."bot_knowledge_chunks" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_knowledge_chunks" TO "service_role";



GRANT ALL ON TABLE "public"."bot_session_personas" TO "anon";
GRANT ALL ON TABLE "public"."bot_session_personas" TO "authenticated";
GRANT ALL ON TABLE "public"."bot_session_personas" TO "service_role";



GRANT ALL ON TABLE "public"."bots" TO "anon";
GRANT ALL ON TABLE "public"."bots" TO "authenticated";
GRANT ALL ON TABLE "public"."bots" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_emails" TO "anon";
GRANT ALL ON TABLE "public"."campaign_emails" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_emails" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_respondents" TO "anon";
GRANT ALL ON TABLE "public"."campaign_respondents" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_respondents" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_schedules" TO "anon";
GRANT ALL ON TABLE "public"."campaign_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."campaign_send_log" TO "anon";
GRANT ALL ON TABLE "public"."campaign_send_log" TO "authenticated";
GRANT ALL ON TABLE "public"."campaign_send_log" TO "service_role";



GRANT ALL ON TABLE "public"."campaigns" TO "anon";
GRANT ALL ON TABLE "public"."campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."campaigns" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."collection_members" TO "anon";
GRANT ALL ON TABLE "public"."collection_members" TO "authenticated";
GRANT ALL ON TABLE "public"."collection_members" TO "service_role";



GRANT ALL ON TABLE "public"."collections" TO "anon";
GRANT ALL ON TABLE "public"."collections" TO "authenticated";
GRANT ALL ON TABLE "public"."collections" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_reviews" TO "anon";
GRANT ALL ON TABLE "public"."conversation_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_reviews" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_turns" TO "anon";
GRANT ALL ON TABLE "public"."conversation_turns" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_turns" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."dataset_rows" TO "anon";
GRANT ALL ON TABLE "public"."dataset_rows" TO "authenticated";
GRANT ALL ON TABLE "public"."dataset_rows" TO "service_role";



GRANT ALL ON TABLE "public"."dataset_rows_flat" TO "anon";
GRANT ALL ON TABLE "public"."dataset_rows_flat" TO "authenticated";
GRANT ALL ON TABLE "public"."dataset_rows_flat" TO "service_role";



GRANT ALL ON SEQUENCE "public"."dataset_rows_flat_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."dataset_rows_flat_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."dataset_rows_flat_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."dataset_state" TO "anon";
GRANT ALL ON TABLE "public"."dataset_state" TO "authenticated";
GRANT ALL ON TABLE "public"."dataset_state" TO "service_role";



GRANT ALL ON TABLE "public"."datasets" TO "anon";
GRANT ALL ON TABLE "public"."datasets" TO "authenticated";
GRANT ALL ON TABLE "public"."datasets" TO "service_role";



GRANT ALL ON TABLE "public"."deck_download_log" TO "anon";
GRANT ALL ON TABLE "public"."deck_download_log" TO "authenticated";
GRANT ALL ON TABLE "public"."deck_download_log" TO "service_role";



GRANT ALL ON TABLE "public"."entity_catalog" TO "anon";
GRANT ALL ON TABLE "public"."entity_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."entity_catalog_refresh" TO "anon";
GRANT ALL ON TABLE "public"."entity_catalog_refresh" TO "authenticated";
GRANT ALL ON TABLE "public"."entity_catalog_refresh" TO "service_role";



GRANT ALL ON TABLE "public"."invites" TO "anon";
GRANT ALL ON TABLE "public"."invites" TO "authenticated";
GRANT ALL ON TABLE "public"."invites" TO "service_role";



GRANT ALL ON TABLE "public"."logged_questions" TO "anon";
GRANT ALL ON TABLE "public"."logged_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."logged_questions" TO "service_role";



GRANT ALL ON TABLE "public"."mco_handoff_sessions" TO "anon";
GRANT ALL ON TABLE "public"."mco_handoff_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."mco_handoff_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."org_features" TO "anon";
GRANT ALL ON TABLE "public"."org_features" TO "authenticated";
GRANT ALL ON TABLE "public"."org_features" TO "service_role";



GRANT ALL ON TABLE "public"."org_transfers" TO "anon";
GRANT ALL ON TABLE "public"."org_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."org_transfers" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."pulseiq_session_conversations" TO "anon";
GRANT ALL ON TABLE "public"."pulseiq_session_conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."pulseiq_session_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."pulseiq_sessions" TO "anon";
GRANT ALL ON TABLE "public"."pulseiq_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."pulseiq_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."pulseiq_topics" TO "anon";
GRANT ALL ON TABLE "public"."pulseiq_topics" TO "authenticated";
GRANT ALL ON TABLE "public"."pulseiq_topics" TO "service_role";



GRANT ALL ON TABLE "public"."question_batches" TO "anon";
GRANT ALL ON TABLE "public"."question_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."question_batches" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "anon";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limit_buckets" TO "service_role";



GRANT ALL ON TABLE "public"."recording_config_versions" TO "anon";
GRANT ALL ON TABLE "public"."recording_config_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."recording_config_versions" TO "service_role";



GRANT ALL ON TABLE "public"."recording_extractions" TO "anon";
GRANT ALL ON TABLE "public"."recording_extractions" TO "authenticated";
GRANT ALL ON TABLE "public"."recording_extractions" TO "service_role";



GRANT ALL ON TABLE "public"."recording_files" TO "anon";
GRANT ALL ON TABLE "public"."recording_files" TO "authenticated";
GRANT ALL ON TABLE "public"."recording_files" TO "service_role";



GRANT ALL ON TABLE "public"."recording_transcripts" TO "anon";
GRANT ALL ON TABLE "public"."recording_transcripts" TO "authenticated";
GRANT ALL ON TABLE "public"."recording_transcripts" TO "service_role";



GRANT ALL ON TABLE "public"."recordings" TO "anon";
GRANT ALL ON TABLE "public"."recordings" TO "authenticated";
GRANT ALL ON TABLE "public"."recordings" TO "service_role";



GRANT ALL ON TABLE "public"."reddit_source_threads" TO "anon";
GRANT ALL ON TABLE "public"."reddit_source_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."reddit_source_threads" TO "service_role";



GRANT ALL ON TABLE "public"."reddit_sources" TO "anon";
GRANT ALL ON TABLE "public"."reddit_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."reddit_sources" TO "service_role";



GRANT ALL ON TABLE "public"."reo_gold_review" TO "anon";
GRANT ALL ON TABLE "public"."reo_gold_review" TO "authenticated";
GRANT ALL ON TABLE "public"."reo_gold_review" TO "service_role";



GRANT ALL ON TABLE "public"."responses" TO "anon";
GRANT ALL ON TABLE "public"."responses" TO "authenticated";
GRANT ALL ON TABLE "public"."responses" TO "service_role";



GRANT ALL ON TABLE "public"."review_downloads" TO "anon";
GRANT ALL ON TABLE "public"."review_downloads" TO "authenticated";
GRANT ALL ON TABLE "public"."review_downloads" TO "service_role";



GRANT ALL ON TABLE "public"."review_source_locations" TO "anon";
GRANT ALL ON TABLE "public"."review_source_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."review_source_locations" TO "service_role";



GRANT ALL ON TABLE "public"."review_sources" TO "anon";
GRANT ALL ON TABLE "public"."review_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."review_sources" TO "service_role";



GRANT ALL ON TABLE "public"."saved_views" TO "anon";
GRANT ALL ON TABLE "public"."saved_views" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_views" TO "service_role";



GRANT ALL ON TABLE "public"."schema_migrations" TO "anon";
GRANT ALL ON TABLE "public"."schema_migrations" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_migrations" TO "service_role";



GRANT ALL ON TABLE "public"."sentry_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."sentry_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."sentry_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."service_health" TO "anon";
GRANT ALL ON TABLE "public"."service_health" TO "authenticated";
GRANT ALL ON TABLE "public"."service_health" TO "service_role";



GRANT ALL ON TABLE "public"."shared_links" TO "anon";
GRANT ALL ON TABLE "public"."shared_links" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_links" TO "service_role";



GRANT ALL ON TABLE "public"."social_alert_rules" TO "anon";
GRANT ALL ON TABLE "public"."social_alert_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."social_alert_rules" TO "service_role";



GRANT ALL ON TABLE "public"."social_alerts_sent" TO "anon";
GRANT ALL ON TABLE "public"."social_alerts_sent" TO "authenticated";
GRANT ALL ON TABLE "public"."social_alerts_sent" TO "service_role";



GRANT ALL ON TABLE "public"."social_comments" TO "anon";
GRANT ALL ON TABLE "public"."social_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."social_comments" TO "service_role";



GRANT ALL ON TABLE "public"."social_connections" TO "anon";
GRANT ALL ON TABLE "public"."social_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."social_connections" TO "service_role";



GRANT ALL ON TABLE "public"."social_dm_log" TO "anon";
GRANT ALL ON TABLE "public"."social_dm_log" TO "authenticated";
GRANT ALL ON TABLE "public"."social_dm_log" TO "service_role";



GRANT ALL ON TABLE "public"."social_moderation_log" TO "anon";
GRANT ALL ON TABLE "public"."social_moderation_log" TO "authenticated";
GRANT ALL ON TABLE "public"."social_moderation_log" TO "service_role";



GRANT ALL ON TABLE "public"."studies" TO "anon";
GRANT ALL ON TABLE "public"."studies" TO "authenticated";
GRANT ALL ON TABLE "public"."studies" TO "service_role";



GRANT ALL ON TABLE "public"."study_response_stats_live" TO "authenticated";
GRANT ALL ON TABLE "public"."study_response_stats_live" TO "service_role";



GRANT ALL ON TABLE "public"."study_stats" TO "anon";
GRANT ALL ON TABLE "public"."study_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."study_stats" TO "service_role";



GRANT ALL ON TABLE "public"."townhall_participant_responses" TO "anon";
GRANT ALL ON TABLE "public"."townhall_participant_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."townhall_participant_responses" TO "service_role";



GRANT ALL ON TABLE "public"."usage_logs" TO "anon";
GRANT ALL ON TABLE "public"."usage_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_logs" TO "service_role";



GRANT ALL ON TABLE "public"."user_events" TO "anon";
GRANT ALL ON TABLE "public"."user_events" TO "authenticated";
GRANT ALL ON TABLE "public"."user_events" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."user_activity_summary" TO "anon";
GRANT ALL ON TABLE "public"."user_activity_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."user_activity_summary" TO "service_role";



GRANT ALL ON TABLE "public"."user_favorites" TO "anon";
GRANT ALL ON TABLE "public"."user_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."user_features" TO "anon";
GRANT ALL ON TABLE "public"."user_features" TO "authenticated";
GRANT ALL ON TABLE "public"."user_features" TO "service_role";



GRANT ALL ON TABLE "public"."user_locations" TO "anon";
GRANT ALL ON TABLE "public"."user_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."user_locations" TO "service_role";



GRANT ALL ON TABLE "public"."user_logins" TO "anon";
GRANT ALL ON TABLE "public"."user_logins" TO "authenticated";
GRANT ALL ON TABLE "public"."user_logins" TO "service_role";



GRANT ALL ON TABLE "public"."user_login_summary" TO "anon";
GRANT ALL ON TABLE "public"."user_login_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."user_login_summary" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_events" TO "anon";
GRANT ALL ON TABLE "public"."webhook_events" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_events" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







