-- sql/109_dataset_taxonomy_enabled.sql
-- Per-dataset opt-in for Dimensions (taxonomy). The Dimensions tab + dim fields
-- in Charts/Stats show when: datasetSource='google_reviews', OR the org has the
-- taxonomy capability (explicit flag or restaurant industry), OR this dataset is
-- individually flagged here. Set at upload time (CSV wizard) and toggleable on
-- the Schema tab — for admin/one-off datasets whose org isn't a restaurant.
-- Nullable-ish boolean, default false; additive, no behavioral effect until set.

BEGIN;

ALTER TABLE datasets ADD COLUMN IF NOT EXISTS taxonomy_enabled boolean NOT NULL DEFAULT false;

COMMIT;
