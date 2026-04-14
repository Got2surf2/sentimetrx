-- ============================================================
-- SENTIMETRX — Town Hall Tables
-- AI-moderated focus groups at scale
-- ============================================================

-- ============================================================
-- TOWNHALL_SESSIONS
-- One row per Town Hall event. Holds config + discussion guide.
-- ============================================================
CREATE TABLE townhall_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          UUID REFERENCES studies(id) ON DELETE SET NULL,
  org_id            UUID NOT NULL,
  created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE,
  status            TEXT DEFAULT 'setup'
                    CHECK (status IN ('setup','active','paused','ended')),
  config            JSONB NOT NULL DEFAULT '{}',
  discussion_guide  JSONB NOT NULL DEFAULT '[]',
  response_counter  INT DEFAULT 0,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER townhall_sessions_updated_at
  BEFORE UPDATE ON townhall_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_townhall_sessions_org ON townhall_sessions(org_id);
CREATE INDEX idx_townhall_sessions_status ON townhall_sessions(status);

-- ============================================================
-- TOWNHALL_THEMES
-- Unified topic pool: guide topics + detected themes + custom.
-- ============================================================
CREATE TABLE townhall_themes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL REFERENCES townhall_sessions(id) ON DELETE CASCADE,
  label               TEXT NOT NULL,
  description         TEXT,
  question            TEXT NOT NULL,
  follow_up_angles    TEXT[] DEFAULT '{}',
  state               TEXT DEFAULT 'active'
                      CHECK (state IN ('active','detected','paused','completed','dismissed')),
  source              TEXT NOT NULL DEFAULT 'guide'
                      CHECK (source IN ('guide','auto_detected','custom')),
  response_target     INT NOT NULL DEFAULT 30,
  response_count      INT DEFAULT 0,
  mention_count       INT DEFAULT 0,
  example_quote       TEXT,
  detected_at         TIMESTAMPTZ,
  approved_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  sort_order          INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_townhall_themes_session ON townhall_themes(session_id);
CREATE INDEX idx_townhall_themes_state ON townhall_themes(session_id, state);

-- ============================================================
-- TOWNHALL_TURNS
-- Every bot/respondent exchange. The analysis backbone.
-- ============================================================
CREATE TABLE townhall_turns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES townhall_sessions(id) ON DELETE CASCADE,
  participant_id    TEXT NOT NULL,
  turn_number       INT NOT NULL,
  bot_message       TEXT NOT NULL,
  user_message      TEXT,
  theme_id          UUID REFERENCES townhall_themes(id) ON DELETE SET NULL,
  source            TEXT DEFAULT 'guide'
                    CHECK (source IN ('guide','clarifier','detected_theme','custom')),
  skipped           BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_townhall_turns_session ON townhall_turns(session_id);
CREATE INDEX idx_townhall_turns_participant ON townhall_turns(session_id, participant_id);
CREATE INDEX idx_townhall_turns_theme ON townhall_turns(theme_id);
CREATE INDEX idx_townhall_turns_session_created ON townhall_turns(session_id, created_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE townhall_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE townhall_themes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE townhall_turns    ENABLE ROW LEVEL SECURITY;

-- Sessions: admins see all, org members see their own org
CREATE POLICY "townhall_sessions_select" ON townhall_sessions FOR SELECT
  USING (is_platform_admin() OR org_id = current_client_id());

CREATE POLICY "townhall_sessions_insert" ON townhall_sessions FOR INSERT
  WITH CHECK (is_platform_admin() OR org_id = current_client_id());

CREATE POLICY "townhall_sessions_update" ON townhall_sessions FOR UPDATE
  USING (is_platform_admin() OR org_id = current_client_id());

-- Themes: same as sessions (via session's org)
CREATE POLICY "townhall_themes_select" ON townhall_themes FOR SELECT
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_client_id()
  ));

CREATE POLICY "townhall_themes_insert" ON townhall_themes FOR INSERT
  WITH CHECK (true);  -- API validates session ownership

CREATE POLICY "townhall_themes_update" ON townhall_themes FOR UPDATE
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_client_id()
  ));

-- Turns: public insert (participants), org select
CREATE POLICY "townhall_turns_insert_public" ON townhall_turns FOR INSERT
  WITH CHECK (true);  -- Participants submit without auth; API validates session is active

CREATE POLICY "townhall_turns_select" ON townhall_turns FOR SELECT
  USING (is_platform_admin() OR session_id IN (
    SELECT id FROM townhall_sessions WHERE org_id = current_client_id()
  ));
