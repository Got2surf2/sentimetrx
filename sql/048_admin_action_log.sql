-- 048 — Admin cross-org action audit log.
--
-- Separate from org_transfers (which records ownership moves). This table
-- captures destructive or state-changing operations a platform admin runs
-- against another tenant's resource — full re-syncs, row trims, dataset
-- deletes, etc. Important for SOC 2 / NIST AI RMF evidence: anything an
-- admin does to a customer's data must be traceable.
--
-- Append-only. No update / delete policies. Only service_role can write.

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  action_type        text NOT NULL,            -- 'dataset.sync_full' | 'dataset.trim' | 'dataset.delete' | ...
  resource_type      text NOT NULL,            -- 'dataset' | 'study' | 'townhall_session' | 'bot' | ...
  resource_id        uuid NOT NULL,
  resource_name      text,                     -- snapshot for readability later

  target_org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  target_org_name    text,                     -- snapshot for readability later

  initiated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_by_email text,                     -- snapshot

  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS admin_action_log_created_idx
  ON public.admin_action_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_action_log_resource_idx
  ON public.admin_action_log (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS admin_action_log_target_org_idx
  ON public.admin_action_log (target_org_id);

ALTER TABLE public.admin_action_log ENABLE ROW LEVEL SECURITY;

-- Platform admins can read the log; no one can write directly via the
-- regular client (service role bypasses RLS for the insert path).
CREATE POLICY admin_action_log_admin_read
  ON public.admin_action_log
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

-- Explicitly deny INSERT/UPDATE/DELETE via the anon / authenticated
-- client. Only service_role writes (from lib/orgTransfer.ts helpers).
-- No policies = denied by default once RLS is on.
