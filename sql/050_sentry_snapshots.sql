-- 050 — Daily Sentry snapshot history.
--
-- Each cron run writes one row capturing the count of unresolved
-- issues plus a JSONB blob of the top N for trend / regression
-- analysis. RLS: read-only to platform admins; write via service role.

CREATE TABLE IF NOT EXISTS public.sentry_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  captured_at     timestamptz NOT NULL DEFAULT now(),
  unresolved_count integer NOT NULL,
  issues          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- top N at time of capture
  error           text                                  -- when ok=false, why
);

CREATE INDEX IF NOT EXISTS sentry_snapshots_captured_idx
  ON public.sentry_snapshots (captured_at DESC);

ALTER TABLE public.sentry_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY sentry_snapshots_admin_read
  ON public.sentry_snapshots
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
