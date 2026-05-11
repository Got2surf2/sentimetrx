-- 047 — Look up auth.users.id by email from a service-role caller.
--
-- Why: /api/invite/register needs to handle the case where the invited
-- email already exists in auth.users (from an earlier signup, manual
-- creation, or aborted prior invite) but has no corresponding row in
-- public.users. In that case we must NOT call auth.admin.createUser
-- (which 422s "already registered") — we should reuse the existing
-- auth.users.id and just insert the missing public.users row.
--
-- The Supabase JS admin SDK exposes no `getUserByEmail` filter, only
-- paginated listUsers(). For instances with thousands of auth users
-- iterating all pages is wasteful; this function is a single indexed
-- lookup. SECURITY DEFINER + restricted EXECUTE so only service_role
-- can call it (anon/authenticated must not be able to enumerate emails).

CREATE OR REPLACE FUNCTION public.get_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_auth_user_id_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_id_by_email(text) TO service_role;
