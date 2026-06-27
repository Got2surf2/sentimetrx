-- 137_entity_catalog_provenance.sql
--
-- Entity-catalog provenance + source authority (owner requirement, 2026-06-27).
--
-- Every entity_catalog row must trace to a valid SOURCE record, and a canonical
-- spelling must come from an OFFICIAL record (a crawl / uploaded source document)
-- or a human. Conversations, survey responses, and ASR transcripts are
-- corroborating sources only. Today provenance is just `source ∈
-- {discovered,manual}` (sql/073) — too coarse. This:
--
--   1. Widens the `source` CHECK to the full source-kind set (the kind that OWNS
--      the canonical, i.e. its authority). 'discovered'/'manual' stay valid so
--      existing rows + the manual routes are unaffected.
--   2. Adds `provenance jsonb` — the per-row source trail, keyed by source-kind:
--        { "<kind>": { "count": <int>, "refs": [ {id?,url?,title?}, ... ] } }
--      (capped refs per kind; see lib/correction/provenance.ts).
--
-- The authority model + strict gating (only crawl/document/manual may set or
-- change a canonical; UGC adds aliases + mentions) lives in
-- lib/correction/provenance.ts and is enforced by the writers. This migration is
-- purely additive — no behavior change until the writers stamp the new fields.
-- Existing rows keep source='discovered', provenance='{}'.
--
-- Rollback: restore the 2-value CHECK + DROP COLUMN provenance.

BEGIN;

-- 1. Widen the source CHECK. The inline constraint from sql/073 is auto-named
--    entity_catalog_source_check.
ALTER TABLE public.entity_catalog
  DROP CONSTRAINT IF EXISTS entity_catalog_source_check;

ALTER TABLE public.entity_catalog
  ADD CONSTRAINT entity_catalog_source_check
  CHECK (source IN ('manual','document','crawl','transcript','conversation','survey','review','discovered'));

-- 2. Provenance trail.
ALTER TABLE public.entity_catalog
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.entity_catalog.source IS
  'Source-kind that OWNS the canonical spelling (its authority). manual>document>crawl (authoritative) > transcript>conversation>survey>review>discovered (corroborating). Only authoritative kinds may set/override a canonical (lib/correction/provenance.ts).';

COMMENT ON COLUMN public.entity_catalog.provenance IS
  'Per-row source trail, keyed by source-kind: { "<kind>": { count, refs[] } }. Maintained by the catalog writers; read by the correction glossary to keep only authoritative-sourced canonicals.';

COMMIT;
