-- sql/074_bot_change_log.sql
-- Per-bot change log. Captures every meaningful mutation a user (or admin)
-- makes to a bot — creates, updates, deletes, knowledge ingestion and
-- knowledge clears, status flips, JSON imports.
--
-- Motivation: Sarina's knowledge_base disappeared between authoring and
-- 2026-05-19 with zero forensic trail. The existing `admin_action_log`
-- table was written into a few migrations ago but is wired only into
-- lib/orgTransfer.ts (0 rows in prod). This is the bot-scoped audit log
-- and a precursor to the same pattern on surveys + campaigns.
--
-- Writes are server-side only (service-role from API routes via
-- lib/auditLog.ts). RLS allows org members and admin-org members to
-- read entries for bots in their org.

BEGIN;

CREATE TABLE IF NOT EXISTS bot_change_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  org_id      uuid NOT NULL,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,
  action      text NOT NULL,
  summary     text NOT NULL,
  before      jsonb,
  after       jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Constrain action values so a typo can't quietly create a new bucket.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bot_change_log_action_check') THEN
    ALTER TABLE bot_change_log
      ADD CONSTRAINT bot_change_log_action_check
      CHECK (action IN (
        'create',
        'update',
        'delete',
        'status_change',
        'knowledge_added',
        'knowledge_cleared',
        'import'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bot_change_log_bot_id_created_at_idx
  ON bot_change_log (bot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS bot_change_log_org_id_created_at_idx
  ON bot_change_log (org_id, created_at DESC);

ALTER TABLE bot_change_log ENABLE ROW LEVEL SECURITY;

-- Read: own-org members + admin-org members can see entries.
DROP POLICY IF EXISTS bot_change_log_org_read ON bot_change_log;
CREATE POLICY bot_change_log_org_read ON bot_change_log
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT org_id FROM users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM users u
      JOIN organizations o ON o.id = u.org_id
      WHERE u.id = auth.uid() AND o.is_admin_org = true
    )
  );

-- Writes happen exclusively via service-role from server code. No insert
-- policy = no client can write. (Service-role bypasses RLS.)

COMMIT;

-- Sanity check
SELECT 'bot_change_log table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_schema='public' AND table_name='bot_change_log')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'bot_change_log_bot_id_created_at_idx',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                          WHERE schemaname='public' AND tablename='bot_change_log'
                            AND indexname='bot_change_log_bot_id_created_at_idx')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'bot_change_log RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables
                          WHERE schemaname='public' AND tablename='bot_change_log' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END;
