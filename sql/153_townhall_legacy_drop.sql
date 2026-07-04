-- 153_townhall_legacy_drop.sql
--
-- ⚠️  PROD APPLY IS GATED: the companion code commit (legacy-leg excisions +
-- orgSnapshot/orgDelete manifest cleanup + this migration) must be DEPLOYED
-- first — the previously-deployed backup cron pages townhall_sessions/themes/
-- turns nightly and snapshot v2 is fail-loud, so dropping under it turns the
-- nightly red. Apply to TEST immediately; apply to prod right after the deploy.
--
-- The end of the agents × PulseIQ convergence (docs/CONVERGENCE.md § 4):
-- owner Phase 6 acceptance passed 2026-07-04 on prod, so the legacy PulseIQ
-- substrate retires. Every session lives on pulseiq_sessions +
-- pulseiq_topics + pulseiq_session_conversations + conversations/
-- conversation_turns, served by lib/chatCore via /api/townhall/*.
--
-- Owner decision (2026-07-03): legacy PulseIQ DATA IS DISCARDABLE — zero
-- active legacy sessions; prod carried 1 townhall_sessions row + 511 turns
-- of internal testing. This migration executes that discard.
--
-- What drops:
--   * Compat views town_halls / town_hall_conversations / town_hall_topics
--     (sql/148 + sql/150 transition shims; no code reads them anymore).
--   * Legacy tables townhall_turns / townhall_themes / townhall_sessions
--     (+ their indexes, policies, triggers, and FKs via CASCADE).
--   * Legacy functions increment_townhall_response_counter (updated
--     townhall_sessions) and townhall_session_counts_for_ids (read
--     townhall_turns; orphaned — no in-code callers).
--   * Legacy-only rows in townhall_participant_responses (session_id set,
--     town_hall_id NULL — they pointed at the discarded legacy sessions).
--
-- What SURVIVES: townhall_participant_responses — dual-substrate since
-- sql/083, now new-substrate-only (town_hall_id → pulseiq_sessions, FK
-- ON DELETE CASCADE). Its legacy session_id column + partial unique index
-- become vestigial but are left in place (dropping the column would churn
-- the substrate CHECK for zero benefit; every remaining row satisfies the
-- check via town_hall_id).

BEGIN;

-- Compat views first (they read pulseiq_*, but nothing reads them).
DROP VIEW IF EXISTS town_hall_conversations;
DROP VIEW IF EXISTS town_hall_topics;
DROP VIEW IF EXISTS town_halls;

-- The legacy data discard: participant responses tied only to legacy sessions.
DELETE FROM townhall_participant_responses WHERE town_hall_id IS NULL;

-- Legacy functions (reference the tables — drop before them for clarity).
DROP FUNCTION IF EXISTS increment_townhall_response_counter(uuid);
DROP FUNCTION IF EXISTS townhall_session_counts_for_ids(uuid[]);

-- Legacy tables. CASCADE clears their policies, triggers, indexes, and the
-- townhall_participant_responses.session_id FK (constraint only — the
-- surviving table's rows are untouched; legacy-only rows were deleted above).
DROP TABLE IF EXISTS townhall_turns CASCADE;
DROP TABLE IF EXISTS townhall_themes CASCADE;
DROP TABLE IF EXISTS townhall_sessions CASCADE;

COMMIT;

-- Verify
SELECT 'legacy townhall substrate dropped' AS object,
       CASE WHEN to_regclass('public.townhall_sessions') IS NULL
             AND to_regclass('public.townhall_themes') IS NULL
             AND to_regclass('public.townhall_turns') IS NULL
             AND to_regclass('public.town_halls') IS NULL
             AND to_regclass('public.town_hall_conversations') IS NULL
             AND to_regclass('public.town_hall_topics') IS NULL
             AND to_regclass('public.townhall_participant_responses') IS NOT NULL
            THEN 'ready' ELSE 'INCOMPLETE' END AS status
UNION ALL
SELECT 'legacy-only participant responses discarded',
       CASE WHEN NOT EXISTS (SELECT 1 FROM townhall_participant_responses WHERE town_hall_id IS NULL)
            THEN 'ready' ELSE 'INCOMPLETE' END;
