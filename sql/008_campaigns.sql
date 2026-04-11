-- ============================================================
-- SENTIMETRX — Campaign Manager Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ============================================================
-- CAMPAIGNS
-- One row per email campaign linked to a study.
-- ============================================================
CREATE TABLE campaigns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  study_id         UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','scheduled','active','paused','completed')),
  study_url        TEXT NOT NULL,           -- survey URL template with {{field}} placeholders
  hidden_fields    TEXT[] NOT NULL DEFAULT '{}', -- field names extracted from study config
  target_responses INTEGER,                 -- optional completion goal
  email_provider   TEXT NOT NULL DEFAULT 'resend'
                   CHECK (email_provider IN ('resend','sendgrid','ses','smtp')),
  email_config     JSONB DEFAULT '{}',      -- provider-specific config (from address, reply-to, etc.)
  send_thank_you   BOOLEAN DEFAULT false,   -- auto-send thank you on completion
  send_incomplete  BOOLEAN DEFAULT false,   -- auto-remind on incomplete responses
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at (reuses existing trigger function)
CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- CAMPAIGN RESPONDENTS
-- One row per uploaded recipient in a campaign.
-- ============================================================
CREATE TABLE campaign_respondents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  fields         JSONB DEFAULT '{}',       -- mapped hidden field values for this respondent
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','sent','opened','clicked','completed','bounced','unsubscribed')),
  sent_at        TIMESTAMPTZ,
  opened_at      TIMESTAMPTZ,
  clicked_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  response_id    UUID REFERENCES responses(id) ON DELETE SET NULL,
  unsubscribe_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- One email per campaign per respondent
CREATE UNIQUE INDEX idx_respondent_email_campaign
  ON campaign_respondents(campaign_id, email);

-- ============================================================
-- CAMPAIGN EMAILS (template sequence)
-- Each campaign has ordered email templates (initial + reminders).
-- ============================================================
CREATE TABLE campaign_emails (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  sequence       SMALLINT NOT NULL DEFAULT 0,  -- 0=initial, 1=reminder1, 2=reminder2, etc.
  subject        TEXT NOT NULL,
  body_html      TEXT NOT NULL,
  body_text      TEXT,                         -- plain-text fallback
  send_delay_hours INTEGER DEFAULT 0,          -- hours after campaign launch (0=immediate)
  send_to        TEXT NOT NULL DEFAULT 'all'
                 CHECK (send_to IN ('all','non_responders','incompletes')),
  is_thank_you   BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER campaign_emails_updated_at
  BEFORE UPDATE ON campaign_emails
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Unique sequence per campaign
CREATE UNIQUE INDEX idx_email_sequence_campaign
  ON campaign_emails(campaign_id, sequence);

-- ============================================================
-- CAMPAIGN SEND LOG (audit trail)
-- Every individual email send is logged here.
-- ============================================================
CREATE TABLE campaign_send_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  respondent_id    UUID NOT NULL REFERENCES campaign_respondents(id) ON DELETE CASCADE,
  email_id         UUID NOT NULL REFERENCES campaign_emails(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  provider_msg_id  TEXT,                    -- external message ID for tracking
  status           TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','failed')),
  error_message    TEXT,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CAMPAIGN SCHEDULES
-- Tracks scheduled email sends for automation.
-- ============================================================
CREATE TABLE campaign_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email_id       UUID NOT NULL REFERENCES campaign_emails(id) ON DELETE CASCADE,
  scheduled_at   TIMESTAMPTZ NOT NULL,
  executed_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_campaigns_study       ON campaigns(study_id);
CREATE INDEX idx_campaigns_org         ON campaigns(org_id);
CREATE INDEX idx_campaigns_status      ON campaigns(org_id, status);
CREATE INDEX idx_respondents_campaign  ON campaign_respondents(campaign_id);
CREATE INDEX idx_respondents_status    ON campaign_respondents(campaign_id, status);
CREATE INDEX idx_send_log_campaign     ON campaign_send_log(campaign_id);
CREATE INDEX idx_send_log_respondent   ON campaign_send_log(respondent_id);
CREATE INDEX idx_schedules_pending     ON campaign_schedules(status, scheduled_at)
                                       WHERE status = 'pending';

-- ============================================================
-- ROW LEVEL SECURITY
-- Same org-isolation pattern as studies.
-- ============================================================
ALTER TABLE campaigns            ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_respondents ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_emails      ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_send_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_schedules   ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's org_id
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM users WHERE id = auth.uid()
$$;

-- CAMPAIGNS: org members see their org's campaigns
CREATE POLICY campaigns_select ON campaigns FOR SELECT
  USING (is_platform_admin() OR org_id = current_org_id());
CREATE POLICY campaigns_insert ON campaigns FOR INSERT
  WITH CHECK (is_platform_admin() OR org_id = current_org_id());
CREATE POLICY campaigns_update ON campaigns FOR UPDATE
  USING (is_platform_admin() OR org_id = current_org_id());
CREATE POLICY campaigns_delete ON campaigns FOR DELETE
  USING (is_platform_admin() OR org_id = current_org_id());

-- CAMPAIGN_RESPONDENTS: access via campaign's org
CREATE POLICY respondents_select ON campaign_respondents FOR SELECT
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY respondents_insert ON campaign_respondents FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY respondents_update ON campaign_respondents FOR UPDATE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY respondents_delete ON campaign_respondents FOR DELETE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));

-- CAMPAIGN_EMAILS: access via campaign's org
CREATE POLICY emails_select ON campaign_emails FOR SELECT
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY emails_insert ON campaign_emails FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY emails_update ON campaign_emails FOR UPDATE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY emails_delete ON campaign_emails FOR DELETE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));

-- CAMPAIGN_SEND_LOG: read-only via campaign's org
CREATE POLICY send_log_select ON campaign_send_log FOR SELECT
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY send_log_insert ON campaign_send_log FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));

-- CAMPAIGN_SCHEDULES: access via campaign's org
CREATE POLICY schedules_select ON campaign_schedules FOR SELECT
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY schedules_insert ON campaign_schedules FOR INSERT
  WITH CHECK (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));
CREATE POLICY schedules_update ON campaign_schedules FOR UPDATE
  USING (campaign_id IN (SELECT id FROM campaigns WHERE org_id = current_org_id() OR is_platform_admin()));

-- ============================================================
-- UNSUBSCRIBE: public endpoint needs to update respondent status
-- without auth. We use a function + policy for this.
-- ============================================================
CREATE OR REPLACE FUNCTION campaign_unsubscribe(p_token TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE campaign_respondents
  SET status = 'unsubscribed'
  WHERE unsubscribe_token = p_token
    AND status != 'unsubscribed';
  RETURN FOUND;
END;
$$;
