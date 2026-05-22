-- sql/086_mco_handoff_sessions.sql
--
-- "Send to my phone" handoff for the /demo/mco kiosk demo. When a user scans
-- the QR code shown in the kiosk modal, they land on /m/<code> which loads
-- the conversation they had at the kiosk and lets them keep talking to Ana
-- on their own phone.
--
-- This is a public, code-gated handoff — no auth. The code itself is the
-- secret. 15-minute TTL caps blast radius if a code leaks (e.g. someone
-- photographs the screen). The API route uses service-role to insert and
-- read by code; clients can NEITHER list nor query the table directly.
--
-- The table has no org_id because the demo is org-less (it's the public
-- AskAna agent at bot_id 920c571b-...). It is RLS-enabled with no policies,
-- which denies all client-side access. The API route is the only path in.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mco_handoff_sessions (
  -- 6-char Crockford base32, ambiguity-free (no I/L/O/U). Stored uppercase.
  code              text PRIMARY KEY,
  bot_id            uuid NOT NULL,
  source_session_id text NOT NULL,
  -- Snapshot of the chat thread at handoff time: array of { role, content }
  messages          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS idx_mco_handoff_sessions_expires
  ON public.mco_handoff_sessions (expires_at);

-- RLS enabled but no policies — denies all client access. The API route
-- uses service-role to mediate every read and write.
ALTER TABLE public.mco_handoff_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mco_handoff_sessions IS
  'Kiosk → phone handoff for /demo/mco. Public code-gated handoff, no auth. 15-min TTL. Service-role only (no client policies). See docs/MCO_AGENT.md § Handoff.';

COMMIT;
