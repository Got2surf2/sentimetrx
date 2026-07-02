-- sql/147_schema_migrations.sql
-- Applied-migration ledger. The repo has ~146 hand-applied SQL files with no
-- record of which are applied where — "applied to prod but not committed" (or
-- vice-versa) has been undetectable. This table is the source of truth for what
-- has run against a database, recorded by scripts/apply-migration.ts on every
-- apply and diffed against sql/ by scripts/migrations-status.ts.
--
-- Populate historical rows once with `tsx scripts/migrations-status.ts --backfill`
-- (marks every current sql/ file applied). Additive; no behavioral effect.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename    text PRIMARY KEY,          -- e.g. '147_schema_migrations.sql'
  sha256      text NOT NULL,             -- hash of the file contents when applied
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text,                      -- who/what ran it (CI, an operator, 'backfill')
  note        text
);

COMMENT ON TABLE public.schema_migrations IS
  'Applied-migration ledger. One row per sql/ file that has run against this database. Written by scripts/apply-migration.ts.';

-- RLS: it holds no tenant data, but every public table must have RLS + a policy
-- (multi-tenancy invariant + test:rls). Platform admins read; only the service
-- role writes (no INSERT/UPDATE/DELETE policy = denied for the authenticated
-- client, allowed for service_role which bypasses RLS).
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY schema_migrations_admin_read
  ON public.schema_migrations
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());

COMMIT;
