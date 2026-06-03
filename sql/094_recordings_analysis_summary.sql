-- 094_recordings_analysis_summary.sql
--
-- Meeting-level synthesis for the Recordings deck. The analyze pass gained a
-- third (synthesis) step that, after the curator settles topics, produces an
-- overall executive summary, per-topic summaries, an aggregate sentiment
-- breakdown, and the meeting's decisions. That is whole-meeting narrative — one
-- object per recording — so it lives in a column here rather than as extraction
-- rows. (Action items DO become action_item extraction rows; only the narrative
-- decisions list lives in this blob.)
--
-- Nullable add on an already-RLS-enabled table: existing recordings_org_read /
-- recordings_org_write policies cover it, so no new policy is needed. Older
-- recordings stay null and the deck degrades gracefully.

BEGIN;

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS analysis_summary jsonb;

COMMENT ON COLUMN recordings.analysis_summary IS
  'Meeting-level synthesis from the analyze pass third step (docs/RECORDINGS.md §3.5): { executive_summary, headline, sentiment_overall, sentiment_breakdown, topic_summaries[], decisions[], generated_at, model }. Action items live as action_item extraction rows, not here. Written by analyzeRecording + reanalyzeRecording(scope=all); null for recordings analyzed before 2026-06.';

COMMIT;
