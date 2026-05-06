-- 034_user_logins.sql
-- Track every successful login (per user, per org) so admins can see who's
-- active and who's gone quiet. Drives customer-success outreach: spot orgs
-- where nobody has signed in for 30+ days *before* renewal time.

CREATE TABLE IF NOT EXISTS public.user_logins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      UUID REFERENCES organizations(id) ON DELETE SET NULL,
  method      TEXT NOT NULL CHECK (method IN ('password', 'magic', 'sso', 'invite')),
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Per-user lookups (most recent login)
CREATE INDEX IF NOT EXISTS idx_user_logins_user_recent
  ON public.user_logins(user_id, created_at DESC);

-- Per-org rollups ("how active is this org over the last N days")
CREATE INDEX IF NOT EXISTS idx_user_logins_org_recent
  ON public.user_logins(org_id, created_at DESC);

-- Service-role only (logged via API, read by admin views).
ALTER TABLE public.user_logins ENABLE ROW LEVEL SECURITY;
-- No policies — service role bypasses RLS.

-- Convenience: snapshot of each user's last login + count over 30d.
-- Used by /admin/clients/[id] and /admin/clients listing to show activity.
CREATE OR REPLACE VIEW public.user_login_summary AS
SELECT
  user_id,
  org_id,
  COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '30 days')  AS logins_30d,
  COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '7 days')   AS logins_7d,
  MAX(created_at)                                                   AS last_login_at,
  MAX(method)                                                       AS last_method
FROM public.user_logins
GROUP BY user_id, org_id;
