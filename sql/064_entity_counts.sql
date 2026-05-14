-- sql/064_entity_counts.sql
-- Phase 5 of the entity rebuild: the runtime count function.
--
-- entity_catalog (063) stores a flat *list* of canonical entities per scope
-- but deliberately does NOT store counts — a discovery sample can't produce
-- accurate full-dataset counts. Instead counts are computed live here, at
-- filter time, against the full dataset_rows_flat.tsv full-text index.
--
-- count_entity_terms takes a set of member dataset ids and a set of
-- pre-built websearch query strings (one per catalog entity, canonical +
-- aliases OR'd together by lib/entityFilter.ts) and returns a row count per
-- term. An optional theme query ANDs in a theme's keyword match so the
-- theme-card "Top entities" section gets entity-∩-theme counts. This single
-- set-based query replaces the per-row 059_top_entities_for_theme function.
--
-- One query, GIN-indexed (idx_drf_tsv from 031). LEFT JOIN so terms that
-- match nothing still come back with row_count 0.

CREATE OR REPLACE FUNCTION public.count_entity_terms(
  p_dataset_ids  uuid[],
  p_terms        text[],
  p_theme_query  text DEFAULT NULL
)
RETURNS TABLE(term text, row_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.term,
    count(r.id) AS row_count
  FROM unnest(p_terms) AS t(term)
  LEFT JOIN public.dataset_rows_flat r
    ON  r.dataset_id = ANY(p_dataset_ids)
    AND r.tsv @@ websearch_to_tsquery('english', t.term)
    AND (
      p_theme_query IS NULL
      OR r.tsv @@ websearch_to_tsquery('english', p_theme_query)
    )
  GROUP BY t.term;
$$;

COMMENT ON FUNCTION public.count_entity_terms(uuid[], text[], text) IS
  'Live full-text row counts for entity catalog terms. Per term: rows in p_dataset_ids whose tsv matches the term (and optionally a theme query). Replaces 059_top_entities_for_theme. Called by lib/entityFilter.ts.';

-- Service-role is the only caller (API routes gate scope ownership first).
GRANT EXECUTE ON FUNCTION public.count_entity_terms(uuid[], text[], text) TO service_role;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'count_entity_terms function' AS object, 'ready' AS status;
