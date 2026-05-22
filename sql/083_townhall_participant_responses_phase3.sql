-- 083_townhall_participant_responses_phase3.sql
--
-- Gap #5b — `townhall_participant_responses` accepts post-session
-- psycho/demo answers from BOTH substrates:
--   - legacy townhall_sessions  → row keyed on (session_id, participant_id)
--   - phase-3 town_halls        → row keyed on (town_hall_id, participant_id)
--
-- Schema before this migration:
--   session_id uuid NOT NULL REFERENCES townhall_sessions(id)
--   participant_id text NOT NULL
--   UNIQUE (session_id, participant_id)
--
-- Schema after this migration:
--   session_id uuid NULL REFERENCES townhall_sessions(id)
--   town_hall_id uuid NULL REFERENCES town_halls(id) ON DELETE CASCADE
--   participant_id text NOT NULL
--   CHECK (session_id IS NOT NULL OR town_hall_id IS NOT NULL)
--   UNIQUE (session_id, participant_id) WHERE session_id IS NOT NULL
--   UNIQUE (town_hall_id, participant_id) WHERE town_hall_id IS NOT NULL
--
-- Application-side rule (app/api/townhall/responses/route.ts):
-- exactly one of session_id / town_hall_id is populated per row, never
-- both, never neither. The CHECK is "at least one" rather than "exactly
-- one" to avoid edge cases on backfill if both substrates ever needed
-- to coexist for the same row (they don't today).

BEGIN;

ALTER TABLE townhall_participant_responses
  ADD COLUMN IF NOT EXISTS town_hall_id uuid REFERENCES town_halls(id) ON DELETE CASCADE;

-- Drop the NOT NULL on session_id so phase-3 rows can leave it null.
-- The existing FK to townhall_sessions stays (just no longer required).
ALTER TABLE townhall_participant_responses
  ALTER COLUMN session_id DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'townhall_participant_responses_substrate_check') THEN
    ALTER TABLE townhall_participant_responses
      ADD CONSTRAINT townhall_participant_responses_substrate_check
      CHECK (session_id IS NOT NULL OR town_hall_id IS NOT NULL);
  END IF;
END $$;

-- Drop the old (session_id, participant_id) NOT NULL unique constraint
-- and replace with partial unique indexes for both substrates. This
-- preserves the "one row per participant per session" invariant in both
-- worlds while allowing the column to be nullable.
ALTER TABLE townhall_participant_responses
  DROP CONSTRAINT IF EXISTS townhall_participant_responses_session_id_participant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS townhall_participant_responses_legacy_unique
  ON townhall_participant_responses (session_id, participant_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS townhall_participant_responses_phase3_unique
  ON townhall_participant_responses (town_hall_id, participant_id)
  WHERE town_hall_id IS NOT NULL;

-- Index for phase-3 lookups by town hall (mirrors the implicit one
-- you get from the legacy session_id FK).
CREATE INDEX IF NOT EXISTS townhall_participant_responses_town_hall_idx
  ON townhall_participant_responses (town_hall_id)
  WHERE town_hall_id IS NOT NULL;

COMMIT;

-- Sanity checks
SELECT 'town_hall_id column exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='townhall_participant_responses' AND column_name='town_hall_id'
  ) THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'session_id is now nullable',
  CASE WHEN (
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name='townhall_participant_responses' AND column_name='session_id'
  ) = 'YES' THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'substrate CHECK exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='townhall_participant_responses_substrate_check'
  ) THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'phase3 partial unique index exists',
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname='townhall_participant_responses_phase3_unique'
  ) THEN 'ready' ELSE 'MISSING' END;
