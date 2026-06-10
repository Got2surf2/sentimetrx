-- 125_recording_draft.sql
--
-- Draft flag for a Town Hall report: the AI-generated report is available almost
-- immediately but is NOT yet human-reviewed. A draft renders a large DRAFT
-- watermark + an opening "pending human review" statement in both the on-screen
-- report and the exported PDF/deck, and is cleared when a human marks it reviewed.
--
-- DEFAULT false (NOT true): existing completed reports were effectively final, so
-- we must not retroactively watermark them. The generate UI defaults the checkbox
-- ON, so NEW analyses set draft=true; the user clears it via "Mark as reviewed".

BEGIN;

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS draft boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN recordings.draft IS
  'TRUE = report is an unreviewed AI draft (DRAFT watermark + pending-review banner in report & exports). Set when analysis runs (generate checkbox, default on); cleared by "Mark as reviewed".';

COMMIT;
