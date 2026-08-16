-- sql/190_secdef_lockdown.sql
-- Lock every SECURITY DEFINER function in `public` to service_role.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE BUG (found 2026-08-16, sql/189 fixed the first two instances)
--
-- Postgres grants EXECUTE to PUBLIC on a new function BY DEFAULT, and Supabase's
-- `anon` / `authenticated` roles inherit PUBLIC. PostgREST then publishes every
-- function `anon` can execute as `POST /rest/v1/rpc/<name>`. A SECURITY DEFINER
-- function runs as its owner, so RLS DOES NOT APPLY to anything it reads. And
-- the anon key is not a secret — it ships in every browser bundle.
--
-- Net effect: most of our SECURITY DEFINER helpers were unauthenticated,
-- un-org-scoped public endpoints. Verified on TEST with nothing but the anon key
-- and a dataset id belonging to another org: `dataset_rows_with_text_count`
-- returned a live row count and `dataset_rows_pending_field_taxonomy` returned a
-- FULL RAW ROW — review text, author name, location, rating.
--
-- Before this migration: 85 SECURITY DEFINER functions in `public`, 48 of them
-- anon-executable, 30 of those reading `dataset_rows_flat` — including a WRITE
-- (`apply_taxonomy_verdicts`), destructive ops (`archive_dataset`,
-- `restore_dataset`), cross-org mutations (`transfer_recording_org`,
-- `transfer_agent_org`), an email→user-id oracle (`get_auth_user_id_by_email`),
-- and raw-row readers (`get_rows_by_filters`, `search_dataset_rows`,
-- `taxonomy_drill_rows`, `taxonomy_rows_for_field`, `sample_row_pairs`).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A BLANKET REVOKE IS SAFE HERE (the audit behind this migration)
--
-- 1. The app makes ZERO browser-side RPC calls — no `.rpc(` in any `'use
--    client'` module. Everything goes through /api/* handlers.
-- 2. Every server-side `.rpc(` call but three uses `createServiceRoleClient()`.
--    The three exceptions all live on the cookie-auth client:
--      - lib/rateLimit.ts `check_rate_limit`  → actually service-role, re-checked
--      - app/dashboard/page.tsx `get_study_response_stats_for_user`
--      - app/dashboard/page.tsx `study_stats_for_ids`
--    The last two are KEPT executable by `authenticated` (see below).
-- 3. RLS POLICY PREDICATES ARE THE REAL LANDMINE: a function called inside a
--    policy's USING/WITH CHECK runs as the *querying* role, so revoking EXECUTE
--    from `authenticated` would make every policy using it fail — locking the
--    whole app out. Catalog scan of pg_policy found exactly three:
--      is_platform_admin (42 policies), current_org_id (31), current_client_id (1).
--    All three are EXCLUDED and left byte-for-byte alone. They are self-contained
--    (auth.uid() + a users/organizations read), so there is no indirect exposure.
-- 4. Trigger functions are excluded (`prorettype <> trigger`): PostgREST cannot
--    expose them and EXECUTE is not re-checked when a trigger fires.
-- 5. Cross-reference scan: no SECURITY INVOKER function calls a target. The only
--    inner call found — set_brand_collection_id → find_or_create_brand_collection
--    — is insulated because the caller is itself SECURITY DEFINER.
--
-- The loop below is catalog-driven rather than a hand-typed list of 43
-- signatures on purpose: a typo in a hand-written signature is the one failure
-- mode that could silently leave a hole open. Re-run the same SELECT after
-- applying to confirm the end state.
--
-- Idempotent: it re-asserts the grants on functions already locked down
-- (sql/180, sql/189), so the end state is deterministic regardless of history.
-- Deploy-order safe: no application code changes with this.

BEGIN;

DO $lockdown$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.prokind  = 'f'                       -- skip aggregates (public.avg/sum)
       AND p.prosecdef                            -- SECURITY DEFINER only
       AND p.prorettype <> 'trigger'::regtype     -- triggers aren't RPC-exposed
       AND p.proname NOT IN (
         -- RLS policy predicates — revoking these locks the app out entirely.
         'is_platform_admin', 'current_org_id', 'current_client_id',
         -- Called on the cookie-auth client from app/dashboard/page.tsx; both
         -- keep `authenticated` and are re-granted explicitly below.
         'get_study_response_stats_for_user', 'study_stats_for_ids'
       )
     ORDER BY 1
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'sql/190: locked % SECURITY DEFINER function(s) to service_role', n;
END
$lockdown$;

-- ── The two dashboard RPCs: drop anon, keep authenticated ───────────────────
-- Both are called with the caller's own JWT from the studies dashboard, so they
-- must stay executable by `authenticated`. That is only safe if the function
-- scopes to the caller's org ITSELF — `authenticated` is every tenant, not just
-- this one.

-- get_study_response_stats_for_user already does (org match + admin-org bypass).
REVOKE ALL ON FUNCTION get_study_response_stats_for_user(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_study_response_stats_for_user(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION get_study_response_stats_for_user(uuid[]) TO authenticated, service_role;

-- study_stats_for_ids did NOT: it is SECURITY DEFINER over `responses` and took
-- arbitrary study ids with no filter whatsoever, so any logged-in user of ANY
-- tenant could read another org's response counts, NPS split, sentiment
-- breakdown and last-response time by guessing/collecting study UUIDs. Its only
-- caller (the dashboard fallback) always passes ids the user already owns, so
-- adding the same filter its sibling uses is a no-op for legitimate traffic.
CREATE OR REPLACE FUNCTION study_stats_for_ids(p_study_ids uuid[])
RETURNS TABLE(study_id uuid, total_responses bigint, complete_count bigint,
              promoters bigint, passives bigint, detractors bigint,
              avg_experience double precision, avg_nps double precision,
              last_response_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.study_id,
         count(*)::bigint,
         count(*) FILTER (WHERE r.status = 'complete' OR r.status IS NULL)::bigint,
         count(*) FILTER (WHERE r.sentiment IN ('positive', 'promoter'))::bigint,
         count(*) FILTER (WHERE r.sentiment IN ('neutral',  'passive' ))::bigint,
         count(*) FILTER (WHERE r.sentiment IN ('negative', 'detractor'))::bigint,
         avg(r.experience_score) FILTER (WHERE r.experience_score IS NOT NULL),
         avg(r.nps_score)        FILTER (WHERE r.nps_score        IS NOT NULL),
         max(r.completed_at)
    FROM responses r
   WHERE r.study_id = ANY(p_study_ids)
     -- sql/190: same org gate as get_study_response_stats_for_user. Under the
     -- service role auth.uid() is NULL and no study matches, which is correct —
     -- this function has no service-role caller, and a future one should use
     -- an explicitly org-gated path rather than inherit a silent bypass.
     AND r.study_id IN (
       SELECT s.id FROM studies s
        WHERE s.org_id = (SELECT u.org_id FROM users u WHERE u.id = auth.uid())
           OR EXISTS (
             SELECT 1 FROM users u2
               JOIN organizations o ON o.id = u2.org_id
              WHERE u2.id = auth.uid() AND o.is_admin_org
           )
     )
   GROUP BY r.study_id;
$$;

COMMENT ON FUNCTION study_stats_for_ids(uuid[]) IS
  'Per-study response aggregates for the studies dashboard fallback. sql/190 added the caller-org filter (it previously accepted ANY study id from ANY authenticated tenant) and dropped anon EXECUTE.';

REVOKE ALL ON FUNCTION study_stats_for_ids(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION study_stats_for_ids(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION study_stats_for_ids(uuid[]) TO authenticated, service_role;

COMMIT;

-- Verify the end state (should return zero rows):
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
--    WHERE ns.nspname='public' AND p.prokind='f' AND p.prosecdef
--      AND p.prorettype <> 'trigger'::regtype
--      AND has_function_privilege('anon', p.oid, 'EXECUTE')
--      AND p.proname NOT IN ('is_platform_admin','current_org_id','current_client_id');
