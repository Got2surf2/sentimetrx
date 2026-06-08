-- 121_reo_gold_set.sql  (2026-06-08)
-- Gold set for the Restaurant Experience Ontology (REO) classifier evaluation.
-- One row per review. `proposed` holds the AI/draft labels; `gold` holds the
-- human-reviewed truth (null until reviewed). Storing both lets us later score
-- the classifier (proposed vs gold) without re-labeling.
--
-- Internal product-dev tooling, admin-only. RLS on day one (multi-tenancy
-- invariant); org-scoped SELECT, writes are service-role only (via the
-- requireAdmin-gated route handler). Org is the admin org that owns the set.

BEGIN;

CREATE TABLE IF NOT EXISTS reo_gold_review (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL,

  -- provenance back to the source row (read-only link; nullable for hand-added)
  source_dataset_id uuid,
  source_row_id     bigint,
  ext_review_id     text,              -- external review id or draft id (e.g. 'R01')

  rating            int,
  review_text       text NOT NULL,

  -- [{domain, aspect, sentiment, evidence?, severity?, note?}, ...]
  proposed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  gold              jsonb,             -- null until reviewed; the corrected truth
  reviewer_note     text,             -- free-text guidance from the reviewer

  -- 'pending' | 'approved' (proposal kept as-is) | 'edited' | 'skipped'
  status            text NOT NULL DEFAULT 'pending',
  reviewed_at       timestamptz,
  reviewed_by       uuid,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, ext_review_id)
);

CREATE INDEX IF NOT EXISTS reo_gold_review_org_status_idx
  ON reo_gold_review (org_id, status);

ALTER TABLE reo_gold_review ENABLE ROW LEVEL SECURITY;

-- Org-scoped read (admins read their own org's set). Writes service-role only.
DROP POLICY IF EXISTS reo_gold_review_org_read ON reo_gold_review;
CREATE POLICY reo_gold_review_org_read ON reo_gold_review
  FOR SELECT
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
-- No INSERT/UPDATE/DELETE policy: mutations go through the requireAdmin route
-- using the service-role client.

COMMENT ON TABLE reo_gold_review IS
  'REO (Restaurant Experience Ontology) gold set, one row per review. proposed=draft/AI labels, gold=human truth. Admin-only eval tooling (2026-06-08).';

COMMIT;
