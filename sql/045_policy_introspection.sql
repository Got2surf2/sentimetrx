-- 045_policy_introspection.sql
-- Helper RPC for tests/integration/rls-isolation.test.ts to read
-- pg_policies through the supabase-js client. Returns one row per
-- public-schema policy with its qual / with_check expression text.
--
-- The test asserts that no policy has `qual = 'true'` or
-- `with_check = 'true'` outside of an explicit allowlist. Catches the
-- regression class that migration 042 cleaned up — someone adding a
-- new `WITH CHECK (true)` policy and shipping it.

BEGIN;

CREATE OR REPLACE FUNCTION public.public_policy_qualifiers()
RETURNS TABLE (
  tablename  text,
  policyname text,
  qual       text,
  with_check text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT
    p.tablename::text,
    p.policyname::text,
    p.qual::text,
    p.with_check::text
  FROM pg_policies p
  WHERE p.schemaname = 'public'
$$;

-- Service-role only. The test connects as service_role.
REVOKE ALL ON FUNCTION public.public_policy_qualifiers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_policy_qualifiers() TO service_role;

COMMIT;
