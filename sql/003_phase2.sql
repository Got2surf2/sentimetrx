-- ============================================================
-- SENTIMETRX Phase 2 — Additional Schema
-- Run this in Supabase SQL Editor AFTER 001_schema.sql
-- ============================================================

-- Invite tokens for client self-registration
CREATE TABLE invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email        TEXT,                    -- optional — pre-fill the registration form
  role         TEXT DEFAULT 'owner'
               CHECK (role IN ('owner','member')),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  used_at      TIMESTAMPTZ,             -- null = not yet used
  expires_at   TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Only platform admins can see/create invites
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invites_admin_all" ON invites
  USING (is_platform_admin());

CREATE POLICY "invites_insert_admin" ON invites FOR INSERT
  WITH CHECK (is_platform_admin());

-- Public read for registration page (validates token without auth)
CREATE POLICY "invites_public_read" ON invites FOR SELECT
  USING (true);

-- Helper: get response counts and stats per study
-- Used by the dashboard to show summary stats without N+1 queries
CREATE OR REPLACE VIEW study_stats AS
SELECT
  s.id                                          AS study_id,
  s.guid,
  s.client_id,
  COUNT(r.id)                                   AS total_responses,
  ROUND(AVG(r.nps_score)::numeric, 1)           AS avg_nps,
  ROUND(AVG(r.experience_score)::numeric, 1)    AS avg_experience,
  COUNT(CASE WHEN r.sentiment = 'promoter'  THEN 1 END) AS promoters,
  COUNT(CASE WHEN r.sentiment = 'passive'   THEN 1 END) AS passives,
  COUNT(CASE WHEN r.sentiment = 'detractor' THEN 1 END) AS detractors,
  MAX(r.completed_at)                           AS last_response_at
FROM studies s
LEFT JOIN responses r ON r.study_id = s.id
GROUP BY s.id, s.guid, s.client_id;

-- RLS on the view
ALTER VIEW study_stats SET (security_invoker = true);
