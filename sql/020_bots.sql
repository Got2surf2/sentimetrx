-- 020_bots.sql
-- Branded chatbots: self-service bot creator with knowledge base training

CREATE TABLE IF NOT EXISTS bots (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                          -- display name (e.g., "ACLU Rights Bot")
  slug            TEXT NOT NULL UNIQUE,                   -- public URL slug (e.g., "aclu-rights")
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused')),
  config          JSONB NOT NULL DEFAULT '{}'::JSONB,     -- ChatBotConfig: colors, avatar, fonts
  system_prompt   TEXT NOT NULL DEFAULT '',                -- custom system prompt instructions
  knowledge_base  TEXT NOT NULL DEFAULT '',                -- extracted text from training URLs/docs
  training_urls   TEXT[] DEFAULT '{}',                     -- original URLs used for training
  conversation_count BIGINT NOT NULL DEFAULT 0,           -- total conversations started
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by slug (public bot serving)
CREATE INDEX IF NOT EXISTS idx_bots_slug ON bots(slug);
-- Index for org listing
CREATE INDEX IF NOT EXISTS idx_bots_org ON bots(org_id);

-- RLS: org members can read/write their own org's bots
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;

CREATE POLICY bots_org_read ON bots FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY bots_org_write ON bots FOR ALL
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));

-- Personality spec — describes who the agent emulates and communication style
ALTER TABLE bots ADD COLUMN IF NOT EXISTS personality TEXT NOT NULL DEFAULT '';

-- Also add features column to users table for user-level feature flags
ALTER TABLE users ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{}'::JSONB;

-- Also add content_flags column to responses table (from content safety feature)
ALTER TABLE responses ADD COLUMN IF NOT EXISTS content_flags JSONB;
