-- sql/170_theme_counts_filtered.sql
-- Brief C (Brief F escalation #2) — theme-prevalence bars honor active filters.
--
-- WHY: the Charts theme-prevalence bars (ChartsModule liveThemeCounts →
-- /theme-counts route) rendered DATASET-WIDE percentages under a filtered UI,
-- because count_theme_matches (the numerator) and count_nonempty_rows (the
-- denominator) took no row-id/filter param — the same class Brief F fixed for
-- the scalar /aggregate ops. Every OTHER Charts aggregate is filter-aware
-- (raw-row charts via applyFilters; scalar + taxonomy server ops via
-- p_row_ids, sql/169/164), so the theme bars were the last filter-blind
-- surface on the filtered Charts tab.
--
-- WHAT: both RPCs DROP+re-CREATE'd with an appended `p_row_ids bigint[]
-- DEFAULT NULL` and the tax-family predicate `(p_row_ids IS NULL OR id =
-- ANY(p_row_ids))`. DEFAULT NULL keeps every existing caller (signalStats,
-- nonEmptyCount, the theme-counts sampled/exact paths) byte-identical and is
-- deploy-order safe (route appends the arg only when filters are active and
-- drops it on PGRST202). When filters are active the client's row-id set is a
-- subset of the loaded 50K sample (bounded), so `id = ANY(...)` is a bounded
-- index lookup — no sampling twin needed on the filtered path.
--
-- SECURITY DEFINER over raw rows -> service_role only (unchanged posture);
-- routes enforce org access.

BEGIN;

-- count_theme_matches: prevalence numerator ---------------------------------
DROP FUNCTION IF EXISTS count_theme_matches(uuid, text[], text[]);
CREATE FUNCTION count_theme_matches(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords   text[],
  p_row_ids    bigint[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

-- count_nonempty_rows: prevalence denominator (sql/161) ---------------------
DROP FUNCTION IF EXISTS count_nonempty_rows(uuid, text);
CREATE FUNCTION count_nonempty_rows(
  p_dataset_id uuid,
  p_field text,
  p_row_ids bigint[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)
  FROM dataset_rows_flat drf
  WHERE drf.dataset_id = p_dataset_id
    AND (p_row_ids IS NULL OR drf.id = ANY(p_row_ids))
    AND NULLIF(btrim(drf.data ->> p_field), '') IS NOT NULL;
$$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'count_theme_matches(uuid, text[], text[], bigint[])',
    'count_nonempty_rows(uuid, text, bigint[])'
  ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
  END LOOP;
END $$;

COMMIT;
