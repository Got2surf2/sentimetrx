-- sql/078_phase3_new_schema.sql
-- Phase 3 of the agents x PulseIQ convergence (docs/CONVERGENCE.md).
--
-- Introduces five new tables that will eventually replace bot_conversation_turns
-- and the townhall_* family. After this migration lands, the tables are DARK:
-- no live route reads or writes them. The follow-up commit dual-writes from
-- /api/bots/[id]/chat to these new tables behind a DUAL_WRITE_PHASE3 env flag;
-- the commit after that backfills Sarina's historical bot_conversation_turns
-- rows. Only once the backfill is row-for-row verified does any read-path
-- cutover happen.
--
-- The `bots`→`agents` rename from CONVERGENCE.md § 7.1 is deferred to a
-- separate commit later in Phase 3. This migration uses `bot_id` columns
-- FK'd to bots(id); the rename will ALTER FK targets when it happens.
--
-- Tables:
--   1. conversations            — one participant talking to a bot over a
--                                 session. The durable conversation primary
--                                 key. Lives independently of any town hall.
--   2. conversation_turns       — turns within a conversation. Superset shape
--                                 of bot_conversation_turns + townhall_turns.
--   3. town_halls               — a named collection of conversations on the
--                                 same bot, plus cohort config + analysis
--                                 layer. A conversation belongs to zero or
--                                 one town halls.
--   4. town_hall_conversations  — join table linking conversations to town
--                                 halls. Allows retroactive cohort views.
--   5. town_hall_topics         — per-town-hall topic pool. Seed topics
--                                 copied from bots.focuses; organic
--                                 discovered themes appended by the cohort
--                                 theme-detection cron in Phase 5.
--
-- Multi-tenancy invariants (CLAUDE.md):
--   - Every table has `org_id uuid NOT NULL` (denormalized so RLS doesn't
--     need joins on the hot path).
--   - Every table has RLS enabled in this same migration.
--   - Every table has an org-scoped SELECT policy + admin-org bypass.
--   - Writes happen exclusively via service-role from server code. No
--     INSERT/UPDATE/DELETE policies = no client can mutate.
--   - Service-role code in lib/ MUST pair id with org_id when reading these
--     tables — `service.from('conversations').eq('id', x).eq('org_id', orgId)`
--     or a gate*Access helper.
--
-- Rollback: DROP TABLE IF EXISTS conversation_turns, conversations,
-- town_hall_topics, town_hall_conversations, town_halls CASCADE;
-- Safe because no live route depends on these tables in this commit.

BEGIN;

-- ── conversations ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  bot_id          uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  session_id      text NOT NULL,
  participant_id  text,
  language        text,
  source          text,
  medium          text,
  campaign        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  turn_count      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_bot_session_idx
  ON conversations (bot_id, session_id);

