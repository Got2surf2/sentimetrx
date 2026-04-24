-- 022_bot_conversations.sql
-- Conversation capture for branded bots/agents
-- Stores every user + assistant turn for review, reporting, and theme analysis

CREATE TABLE IF NOT EXISTS bot_conversation_turns (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id          UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL,                          -- client-generated session ID (groups a conversation)
  turn_number     INT NOT NULL DEFAULT 0,                 -- 0-indexed turn within session
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL DEFAULT '',                -- message in original language
  content_en      TEXT,                                    -- English translation (NULL if already English)
  language        TEXT NOT NULL DEFAULT 'en',              -- ISO 639-1 language code
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup by bot + session (conversation replay)
CREATE INDEX IF NOT EXISTS idx_bot_turns_session ON bot_conversation_turns(bot_id, session_id, turn_number);
-- Fast lookup by bot for listing all sessions
CREATE INDEX IF NOT EXISTS idx_bot_turns_bot ON bot_conversation_turns(bot_id, created_at DESC);
-- Session listing: distinct sessions per bot
CREATE INDEX IF NOT EXISTS idx_bot_turns_session_id ON bot_conversation_turns(session_id);

-- RLS: org members can read their org's bot conversations
ALTER TABLE bot_conversation_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY bot_turns_org_read ON bot_conversation_turns FOR SELECT
  USING (bot_id IN (SELECT id FROM bots WHERE org_id IN (SELECT org_id FROM users WHERE id = auth.uid())));

-- Service role can insert (public chat endpoint uses service role)
CREATE POLICY bot_turns_service_insert ON bot_conversation_turns FOR INSERT
  WITH CHECK (true);

-- Add last_session_at to bots for quick "last active" display
ALTER TABLE bots ADD COLUMN IF NOT EXISTS last_session_at TIMESTAMPTZ;
