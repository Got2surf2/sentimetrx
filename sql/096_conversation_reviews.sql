-- 096_conversation_reviews.sql
--
-- Human-in-the-loop review gate for agent conversations. Trolls, bots, and
-- wholly off-topic conversations are auto-detected and **excluded from all
-- reports** (the Agent Study) while staying in the database — a human clears
-- (`approved`) or confirms-junk (`excluded`) them from the Transcripts page.
-- A conversation with no row here is `clean` and flows into reports normally.
--
-- Auto-flagging itself is computed LIVE (lib/conversationReview.ts) from each
-- session's turns + content_flags — it is NOT persisted. Only a human decision
-- writes a row. So the review queue = sessions whose live auto-flag is
-- non-empty AND have no row here yet.
--
-- Per CLAUDE.md multi-tenancy invariants: org_id paired on every row, RLS
-- day-one with an org-scoped SELECT policy, writes service-role only (the
-- review API uses the service role + a paired org_id check).

BEGIN;

CREATE TABLE IF NOT EXISTS conversation_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  bot_id       uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id   text NOT NULL,
  -- 'approved'  — a human cleared an auto-flagged conversation → include in reports
  -- 'excluded'  — a human confirmed junk (or manually excluded a clean one) → never in reports
  status       text NOT NULL,
  reasons      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- snapshot of the auto-flag reasons at decision time (audit)
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_reviews_status_check') THEN
    ALTER TABLE conversation_reviews
      ADD CONSTRAINT conversation_reviews_status_check
      CHECK (status IN ('approved', 'excluded'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_reviews_bot_session_idx
  ON conversation_reviews (bot_id, session_id);

CREATE INDEX IF NOT EXISTS conversation_reviews_org_idx
  ON conversation_reviews (org_id, status);

ALTER TABLE conversation_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_reviews_org_read ON conversation_reviews;
CREATE POLICY conversation_reviews_org_read ON conversation_reviews
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

COMMENT ON TABLE conversation_reviews IS
  'Human-in-the-loop review decisions for agent conversations. A row exists only when a human acted: approved (clear an auto-flagged troll/bot/off-topic conversation → include in reports) or excluded (confirm junk → never in reports). No row = clean. Auto-flagging is computed live in lib/conversationReview.ts and not persisted. Service-role writes only.';

COMMIT;
