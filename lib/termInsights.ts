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
const MIN_GROUP_SHARE = 0.10 // group must be ≥10% of the analyzed rows
const MIN_VALUE_TOTAL = 5    // absolute floor — ignore tiny groups even if share passes
const MAX_CARDINALITY = 50   // skip fields with too many distinct values
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
  moreFrequent: ValueRow | null   // highest z, capped at z >= Z_THRESHOLD
  lessFrequent: ValueRow | null   // lowest z, capped at z <= -Z_THRESHOLD
}

/**
 * Pick fields suitable for outlier analysis: not text fields, not dates,
 * with reasonable cardinality (2..MAX_CARDINALITY unique values).
 */
export function detectInsightFields(
  rows: Record<string, unknown>[],
  excludeFields: string[],
): string[] {
  if (rows.length === 0) return []
  const exclude = new Set(excludeFields)
  const candidates: string[] = []
  const keys = new Set<string>()
  // Sample 200 rows for key detection — datasets sometimes have sparse rows
  // where the first row doesn't include all columns.
  for (const r of rows.slice(0, 200)) for (const k of Object.keys(r || {})) keys.add(k)

  for (const k of Array.from(keys)) {
    if (exclude.has(k)) continue
    const sample: unknown[] = []
    for (const r of rows.slice(0, 500)) {
      const v = r[k]
      if (v != null && v !== '') sample.push(v)
      if (sample.length >= 100) break
    }
    if (sample.length === 0) continue

    // Drop date-like fields — they're handled by the frequency chart.
    let dateLike = 0
    for (const v of sample) {
      if (typeof v !== 'string') break
      const t = Date.parse(v)
      if (isNaN(t)) break
      const y = new Date(t).getUTCFullYear()
      if (y >= MIN_DATE_YEAR && y <= MAX_DATE_YEAR) dateLike++
    }
    if (dateLike >= sample.length * 0.8) continue

    // Cardinality check
    const uniq = new Set(sample.map(v => String(v).trim()))
    if (uniq.size < 2 || uniq.size > MAX_CARDINALITY) continue

    candidates.push(k)
  }
  return candidates
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

  // Eligibility: at least MIN_GROUP_SHARE of the analyzed rows AND >= MIN_VALUE_TOTAL
  // absolute. Matches legacy Ana's `size_percent > 0.1 && size_percent < 1` filter.
  const minTotalForGroup = Math.max(MIN_VALUE_TOTAL, Math.ceil(overallTotal * MIN_GROUP_SHARE))
  const eligible = (v: ValueRow) => v.total >= minTotalForGroup && v.total < overallTotal

  let moreFrequent: ValueRow | null = null
  for (const v of valueRows) {
    if (eligible(v) && v.zscore >= Z_THRESHOLD) { moreFrequent = v; break }
  }
  let lessFrequent: ValueRow | null = null
  for (let i = valueRows.length - 1; i >= 0; i--) {
    const v = valueRows[i]
    if (eligible(v) && v.zscore <= -Z_THRESHOLD) { lessFrequent = v; break }
  }

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
 * Compute insights across all auto-detected categorical fields.
 * Returns only fields with at least one detected outlier — silent fields
 * (everything is statistically uniform) are dropped from the summary.
 */
export function computeAllInsights(
  rows: Record<string, unknown>[],
  textFields: string[],
  targets: string[],
): FieldInsights[] {
  const fields = detectInsightFields(rows, textFields)
  const out: FieldInsights[] = []
  for (const field of fields) {
    const ins = fieldInsights(rows, textFields, targets, field)
    if (!ins) continue
    if (ins.moreFrequent || ins.lessFrequent) out.push(ins)
  }
  // Sort: most-extreme outlier first (highest |z|).
  out.sort((a, b) => {
    const aMax = Math.max(Math.abs(a.moreFrequent?.zscore || 0), Math.abs(a.lessFrequent?.zscore || 0))
    const bMax = Math.max(Math.abs(b.moreFrequent?.zscore || 0), Math.abs(b.lessFrequent?.zscore || 0))
    return bMax - aMax
  })
  return out
}
