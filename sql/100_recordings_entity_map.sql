-- 100_recordings_entity_map.sql
--
-- Town Hall entity-spelling normalization (docs/RECORDINGS.md §3.5b).
-- After transcription we auto-extract the proper nouns mentioned in the meeting,
-- clustering the ASR's phonetic/spelling variants under a best-guess canonical.
-- The user reviews/corrects these at the "Review & generate" gate. The confirmed
-- map then (a) feeds the polish pass glossary so the polished Q&A uses correct
-- spellings, and (b) powers a deterministic "Corrected" transcript view (the raw
-- ASR transcript stays untouched as the record of truth).
--
-- Shape: { entities: [{ canonical, variants: [string], type, mentions }],
--          extracted_at, reviewed_at? }
--
-- Nullable + additive: existing recordings keep NULL (no entity map); the column
-- has no behavioral effect until populated. recordings already has RLS enabled
-- with an org-scoped policy, which covers this column — no new policy needed.

BEGIN;

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS entity_map jsonb;

COMMIT;
