-- 037: org_stats_for_ids RPC
--
-- Replaces the per-org Promise.all loop in
-- app/api/admin/clients/route.ts which fans out 3 queries × N orgs.
-- At ~50 orgs that's 150 round trips. New RPC is one round trip
-- returning user_count / study_count / response_count per org.
--
-- Restricted to service_role: the only caller is /api/admin/clients
-- which uses createServiceRoleClient() after gating on is_admin_org.
--
-- Apply via Supabase SQL Editor (staging + prod).

CREATE OR REPLACE FUNCTION org_stats_for_ids(p_org_ids uuid[])
RETURNS TABLE(
  org_id          uuid,
  user_count      bigint,
  study_count     bigint,
  response_count  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ids AS (
    SELECT unnest(p_org_ids) AS org_id
  ),
  uc AS (
    SELECT u.org_id, count(*)::bigint AS cnt
    FROM users u
    WHERE u.org_id = ANY(p_org_ids)
    GROUP BY u.org_id
  ),
  sc AS (
    SELECT s.org_id, count(*)::bigint AS cnt
    FROM studies s
    WHERE s.org_id = ANY(p_org_ids)
    GROUP BY s.org_id
  ),
  rc AS (
    SELECT s.org_id, count(*)::bigint AS cnt
    FROM responses r
    JOIN studies s ON s.id = r.study_id
    WHERE s.org_id = ANY(p_org_ids)
    GROUP BY s.org_id
  )
  SELECT
    ids.org_id,
    COALESCE(uc.cnt, 0) AS user_count,
    COALESCE(sc.cnt, 0) AS study_count,
    COALESCE(rc.cnt, 0) AS response_count
  FROM ids
  LEFT JOIN uc ON uc.org_id = ids.org_id
  LEFT JOIN sc ON sc.org_id = ids.org_id
  LEFT JOIN rc ON rc.org_id = ids.org_id;
$$;

REVOKE ALL ON FUNCTION org_stats_for_ids(uuid[]) FROM public;
GRANT  EXECUTE ON FUNCTION org_stats_for_ids(uuid[]) TO service_role;
