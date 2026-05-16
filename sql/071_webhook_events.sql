-- sql/071_webhook_events.sql
-- Idempotency ledger for inbound webhooks (Resend first; designed for any
-- Svix-style signed sender).
--
-- Context: Resend retries failed deliveries. Without dedup, a retried webhook
-- would re-run our handler — bumping `opened_at` timestamps, re-writing
-- status, and (more dangerously) double-counting events. Resend's `svix-id`
-- header is stable across retries, so we use it as the dedup key.
--
-- Lifecycle: every verified webhook tries to INSERT (source, svix_id). The
-- UNIQUE (source, svix_id) index turns a retried delivery into a 23505
-- error that the route catches and short-circuits with 200 OK.
--
-- Not org-scoped: the inbound event hasn't been resolved to a campaign/org
-- yet when we dedupe. SELECT policy is deny-all because nothing in the app
-- needs to read this table from the auth client; the service role (every
-- webhook route) bypasses RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL CHECK (source IN ('resend')),
  svix_id     text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, svix_id)
);

COMMENT ON TABLE public.webhook_events IS
  'Append-only idempotency ledger for inbound signed webhooks. UNIQUE (source, svix_id) is the dedup key. Service role only; no auth-client reads.';

GRANT INSERT, SELECT ON public.webhook_events TO service_role;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Deny-all SELECT. Service role bypasses RLS so the dedup path still works.
DROP POLICY IF EXISTS "webhook_events_no_read" ON public.webhook_events;
CREATE POLICY "webhook_events_no_read" ON public.webhook_events
  FOR SELECT
  USING (false);

-- Verify
SELECT 'webhook_events table'  AS object, 'ready' AS status
UNION ALL SELECT 'unique (source, svix_id)',    'ready'
UNION ALL SELECT 'RLS + deny-all SELECT policy', 'ready';

COMMIT;
