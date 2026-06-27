-- 136_agent_brand_tag.sql
--
-- Shared brand-correction layer, Phase 3 (bot→brand entity rollup).
--
-- Gives an agent a first-class link to a brand (docs/RECORDINGS.md §3.5c,
-- docs/BOTS.md §9.y). Until now the only bot↔brand link was the *reverse*
-- direction — a Town Hall recording naming `underlying_agent_id` + `brand_tag`
-- — which is per-meeting and only exists once a recording is made. This adds a
-- stable per-agent `brand_tag`, mirroring `datasets.brand_tag`, so an agent's
-- curated entity catalog (scope_type='bot') can roll up into the brand
-- collection's shared `entity_catalog` (scope_type='collection'). That makes the
-- brand glossary authoritative for every product that draws on it (Town Hall
-- spelling correction, the What We Heard agent readout, future survey
-- correction).
--
-- Free text by design (same as datasets.brand_tag) — the rollup resolves it to a
-- brand collection via find_or_create_brand_collection(org_id, tag, created_by)
-- (sql/060), the same slugify find-or-create the sql/062 dataset trigger uses.
-- We deliberately do NOT add a trigger / collection-membership for agents here
-- (an agent is not a dataset; "bots as true collection members" stays deferred,
-- §3.5c). The rollup is code-driven (lib/correction/rollup.ts), fired on entity
-- extract / curate.
--
-- Additive + idempotent; nullable, no backfill. Rollback: DROP COLUMN.

BEGIN;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS brand_tag text;

COMMENT ON COLUMN public.agents.brand_tag IS
  'Free-text brand label. Resolves (via find_or_create_brand_collection) to the brand collection whose entity_catalog this agent''s curated entities roll up into. Phase 3 of the shared brand-correction layer.';

COMMIT;
