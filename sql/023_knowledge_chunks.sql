-- 023_knowledge_chunks.sql
-- Full-text search knowledge base for bot/agent RAG
-- Uses PostgreSQL tsvector + pg_trgm for keyword + trigram similarity search
-- No external embedding API required

-- Enable trigram extension for fuzzy matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Knowledge chunks table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_knowledge_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,              -- section heading (e.g. "Temple Hours")
  content     TEXT NOT NULL,              -- chunk text
  metadata    JSONB DEFAULT '{}',         -- optional tags, source URL, etc.
  tsv         TSVECTOR,                   -- full-text search vector (auto-populated)
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_knowledge_tsv ON bot_knowledge_chunks USING GIN(tsv);

-- Trigram index on content for fuzzy matching
CREATE INDEX IF NOT EXISTS idx_knowledge_trgm ON bot_knowledge_chunks USING GIN(content gin_trgm_ops);

-- Bot lookup index
CREATE INDEX IF NOT EXISTS idx_knowledge_bot ON bot_knowledge_chunks(bot_id);

-- ── Auto-populate tsvector on insert/update ───────────────────
CREATE OR REPLACE FUNCTION knowledge_tsv_trigger() RETURNS TRIGGER AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
             setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_tsv ON bot_knowledge_chunks;
CREATE TRIGGER trg_knowledge_tsv
  BEFORE INSERT OR UPDATE OF title, content ON bot_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION knowledge_tsv_trigger();

-- ── Search function: full-text + trigram ranked ───────────────
-- Returns chunks ranked by a blend of full-text relevance and trigram similarity
CREATE OR REPLACE FUNCTION search_knowledge_chunks(
  p_bot_id UUID,
  p_query  TEXT,
  p_limit  INT DEFAULT 5
)
RETURNS TABLE(
  id        UUID,
  title     TEXT,
  content   TEXT,
  metadata  JSONB,
  rank      REAL
) AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE bot_knowledge_chunks ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_all" ON bot_knowledge_chunks
  FOR ALL USING (true) WITH CHECK (true);
