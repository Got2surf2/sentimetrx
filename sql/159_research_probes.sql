-- sql/159_research_probes.sql
-- Research Probes (BOTS.md §14) — in-conversation market research.
-- Substrate only: probe library on agents, outcome-accounted responses table,
-- and an atomic answered-quota counter (the sql/154 pattern — never re-count
-- the responses table per turn).
--
-- Every *assignment* resolves to exactly one outcome (asked_answered /
-- asked_declined / asked_ignored / never_fit / quota_closed) so response and
-- decline rates are first-class data, not survivor bias.

BEGIN;

-- Probe library rides the agent row (same pattern as focuses/intents).
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS research_probes jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN agents.research_probes IS
  'Research-probe library (BOTS.md §14.4): [{id, version, construct, mode: verbatim|concept, question, answer_schema, follow_up, tag_hooks, eligibility{min_user_turns, sentiment_gate, topic_triggers, topic_exclusions, channels}, sampling{sample_pct, target_n, cooldown_days, field_start, field_end}, enabled}]. Any wording change MUST bump version. While any probe is enabled the public widget shows the §14.3 disclosure line.';

-- One row per (session, probe) assignment outcome.
CREATE TABLE IF NOT EXISTS agent_probe_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  agent_id       uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  session_id     text NOT NULL,
  probe_id       text NOT NULL,
  probe_version  integer NOT NULL,
  outcome        text NOT NULL CHECK (outcome IN
                   ('asked_answered','asked_declined','asked_ignored','never_fit','quota_closed')),
  asked_wording  text,                -- exact question text as delivered (null unless asked)
  asked_turn     integer,             -- user-turn count at ask time
  ask_context    jsonb,               -- { preceding_topic, rolling_sentiment, channel }
  answer_text    text,                -- verbatim user answer (null unless answered)
  followup_text  text,                -- the one allowed follow-up's answer, if used
  coded          jsonb,               -- { yes_no?, scale?, emotion_flags?, confidence } — Ana coding
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, session_id, probe_id)
);

CREATE INDEX IF NOT EXISTS idx_apr_analytics
  ON agent_probe_responses (org_id, agent_id, probe_id, probe_version, outcome);

ALTER TABLE agent_probe_responses ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT (mirrors question_batches: org via users.org_id). No write
-- policy → RLS denies anon/authenticated writes; all writes go through
-- service-role chatCore paths that pair agent_id with org_id.
DROP POLICY IF EXISTS apr_org_read ON agent_probe_responses;
CREATE POLICY apr_org_read ON agent_probe_responses
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- Answered-quota counters — read at session-start assignment (compare against
-- sampling.target_n), bumped atomically when an answer is captured.
CREATE TABLE IF NOT EXISTS agent_probe_quota (
  agent_id       uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  probe_id       text NOT NULL,
  probe_version  integer NOT NULL,
  answered_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, probe_id, probe_version)
);

ALTER TABLE agent_probe_quota ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS apq_org_read ON agent_probe_quota;
CREATE POLICY apq_org_read ON agent_probe_quota
  FOR SELECT
  USING (agent_id IN (SELECT id FROM agents
                      WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

-- Atomic increment; returns the new answered count for the (probe, version).
CREATE OR REPLACE FUNCTION increment_probe_answered(
  p_agent_id uuid,
  p_probe_id text,
  p_probe_version integer,
  p_delta integer DEFAULT 1
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO agent_probe_quota (agent_id, probe_id, probe_version, answered_count)
  VALUES (p_agent_id, p_probe_id, p_probe_version, p_delta)
  ON CONFLICT (agent_id, probe_id, probe_version)
  DO UPDATE SET answered_count = agent_probe_quota.answered_count + p_delta
  RETURNING answered_count INTO v_count;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION increment_probe_answered(uuid, text, integer, integer) IS
  'Atomically bumps the answered-quota counter for a research probe version and returns the new count. chatCore assignment reads agent_probe_quota vs sampling.target_n; this keeps quota O(1) per answer (sql/154 counter pattern).';

COMMIT;
