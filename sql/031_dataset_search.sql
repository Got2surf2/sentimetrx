-- 031_dataset_search.sql
-- Full-text search on dataset_rows_flat for TextMine search
-- Uses tsvector + GIN index for fast keyword/phrase search across all text fields in JSONB data

-- Add tsvector column
ALTER TABLE dataset_rows_flat ADD COLUMN IF NOT EXISTS tsv TSVECTOR;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_drf_tsv ON dataset_rows_flat USING GIN(tsv);

-- Trigram index on concatenated text for fuzzy matching
-- (pg_trgm extension already enabled from 023_knowledge_chunks.sql)

-- ── Auto-populate tsvector from all text values in JSONB data ────
-- Extracts all string values from the data JSONB and concatenates into a tsvector
CREATE OR REPLACE FUNCTION drf_tsv_trigger() RETURNS TRIGGER AS $$
DECLARE
  txt TEXT := '';
  val TEXT;
  key TEXT;
BEGIN
  -- Concatenate all string values from the JSONB data column
  FOR key, val IN SELECT k, v::text FROM jsonb_each_text(NEW.data) AS x(k, v)
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

DROP TRIGGER IF EXISTS trg_drf_tsv ON dataset_rows_flat;
CREATE TRIGGER trg_drf_tsv
  BEFORE INSERT OR UPDATE OF data ON dataset_rows_flat
  FOR EACH ROW EXECUTE FUNCTION drf_tsv_trigger();

-- ── Search function: full-text ranked ────────────────────────────
-- Returns rows matching a query, ranked by relevance.
-- Uses websearch_to_tsquery so the caller can pass natural-language operators
-- like "OR" — important for AI-expanded synonym queries.
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
    r.data,
    ts_rank_cd(r.tsv, tsquery_val)::REAL AS rank,
    ts_headline('english',
      (SELECT string_agg(v, ' | ')
       FROM jsonb_each_text(r.data) AS x(k, v)
       WHERE length(v) > 2 AND v ~ '[a-zA-Z]'),
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Backfill existing rows ───────────────────────────────────────
-- Populate tsv for any rows that pre-date the trigger.
UPDATE dataset_rows_flat SET tsv = to_tsvector('english',
  COALESCE((SELECT string_agg(v, ' ') FROM jsonb_each_text(data) AS x(k, v)
    WHERE length(v) > 2 AND v ~ '[a-zA-Z]'), ''))
WHERE tsv IS NULL;
