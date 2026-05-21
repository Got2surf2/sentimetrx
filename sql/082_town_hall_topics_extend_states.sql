-- 082_town_hall_topics_extend_states.sql
--
-- NOWOCATS town-hall launch (early June 2026) — the facilitator
-- dashboard's topic state machine uses six states on legacy
-- townhall_themes: active, detected, paused, parked, completed,
-- dismissed. The Phase-3 town_hall_topics CHECK constraint (sql/078)
-- accepted only four: active, pending, completed, rejected.
--
-- Bridge the two vocabularies by adding the missing legacy labels to
-- the CHECK so the existing route code (app/api/townhall/themes/[id])
-- can write directly without per-call value translation. The adapter
-- (lib/townHallAdapter.ts) already projects 'pending' → 'detected' and
-- 'rejected' → 'dismissed' on read.
--
-- After this migration: state ∈ { active, pending, detected,
-- paused, parked, completed, rejected, dismissed }.
--
-- Rollback: DROP + recreate with the original 4 values. Safe because
-- no row in production currently uses the legacy-only labels (the
-- only writer is cohortThemeAggregator which inserts 'pending').

BEGIN;

ALTER TABLE town_hall_topics
  DROP CONSTRAINT IF EXISTS town_hall_topics_state_check;

ALTER TABLE town_hall_topics
  ADD CONSTRAINT town_hall_topics_state_check
  CHECK (state IN (
    'active',
    'pending',     -- cohort aggregator insert state (organic-awaiting-approval)
    'detected',    -- legacy alias for 'pending' (UI-visible label)
    'paused',
    'parked',
    'completed',
    'rejected',
    'dismissed'    -- legacy alias for 'rejected'
  ));

COMMIT;

-- Sanity check
SELECT 'town_hall_topics state check accepts paused',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'town_hall_topics_state_check'
      AND check_clause LIKE '%paused%'
  ) THEN 'ready' ELSE 'MISSING' END;
