-- 081_logged_questions.sql
--
-- Question Log MVP — durable record of user questions the bot couldn't
-- (or didn't) answer. Driver: NOWOCATS PM-2 public-record requirement,
-- but the table is generic across every bot.
--
-- Capture point lives in lib/chatCore.ts (Question Log capture block,
-- 2026-05-21). Three classifications wire today:
--   - 'deflect'        — deflection router fired (off-topic / sensitive)
--   - 'kb_miss'        — RAG confidence < 0.05 AND no KB fallback hit
--   - 'ai_uncertain'   — assistant response matched an "I don't know" marker
--
-- Future classifications (per docs/BOTS.md § 9.x): 'clarification',
-- 'intent:ASK', PII-flagged variants. The `classification` column is
-- free text (not enum'd) so adding categories is doc-only.
--
-- Lifecycle: status starts at 'open'. Team marks each row 'answered' /
-- 'referred' / 'n_a' from the admin UI (next-session work) and can
-- attach a follow-up `notes` field.
--
-- Per CLAUDE.md multi-tenancy invariants: org_id is paired with every
-- read/write; RLS is enabled day-one with an org-scoped SELECT policy
-- so other tenants can't see each other's logged questions.

BEGIN;

CREATE TABLE IF NOT EXISTS logged_questions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL,
  bot_id                  uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id              text NOT NULL,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  turn_id                 uuid REFERENCES conversation_turns(id) ON DELETE SET NULL,
  user_message            text NOT NULL,
  language                text,
  classification          text NOT NULL,
  status                  text NOT NULL DEFAULT 'open',
  resolved_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  resolved_at             timestamptz,
  notes                   text,
  suggested_kb_addition   text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logged_questions_status_check') THEN
    ALTER TABLE logged_questions
      ADD CONSTRAINT logged_questions_status_check
      CHECK (status IN ('open', 'answered', 'referred', 'n_a'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS logged_questions_bot_created_idx
  ON logged_questions (bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS logged_questions_org_status_idx
  ON logged_questions (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS logged_questions_session_idx
  ON logged_questions (session_id);

ALTER TABLE logged_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logged_questions_org_read ON logged_questions;
CREATE POLICY logged_questions_org_read ON logged_questions
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- No INSERT/UPDATE/DELETE policy: writes are service-role only (capture
-- happens fire-and-forget from lib/chatCore.ts), and admin mutations
-- (status change / resolution) go through API routes that use the
-- service role + paired org_id check per the CLAUDE.md service-role
-- invariant. RLS-enabled-with-no-write-policy means RLS implicitly
-- denies all writes from the anon / authenticated roles.

COMMENT ON TABLE logged_questions IS
  'Durable record of user questions the bot couldn''t or didn''t answer. Populated fire-and-forget from lib/chatCore.ts at three capture points: deflect, kb_miss, ai_uncertain. Status lifecycle: open -> answered|referred|n_a. Generic across every bot; NOWOCATS PM-2 record is the driving use case. See docs/BOTS.md § 9.x.';

COMMENT ON COLUMN logged_questions.classification IS
  'Free-text classification — today: deflect | kb_miss | ai_uncertain. Future per spec: clarification, intent:ASK variants, manual.';

COMMENT ON COLUMN logged_questions.suggested_kb_addition IS
  'Optional — when an admin reviews the question and proposes content the KB should add, the proposal lives here. Future: integrate with bot_change_log so KB additions that resolve a logged question get cross-linked.';

COMMIT;
