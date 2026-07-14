// Single source of truth for "does this comment carry usable feedback?" —
// the substantive / "useful" flag surfaced across TextMine (mining corpus,
// theme-fit denominator, the dataset-level substantive %, Filters).
//
// The flag is STORED per comment at ingest (dataset_rows_flat.substantive) so
// every count is a cheap boolean read that agrees everywhere — no JS-vs-SQL
// drift. The SCORER is deliberately swappable and VERSIONED: v1 is the cheap
// deterministic word rule; a later v2 can be an LLM judgment ("does this carry
// actionable feedback?") that is re-scored on demand, never recomputed per
// query. `substantive_v` on the row records which scorer stamped it, so a
// bump lets a backfill find and re-score stale rows.
import { isSubstantiveText } from './datasetUtils'

// Bump when scoreUsefulness changes so stored rows can be identified as stale.
export const USEFULNESS_VERSION = 1

// v1 — the deterministic word rule (owner ask 2026-07-11): >=5 words, or >=4
// words containing an everyday function word. "Nothing" / "N/A" fail.
export function scoreUsefulness(text: string): boolean {
  return isSubstantiveText(text)
}

// The substantive open-ended field names for one parsed row, given the row's
// values keyed by field and the set of fields that are open-ended text. Stored
// as the `substantive` jsonb map (present key = substantive); absent/empty =
// nothing useful in that row. Keeping only the TRUE keys keeps the blob small.
export function substantiveFieldsFor(
  data: Record<string, unknown>,
  openEndedFields: string[],
): Record<string, true> {
  const out: Record<string, true> = {}
  for (const f of openEndedFields) {
    const v = data[f]
    if (v != null && scoreUsefulness(String(v))) out[f] = true
  }
  return out
}
