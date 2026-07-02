-- 148: Rename the new-schema PulseIQ tables out of the "town hall" namespace.
--
-- WHY (CONVERGENCE §4.2 item 0, owner-approved 2026-07-03): "Town Hall" is the
-- recordings product; the chat product is PulseIQ. The Phase-3 tables created
-- in sql/078 (town_halls / town_hall_topics / town_hall_conversations) are the
-- PERMANENT PulseIQ home but inherited the other product's name. They are dark
-- in prod today (zero prod writes — DUAL_WRITE_PHASE3 / READ_PHASE3 /
-- TOWNHALL_VIA_AGENT_HANDLER all OFF; the only rows are local-dev artifacts),
-- so this is the last near-zero-risk moment to rename.
--
-- NO DATA IS MOVED. ALTER TABLE ... RENAME relabels the relation in place;
-- rows, indexes, constraints, and RLS policies all ride along. The LEGACY
-- tables (townhall_sessions / townhall_turns / townhall_themes) — which hold
-- all real PulseIQ history — are NOT touched by this migration.
--
-- Backward compatibility: security_invoker views under the old names (same
-- pattern as the bots→agents rename in sql/079), so already-deployed code
-- that still references town_halls keeps working until the code sweep ships.
-- Simple single-table views are auto-updatable, so dual-write inserts through
-- the old names keep working too. The views drop in convergence tranche 2
-- alongside the legacy-table cleanup.
--
-- Column names (town_hall_id etc.) intentionally NOT renamed — the compat
-- views must expose identical columns, and the FK name is far less confusing
-- than the table name was. Revisit in tranche 2 if desired.

BEGIN;

ALTER TABLE town_halls RENAME TO pulseiq_events;
ALTER TABLE town_hall_conversations RENAME TO pulseiq_event_conversations;
ALTER TABLE town_hall_topics RENAME TO pulseiq_topics;

-- Rename the indexes so \di output matches the new family name.
ALTER INDEX IF EXISTS town_halls_slug_idx RENAME TO pulseiq_events_slug_idx;
ALTER INDEX IF EXISTS town_hall_conversations_pair_idx RENAME TO pulseiq_event_conversations_pair_idx;
ALTER INDEX IF EXISTS town_halls_org_created_idx RENAME TO pulseiq_events_org_created_idx;
ALTER INDEX IF EXISTS town_halls_bot_idx RENAME TO pulseiq_events_bot_idx;
ALTER INDEX IF EXISTS town_hall_conversations_conv_idx RENAME TO pulseiq_event_conversations_conv_idx;
ALTER INDEX IF EXISTS town_hall_topics_hall_state_idx RENAME TO pulseiq_topics_hall_state_idx;
ALTER INDEX IF EXISTS town_hall_topics_org_idx RENAME TO pulseiq_topics_org_idx;

-- RLS policies ride along with the table; rename for greppability.
ALTER POLICY town_halls_org_read ON pulseiq_events RENAME TO pulseiq_events_org_read;
ALTER POLICY town_hall_conversations_org_read ON pulseiq_event_conversations RENAME TO pulseiq_event_conversations_org_read;
ALTER POLICY town_hall_topics_org_read ON pulseiq_topics RENAME TO pulseiq_topics_org_read;

-- Backward-compat views under the old names (drop in tranche 2).
-- security_invoker: the view runs under the caller's role, so RLS on the
-- underlying table still applies to authed clients.
CREATE VIEW town_halls WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_events;

CREATE VIEW town_hall_conversations WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_event_conversations;

CREATE VIEW town_hall_topics WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_topics;

COMMIT;
