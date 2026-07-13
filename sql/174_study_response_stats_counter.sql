-- sql/174_study_response_stats_counter.sql
-- Brief E item 4 (PERFORMANCE_REVIEW.md §7 / §1, "schedule last") — retire the
-- `study_response_stats` MATERIALIZED VIEW. Its `refresh_study_response_stats()`
-- does a full platform-wide GROUP BY over `responses`, debounced to one refresh
-- per 30s and fired from /api/respond + /api/studies/[id]/responses on every
-- submit. Trivial at today's ~191 responses; at 1M+ accumulated responses each
-- refresh is a multi-second whole-table scan re-run every 30s during a QR-burst,
-- competing for the exact I/O ingestion needs.
--
-- Replace with a per-study COUNTER TABLE maintained incrementally by an
-- AFTER INSERT/UPDATE/DELETE trigger on `responses` — O(1) per row, no scan.
-- Averages are kept as sum+count pairs (avg = sum/nullif(count,0)) so a single
-- response's edit updates the study's stats in constant time. Readers move to
-- the table; the MV is dropped; refresh_study_response_stats becomes a no-op
-- stub (deploy-window safety — the pre-deploy /api/respond still calls it until
-- the new code lands; those calls become harmless).
--
-- study_stats_for_ids (sql/036) is unchanged: it already aggregates `responses`
-- directly, bounded to the requested study ids (the dashboard fallback).

BEGIN;

-- ── 1. Counter table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_response_stats_live (
  study_id         uuid PRIMARY KEY REFERENCES studies(id) ON DELETE CASCADE,
  total_responses  bigint      NOT NULL DEFAULT 0,
  complete_count   bigint      NOT NULL DEFAULT 0,
  promoters        bigint      NOT NULL DEFAULT 0,
  passives         bigint      NOT NULL DEFAULT 0,
  detractors       bigint      NOT NULL DEFAULT 0,
  exp_sum          double precision NOT NULL DEFAULT 0,  -- Σ experience_score (non-null)
  exp_n            bigint      NOT NULL DEFAULT 0,        -- count(experience_score)
  nps_sum          double precision NOT NULL DEFAULT 0,
  nps_n            bigint      NOT NULL DEFAULT 0,
  last_response_at timestamptz
);

-- RLS + org-scoped SELECT (multi-tenancy invariant). Writes are via the
-- SECURITY DEFINER trigger (table owner → bypasses RLS); reads go through the
-- SECURITY DEFINER reader RPC (which org-filters), but the policy keeps a direct
-- authenticated read honest too.
ALTER TABLE study_response_stats_live ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS study_response_stats_live_org_select ON study_response_stats_live;
CREATE POLICY study_response_stats_live_org_select ON study_response_stats_live
  FOR SELECT TO authenticated
  USING (
    study_id IN (
      SELECT s.id FROM studies s
      WHERE s.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
         OR EXISTS (SELECT 1 FROM users u2 JOIN organizations o ON o.id = u2.org_id
                    WHERE u2.id = auth.uid() AND o.is_admin_org)
    )
  );
REVOKE ALL ON study_response_stats_live FROM anon;

