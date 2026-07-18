-- 184_help_feedback.sql
-- Thumbs up/down feedback on the in-product Help assistant (Guide, 🛟).
--
-- One row per rating a signed-in user gives to a Help answer. This is the
-- KB-gap detector (HELP_AGENT §9): repeated thumbs-down / low-confidence
-- questions are the authoring backlog for the next help article. Stored with
-- the (question, answer) pair and the page the user was on, so a reviewer can
-- see what Guide got wrong and where.
--
-- Writes go through the service-role /api/help/feedback route (which pairs the
-- row's org_id with the caller's own org from auth). RLS gives org-scoped read
-- only — the multi-tenancy invariant for every new public table.

BEGIN;

CREATE TABLE IF NOT EXISTS help_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  user_id     uuid NOT NULL,
  session_id  text,
  rating      smallint NOT NULL CHECK (rating IN (-1, 1)),  -- -1 = down, +1 = up
  question    text,
  answer      text,
  page_route  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Reviewer reads: most-recent first, and cheap "recent thumbs-down" scans.
CREATE INDEX IF NOT EXISTS idx_help_feedback_created ON help_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_help_feedback_rating  ON help_feedback (rating, created_at DESC);

ALTER TABLE help_feedback ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (multi-tenancy invariant). No write policy → RLS denies
-- anon/authenticated writes; every insert goes through the service-role route
-- which stamps org_id from the authenticated caller.
DROP POLICY IF EXISTS help_feedback_org_read ON help_feedback;
CREATE POLICY help_feedback_org_read ON help_feedback
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMIT;
