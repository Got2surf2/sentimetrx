// lib/termInsights.ts
//
// "Where does this term show up disproportionately?" — for a given word or
// set of theme keywords, find categorical fields whose values have an
// abnormally HIGH or LOW frequency of the term compared to the overall
// dataset frequency. Powers the Insights view in OpinionPopover and
// ThemePopover.
//
// Outlier scoring is a direct port of the legacy Ana approach
// (oldana/comments/insights.py — `probability()` + `calculate_insights()`):
// a two-proportion z-test comparing the in-group rate to the out-of-group
// rate, using the overall rate as the pooled variance estimate.
//
//   z = (p_group - p_other) / sqrt( p_overall * (1 - p_overall) * (1/n_group + 1/n_other) )
//
// Threshold defaults match legacy Ana:
//   - |z| ≥ 1.64 → significant at 5% one-sided (separately for higher / lower)
//   - group must be at least 10% of total to qualify (excludes tiny outliers)
//   - skip the field if it's a date or has too many distinct values

const Z_THRESHOLD = 1.64    // 95% one-sided significance (legacy Ana)
// Absolute floor on group size for statistical validity. The two-proportion
// z-test needs n>=30 to be reliable (rule of thumb). Below that the SE is too
// large to draw conclusions. We do NOT additionally require a 10% share —
// legacy Ana did, but on heavily skewed datasets (e.g. 80% 5★ reviews) that
// rule masks the most extreme outlier (the small-but-statistically-robust 4★).
const MIN_VALUE_TOTAL = 30
// Cap on distinct values per field. Fields with more than this many distinct
// values aren't useful as insight breakdowns (too granular — every value
// becomes its own tiny group). 20 catches typical metadata fields (rating,
// source, brand, daypart, day-of-week, age bucket, segment) without dragging
// in noise like ZIP / City / individual user IDs.
const MAX_CARDINALITY = 20
// Headline shows up to this many outliers per direction. Beyond this, the
// expanded per-value table is the place to see them.
const HEADLINE_MAX_OUTLIERS = 3
const MAX_DATE_YEAR = 2100
const MIN_DATE_YEAR = 2000

/** A single field value's statistics. */
export interface ValueRow {
  value: string
  matching: number   // rows where value=this AND text contains the term
  total: number      // rows where value=this
  frequency: number  // matching / total — value's local rate
  zscore: number     // (frequency - overall) / standard_error
}

/** Per-field summary returned by the insights computation. */
export interface FieldInsights {
  field: string
  uniqueValues: number
  overallMatching: number
  overallTotal: number
  overallFrequency: number   // matching/total across all rows that have this field set
  values: ValueRow[]
  /** All eligible values with z >= Z_THRESHOLD, sorted most-extreme-first. */
  moreFrequent: ValueRow[]
  /** All eligible values with z <= -Z_THRESHOLD, sorted most-extreme-first. */
  lessFrequent: ValueRow[]
}

/** Why a field was skipped from the insights analysis. */
export type SkipReason = 'text-field' | 'no-data' | 'date-like' | 'single-value' | 'too-many-values'

export interface FieldDetection {
  accepted: string[]
  skipped: { field: string; reason: SkipReason; uniqueValues?: number }[]
}

/**
 * Pick fields suitable for outlier analysis: not text fields, not dates,
 * with reasonable cardinality (2..MAX_CARDINALITY unique values).
 * Returns both accepted candidates AND the rejected ones with reasons,
 * so the UI can show why a field didn't appear.
 *
 * Scans ALL rows — not a head slice. Collection rows are returned
 * concatenated member-by-member, so a head-slice approach would only see
 * the first member's values: a field that's single-valued per member
 * (e.g. _collection_label, or a state field on a single-region dataset)
 * would falsely look single-valued for the whole union and be skipped.
 */
export function detectInsightFieldsDetailed(
  rows: Record<string, unknown>[],
  excludeFields: string[],
): FieldDetection {
  if (rows.length === 0) return { accepted: [], skipped: [] }
  const exclude = new Set(excludeFields)
  const SAMPLE_FOR_DATE = 100

  const allKeys = new Set<string>()
  const fieldData = new Map<string, { uniq: Set<string>; sample: unknown[]; over: boolean }>()

  for (const r of rows) {
    if (!r) continue
    for (const k of Object.keys(r)) {
      allKeys.add(k)
      if (exclude.has(k)) continue
      const v = r[k]
      if (v == null || v === '') continue
      let fd = fieldData.get(k)
      if (!fd) { fd = { uniq: new Set(), sample: [], over: false }; fieldData.set(k, fd) }
      if (fd.sample.length < SAMPLE_FOR_DATE) fd.sample.push(v)
      if (fd.over) continue
      fd.uniq.add(String(v).trim())
      if (fd.uniq.size > MAX_CARDINALITY) fd.over = true
    }
  }

  const accepted: string[] = []
  const skipped: { field: string; reason: SkipReason; uniqueValues?: number }[] = []

  for (const k of Array.from(allKeys)) {
    if (exclude.has(k)) {
      skipped.push({ field: k, reason: 'text-field' })
      continue
    }
    const fd = fieldData.get(k)
    if (!fd || fd.sample.length === 0) {
      skipped.push({ field: k, reason: 'no-data' })
      continue
    }
    let dateLike = 0
    for (const v of fd.sample) {
      if (typeof v !== 'string') break
      const t = Date.parse(v)
      if (isNaN(t)) break
      const y = new Date(t).getUTCFullYear()
      if (y >= MIN_DATE_YEAR && y <= MAX_DATE_YEAR) dateLike++
    }
    if (dateLike >= fd.sample.length * 0.8) {
      skipped.push({ field: k, reason: 'date-like' })
      continue
    }
    if (fd.over) {
      skipped.push({ field: k, reason: 'too-many-values', uniqueValues: fd.uniq.size })
      continue
    }
    if (fd.uniq.size < 2) {
      skipped.push({ field: k, reason: 'single-value', uniqueValues: fd.uniq.size })
      continue
    }
    accepted.push(k)
  }
  return { accepted, skipped }
}

