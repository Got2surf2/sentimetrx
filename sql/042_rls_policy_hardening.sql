-- 042_rls_policy_hardening.sql
-- Cleanups from the 2026-05-09 security review:
--
-- 1. sql/011_townhall.sql still references current_client_id() for the
--    townhall_sessions / townhall_themes / townhall_turns policies. That
--    function returns clients.id (legacy), but the townhall tables store
--    org_id (organizations.id). The two values don't match, so the
--    policies effectively never let anything through under the user's
--    JWT — they only "work" because the API uses the service role
--    client which bypasses RLS. Switch them to current_org_id() so the
--    user-token path is at least defensible defense-in-depth instead of
--    silently broken.
--
-- 2. Several INSERT policies were authored as `WITH CHECK (true)` with
--    a comment along the lines of "API validates ownership." That
--    leaves the door open to any role that doesn't bypass RLS (i.e. an
--    authed user with their own JWT) inserting whatever they want.
--    Service-role calls bypass RLS regardless, so we can safely drop
--    those policies — the "permissive insert for anon" is no longer
--    load-bearing because all real callers go through the service-role
--    client.

BEGIN;

-- ── 1. Townhall: replace legacy current_client_id() with current_org_id() ──

DROP POLICY IF EXISTS "townhall_sessions_select" ON townhall_sessions;
CREATE POLICY "townhall_sessions_select" ON townhall_sessions FOR SELECT
  USING (is_platform_admin() OR org_id = current_org_id());

DROP POLICY IF EXISTS "townhall_sessions_insert" ON townhall_sessions;
CREATE POLICY "townhall_sessions_insert" ON townhall_sessions FOR INSERT
  WITH CHECK (is_platform_admin() OR org_id = current_org_id());

DROP POLICY IF EXISTS "townhall_sessions_update" ON townhall_sessions;
CREATE POLICY "townhall_sessions_update" ON townhall_sessions FOR UPDATE
  USING (is_platform_admin() OR org_id = current_org_id());

DROP POLICY IF EXISTS "townhall_themes_select" ON townhall_themes;
CREATE POLICY "townhall_themes_select" ON townhall_themes FOR SELECT
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_org_id()
  ));

DROP POLICY IF EXISTS "townhall_themes_update" ON townhall_themes;
CREATE POLICY "townhall_themes_update" ON townhall_themes FOR UPDATE
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_org_id()
  ));

DROP POLICY IF EXISTS "townhall_turns_select" ON townhall_turns;
CREATE POLICY "townhall_turns_select" ON townhall_turns FOR SELECT
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_org_id()
  ));

-- ── 2. Drop unconditional INSERT policies. Service role bypasses RLS, so
--    nothing real depends on these; keeping them only weakens defense in
--    depth if a code path ever runs under the user's JWT instead.

DROP POLICY IF EXISTS "townhall_themes_insert" ON townhall_themes;
DROP POLICY IF EXISTS "townhall_turns_insert_public" ON townhall_turns;
DROP POLICY IF EXISTS "bot_turns_service_insert" ON bot_conversation_turns;
DROP POLICY IF EXISTS "bot_reviews_service_insert" ON bot_conversation_reviews;
DROP POLICY IF EXISTS "org_transfers_service_insert" ON org_transfers;
DROP POLICY IF EXISTS "send_log_insert" ON campaign_send_log;

COMMIT;
