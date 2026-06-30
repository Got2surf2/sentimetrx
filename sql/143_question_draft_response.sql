-- 143_question_draft_response.sql
--
-- AI-suggested response, drafted at import time (not on demand) so the answer box
-- and the client review link open with a suggestion already filled in — an empty
-- box has no value (owner). Kept distinct from suggested_kb_addition (the accepted
-- answer, which also flags "in knowledge base") so an un-answered import isn't
-- mistaken for KB content.

BEGIN;

ALTER TABLE logged_questions
  ADD COLUMN IF NOT EXISTS draft_response text;

COMMIT;
