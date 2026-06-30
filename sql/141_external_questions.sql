-- 141_external_questions.sql
--
-- "External" questions — a client-supplied list of community questions pasted
-- into an agent's Question Log, answered with the agent's KB (AI-drafted, then
-- accepted/edited by a reviewer), and treated the same as questions that came
-- in through the live agent. See docs/BOTS.md § 9.x (External questions).
--
-- Reuses the existing logged_questions → /draft → /answer → KB loop. New
-- columns:
--   source          — 'agent' (live capture, the default) vs 'external' (pasted)
--   external_contact — jsonb {name?, email?, phone?, ...} so a reply can be sent
--                      back to the asker; kept per the owner's decision (3).
--   answer_text      — the accepted answer, stored on the row so the
--                      "download responses" export carries question+answer+contact
--                      regardless of whether the answer was also written to the KB
--                      (KB write is opt-in per question — decision 2).
--   batch_label      — optional grouping label for one pasted list.
--
-- classification stays free-text; external rows use classification='external'.
-- RLS is already enabled on logged_questions (sql/081) with an org-scoped policy,
-- so the new columns inherit it.

BEGIN;

ALTER TABLE logged_questions
  ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'agent',
  ADD COLUMN IF NOT EXISTS external_contact jsonb,
  ADD COLUMN IF NOT EXISTS answer_text      text,
  ADD COLUMN IF NOT EXISTS batch_label      text;

-- Filter the queue / export by source cheaply.
CREATE INDEX IF NOT EXISTS logged_questions_bot_source_idx
  ON logged_questions (bot_id, source, created_at DESC);

COMMIT;