-- ── 2. Signed-delta applier + trigger ────────────────────────────────────────
-- Applies one response row's contribution (p_sign = +1 insert / -1 delete) to a
-- study's counters via UPSERT. "complete" = status='complete' OR status IS NULL
-- and the sentiment buckets match the MV's FILTER predicates exactly.
CREATE OR REPLACE FUNCTION srs_apply_delta(
  p_study_id  uuid,
  p_sign      int,
  p_status    text,
  p_sentiment text,
  p_exp       int,
  p_nps       int,
  p_completed timestamptz
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_study_id IS NULL THEN RETURN; END IF;
  INSERT INTO study_response_stats_live AS s (
    study_id, total_responses, complete_count, promoters, passives, detractors,
    exp_sum, exp_n, nps_sum, nps_n, last_response_at
  ) VALUES (
    p_study_id,
    p_sign,
    p_sign * (CASE WHEN p_status = 'complete' OR p_status IS NULL THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('positive', 'promoter')  THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('neutral',  'passive')   THEN 1 ELSE 0 END),
    p_sign * (CASE WHEN p_sentiment IN ('negative', 'detractor') THEN 1 ELSE 0 END),
    p_sign * COALESCE(p_exp, 0),  p_sign * (CASE WHEN p_exp IS NOT NULL THEN 1 ELSE 0 END),
    p_sign * COALESCE(p_nps, 0),  p_sign * (CASE WHEN p_nps IS NOT NULL THEN 1 ELSE 0 END),
    CASE WHEN p_sign > 0 THEN p_completed ELSE NULL END
  )
  ON CONFLICT (study_id) DO UPDATE SET
    total_responses  = s.total_responses  + EXCLUDED.total_responses,
    complete_count   = s.complete_count   + EXCLUDED.complete_count,
    promoters        = s.promoters        + EXCLUDED.promoters,
    passives         = s.passives         + EXCLUDED.passives,
    detractors       = s.detractors       + EXCLUDED.detractors,
    exp_sum          = s.exp_sum          + EXCLUDED.exp_sum,
    exp_n            = s.exp_n            + EXCLUDED.exp_n,
    nps_sum          = s.nps_sum          + EXCLUDED.nps_sum,
    nps_n            = s.nps_n            + EXCLUDED.nps_n,
    -- last_response_at only advances on inserts (a delete can't cheaply
    -- recompute the max without a scan — acceptable staleness for a rare event).
    last_response_at = CASE WHEN p_sign > 0
                         THEN GREATEST(s.last_response_at, p_completed)
                         ELSE s.last_response_at END;
END;
$$;

CREATE OR REPLACE FUNCTION trg_study_response_stats()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM srs_apply_delta(NEW.study_id, 1, NEW.status, NEW.sentiment, NEW.experience_score, NEW.nps_score, NEW.completed_at);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM srs_apply_delta(OLD.study_id, -1, OLD.status, OLD.sentiment, OLD.experience_score, OLD.nps_score, OLD.completed_at);
  ELSE -- UPDATE: reverse OLD, apply NEW (handles a study_id change too)
    PERFORM srs_apply_delta(OLD.study_id, -1, OLD.status, OLD.sentiment, OLD.experience_score, OLD.nps_score, OLD.completed_at);
    PERFORM srs_apply_delta(NEW.study_id, 1, NEW.status, NEW.sentiment, NEW.experience_score, NEW.nps_score, NEW.completed_at);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS study_response_stats_maintain ON responses;
CREATE TRIGGER study_response_stats_maintain
  AFTER INSERT OR UPDATE OR DELETE ON responses
  FOR EACH ROW EXECUTE FUNCTION trg_study_response_stats();

-- ── 3. Backfill from the current responses (one-time) ────────────────────────
TRUNCATE study_response_stats_live;
INSERT INTO study_response_stats_live (
  study_id, total_responses, complete_count, promoters, passives, detractors,
  exp_sum, exp_n, nps_sum, nps_n, last_response_at
)
SELECT
  study_id,
  count(*),
  count(*) FILTER (WHERE status = 'complete' OR status IS NULL),
  count(*) FILTER (WHERE sentiment IN ('positive', 'promoter')),
  count(*) FILTER (WHERE sentiment IN ('neutral',  'passive')),
  count(*) FILTER (WHERE sentiment IN ('negative', 'detractor')),
  COALESCE(sum(experience_score) FILTER (WHERE experience_score IS NOT NULL), 0),
  count(experience_score),
  COALESCE(sum(nps_score) FILTER (WHERE nps_score IS NOT NULL), 0),
  count(nps_score),
  max(completed_at)
FROM responses
WHERE study_id IS NOT NULL
GROUP BY study_id;

-- ── 4. Repoint the reader RPC to the counter table ──────────────────────────
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
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT srs.study_id, srs.total_responses, srs.complete_count,
         srs.promoters, srs.passives, srs.detractors,
         srs.exp_sum / NULLIF(srs.exp_n, 0) AS avg_experience,
         srs.nps_sum / NULLIF(srs.nps_n, 0) AS avg_nps,
         srs.last_response_at
  FROM study_response_stats_live srs
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

-- ── 5. Drop the MV; stub the refresh fn (deploy-window safe no-op) ───────────
DROP MATERIALIZED VIEW IF EXISTS study_response_stats;

CREATE OR REPLACE FUNCTION refresh_study_response_stats()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- No-op since sql/174: study_response_stats_live is maintained live by the
  -- responses trigger. Retained as a stub so any lingering caller (the
  -- pre-deploy /api/respond) is harmless; safe to drop once no caller remains.
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION srs_apply_delta(uuid, int, text, text, int, int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION srs_apply_delta(uuid, int, text, text, int, int, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_study_response_stats_for_user(uuid[]) TO authenticated, service_role;

COMMIT;
