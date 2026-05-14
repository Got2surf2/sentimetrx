-- sql/067_review_download_limits.sql
-- Review-download accounting + opt-in per-org monthly record caps.
--
-- Context: during the Darden pilot we're absorbing the DataForSEO cost of
-- review downloads, so we need (a) a ledger of how many review records each
-- org has pulled, and (b) an opt-in monthly cap that hard-stops further
-- downloads once hit. Scope: Google + Tripadvisor review sources — the only
-- paid review-download path.
--
-- The cap also doubles as a "sampling" mechanism. lib/reviewSync.ts requests
-- DataForSEO tasks newest-first, so when an org's remaining monthly budget
-- caps a task's depth, it pulls the N most-recent reviews rather than the
-- full back-catalogue.

-- ============================================================
-- 1. organizations.limits — opt-in per-org limits
-- ============================================================
-- Empty {} = unlimited (the default for every existing org). Only pilot
-- orgs get a value, so this is a no-op for everyone else.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.limits IS
  'Opt-in per-org limits. Key: review_records_monthly (int) = max review records downloadable per calendar month across Google + Tripadvisor. Empty {} = unlimited.';

-- ============================================================
-- 2. review_downloads — append-only download ledger
-- ============================================================
-- One row per sync call that actually ingested review rows. Doubles as the
-- billing record and the monthly-cap counter (sum of `records` for the org
-- since the start of the calendar month).
CREATE TABLE IF NOT EXISTS public.review_downloads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_source_id uuid REFERENCES public.review_sources(id) ON DELETE SET NULL,
  dataset_id       uuid REFERENCES public.datasets(id) ON DELETE SET NULL,
  source           text NOT NULL DEFAULT 'google'
                     CHECK (source IN ('google', 'tripadvisor')),
  records          int  NOT NULL DEFAULT 0,   -- review records ingested this sync
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Monthly-usage rollup read path: sum(records) for an org since month start.
CREATE INDEX IF NOT EXISTS review_downloads_org_created_idx
  ON public.review_downloads (org_id, created_at DESC);

COMMENT ON TABLE public.review_downloads IS
  'Append-only ledger of review-record downloads (Google + Tripadvisor). One row per sync that ingested rows. Doubles as billing record + monthly-cap counter. Written by lib/reviewSync.ts via the service role.';

-- ============================================================
-- 3. Grants — service-role only (writes + reads go through API routes)
-- ============================================================
GRANT SELECT, INSERT ON public.review_downloads TO service_role;

-- ============================================================
-- 4. RLS — enabled + org-scoped SELECT policy
-- ============================================================
-- Service-role (every API route) bypasses RLS, so the ledger writes in
-- reviewSync keep working. The SELECT policy mirrors the canonical pattern
-- from 032_enable_rls_everywhere so an org member could read their own
-- download history directly if a future auth-client read needs it.
ALTER TABLE public.review_downloads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members read review_downloads" ON public.review_downloads;
CREATE POLICY "org members read review_downloads" ON public.review_downloads
  FOR SELECT
  USING (org_id IN (SELECT org_id FROM public.users WHERE id = auth.uid()));

-- ============================================================
-- Verify
-- ============================================================
SELECT 'organizations.limits column' AS object, 'ready' AS status
UNION ALL SELECT 'review_downloads table',        'ready'
UNION ALL SELECT 'review_downloads index',        'ready'
UNION ALL SELECT 'RLS + SELECT policy',           'ready';
