-- sql/056_ai_user_consent.sql
-- User-level AI consent + audit trail.
--
-- Background: today the per-user "AI on/off" toggle lives in
-- localStorage('sentimetrx_ai_enabled'). That's per-browser, not
-- per-user; nothing is logged. The product agreement with some orgs
-- requires that even when the org admin makes AI available, each
-- individual user must explicitly opt in — and that opt-ins/-outs
-- are auditable.
--
-- This migration:
--   1. Adds users.ai_enabled (boolean, DEFAULT false). Org ai_key_mode
--      stays the ceiling; users.ai_enabled is the individual decision
--      within that ceiling. New users start opted out by design.
--   2. Adds ai_consent_audit (append-only, service-role-only writes)
--      capturing every toggle: who, which org, prev → next, IP, UA, ts.
--
-- Backfill policy: existing users default to false. Anyone who was
-- relying on the localStorage flag has to re-toggle on next session.
-- Acceptable because the contract guarantee requires explicit consent
-- to pass through — grandfathering would break the guarantee.

-- ============================================================
-- 1. users.ai_enabled
-- ============================================================
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.ai_enabled IS
  'User-level opt-in for AI features. Org ai_key_mode is the ceiling; this is the per-user decision. Always defaults to false on user creation.';

-- ============================================================
-- 2. ai_consent_audit
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_consent_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (action IN ('enable', 'disable')),
  prev_value  boolean NOT NULL,
  new_value   boolean NOT NULL,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_consent_audit_user_id_idx
  ON public.ai_consent_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_consent_audit_org_id_idx
  ON public.ai_consent_audit (org_id, created_at DESC);

-- ============================================================
-- 3. RLS — service-role-only writes; users can read their own rows
-- ============================================================
ALTER TABLE public.ai_consent_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_consent_audit_self_read ON public.ai_consent_audit;
CREATE POLICY ai_consent_audit_self_read
  ON public.ai_consent_audit
  FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies for the auth client → all writes
-- must come through service-role calls in the API. Audit table is
-- append-only by convention; no UPDATE/DELETE path exists in code.

-- ============================================================
-- Verify
-- ============================================================
SELECT 'users.ai_enabled' AS object, 'ready' AS status
UNION ALL SELECT 'ai_consent_audit table', 'ready'
UNION ALL SELECT 'ai_consent_audit_user_id_idx', 'ready'
UNION ALL SELECT 'ai_consent_audit_self_read policy', 'ready';
