-- sql/139_dataset_taxonomy_suppressed.sql
-- Per-dataset OPT-OUT for Dimensions, complementing taxonomy_enabled (opt-in,
-- sql/109). Set when restaurant-detection at theme-generation time judges a
-- dataset is NOT food-service (e.g. a hotel's or clinic's Google reviews), so
-- the google_reviews→restaurant visibility proxy can be overridden and the
-- (irrelevant) restaurant taxonomy is hidden for that dataset.
--
-- Suppression ONLY gates the google_reviews proxy — an explicit taxonomy_enabled
-- flag or a restaurant-industry org still shows Dimensions (manual/explicit
-- intent wins over auto-detection). Additive, default false, no behavioral
-- effect until set.

BEGIN;

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS taxonomy_suppressed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN datasets.taxonomy_suppressed IS
  'Dimensions opt-out: AI detected non-food-service data → hide the restaurant taxonomy even for google_reviews. Only overrides the source proxy, not an explicit taxonomy_enabled/org capability.';

COMMIT;
