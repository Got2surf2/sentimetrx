-- ============================================================
-- 026: SOCIAL MEDIA MODERATION
-- Facebook Pages + Instagram Business comment monitoring,
-- moderation, alerting, and AI-powered engagement.
-- ============================================================

-- Social account connections (Meta OAuth tokens)
CREATE TABLE social_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_id       TEXT NOT NULL,
  account_name     TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  connected_by     UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_connections_org ON social_connections(org_id);

-- Ingested comments from FB + IG
CREATE TABLE social_comments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id       UUID NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform            TEXT NOT NULL,
  post_id             TEXT NOT NULL,
  post_text           TEXT,
  comment_id          TEXT NOT NULL UNIQUE,
  parent_comment_id   TEXT,
  author_name         TEXT,
  author_id           TEXT,
  text                TEXT NOT NULL,
  sentiment           TEXT,
  flags               JSONB DEFAULT '[]',
  is_hidden           BOOLEAN DEFAULT false,
  is_deleted          BOOLEAN DEFAULT false,
  is_reply            BOOLEAN DEFAULT false,
  replied_at          TIMESTAMPTZ,
  our_reply           TEXT,
  platform_created_at TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_comments_org ON social_comments(org_id, ingested_at DESC);
CREATE INDEX idx_social_comments_connection ON social_comments(connection_id, platform_created_at DESC);
CREATE INDEX idx_social_comments_platform_id ON social_comments(comment_id);

-- Moderation action log
CREATE TABLE social_moderation_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  comment_id   UUID REFERENCES social_comments(id) ON DELETE CASCADE,
  action       TEXT NOT NULL CHECK (action IN ('hide', 'unhide', 'delete', 'reply', 'ai_reply', 'dm')),
  reply_text   TEXT,
  performed_by UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_mod_log_org ON social_moderation_log(org_id, created_at DESC);

-- Alert configuration
CREATE TABLE social_alert_rules (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL,
  config    JSONB DEFAULT '{}',
  channels  JSONB DEFAULT '[]',
  enabled   BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_alert_rules_org ON social_alert_rules(org_id);

-- Alert history
CREATE TABLE social_alerts_sent (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  rule_id     UUID REFERENCES social_alert_rules(id) ON DELETE SET NULL,
  channel     TEXT NOT NULL,
  target      TEXT NOT NULL,
  subject     TEXT,
  body        TEXT,
  comment_ids UUID[],
  sent_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_alerts_sent_org ON social_alerts_sent(org_id, sent_at DESC);

-- DM engagement log
CREATE TABLE social_dm_log (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL,
  connection_id      UUID REFERENCES social_connections(id) ON DELETE SET NULL,
  platform           TEXT NOT NULL,
  recipient_id       TEXT NOT NULL,
  recipient_name     TEXT,
  trigger_comment_id UUID REFERENCES social_comments(id) ON DELETE SET NULL,
  intent             TEXT,
  template           TEXT,
  message_text       TEXT NOT NULL,
  sent_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_social_dm_log_org ON social_dm_log(org_id, sent_at DESC);
