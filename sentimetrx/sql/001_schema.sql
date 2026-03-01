-- ============================================================
-- SENTIMETRX.AI — Phase 1 Database Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- for gen_random_uuid()

-- ============================================================
-- CLIENTS
-- One row per paying customer / organisation.
-- Created by the Sentimetrx admin when onboarding a new client.
-- ============================================================
CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT UNIQUE NOT NULL,        -- e.g. "coalition-cfl", "ana-restaurant-group"
  plan         TEXT DEFAULT 'active'
               CHECK (plan IN ('trial','active','suspended')),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- USERS
-- Everyone who can log in. Tied to Supabase Auth by id.
-- client_id = NULL means Sentimetrx platform admin.
-- ============================================================
CREATE TABLE users (
  id           UUID PRIMARY KEY,            -- MUST match auth.users.id exactly
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
  email        TEXT NOT NULL UNIQUE,
  full_name    TEXT,
  role         TEXT DEFAULT 'member'
               CHECK (role IN ('platform_admin','owner','member')),
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- STUDIES
-- One row per survey study.
-- config JSONB holds the entire bot configuration so the
-- schema never needs changing when new study types are added.
-- ============================================================
CREATE TABLE studies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guid         TEXT UNIQUE NOT NULL,        -- public-facing ID used in survey links
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  bot_name     TEXT NOT NULL,
  bot_emoji    TEXT DEFAULT '💬',
  status       TEXT DEFAULT 'draft'
               CHECK (status IN ('draft','active','paused','closed')),
  config       JSONB NOT NULL DEFAULT '{}',
  /*
    Expected config shape:
    {
      "greeting":      "Hi! I'm Charity...",
      "ratingPrompt":  "How familiar are you with...",
      "ratingScale": [
        {"emoji":"🤷","label":"Not familiar","score":1},
        ...
      ],
      "promoterQ1":    "...",
      "passiveQ1":     "...",
      "detractorQ1":   "...",
      "q3":            "...",
      "q4":            "...",
      "clarifiers": {
        "trust":        "...",
        "impact":       "...",
        "default":      "..."
      },
      "psychographicBank": [
        {"key":"donor_status","q":"...","opts":["...","..."]}
      ],
      "theme": {
        "primaryColor":      "#1a7a4a",
        "headerGradient":    "linear-gradient(135deg,#1a7a4a,#0d4a2a)",
        "backgroundColor":   "#0a1628",
        "accentColor":       "#4ade80",
        "botAvatarGradient": "linear-gradient(135deg,#1a7a4a,#0d4a2a)"
      }
    }
  */
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on any change to studies
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER studies_updated_at
  BEFORE UPDATE ON studies
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- RESPONSES
-- One row per completed survey conversation.
-- sentiment, experience_score, nps_score are pulled out of
-- the JSON blob and stored as real columns so the dashboard
-- can filter and aggregate them with fast indexed queries.
-- Everything else lives in the payload blob.
-- ============================================================
CREATE TABLE responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id          UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  study_guid        TEXT NOT NULL,           -- denormalised — no join needed for lookups
  client_id         UUID NOT NULL,           -- denormalised — used by RLS policies

  -- Pulled out for fast indexed queries
  sentiment         TEXT CHECK (sentiment IN ('promoter','passive','detractor')),
  experience_score  SMALLINT CHECK (experience_score BETWEEN 1 AND 5),
  nps_score         SMALLINT CHECK (nps_score BETWEEN 1 AND 5),

  -- Full structured payload — everything the bot collected
  payload           JSONB NOT NULL,
  /*
    {
      "agent": "Charity",
      "experienceRating": {"score":4,"label":"Know them well","sentiment":"passive"},
      "npsRecommend":     {"score":5,"label":"Definitely!"},
      "openEnded":        {"q1":"...","q3":"...","q4":"..."},
      "psychographics":   {"donor_status":"Current regular donor",...},
      "demographics":     {"age":"35-44","gender":"female","zip":"32801"}
    }
  */

  completed_at      TIMESTAMPTZ DEFAULT now(),
  duration_sec      INT,
  ip_hash           TEXT                     -- SHA-256 of IP, never raw
);

-- Performance indexes
CREATE INDEX idx_responses_study      ON responses(study_id);
CREATE INDEX idx_responses_client     ON responses(client_id);
CREATE INDEX idx_responses_study_date ON responses(study_id, completed_at DESC);
CREATE INDEX idx_responses_sentiment  ON responses(study_id, sentiment);
CREATE INDEX idx_responses_nps        ON responses(study_id, nps_score);
CREATE INDEX idx_studies_client       ON studies(client_id);
CREATE INDEX idx_studies_guid         ON studies(guid);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Enforces multi-tenancy at the database layer.
-- A client user physically cannot query another client's data
-- regardless of what the application code does.
-- ============================================================
ALTER TABLE clients   ENABLE ROW LEVEL SECURITY;
ALTER TABLE studies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;

-- Helper function: get the current user's client_id
-- Returns NULL for platform admins (they see everything)
CREATE OR REPLACE FUNCTION current_client_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT client_id FROM users WHERE id = auth.uid()
$$;

-- Helper function: is the current user a platform admin?
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'platform_admin'
  )
$$;

-- CLIENTS: platform admins see all; clients see only their own row
CREATE POLICY "clients_select" ON clients FOR SELECT
  USING (is_platform_admin() OR id = current_client_id());

-- USERS: platform admins see all; users see others in their client
CREATE POLICY "users_select" ON users FOR SELECT
  USING (is_platform_admin() OR client_id = current_client_id() OR id = auth.uid());

-- STUDIES: platform admins see all; clients see only their own
CREATE POLICY "studies_select" ON studies FOR SELECT
  USING (is_platform_admin() OR client_id = current_client_id());

CREATE POLICY "studies_insert" ON studies FOR INSERT
  WITH CHECK (is_platform_admin() OR client_id = current_client_id());

CREATE POLICY "studies_update" ON studies FOR UPDATE
  USING (is_platform_admin() OR client_id = current_client_id());

-- RESPONSES: platform admins see all; clients see only their own
CREATE POLICY "responses_select" ON responses FOR SELECT
  USING (is_platform_admin() OR client_id = current_client_id());

-- Responses INSERT is allowed without auth (public survey submissions)
-- but validated at the API layer (study_guid must match an active study)
CREATE POLICY "responses_insert_public" ON responses FOR INSERT
  WITH CHECK (true);  -- API validates study_guid; see /api/respond route

-- ============================================================
-- SEED: Sentimetrx platform admin client record
-- Replace 'your-admin-auth-uid-here' with your actual Supabase
-- Auth user ID after you create your admin account in Step 6
-- of the deployment instructions.
-- ============================================================
INSERT INTO clients (id, name, slug, plan)
VALUES (
  gen_random_uuid(),
  'Sentimetrx',
  'sentimetrx',
  'active'
);

-- NOTE: Run the users INSERT separately after creating your
-- admin account — see deployment instructions Step 6.
