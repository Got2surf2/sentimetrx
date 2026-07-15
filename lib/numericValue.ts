// lib/numericValue.ts
// Single client-side source of truth for "is this cell a number, and what number".
//
// Three layers used to disagree on what counts as numeric for a chart VALUE:
//   * the field-type classifier — `!isNaN(Number(v.trim()))` (lib/datasetUtils.ts)
//   * the SQL aggregate RPCs — `btrim(v) ~ tolerant-regex` then `::double precision`
//     (sql/182, the fix for the "No groups found." bug)
//   * the client rows-fallback charts — `parseFloat(String(v))`
// `parseFloat` is the odd one out: it accepts trailing garbage ("4.5abc"→4.5) and
// mis-reads thousands separators ("1,000"→1), so a collection/virtual-field chart
// could show a different mean than the SQL path for the same field.
//
// `toNumericOrNull` matches the classifier + SQL exactly: trim, require the same
// tolerant numeric shape Postgres accepts (whitespace-padded, leading/trailing
// dot, scientific), then Number(). Returns null for anything else (blank,
// "1,000", "4/5", "4 stars", Infinity) so callers can skip it.
const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

export function toNumericOrNull(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (!NUMERIC_RE.test(s)) return null
  const n = Number(s)
  return isNaN(n) ? null : n
}
