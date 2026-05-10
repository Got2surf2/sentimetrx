-- 046_users_auth_fk.sql
-- Make the public.users.id → auth.users.id invariant DB-enforced.
--
-- Background: sql/001_schema.sql declares public.users.id as a PRIMARY KEY
-- with a comment "MUST match auth.users.id exactly," but no FOREIGN KEY ever
-- existed. The invariant has only been enforced by application code (the
-- invite flow inserts a public.users row whose id is the createUser response
-- id). The 2026-05-10 auth-flows test surfaced this — a public.users insert
-- with a fabricated UUID succeeded.
--
-- ON DELETE CASCADE matches the de-facto behaviour: if an auth user is
-- removed, their public.users row should go with them. A pre-flight orphan
-- check ran clean before this migration was authored (2026-05-10).

BEGIN;

-- Defensive: refuse to add the FK if any orphan rows exist. Without this,
-- the ALTER would fail with a less obvious message; we'd rather raise on
-- our own terms.
DO $$
DECLARE
  orphan_count int;
BEGIN
  SELECT count(*) INTO orphan_count
  FROM public.users u
  WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.id);
  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'Cannot add users.id FK: % orphan public.users rows exist (no matching auth.users row). Investigate and clean up before re-running.', orphan_count;
  END IF;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

COMMIT;
