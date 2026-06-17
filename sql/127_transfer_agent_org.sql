-- 127_transfer_agent_org.sql
-- ============================================================
-- Cascading agent org-transfer. Mirrors transfer_recording_org: moving an
-- agent to another org must carry EVERYTHING it owns, in one transaction —
-- otherwise the agent row moves but its conversations / turns / logged
-- questions / reviews / change-log / impressions / study cache are stranded
-- in the old org (the Sarina bug, 2026-06-17: agent in Arjun Pilots but 77
-- conversations + 17 questions + 505 turns left in Datanautix, so its history
-- was invisible from the new org).
--
-- The PATCH /api/bots/[id] transfer path calls this instead of a bare
-- `agents.org_id` update. Moves by bot_id regardless of each row's current
-- org, so it also REPAIRS an already-split agent (idempotent: re-running with
-- the same target is a no-op). `bots` / `bot_change_log` are security-invoker
-- VIEWS over agents / agent_change_log and reflect automatically — not touched.
--
-- NOTE: bot_knowledge_chunks has no org_id (scoped by bot_id only), so it
-- follows the agent with no update needed.
-- ============================================================

-- (Wrapped in BEGIN/COMMIT 2026-06-17 for the CI tx-wrap guard; already applied
--  to prod — CREATE OR REPLACE makes a re-run a no-op.)
BEGIN;

CREATE OR REPLACE FUNCTION public.transfer_agent_org(p_agent_id uuid, p_to_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_to_org IS NULL THEN
    RAISE EXCEPTION 'transfer_agent_org: target org is null';
  END IF;

  UPDATE agents              SET org_id = p_to_org WHERE id     = p_agent_id;
  UPDATE conversations       SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE conversation_turns  SET org_id = p_to_org
    WHERE conversation_id IN (SELECT id FROM conversations WHERE bot_id = p_agent_id);
  UPDATE logged_questions    SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE conversation_reviews SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_change_log    SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_impressions   SET org_id = p_to_org WHERE bot_id = p_agent_id;
  UPDATE agent_study_cache   SET org_id = p_to_org WHERE bot_id = p_agent_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_agent_org(uuid, uuid) TO service_role;

SELECT 'transfer_agent_org()' AS object, 'ready' AS status;

COMMIT;
