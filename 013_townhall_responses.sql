-- 013_townhall_responses.sql
-- Post-session demographic & psychographic responses from Town Hall participants

CREATE TABLE IF NOT EXISTS townhall_participant_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES townhall_sessions(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL,
  psychographics  JSONB DEFAULT '{}',
  demographics    JSONB DEFAULT '{}',
  submitted_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(session_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_th_responses_session ON townhall_participant_responses(session_id);

-- RLS: anyone can insert (anonymous participants), org members can read
ALTER TABLE townhall_participant_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "th_responses_anon_insert" ON townhall_participant_responses
  FOR INSERT WITH CHECK (true);

CREATE POLICY "th_responses_service_all" ON townhall_participant_responses
  FOR ALL USING (true) WITH CHECK (true);
