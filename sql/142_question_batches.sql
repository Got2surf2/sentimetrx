-- 142_question_batches.sql
--
-- Question batches — a named group of external questions imported together
-- (e.g. a client's pasted/CSV community comment log), with an optional public
-- "client review" share link so the client can walk the queue and accept/edit
-- the AI-drafted responses themselves. See docs/BOTS.md § 9.x (External
-- questions → CSV import + client review).
--
-- share_token mirrors recordings.share_token (sql/090): a random URL-safe token
-- granting token-gated access to the public review page at /review/<token>,
-- NULL until sharing is enabled; fail-closed on share_enabled + expiry.
--
-- logged_questions gains:
--   batch_id         — FK to the batch (NULL for ad-hoc/paste-without-batch)
--   original_comment — the FULL pasted comment; user_message holds the
--                      AI-extracted answerable question, so the rest is kept as
--                      commentary (owner: "extract the question, store the rest").

BEGIN;

CREATE TABLE IF NOT EXISTS question_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  bot_id          uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  label           text,
  source_kind     text NOT NULL DEFAULT 'paste',  -- 'paste' | 'csv'
  share_token     text UNIQUE,                     -- URL-safe; NULL until shared
  share_enabled   boolean NOT NULL DEFAULT false,
  share_expires_at timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_batches_bot_idx ON question_batches (bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS question_batches_share_token_idx ON question_batches (share_token) WHERE share_token IS NOT NULL;

ALTER TABLE question_batches ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (mirrors logged_questions: org via users.org_id). The public
-- review page uses the service role + token match, which bypasses RLS, so no
-- public policy is needed. No write policy → RLS denies anon/authenticated writes;
-- all writes go through service-role API routes with a paired org_id check.
DROP POLICY IF EXISTS question_batches_org_read ON question_batches;
CREATE POLICY question_batches_org_read ON question_batches
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

ALTER TABLE logged_questions
  ADD COLUMN IF NOT EXISTS batch_id         uuid REFERENCES question_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_comment text;

CREATE INDEX IF NOT EXISTS logged_questions_batch_idx ON logged_questions (batch_id) WHERE batch_id IS NOT NULL;

COMMIT;
