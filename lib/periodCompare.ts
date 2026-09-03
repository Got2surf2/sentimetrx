// lib/periodCompare.ts
// Period-over-period comparison for the Charts time series (owner ask,
// 2026-09-02: "same quarter last year", "vs last month" — a Compare-periods
// control overlaying two series plus a delta summary).
//
// Pure bucket math over the SAME bucket keys the chart already uses
// (lib/trendWindows.bucketKey formats: day/week 'YYYY-MM-DD', month
// 'YYYY-MM', quarter 'YYYY-Qn'). The observed buckets are first FILLED into a
// complete sequence (a month nobody wrote a review in is a real 0 in count
// mode, an honest gap in metric mode), so window alignment is calendar-exact
// and sparse data can't shift the comparison.

export type CompareUnit = 'day' | 'week' | 'month' | 'quarter'
export type CompareMode = 'prev' | 'yoy'

const DAY = 86_400_000

/** Shift a bucket key by `by` units (negative = back in time). */
export function shiftBucket(key: string, unit: CompareUnit, by: number): string {
  if (unit === 'month') {
    const [y, m] = key.split('-').map(Number)
    const total = y * 12 + (m - 1) + by
    return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
  }
  if (unit === 'quarter') {
    const [y, q] = key.split('-Q').map(Number)
    const total = y * 4 + (q - 1) + by
    return `${Math.floor(total / 4)}-Q${(((total % 4) + 4) % 4) + 1}`
  }
  // day / week — a date string; week buckets are Mondays, so ±7d stays a Monday.
  const step = unit === 'week' ? 7 : 1
  const d = new Date(key + 'T00:00:00Z').getTime() + by * step * DAY
  return new Date(d).toISOString().slice(0, 10)
}

/** One year back, staying on the bucket grid (52 weeks for week buckets). */
function yearBack(key: string, unit: CompareUnit): string {
  if (unit === 'month') return shiftBucket(key, unit, -12)
  if (unit === 'quarter') return shiftBucket(key, unit, -4)
  if (unit === 'week') return shiftBucket(key, unit, -52)
  // day: the same calendar date last year (Feb 29 falls back to Feb 28).
  const [y, m, d] = key.split('-').map(Number)
  const prev = new Date(Date.UTC(y - 1, m - 1, d))
  if (prev.getUTCMonth() !== m - 1) prev.setUTCDate(0)
  return prev.toISOString().slice(0, 10)
}

/** Complete bucket sequence from first to last (inclusive). */
export function fillBuckets(first: string, last: string, unit: CompareUnit): string[] {
  const out: string[] = []
  let k = first
  for (let guard = 0; guard < 4000 && k <= last; guard++) {
    out.push(k)
    k = shiftBucket(k, unit, 1)
  }
  return out
}

export interface PeriodComparison {
  /** Current-period bucket keys — the chart's x-axis. */
  x: string[]
  /** y per current bucket (count, or metric average; null = gap). */
  current: (number | null)[]
  /** Aligned prior-period y per current bucket. */
  comparison: (number | null)[]
  /** The prior bucket each comparison point came from (hover labels). */
  comparisonKeys: string[]
  /** e.g. "vs previous 6 months" / "vs same period last year". */
  label: string
  delta: {
    /** Count mode: total rows. Metric mode: count-weighted average. */
    currentTotal: number
    priorTotal: number
    /** Percent change current vs prior (null when prior is 0 / empty). */
    pctChange: number | null
  }
}

function unitNoun(unit: CompareUnit, n: number): string {
  const noun = unit === 'day' ? 'day' : unit === 'week' ? 'week' : unit === 'month' ? 'month' : 'quarter'
  return n + ' ' + noun + (n === 1 ? '' : 's')
}

/**
 * Build an aligned two-period comparison from observed buckets.
 *
 * mode 'prev' — the filled span splits into two equal halves: the trailing
 * half is the current period, the half before it the comparison.
 * mode 'yoy'  — current period = the trailing ≤1 year of buckets that have a
 * full year of history behind them; comparison = the same calendar window one
 * year earlier. Returns null when the data can't honestly support the
 * comparison (fewer than 4 buckets per side, or no pre-year history for yoy).
 */
export function buildPeriodComparison(opts: {
  dates: string[]
  counts: number[]
  /** Metric sum per bucket (align with dates); omit/empty in count mode. */
  sums?: (number | null)[]
  unit: CompareUnit
  mode: CompareMode
  metric: boolean
}): PeriodComparison | null {
  const { unit, mode, metric } = opts
  if (opts.dates.length < 2) return null

  const byKey = new Map<string, { count: number; sum: number | null }>()
  opts.dates.forEach((d, i) => {
    byKey.set(d, { count: opts.counts[i] || 0, sum: opts.sums ? opts.sums[i] : null })
  })
  const filled = fillBuckets(opts.dates[0], opts.dates[opts.dates.length - 1], unit)
  if (filled.length < 8) return null

  const perYear = unit === 'day' ? 365 : unit === 'week' ? 52 : unit === 'month' ? 12 : 4

  let currentKeys: string[]
  let priorKeyOf: (k: string) => string
  let label: string
  if (mode === 'yoy') {
    // Buckets that have a full year of history behind them, capped at one year.
    const n = Math.min(perYear, filled.length - perYear)
    if (n < 4) return null
    currentKeys = filled.slice(-n)
    priorKeyOf = (k) => yearBack(k, unit)
    label = 'vs same period last year'
  } else {
    const n = Math.floor(filled.length / 2)
    if (n < 4) return null
    currentKeys = filled.slice(-n)
    priorKeyOf = (k) => shiftBucket(k, unit, -n)
    label = 'vs previous ' + unitNoun(unit, n)
  }

  const yOf = (k: string): number | null => {
    const b = byKey.get(k)
    if (!b) return metric ? null : 0
    if (!metric) return b.count
    return b.sum != null && b.count > 0 ? b.sum / b.count : null
  }

  const comparisonKeys = currentKeys.map(priorKeyOf)
  const current = currentKeys.map(yOf)
  const comparison = comparisonKeys.map(yOf)

  const totals = (keys: string[]): { total: number; n: number } => {
    let cnt = 0, sum = 0, sumN = 0
    keys.forEach((k) => {
      const b = byKey.get(k)
      if (!b) return
      cnt += b.count
      if (b.sum != null) { sum += b.sum; sumN += b.count }
    })
    return metric ? { total: sumN > 0 ? sum / sumN : 0, n: sumN } : { total: cnt, n: cnt }
  }
  const cur = totals(currentKeys)
  const pri = totals(comparisonKeys)
  if (pri.n === 0 && cur.n === 0) return null

  return {
    x: currentKeys,
    current,
    comparison,
    comparisonKeys,
    label,
    delta: {
      currentTotal: cur.total,
      priorTotal: pri.total,
      pctChange: pri.total !== 0 && pri.n > 0 ? ((cur.total - pri.total) / Math.abs(pri.total)) * 100 : null,
    },
  }
}
