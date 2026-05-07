-- 036: study_stats_for_ids RPC
--
-- Replaces the per-study Promise.all count queries in
-- app/dashboard/page.tsx (the fallback path used when the
-- study_response_stats materialized view is empty/stale for
-- the requested ids). Single grouped aggregate, one round trip.
--
-- Apply via Supabase SQL Editor (staging + prod).

CREATE OR REPLACE FUNCTION study_stats_for_ids(p_study_ids uuid[])
RETURNS TABLE(
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
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.study_id,
    count(*)::bigint AS total_responses,
    count(*) FILTER (WHERE r.status = 'complete' OR r.status IS NULL)::bigint AS complete_count,
    count(*) FILTER (WHERE r.sentiment IN ('positive', 'promoter'))::bigint AS promoters,
    count(*) FILTER (WHERE r.sentiment IN ('neutral',  'passive' ))::bigint AS passives,
    count(*) FILTER (WHERE r.sentiment IN ('negative', 'detractor'))::bigint AS detractors,
    avg(r.experience_score) FILTER (WHERE r.experience_score IS NOT NULL) AS avg_experience,
    avg(r.nps_score)        FILTER (WHERE r.nps_score        IS NOT NULL) AS avg_nps,
    max(r.completed_at) AS last_response_at
  FROM responses r
  WHERE r.study_id = ANY(p_study_ids)
  GROUP BY r.study_id;
$$;

REVOKE ALL ON FUNCTION study_stats_for_ids(uuid[]) FROM public;
GRANT  EXECUTE ON FUNCTION study_stats_for_ids(uuid[]) TO authenticated, service_role;
