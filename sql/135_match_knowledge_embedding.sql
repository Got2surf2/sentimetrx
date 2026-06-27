-- 135_match_knowledge_embedding.sql
--
-- Nearest-neighbour cosine match over an agent's knowledge chunks. Backs the
-- "near-duplicate guard" when a reviewer saves an answered-question chunk
-- (app/api/bots/[id]/questions/[questionId]/answer): before inserting a NEW
-- chunk we check whether a near-identical one already exists, so the KB doesn't
-- accumulate redundant answers as different-but-similar questions get answered
-- over time. Read-only, additive; mirrors the cosine distance (<=>) already used
-- by search_knowledge_semantic (sql/024). agent_knowledge_chunks is bot-scoped
-- (no org_id); callers gate org access before invoking.

BEGIN;

CREATE OR REPLACE FUNCTION match_agent_knowledge_embedding(
  p_bot_id     uuid,
  p_embedding  vector(1536),
  p_exclude_id uuid DEFAULT NULL,
  p_limit      int  DEFAULT 1
)
RETURNS TABLE (id uuid, title text, content text, similarity double precision)
LANGUAGE sql
STABLE
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

COMMENT ON FUNCTION match_agent_knowledge_embedding(uuid, vector, uuid, int) IS
  'Nearest agent_knowledge_chunks rows to p_embedding by cosine similarity (1 - cosine distance), bot-scoped. Powers the near-duplicate guard in the answer-a-question flow. Read-only.';

COMMIT;
