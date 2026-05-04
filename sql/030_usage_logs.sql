-- 030_usage_logs.sql
-- AI usage accounting: track token consumption per resource for cost analysis and pricing

CREATE TABLE IF NOT EXISTS usage_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type   TEXT NOT NULL,          -- 'bot', 'townhall', 'social', 'dataset', 'system'
  resource_id     UUID,                   -- bot.id, session.id, dataset.id, etc.
  event_type      TEXT NOT NULL,          -- 'chat', 'persona', 'demographics', 'intent', 'deflect', 'summary', 'theme_detect', 'knowledge_classify', 'ai_reply', 'report', 'translate', 'research', 'ana'
  model           TEXT NOT NULL,          -- e.g. 'claude-haiku-4-5-20251001'
  provider        TEXT NOT NULL DEFAULT 'anthropic',
  tier            TEXT NOT NULL DEFAULT 'fast',
  input_tokens    INT NOT NULL DEFAULT 0,
  output_tokens   INT NOT NULL DEFAULT 0,
  cache_read_tokens    INT NOT NULL DEFAULT 0,
  cache_creation_tokens INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_org ON usage_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_resource ON usage_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);

-- RLS: service role writes, org members read their own
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_logs_service_write ON usage_logs FOR ALL USING (true);

CREATE POLICY usage_logs_org_read ON usage_logs FOR SELECT
  USING (org_id IN (SELECT org_id FROM users WHERE id = auth.uid()));
