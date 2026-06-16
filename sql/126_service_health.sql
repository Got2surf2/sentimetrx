-- 126_service_health.sql
-- ============================================================
-- Platform service-credit / health monitor (one row per external vendor).
--
-- Motivation: a DataForSEO HTTP 402 (out of balance) silently stalled a
-- review load (Rubio's, 2026-06-16) — buried in a per-location error_message
-- with nothing surfaced. This table is the single source of truth for
-- "are we out of credits anywhere", read by /admin/health and the
-- service-balance cron (which alerts on low/critical/error).
--
-- Two tiers:
--   tier 1 — vendor exposes a balance API; we poll it (balance_usd set).
--   tier 2 — no balance API; we only learn on a failed call, so we record
--            the LAST credit/quota error (last_error_*). balance_usd null.
--
-- Platform-global (about OUR vendor accounts, not customer data) → no org_id.
-- Visible to the admin org only. Writes go through the service role.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.service_health (
  service         text PRIMARY KEY,        -- 'dataforseo','deepgram','twilio','anthropic','openai','resend','google_places'
  display_name    text NOT NULL,
  tier            int  NOT NULL DEFAULT 2 CHECK (tier IN (1, 2)),
  balance_usd     numeric,                 -- null for tier-2 or not-yet-probed
  balance_raw     jsonb,                   -- raw vendor payload for debugging
  status          text NOT NULL DEFAULT 'unknown'
                    CHECK (status IN ('ok','low','critical','error','unknown')),
  checked_at      timestamptz,             -- last successful balance probe (tier 1)
  last_error_at   timestamptz,             -- last credit/quota error seen
  last_error_code text,
  last_error_msg  text,
  last_alerted_at timestamptz,             -- last time the cron emailed about this service (alert throttle)
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_health IS
  'One row per external vendor account; platform credit/health state. Tier-1 rows carry a polled balance_usd; tier-2 rows carry last credit-error only. Written by lib/serviceHealth.ts (service role), read by /admin/health + the service-balance cron.';

-- ============================================================
-- Grants — service-role only (all writes + the cron read go through it)
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON public.service_health TO service_role;

-- ============================================================
-- RLS — admin-org members may read; nobody else. Service role bypasses RLS.
-- ============================================================
ALTER TABLE public.service_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin org reads service_health" ON public.service_health;
CREATE POLICY "admin org reads service_health" ON public.service_health
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.organizations o ON o.id = u.org_id
    WHERE u.id = auth.uid() AND o.is_admin_org = true
  ));

-- ============================================================
-- Verify
-- ============================================================
SELECT 'service_health table' AS object, 'ready' AS status
UNION ALL SELECT 'RLS + admin-org SELECT policy', 'ready';