CREATE INDEX IF NOT EXISTS conversations_org_created_idx
  ON conversations (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversations_bot_created_idx
  ON conversations (bot_id, created_at DESC);

COMMENT ON TABLE conversations IS
  'One participant talking to a bot over a session. Phase 3 dark; populated by dual-write from /api/bots/[id]/chat once the DUAL_WRITE_PHASE3 flag flips on. Independent of any town hall — town_hall_conversations joins one to a town hall when applicable.';

COMMENT ON COLUMN conversations.session_id IS
  'Widget-side session UUID (text, matches bot_conversation_turns.session_id). Phase 3 carries the legacy session id to make backfill from bot_conversation_turns trivial; future surfaces may use conversations.id directly.';

COMMENT ON COLUMN conversations.participant_id IS
  'Town-hall participant identifier when the conversation is part of a town hall (PulseIQ-side concept). NULL for 1:1 bot chats.';

-- ── conversation_turns ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_turns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL,
  turn_number     integer NOT NULL,
  role            text NOT NULL,
  content         text NOT NULL,
  content_en      text,
  language        text,
  source          text NOT NULL DEFAULT 'normal',
  content_flags   jsonb,
  sentiment       text,
  sentiment_score real,
  ai_thinking     jsonb,
  theme_id        uuid,
  skipped         boolean,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_turns_role_check') THEN
    ALTER TABLE conversation_turns
      ADD CONSTRAINT conversation_turns_role_check
      CHECK (role IN ('user', 'assistant', 'system'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_conv_turn_idx
  ON conversation_turns (conversation_id, turn_number);

CREATE INDEX IF NOT EXISTS conversation_turns_conv_created_idx
  ON conversation_turns (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS conversation_turns_org_created_idx
  ON conversation_turns (org_id, created_at DESC);

COMMENT ON TABLE conversation_turns IS
  'Turns within a conversation. Superset shape of bot_conversation_turns + townhall_turns. Phase 3 dark; populated by dual-write once DUAL_WRITE_PHASE3 flag flips on.';

COMMENT ON COLUMN conversation_turns.source IS
  'Turn provenance. Values from bots: normal, deflect, silence_probe. Values from PulseIQ: guide, clarifier, detected_theme, custom, deflect, standby, language_switch, system, revisit. Source values are not constrained here — the route owns the vocabulary during dual-write.';

COMMENT ON COLUMN conversation_turns.theme_id IS
  'Reference to town_hall_topics(id) when the turn was assigned to a topic by PulseIQ-side matching. NULL for 1:1 bot conversations.';

-- ── town_halls ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS town_halls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL,
  bot_id             uuid NOT NULL REFERENCES bots(id) ON DELETE RESTRICT,
  slug               text NOT NULL,
  name               text NOT NULL,
  status             text NOT NULL DEFAULT 'draft',
  cohort_config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  discussion_guide   jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_target    integer NOT NULL DEFAULT 50,
  started_at         timestamptz,
  ended_at           timestamptz,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_theme_detection_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'town_halls_status_check') THEN
    ALTER TABLE town_halls
      ADD CONSTRAINT town_halls_status_check
      CHECK (status IN ('draft', 'live', 'paused', 'closed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS town_halls_slug_idx ON town_halls (slug);
CREATE INDEX IF NOT EXISTS town_halls_org_created_idx ON town_halls (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS town_halls_bot_idx ON town_halls (bot_id);

COMMENT ON TABLE town_halls IS
  'Cohort wrapper around a bot. A town hall has its own slug + cohort config + analysis layer; the bot it points at is unchanged. Phase 3 dark; activated in Phase 5/6.';

COMMENT ON COLUMN town_halls.bot_id IS
  'The bot serving this town hall. ON DELETE RESTRICT prevents accidental bot deletion while a town hall references it.';

-- ── town_hall_conversations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS town_hall_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  town_hall_id    uuid NOT NULL REFERENCES town_halls(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  joined_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS town_hall_conversations_pair_idx
  ON town_hall_conversations (town_hall_id, conversation_id);

CREATE INDEX IF NOT EXISTS town_hall_conversations_conv_idx
  ON town_hall_conversations (conversation_id);

COMMENT ON TABLE town_hall_conversations IS
  'Join table linking conversations to town halls. A conversation joins zero or one town halls; a town hall has many conversations. Allows retroactive cohort views (e.g. add existing Sarina chats to the June town hall post-hoc).';

-- ── town_hall_topics ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS town_hall_topics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,
  town_hall_id      uuid NOT NULL REFERENCES town_halls(id) ON DELETE CASCADE,
  label             text NOT NULL,
  description       text,
  question          text NOT NULL,
  follow_up_angles  text[],
  keywords          text[],
  state             text NOT NULL DEFAULT 'active',
  source            text NOT NULL DEFAULT 'seed',
  response_target   integer NOT NULL DEFAULT 5,
  response_count    integer NOT NULL DEFAULT 0,
  mention_count     integer NOT NULL DEFAULT 0,
  example_quote     text,
  sort_order        integer,
  detected_at       timestamptz,
  approved_at       timestamptz,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'town_hall_topics_state_check') THEN
    ALTER TABLE town_hall_topics
      ADD CONSTRAINT town_hall_topics_state_check
      CHECK (state IN ('active', 'pending', 'completed', 'rejected'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'town_hall_topics_source_check') THEN
    ALTER TABLE town_hall_topics
      ADD CONSTRAINT town_hall_topics_source_check
      CHECK (source IN ('seed', 'auto_detected', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS town_hall_topics_hall_state_idx
  ON town_hall_topics (town_hall_id, state);

CREATE INDEX IF NOT EXISTS town_hall_topics_org_idx
  ON town_hall_topics (org_id);

COMMENT ON TABLE town_hall_topics IS
  'Per-town-hall topic pool. Seed topics are inserted at town-hall create (from bots.focuses or a curated set); auto_detected topics are appended by the Phase-5 cohort theme-detection cron. The chat handler pulls from this table when serving a town-hall conversation.';

-- ── RLS: enable on every table ───────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE town_halls ENABLE ROW LEVEL SECURITY;
ALTER TABLE town_hall_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE town_hall_topics ENABLE ROW LEVEL SECURITY;

-- ── RLS: org-scoped SELECT + admin-org bypass on every table ─────────────
-- Pattern matches sql/074_bot_change_log.sql lines 58-69.

DROP POLICY IF EXISTS conversations_org_read ON conversations;
CREATE POLICY conversations_org_read ON conversations
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

DROP POLICY IF EXISTS conversation_turns_org_read ON conversation_turns;
CREATE POLICY conversation_turns_org_read ON conversation_turns
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

DROP POLICY IF EXISTS town_halls_org_read ON town_halls;
CREATE POLICY town_halls_org_read ON town_halls
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

DROP POLICY IF EXISTS town_hall_conversations_org_read ON town_hall_conversations;
CREATE POLICY town_hall_conversations_org_read ON town_hall_conversations
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

DROP POLICY IF EXISTS town_hall_topics_org_read ON town_hall_topics;
CREATE POLICY town_hall_topics_org_read ON town_hall_topics
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

-- No INSERT / UPDATE / DELETE policies. All mutations go through service-role
-- from server code (lib/auditLog.ts style). Service-role bypasses RLS;
-- client tokens cannot mutate these tables by design.

COMMIT;

-- ── Sanity checks ────────────────────────────────────────────────────────
SELECT 'conversations table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversations')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'conversation_turns table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='conversation_turns')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_halls table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='town_halls')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_hall_conversations table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='town_hall_conversations')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_hall_topics table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='town_hall_topics')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'conversations RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='conversations' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'conversation_turns RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='conversation_turns' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_halls RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='town_halls' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_hall_conversations RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='town_hall_conversations' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'town_hall_topics RLS enabled',
       CASE WHEN EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='town_hall_topics' AND rowsecurity=true)
            THEN 'ready' ELSE 'MISSING' END;
