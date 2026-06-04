-- sql/103_recording_brand_link.sql
-- Brand-entity convergence for Town Hall (docs/RECORDINGS.md §3.5c).
--
-- A recording can name a brand and/or an underlying agent so the meeting's
-- entity-spelling correction draws on that brand's curated entity catalog:
--   - brand_tag mirrors datasets.brand_tag — when the meeting's derived dataset
--     inherits it (lib/recordings/mirror.ts), the existing brand-collection
--     trigger (sql/062) folds the meeting's data into the brand's entity_catalog
--     (the reverse direction — the meeting feeds brand-level analysis).
--   - underlying_agent_id links the brand's conversational agent (e.g. Sarina)
--     so its bot-scope entity_catalog entries seed the meeting glossary too
--     (bot entities aren't collection members, so they're unioned at read time).
-- Both nullable: a recording with neither behaves exactly as before.

BEGIN;

-- `agents` is the real table; `bots` is a backward-compat VIEW, so the FK must
-- target agents(id).
ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS brand_tag TEXT,
  ADD COLUMN IF NOT EXISTS underlying_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

COMMIT;
