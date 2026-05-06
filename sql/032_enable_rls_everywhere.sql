-- 032_enable_rls_everywhere.sql
--
-- Enable Row-Level Security on every table in the public schema and add
-- SELECT policies for tables read via the Supabase auth client (i.e. from a
-- logged-in user context, not the service role). All API routes use the
-- service role for writes — service role bypasses RLS, so writes keep
-- working without policies.
--
-- Run order:
--   1. Enable RLS on all public tables (idempotent — re-running is safe).
--   2. Add SELECT policies for the 13 tables the auth client actually reads:
--        users, organizations, studies, responses, datasets,
--        dataset_rows_flat, dataset_state, campaigns, bots,
--        collections, collection_members, townhall_sessions,
--        townhall_themes, townhall_turns, study_response_stats
--   3. Tables not listed above stay RLS-enabled but policy-less: only the
--      service role (and Supabase's internal admin tools) can read them.
--
-- Why this is safe to apply on a running production app:
--   - Every API route uses createServiceRoleClient() for data access; the
--     service role bypasses RLS entirely.
--   - Auth-client queries (anything via createClient() + supabase.from(...))
--     are only used to look up the current user's row, their org, and the
--     org-scoped objects they're allowed to see.
--   - Anon queries (no auth) are blocked everywhere.

-- ============================================================
-- 1. Enable RLS on every table in public schema (idempotent loop)
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) ||
            ' ENABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;

-- Also enable on the materialized view (pg 15+ supports this).
ALTER MATERIALIZED VIEW IF EXISTS public.study_response_stats ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. SELECT policies for auth-client-read tables
-- ============================================================
-- Each policy uses (SELECT org_id FROM users WHERE id = auth.uid()) to fetch
-- the calling user's org_id. Wrapped in a SELECT to avoid recursive policy
-- evaluation when the target table is `users` itself.

-- ── users: a user can read their own row ────────────────────
DROP POLICY IF EXISTS "user reads own row" ON public.users;
CREATE POLICY "user reads own row" ON public.users
  FOR SELECT
  USING (id = auth.uid());

-- ── organizations: read orgs the user belongs to ────────────
DROP POLICY IF EXISTS "user reads own org" ON public.organizations;
CREATE POLICY "user reads own org" ON public.organizations
  FOR SELECT
  USING (id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── studies: org-scoped ─────────────────────────────────────
DROP POLICY IF EXISTS "org members read studies" ON public.studies;
CREATE POLICY "org members read studies" ON public.studies
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── responses: org-scoped via study ─────────────────────────
DROP POLICY IF EXISTS "org members read responses" ON public.responses;
CREATE POLICY "org members read responses" ON public.responses
  FOR SELECT
  USING (study_id IN (
    SELECT id FROM public.studies
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── datasets: org-scoped ────────────────────────────────────
DROP POLICY IF EXISTS "org members read datasets" ON public.datasets;
CREATE POLICY "org members read datasets" ON public.datasets
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── dataset_rows_flat: org-scoped via dataset ───────────────
DROP POLICY IF EXISTS "org members read dataset_rows_flat" ON public.dataset_rows_flat;
CREATE POLICY "org members read dataset_rows_flat" ON public.dataset_rows_flat
  FOR SELECT
  USING (dataset_id IN (
    SELECT id FROM public.datasets
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── dataset_state: org-scoped via dataset ───────────────────
DROP POLICY IF EXISTS "org members read dataset_state" ON public.dataset_state;
CREATE POLICY "org members read dataset_state" ON public.dataset_state
  FOR SELECT
  USING (dataset_id IN (
    SELECT id FROM public.datasets
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── campaigns: org-scoped ───────────────────────────────────
DROP POLICY IF EXISTS "org members read campaigns" ON public.campaigns;
CREATE POLICY "org members read campaigns" ON public.campaigns
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── bots: org-scoped ────────────────────────────────────────
DROP POLICY IF EXISTS "org members read bots" ON public.bots;
CREATE POLICY "org members read bots" ON public.bots
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── collections: org-scoped (collections.dataset_id → datasets.org_id)
-- collections are dataset-shaped (the wrapper dataset is org-scoped already).
DROP POLICY IF EXISTS "org members read collections" ON public.collections;
CREATE POLICY "org members read collections" ON public.collections
  FOR SELECT
  USING (dataset_id IN (
    SELECT id FROM public.datasets
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── collection_members: org-scoped via collection's wrapper dataset ──
DROP POLICY IF EXISTS "org members read collection_members" ON public.collection_members;
CREATE POLICY "org members read collection_members" ON public.collection_members
  FOR SELECT
  USING (collection_id IN (
    SELECT c.id FROM public.collections c
    JOIN public.datasets d ON d.id = c.dataset_id
    WHERE d.org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── townhall_sessions: org-scoped ───────────────────────────
DROP POLICY IF EXISTS "org members read townhall_sessions" ON public.townhall_sessions;
CREATE POLICY "org members read townhall_sessions" ON public.townhall_sessions
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ── townhall_themes: org-scoped via session ─────────────────
DROP POLICY IF EXISTS "org members read townhall_themes" ON public.townhall_themes;
CREATE POLICY "org members read townhall_themes" ON public.townhall_themes
  FOR SELECT
  USING (session_id IN (
    SELECT id FROM public.townhall_sessions
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── townhall_turns: org-scoped via session ──────────────────
DROP POLICY IF EXISTS "org members read townhall_turns" ON public.townhall_turns;
CREATE POLICY "org members read townhall_turns" ON public.townhall_turns
  FOR SELECT
  USING (session_id IN (
    SELECT id FROM public.townhall_sessions
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ── study_response_stats (MV): org-scoped via study ─────────
-- Materialized views support RLS in pg15+. If your Postgres version errors
-- on this CREATE POLICY, ALTER MATERIALIZED VIEW DISABLE RLS as a fallback.
DROP POLICY IF EXISTS "org members read study_response_stats" ON public.study_response_stats;
CREATE POLICY "org members read study_response_stats" ON public.study_response_stats
  FOR SELECT
  USING (study_id IN (
    SELECT id FROM public.studies
    WHERE org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid())
  ));

-- ============================================================
-- 3. Verification helper (run manually after applying)
-- ============================================================
-- Confirm every public table has RLS enabled:
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
-- Should show rowsecurity=t for every row.
--
-- Confirm anon cannot read anything (run in SQL editor as anon role):
--   SET LOCAL ROLE anon;
--   SELECT count(*) FROM dataset_rows_flat;  -- should be 0 (was 107k+)
--   RESET ROLE;