export function detectInsightFields(
  rows: Record<string, unknown>[],
  excludeFields: string[],
): string[] {
  return detectInsightFieldsDetailed(rows, excludeFields).accepted
}

/** Does any of `targets` appear (substring) in any of the row's text fields? */
function rowMatchesTerm(
  row: Record<string, unknown>,
  textFields: string[],
  targetsLowered: string[],
): boolean {
  for (const f of textFields) {
    const t = String(row[f] || '').toLowerCase()
    for (const target of targetsLowered) {
      if (t.includes(target)) return true
    }
  }
  return false
}

/** Compute outlier statistics for one field. */
export function fieldInsights(
  rows: Record<string, unknown>[],
  textFields: string[],
  targets: string[],
  field: string,
): FieldInsights | null {
  const lowered = targets.map(t => t.toLowerCase()).filter(Boolean)
  if (lowered.length === 0) return null

  const groups = new Map<string, { matching: number; total: number }>()
  let overallMatching = 0
  let overallTotal = 0

  for (const row of rows) {
    const raw = row[field]
    if (raw == null || raw === '') continue
    const v = String(raw).trim()
    if (!v) continue
    const hit = rowMatchesTerm(row, textFields, lowered)
    let g = groups.get(v)
    if (!g) { g = { matching: 0, total: 0 }; groups.set(v, g) }
    g.total++
    overallTotal++
    if (hit) {
      g.matching++
      overallMatching++
    }
  }

  if (overallTotal === 0) return null
  const overallFrequency = overallMatching / overallTotal

  const valueRows: ValueRow[] = []
  for (const [value, g] of Array.from(groups.entries())) {
    const frequency = g.total > 0 ? g.matching / g.total : 0
    // Two-proportion z-test (matches legacy Ana's `probability()`):
    // compare the in-group rate vs. the out-of-group rate, with the overall
    // rate as the pooled variance estimate.
    const otherTotal = overallTotal - g.total
    const otherMatching = overallMatching - g.matching
    const otherFreq = otherTotal > 0 ? otherMatching / otherTotal : 0
    const denom = overallFrequency * (1 - overallFrequency) * (1 / Math.max(g.total, 1) + 1 / Math.max(otherTotal, 1))
    const zscore = denom > 0 ? (frequency - otherFreq) / Math.sqrt(denom) : 0
    valueRows.push({ value, matching: g.matching, total: g.total, frequency, zscore })
  }
  valueRows.sort((a, b) => b.zscore - a.zscore)

  // Eligibility: enough rows for the z-test to be reliable AND not the
  // entire dataset (which would make "vs other" trivially zero).
  const eligible = (v: ValueRow) => v.total >= MIN_VALUE_TOTAL && v.total < overallTotal

  // All significant outliers per direction, most-extreme-first. Cap the
  // headline display in the UI; the per-value table shows everything.
  const moreFrequent = valueRows
    .filter(v => eligible(v) && v.zscore >= Z_THRESHOLD)
  const lessFrequent = valueRows
    .filter(v => eligible(v) && v.zscore <= -Z_THRESHOLD)
    .sort((a, b) => a.zscore - b.zscore) // most-negative first

  return {
    field,
    uniqueValues: valueRows.length,
    overallMatching,
    overallTotal,
    overallFrequency,
    values: valueRows,
    moreFrequent,
    lessFrequent,
  }
}

/**
 * Compute insights across all auto-detected low-cardinality categorical fields.
 * Returns every eligible field — including ones with no statistically significant
 * outliers (those still show their per-value table when expanded, just with
 * "—" in the headline; the user can verify the analysis ran).
 *
 * Sort: fields with the strongest outlier (highest |z|) float to the top.
 * Fields without any outlier sort to the bottom but still appear.
 */
export function computeAllInsights(
  rows: Record<string, unknown>[],
  textFields: string[],
  targets: string[],
): FieldInsights[] {
  return computeAllInsightsDetailed(rows, textFields, targets).insights
}

/**
 * Same as computeAllInsights but also returns the field-detection diagnostic
 * (which fields were considered, which were skipped and why). The popover
 * uses this to show transparency about what was analyzed.
 */
export function computeAllInsightsDetailed(
  rows: Record<string, unknown>[],
  textFields: string[],
  targets: string[],
): { insights: FieldInsights[]; detection: FieldDetection } {
  const detection = detectInsightFieldsDetailed(rows, textFields)
  const out: FieldInsights[] = []
  for (const field of detection.accepted) {
    const ins = fieldInsights(rows, textFields, targets, field)
    if (!ins) continue
    out.push(ins)
  }
  out.sort((a, b) => {
    const aMax = Math.max(Math.abs(a.moreFrequent[0]?.zscore || 0), Math.abs(a.lessFrequent[0]?.zscore || 0))
    const bMax = Math.max(Math.abs(b.moreFrequent[0]?.zscore || 0), Math.abs(b.lessFrequent[0]?.zscore || 0))
    return bMax - aMax
  })
  return { insights: out, detection }
}
