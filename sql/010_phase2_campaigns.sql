-- Phase 2 campaign enhancements
-- Run in Supabase SQL Editor after 008_campaigns.sql and 009_recipient_guid.sql

-- Add send_time (time of day) and timezone to campaign_emails
ALTER TABLE campaign_emails
  ADD COLUMN IF NOT EXISTS send_time TIME,          -- e.g. '09:00' — null = send immediately
  ADD COLUMN IF NOT EXISTS send_timezone TEXT DEFAULT 'America/New_York';

-- Add scheduled_send tracking to campaign_send_log
ALTER TABLE campaign_send_log
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES campaign_schedules(id) ON DELETE SET NULL;

-- SMS channel support
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'both')),
  ADD COLUMN IF NOT EXISTS sms_config JSONB DEFAULT '{}';

ALTER TABLE campaign_emails
  ADD COLUMN IF NOT EXISTS sms_body TEXT;

-- Add phone field to campaign_respondents (for SMS)
ALTER TABLE campaign_respondents
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Shareable dashboard links
CREATE TABLE IF NOT EXISTS shared_links (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  type        TEXT NOT NULL CHECK (type IN ('study', 'campaign')),
  target_id   UUID NOT NULL,          -- study ID or campaign ID
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_links_token ON shared_links(token);
CREATE INDEX IF NOT EXISTS idx_shared_links_target ON shared_links(target_id);

-- Track when a shared link was last accessed
ALTER TABLE shared_links ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
