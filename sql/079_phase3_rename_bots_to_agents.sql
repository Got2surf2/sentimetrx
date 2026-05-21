-- sql/079_phase3_rename_bots_to_agents.sql
-- Phase 3 of the agents x PulseIQ convergence (docs/CONVERGENCE.md § 7.1).
--
-- Renames the bot_* family of tables to agent_* to align with the product-
-- facing naming convention ("agents" everywhere in the UI per CLAUDE.md).
-- Creates backward-compatible VIEWs at the old names so deployed code that
-- still references `bots`, `bot_knowledge_chunks`, etc. keeps working until
-- it's migrated in subsequent commits. Views are created WITH (security_
-- invoker = true) so RLS on the underlying renamed table applies as if the
-- caller were querying the table directly (Postgres 15+ feature).
--
-- Five tables renamed:
--   bots                       → agents
--   bot_knowledge_chunks       → agent_knowledge_chunks
--   bot_change_log             → agent_change_log
--   bot_session_personas       → agent_session_personas
--   bot_conversation_reviews   → agent_conversation_reviews
--
-- One table NOT renamed:
--   bot_conversation_turns — drops in Phase 3 Tier 5 cleanup; renaming
--   it now would be churn for a table about to disappear.
--
-- FK columns (`bot_id` on conversations, town_halls, bot_knowledge_chunks,
-- bot_change_log, bot_session_personas, bot_conversation_reviews,
-- bot_conversation_turns) are NOT renamed. The FK reference rebinds to
-- the new table name automatically because Postgres tracks constraints by
-- OID, not text. The column name `bot_id` is internally inconsistent with
-- the renamed parent, but renaming columns multiplies the code-migration
-- surface 10x and isn't required for this commit's goal. Future commit
-- can rename FK columns when convenient.
--
-- Postgres handles automatically (no migration work needed):
--   - Foreign-key constraints on the renamed tables follow the OID
--   - Indexes follow the table (names like `bots_slug_idx` keep their
--     text but point at `agents`; can be rename-for-cosmetic later)
--   - RLS policies follow the table (same rationale)
--   - Triggers follow the table (`trg_knowledge_tsv` on bot_knowledge_chunks
--     stays in place on agent_knowledge_chunks)
--   - Functions reference tables by OID at parse time; rename rebinds
--     automatically. Verified for search_knowledge_chunks +
--     search_knowledge_semantic which reference bot_knowledge_chunks.
--
-- Rollback: DROP VIEW + ALTER TABLE rename back. Idempotent — the views
-- and renames use IF EXISTS / IF NOT EXISTS where supported; bare renames
-- are wrapped in DO blocks that check existence first.

BEGIN;

-- ── Rename the parent table + four children ──────────────────────────────
-- Wrapped in DO blocks so re-running this migration after a partial apply
-- doesn't fail on "relation already exists".

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bots' AND relkind = 'r') THEN
    ALTER TABLE bots RENAME TO agents;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bot_knowledge_chunks' AND relkind = 'r') THEN
    ALTER TABLE bot_knowledge_chunks RENAME TO agent_knowledge_chunks;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bot_change_log' AND relkind = 'r') THEN
    ALTER TABLE bot_change_log RENAME TO agent_change_log;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bot_session_personas' AND relkind = 'r') THEN
    ALTER TABLE bot_session_personas RENAME TO agent_session_personas;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bot_conversation_reviews' AND relkind = 'r') THEN
    ALTER TABLE bot_conversation_reviews RENAME TO agent_conversation_reviews;
  END IF;
END $$;

-- ── Backward-compat views ────────────────────────────────────────────────
-- security_invoker = true makes the view execute under the caller's role,
-- so RLS on the underlying renamed table applies (Postgres 15+).
-- Auto-updatable views: simple SELECT * FROM single_table is updatable
-- through Postgres without INSTEAD OF triggers, so INSERT/UPDATE/DELETE
-- through the view translate to operations on the renamed table.

CREATE OR REPLACE VIEW bots WITH (security_invoker = true) AS
  SELECT * FROM agents;

CREATE OR REPLACE VIEW bot_knowledge_chunks WITH (security_invoker = true) AS
  SELECT * FROM agent_knowledge_chunks;

CREATE OR REPLACE VIEW bot_change_log WITH (security_invoker = true) AS
  SELECT * FROM agent_change_log;

CREATE OR REPLACE VIEW bot_session_personas WITH (security_invoker = true) AS
  SELECT * FROM agent_session_personas;

CREATE OR REPLACE VIEW bot_conversation_reviews WITH (security_invoker = true) AS
  SELECT * FROM agent_conversation_reviews;

COMMENT ON VIEW bots IS
  'Phase 3 backward-compat view. Underlying table renamed to agents in sql/079. Drop this view once all code references migrate to agents.';
COMMENT ON VIEW bot_knowledge_chunks IS
  'Phase 3 backward-compat view. Underlying table renamed to agent_knowledge_chunks in sql/079.';
COMMENT ON VIEW bot_change_log IS
  'Phase 3 backward-compat view. Underlying table renamed to agent_change_log in sql/079.';
COMMENT ON VIEW bot_session_personas IS
  'Phase 3 backward-compat view. Underlying table renamed to agent_session_personas in sql/079.';
COMMENT ON VIEW bot_conversation_reviews IS
  'Phase 3 backward-compat view. Underlying table renamed to agent_conversation_reviews in sql/079.';

COMMIT;

-- ── Sanity checks ────────────────────────────────────────────────────────
SELECT 'agents table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agents' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'agent_knowledge_chunks table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_knowledge_chunks' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'agent_change_log table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_change_log' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'agent_session_personas table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_session_personas' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'agent_conversation_reviews table',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='agent_conversation_reviews' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'bots view',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='bots')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'bot_knowledge_chunks view',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='bot_knowledge_chunks')
            THEN 'ready' ELSE 'MISSING' END
UNION ALL
SELECT 'bot_conversation_turns still a table (not renamed)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='bot_conversation_turns' AND table_type='BASE TABLE')
            THEN 'ready' ELSE 'MISSING' END;
