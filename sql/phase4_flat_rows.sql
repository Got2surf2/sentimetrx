-- Phase 4: Flat row table + materialized view
-- Apply via the production Supabase SQL Editor:
-- https://supabase.com/dashboard → SQL Editor → New query → Paste → Run

-- ============================================================
-- 1. Create flat row table
-- ============================================================
CREATE TABLE IF NOT EXISTS dataset_rows_flat (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id  uuid NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_index   int NOT NULL DEFAULT 0,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_drf_dataset ON dataset_rows_flat(dataset_id);
CREATE INDEX IF NOT EXISTS idx_drf_dataset_idx ON dataset_rows_flat(dataset_id, row_index);
CREATE INDEX IF NOT EXISTS idx_drf_data_gin ON dataset_rows_flat USING gin(data);

-- RLS: same policy as dataset_rows
ALTER TABLE dataset_rows_flat ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (API routes use service role for data operations)
CREATE POLICY "Service role full access on dataset_rows_flat"
  ON dataset_rows_flat FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. Populate flat table from existing batched data
-- ============================================================
-- This reads every batch in dataset_rows, unnests the rows[] array,
-- and inserts each individual row into dataset_rows_flat.
-- For a 50K-row dataset this takes ~5-10 seconds.

INSERT INTO dataset_rows_flat (dataset_id, row_index, data)
SELECT
  dr.dataset_id,
  (dr.batch_index * 200) + (row_num - 1) AS row_index,
  row_data
FROM dataset_rows dr,
  LATERAL jsonb_array_elements(dr.rows) WITH ORDINALITY AS t(row_data, row_num)
WHERE NOT EXISTS (
  SELECT 1 FROM dataset_rows_flat drf
  WHERE drf.dataset_id = dr.dataset_id
  LIMIT 1
);

-- ============================================================
-- 3. Materialized view for study response stats
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS study_response_stats AS
SELECT
  study_id,
  count(*) AS total_responses,
  count(*) FILTER (WHERE status = 'complete' OR status IS NULL) AS complete_count,
  count(*) FILTER (WHERE sentiment = 'positive' OR sentiment = 'promoter') AS promoters,
  count(*) FILTER (WHERE sentiment = 'neutral' OR sentiment = 'passive') AS passives,
  count(*) FILTER (WHERE sentiment = 'negative' OR sentiment = 'detractor') AS detractors,
  avg(experience_score) FILTER (WHERE experience_score IS NOT NULL) AS avg_experience,
  avg(nps_score) FILTER (WHERE nps_score IS NOT NULL) AS avg_nps,
  max(completed_at) AS last_response_at
FROM responses
GROUP BY study_id;

-- Index for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_srs_study ON study_response_stats(study_id);

-- ============================================================
-- 4. Function to refresh the materialized view
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_study_response_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY study_response_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Helper function: count field values from flat rows (replaces JS iteration)
-- ============================================================
CREATE OR REPLACE FUNCTION count_field_values(
  p_dataset_id uuid,
  p_field_key text,
  p_limit int DEFAULT 200
)
RETURNS TABLE(value text, count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (data ->> p_field_key)::text AS value,
    count(*)::bigint AS count
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND data ->> p_field_key IS NOT NULL
    AND data ->> p_field_key != ''
  GROUP BY data ->> p_field_key
  ORDER BY count(*) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. Helper function: get numeric stats from flat rows
-- ============================================================
CREATE OR REPLACE FUNCTION numeric_field_stats(
  p_dataset_id uuid,
  p_field_key text
)
RETURNS TABLE(
  n bigint,
  min_val double precision,
  max_val double precision,
  avg_val double precision,
  median_val double precision,
  stddev_val double precision
) AS $$
BEGIN
  RETURN QUERY
  WITH nums AS (
    SELECT (data ->> p_field_key)::double precision AS v
    FROM dataset_rows_flat
    WHERE dataset_id = p_dataset_id
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. Helper function: keyword theme matching in SQL
-- ============================================================
CREATE OR REPLACE FUNCTION count_theme_matches(
  p_dataset_id uuid,
  p_field_keys text[],
  p_keywords text[]
)
RETURNS bigint AS $$
DECLARE
  kw_pattern text;
  match_count bigint;
BEGIN
  -- Build a combined regex pattern from all keywords
  SELECT string_agg('(?:^|\W)' || regexp_replace(kw, '([.*+?^${}()|[\]\\])', '\\\1', 'g') || '\w*', '|')
  INTO kw_pattern
  FROM unnest(p_keywords) AS kw;

  IF kw_pattern IS NULL THEN RETURN 0; END IF;

  SELECT count(*)
  INTO match_count
  FROM dataset_rows_flat
  WHERE dataset_id = p_dataset_id
    AND EXISTS (
      SELECT 1 FROM unnest(p_field_keys) AS fk
      WHERE data ->> fk IS NOT NULL
        AND data ->> fk ~* kw_pattern
    );

  RETURN match_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Done! Verify:
-- ============================================================
SELECT 'dataset_rows_flat rows' AS check, count(*) FROM dataset_rows_flat
UNION ALL
SELECT 'study_response_stats rows', count(*) FROM study_response_stats;
