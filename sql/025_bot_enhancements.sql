-- 025_bot_enhancements.sql
-- Agent chat enhancements: content flags, topic management, persona profiling

-- ── Content flags + source on conversation turns ────────────────────
ALTER TABLE bot_conversation_turns ADD COLUMN IF NOT EXISTS content_flags JSONB;
ALTER TABLE bot_conversation_turns ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'normal';

-- ── Topic management on bots ────────────────────────────────────────
ALTER TABLE bots ADD COLUMN IF NOT EXISTS sensitive_topics TEXT[] DEFAULT '{}';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS focus_topics TEXT[] DEFAULT '{}';
ALTER TABLE bots ADD COLUMN IF NOT EXISTS deflection_enabled BOOLEAN DEFAULT true;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS deflection_message TEXT NOT NULL DEFAULT '';

-- ── Persona profiling config on bots ────────────────────────────────
ALTER TABLE bots ADD COLUMN IF NOT EXISTS ask_profile BOOLEAN DEFAULT false;
ALTER TABLE bots ADD COLUMN IF NOT EXISTS profile_question TEXT NOT NULL DEFAULT '';

-- ── Session-level persona storage ───────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_session_personas (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id       UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL,
  persona      JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_session_persona_unique
  ON bot_session_personas(bot_id, session_id);

CREATE INDEX IF NOT EXISTS idx_bot_session_persona_bot
  ON bot_session_personas(bot_id);

ALTER TABLE bot_session_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY persona_org_read ON bot_session_personas FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE org_id IN (
    SELECT org_id FROM users WHERE id = auth.uid()
  )));

CREATE POLICY persona_service_write ON bot_session_personas FOR ALL
  USING (true);

-- ── Intent detection config on bots ─────────────────────────────────
-- Each intent: { label, keywords[], url?, message?, enabled }
ALTER TABLE bots ADD COLUMN IF NOT EXISTS intents JSONB DEFAULT '[]'::JSONB;
