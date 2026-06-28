-- sql/138_collection_purpose.sql
-- Persist a report PURPOSE on each collection so its card surfaces only the
-- relevant report (a competitive set shouldn't offer a "Community report").
-- Previously purpose was only inferred at report build-time (inferPurpose) +
-- a `?purpose=` override; now it's a first-class, user-overridable property set
-- at creation with a smart default.
--
--   community   — town halls + agents (community-engagement synthesis)
--   competitive — competitor reviews/CSAT (primary-focused deep-dive)
--   brand_360   — one brand's many data sources (triangulation)
--
-- Nullable: existing collections keep NULL and fall back to showing all three
-- report options (back-compat). Additive, no behavioral change until set.

BEGIN;

ALTER TABLE collections ADD COLUMN IF NOT EXISTS purpose text
  CHECK (purpose IS NULL OR purpose IN ('community', 'competitive', 'brand_360'));

COMMENT ON COLUMN collections.purpose IS
  'Report purpose typing (community|competitive|brand_360); drives which report the card offers. NULL = legacy, show all.';

COMMIT;
