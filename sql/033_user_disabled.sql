-- 033_user_disabled.sql
-- Add a per-user "disabled" flag so admins can suspend access without
-- deleting the user record (preserves audit trail of their work).
--
-- Disable mechanism:
-- - public.users.disabled is the canonical flag the app reads.
-- - The API endpoint that toggles this also updates auth.users.banned_until
--   via the Supabase admin API so new login attempts are rejected at the
--   auth layer immediately. Existing JWT sessions continue working until
--   they naturally expire (typically 1 hour) — acceptable for v1.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS disabled BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_disabled ON public.users(disabled) WHERE disabled = true;
