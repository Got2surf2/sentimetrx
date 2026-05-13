-- sql/055_cooccurrence_matrix.sql
-- Single-pass theme co-occurrence matrix.
--
-- Replaces the N² calls to count_theme_intersection (one RPC per theme
-- pair) with a single SQL function that returns the entire matrix in
-- one query. The API used to issue ~91 RPCs for a 14-theme dataset and
-- ~182 for a 2-member collection (9–18 seconds wall clock). With this
-- function the collection becomes 2 RPCs total — one per member.
--
-- Algorithm:
--   1. Build a (theme_id, pattern) table from the input themes JSON.
--   2. For each row in the dataset, concatenate the configured text
--      fields once.
--   3. Cross-match concatenated text against every theme pattern; the
--      array_agg gives each row a set of "themes this row matches."
--   4. For each row's matched-theme set, cross product with itself
--      (excluding the diagonal) → pair counts.
--   5. Pivot into a jsonb matrix { theme_a_id: { theme_b_id: count } }.

CREATE OR REPLACE FUNCTION compute_theme_cooccurrence_matrix(
  p_dataset_id uuid,
  p_field_keys text[],
  p_themes jsonb  -- [{ "id": "...", "keywords": ["kw1", ...] }, ...]
)
RETURNS jsonb AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'compute_theme_cooccurrence_matrix' AS func, 'ready' AS status;
