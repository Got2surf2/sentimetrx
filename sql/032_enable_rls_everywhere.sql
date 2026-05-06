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
-- 0. Drop pre-existing permissive policies that mistakenly use USING (true)
-- ============================================================
-- Several earlier migrations (phase4/7/8, 013, 023, 025, 030) created
-- policies labeled "Service role full access" or similar with USING (true).
-- USING (true) is permissive for EVERY role — including anon — not just the
-- service role. Service role already bypasses RLS automatically (it has the
-- BYPASSRLS attribute in Supabase), so these policies aren't needed; they
-- were the actual cause of the public-data leak that triggered this
-- migration. Dropping them returns the table to default-deny for all
-- non-service-role queries.
--
-- The invites_public_read policy on `invites` is INTENTIONAL — invitees
-- have no account when they first follow the link, so SELECT must be
-- public. Keeping it.

DROP POLICY IF EXISTS "Service role full access on dataset_rows_flat"      ON public.dataset_rows_flat;
DROP POLICY IF EXISTS "Service role full access on review_sources"         ON public.review_sources;
DROP POLICY IF EXISTS "Service role full access on review_source_locations" ON public.review_source_locations;
DROP POLICY IF EXISTS "Service role full access on user_locations"         ON public.user_locations;
DROP POLICY IF EXISTS "Service role full access on reddit_sources"         ON public.reddit_sources;
DROP POLICY IF EXISTS "Service role full access on reddit_source_threads"  ON public.reddit_source_threads;
DROP POLICY IF EXISTS "th_responses_service_all"                            ON public.townhall_participant_responses;
DROP POLICY IF EXISTS "service_all"                                         ON public.bot_knowledge_chunks;
DROP POLICY IF EXISTS "persona_service_write"                               ON public.bot_session_personas;
DROP POLICY IF EXISTS "usage_logs_service_write"                            ON public.usage_logs;

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

-- Materialized views cannot have RLS until Postgres 17. As a stand-in,
-- REVOKE SELECT from the anon role so anonymous callers can't read the MV.
-- Authenticated users can still read it; the dashboard's auth-client query
-- is `.from('study_response_stats').select('*').in('study_id', studyIds)`
-- where studyIds come from the (RLS-protected) studies table, so a user
-- only ever asks for their own org's study_ids. Cross-org enumeration is
-- theoretical only since study IDs are random UUIDs.
-- TODO: replace direct MV read with a SECURITY DEFINER RPC for full isolation.
REVOKE ALL ON public.study_response_stats FROM anon;

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

-- (study_response_stats: handled via REVOKE above; cannot have RLS as MV in pg15)

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
