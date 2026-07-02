-- 150: Align the new-schema table names with the owner-declared product
-- language (2026-07-03): the product noun is "PulseIQ session".
--   pulseiq_events              → pulseiq_sessions
--   pulseiq_event_conversations → pulseiq_session_conversations
-- (pulseiq_topics already fits.)
--
-- Same rules as sql/148: rename-in-place (no data moved), indexes + policies
-- follow, and the sql/148 compat views under the ORIGINAL town_hall* names are
-- recreated to point at the new names — deployed prod code keeps working.
-- All views drop together in convergence tranche 2.

BEGIN;

ALTER TABLE pulseiq_events RENAME TO pulseiq_sessions;
ALTER TABLE pulseiq_event_conversations RENAME TO pulseiq_session_conversations;

ALTER INDEX IF EXISTS pulseiq_events_slug_idx RENAME TO pulseiq_sessions_slug_idx;
ALTER INDEX IF EXISTS pulseiq_events_org_created_idx RENAME TO pulseiq_sessions_org_created_idx;
ALTER INDEX IF EXISTS pulseiq_events_bot_idx RENAME TO pulseiq_sessions_bot_idx;
ALTER INDEX IF EXISTS pulseiq_event_conversations_pair_idx RENAME TO pulseiq_session_conversations_pair_idx;
ALTER INDEX IF EXISTS pulseiq_event_conversations_conv_idx RENAME TO pulseiq_session_conversations_conv_idx;

ALTER POLICY pulseiq_events_org_read ON pulseiq_sessions RENAME TO pulseiq_sessions_org_read;
ALTER POLICY pulseiq_event_conversations_org_read ON pulseiq_session_conversations RENAME TO pulseiq_session_conversations_org_read;

-- Recreate the sql/148 compat views against the new names.
CREATE OR REPLACE VIEW town_halls WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_sessions;

CREATE OR REPLACE VIEW town_hall_conversations WITH (security_invoker = true) AS
  SELECT * FROM pulseiq_session_conversations;

COMMIT;
