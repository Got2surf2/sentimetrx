-- 043_study_response_stats_definer.sql
-- Replace direct authenticated-role read of the study_response_stats
-- materialized view with a SECURITY DEFINER function that filters to
-- the caller's org. Postgres < 17 can't put RLS on a materialized view,
-- so until then the alternative is to wrap access in a function that
-- enforces the org filter itself.
--
-- Before: authenticated could `SELECT * FROM study_response_stats` and
-- enumerate stats for every org's studies (UUID secrecy was the only
-- protection — fine in practice, brittle in principle).
-- After: authenticated has no direct grant; the helper RPC returns
-- only rows whose study_id belongs to a study in the caller's org.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_study_response_stats_for_user(p_study_ids uuid[])
RETURNS TABLE (
  study_id          uuid,
  total_responses   bigint,
  complete_count    bigint,
  promoters         bigint,
  passives          bigint,
  detractors        bigint,
  avg_experience    double precision,
  avg_nps           double precision,
  last_response_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
-- Pin search_path so the body resolves `studies`, `users`, etc. against
-- the public schema even when the caller has set a custom search_path.
SET search_path = public, pg_temp
AS $$
  SELECT srs.study_id, srs.total_responses, srs.complete_count,
         srs.promoters, srs.passives, srs.detractors,
         srs.avg_experience, srs.avg_nps, srs.last_response_at
  FROM study_response_stats srs
  WHERE srs.study_id = ANY(p_study_ids)
    AND srs.study_id IN (
      SELECT s.id FROM studies s
      WHERE s.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
         OR EXISTS (
           SELECT 1 FROM users u2 JOIN organizations o ON o.id = u2.org_id
           WHERE u2.id = auth.uid() AND o.is_admin_org
         )
    );
$$;

-- Grant execute to authenticated; the function itself enforces org scope.
GRANT EXECUTE ON FUNCTION public.get_study_response_stats_for_user(uuid[]) TO authenticated;

-- Lock down the materialized view so callers must use the RPC. anon was
-- already revoked in 032; revoke authenticated now too.
REVOKE ALL ON public.study_response_stats FROM authenticated;

COMMIT;
