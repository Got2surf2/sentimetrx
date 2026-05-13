-- sql/057_user_events.sql
-- Generic user activity events table for stickiness measurement,
-- pilot health monitoring, and proactive outreach to inactive users.
--
-- Why generic and not a table per event-type: we want to instrument
-- the 7–10 highest-signal actions cheaply now, then add more event
-- names without schema churn. (jsonb metadata column carries the
-- per-event details.)
--
-- ai_consent_audit (sql/056) stays as its own table because consent
-- is a compliance artifact with stricter retention semantics; this
-- table is for product analytics.
--
-- Grant pattern: explicit GRANTs are now required for the Data API
-- to see tables in `public` (Supabase change rolling out May–Oct 2026).
-- Following the pattern as defensive standard going forward.

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id         uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_name     text NOT NULL,            -- 'login', 'dataset_created', 'theme_mined', ...
  event_category text,                     -- 'auth' | 'data' | 'analyze' | 'export' | 'share' | 'admin'
  metadata       jsonb NOT NULL DEFAULT '{}',
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_events_user_idx
  ON public.user_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_org_idx
  ON public.user_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_events_name_idx
  ON public.user_events (event_name, created_at DESC);

COMMENT ON TABLE public.user_events IS
  'Append-only stream of meaningful user actions for stickiness analysis and pilot outreach. Writes go through lib/userEvents.ts::recordEvent (service-role). Best-effort: never blocks user flow on a failed insert.';

-- ============================================================
-- 2. Grants (Supabase Data API access pattern)
-- ============================================================
GRANT SELECT, INSERT ON public.user_events TO service_role;
-- authenticated has no direct access — the table is read only via the
-- admin endpoints (requireAdmin), which use service-role internally.
-- anon: no access.

-- ============================================================
-- 3. RLS
-- ============================================================
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

-- Service-role bypasses RLS, which is the only writer/reader path.
-- No policies for authenticated/anon means default deny — defense in
-- depth in case a future grant accidentally opens it up.

-- ============================================================
-- 4. Activity summary view (powers the admin dashboard)
-- ============================================================
CREATE OR REPLACE VIEW public.user_activity_summary AS
SELECT
  u.id           AS user_id,
  u.email,
  u.full_name,
  u.org_id,
  o.name         AS org_name,
  u.created_at   AS user_created_at,
  u.disabled,
  -- Lifetime stats
  count(ue.*)                                                     AS total_events,
  count(DISTINCT date_trunc('day', ue.created_at))                AS active_days,
  -- Recency
  max(ue.created_at)                                              AS last_active_at,
  min(ue.created_at)                                              AS first_active_at,
  -- Recent windows
  count(*) FILTER (WHERE ue.created_at > now() - interval '7 days')   AS events_7d,
  count(*) FILTER (WHERE ue.created_at > now() - interval '30 days')  AS events_30d,
  count(DISTINCT date_trunc('day', ue.created_at))
    FILTER (WHERE ue.created_at > now() - interval '7 days')         AS active_days_7d,
  count(DISTINCT date_trunc('day', ue.created_at))
    FILTER (WHERE ue.created_at > now() - interval '30 days')        AS active_days_30d
FROM public.users u
LEFT JOIN public.organizations o ON o.id = u.org_id
LEFT JOIN public.user_events ue ON ue.user_id = u.id
GROUP BY u.id, u.email, u.full_name, u.org_id, o.name, u.created_at, u.disabled;

COMMENT ON VIEW public.user_activity_summary IS
  'One row per user with rollups for stickiness + inactivity outreach. Drives /admin/activity.';

GRANT SELECT ON public.user_activity_summary TO service_role;

-- ============================================================
-- Verify
-- ============================================================
SELECT 'user_events table' AS object, 'ready' AS status
UNION ALL SELECT 'user_events indexes', 'ready'
UNION ALL SELECT 'user_activity_summary view', 'ready';
