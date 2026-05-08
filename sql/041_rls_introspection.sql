-- 041: RLS introspection helper
--
-- Returns RLS-enabled state for every base table in the public schema.
-- Used by tests/integration/rls-isolation.test.ts to fail-fast if a new
-- table is added without RLS — the single biggest multi-tenancy risk.
--
-- SECURITY DEFINER lets the function read pg_class without granting the
-- service_role direct catalog access. The result has no privacy
-- implications (just relname + relrowsecurity for every table).
--
-- Apply via the production Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public_tables_rls_status()
RETURNS TABLE(table_name text, rls_enabled boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT c.relname::text, c.relrowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relname;
$$;

REVOKE ALL ON FUNCTION public_tables_rls_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public_tables_rls_status() TO service_role;
