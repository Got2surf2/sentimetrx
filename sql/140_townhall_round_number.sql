-- sql/140_townhall_round_number.sql
-- Round-based pacing for PulseIQ town halls (tasting-kitchen variant).
-- Tags each seeded theme with the round (= tasting item) it belongs to so the
-- moderator can gate the room round-by-round: round 1 themes start 'active',
-- later rounds start 'paused' and are batch-activated when the moderator pushes
-- the next round. NULL = open-conversation pacing (the existing behavior), so
-- this column is inert until config.pacing_mode === 'rounds'.
--
-- Additive, nullable, no behavioral effect until the creator authors rounds and
-- the seed-on-activate path stamps round_number (app/api/townhall/sessions/[id]).

BEGIN;

ALTER TABLE townhall_themes ADD COLUMN IF NOT EXISTS round_number int;

COMMENT ON COLUMN townhall_themes.round_number IS
  'Round-based pacing: which tasting round/item this theme belongs to (1-indexed). NULL = open-conversation pacing. round 1 seeds active, later rounds seed paused until the moderator advances.';

CREATE INDEX IF NOT EXISTS idx_townhall_themes_round
  ON townhall_themes (session_id, round_number);

COMMIT;
