-- 044_pin_definer_search_path.sql
-- Pin search_path on the SECURITY DEFINER helpers used by RLS policies.
--
-- A SECURITY DEFINER function inherits the *caller's* search_path unless
-- explicitly pinned. A role that sets `search_path = malicious_schema, public`
-- could shadow the `users` / `organizations` references inside these
-- helpers and trick them into reading attacker-controlled tables. Pinning
-- search_path = public, pg_temp closes that vector.
--
-- The function bodies are unchanged; we just rebuild them with the
-- additional `SET search_path` clause. Apply via the linked CLI:
--   supabase db query --linked --file sql/044_pin_definer_search_path.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT client_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT org_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.organizations o ON o.id = u.org_id
    WHERE u.id = auth.uid() AND o.is_admin_org
  )
$$;

COMMIT;
