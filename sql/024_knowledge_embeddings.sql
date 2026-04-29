-- 024_knowledge_embeddings.sql
-- Adds pgvector semantic search to bot knowledge chunks
-- + structured agent fields (faq, facts, guardrails)

-- ── Enable pgvector extension ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Add embedding column to knowledge chunks ─────────────────────
ALTER TABLE bot_knowledge_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
  ON bot_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- ── Semantic search function (embeddings + full-text + trigram) ──
CREATE OR REPLACE FUNCTION search_knowledge_semantic(
  p_bot_id    UUID,
  p_query     TEXT,
  p_embedding vector(1536) DEFAULT NULL,
  p_limit     INT DEFAULT 5
)
RETURNS TABLE(
  id         UUID,
  title      TEXT,
  content    TEXT,
  metadata   JSONB,
  rank       REAL,
  confidence REAL
) AS $$
DECLARE
  tsquery_val TSQUERY;
  max_rank    REAL;
BEGIN
  tsquery_val := plainto_tsquery('english', p_query);

  RETURN QUERY
  WITH scored AS (
    SELECT
      c.id,
      c.title,
      c.content,
      c.metadata,
      (
        -- Semantic similarity (cosine) — weighted highest when available
        CASE WHEN p_embedding IS NOT NULL AND c.embedding IS NOT NULL
          THEN (1.0 - (c.embedding <=> p_embedding)) * 4.0
          ELSE 0
        END
        -- Full-text rank
        + COALESCE(ts_rank_cd(c.tsv, tsquery_val), 0) * 2.0
        -- Trigram similarity
        + COALESCE(similarity(c.content, p_query), 0)
        + COALESCE(similarity(c.title, p_query), 0) * 1.5
      )::REAL AS rank
    FROM bot_knowledge_chunks c
    WHERE c.bot_id = p_bot_id
      AND (
        -- Semantic match (cosine distance < 0.5 means similarity > 0.5)
        (p_embedding IS NOT NULL AND c.embedding IS NOT NULL AND (c.embedding <=> p_embedding) < 0.5)
        -- Full-text match
        OR c.tsv @@ tsquery_val
        -- Trigram match
        OR similarity(c.content, p_query) > 0.05
        OR similarity(c.title, p_query) > 0.1
      )
  )
  SELECT
    s.id,
    s.title,
    s.content,
    s.metadata,
    s.rank,
    -- Normalize to 0-1 confidence: rank / theoretical max
    -- Max possible: 4.0 (cosine) + 2.0 (fts) + 1.0 (content trgm) + 1.5 (title trgm) = 8.5
    LEAST(s.rank / 8.5, 1.0)::REAL AS confidence
  FROM scored s
  ORDER BY s.rank DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Structured agent fields ──────────────────────────────────────
ALTER TABLE bots ADD COLUMN IF NOT EXISTS faq        JSONB DEFAULT '[]'::JSONB;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS facts      JSONB DEFAULT '[]'::JSONB;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS guardrails JSONB DEFAULT '[]'::JSONB;

-- Subject the agent represents (for sentiment filtering)
ALTER TABLE bots ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT '';

-- How to handle negative content: 'deflect' (default) or 'pivot'
ALTER TABLE bots ADD COLUMN IF NOT EXISTS negative_content_mode TEXT NOT NULL DEFAULT 'deflect';

-- Opponents for contrast/oppo research
ALTER TABLE bots ADD COLUMN IF NOT EXISTS opponents JSONB DEFAULT '[]'::JSONB;

-- Contrast mode: 'off' | 'user_triggered' (default) | 'always'
ALTER TABLE bots ADD COLUMN IF NOT EXISTS contrast_mode TEXT NOT NULL DEFAULT 'user_triggered';
