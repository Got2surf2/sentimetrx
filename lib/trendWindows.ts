// lib/trendWindows.ts
//
// Derive the time framing for trend charts + recent-vs-prior alert windows
// DYNAMICALLY from the date range of the data currently in view (post-filter) —
// never a hard-coded "last 2 quarters". Pure + unit-tested.
//
//   • bucketUnit  — chart granularity, adaptive so any span yields ~6–12 buckets
//   • domain      — chart x-axis (the full in-view span)
//   • recent/prior — the two comparison windows for the trend tier
//
// Reference modes:
//   'auto'         — most-recent third vs the prior third (default; volume-balanced)
//   'yoy'          — recent period vs the SAME period 12 months earlier (controls
//                    for seasonality — important for restaurants)
//   { recentDays } — explicit trailing window vs the equal period before it

const DAY = 86_400_000

export type TrendReference = 'auto' | 'yoy' | { recentDays: number }
export type BucketUnit = 'week' | 'month' | 'quarter'

export interface TrendWindow { startMs: number; endMs: number; label: string }
export interface TrendWindows {
  bucketUnit:    BucketUnit
  domainStartMs: number
  domainEndMs:   number
  recent:        TrendWindow | null   // null when the span is too short to compare
  prior:         TrendWindow | null
  windowLabel:   string | null        // e.g. "last 4 months vs prior 4 months"
}

function humanDur(days: number): string {
  // Breakpoints chosen so the smallest count in each unit is ≥ 2 (no "1 month").
  if (days >= 365) { const q = Math.round(days / 91); return `${q} quarters` }
  if (days >= 70)  { const m = Math.round(days / 30); return `${m} months` }
  if (days >= 11)  { const w = Math.round(days / 7);  return `${w} weeks` }
  return `${Math.max(1, Math.round(days))} days`
}

export function pickBucketUnit(spanDays: number): BucketUnit {
  // Target ~6–12 buckets across the span.
  if (spanDays <= 90)  return 'week'
  if (spanDays <= 420) return 'month'
  return 'quarter'
}

/**
 * @param minMs / maxMs  earliest / latest in-view timestamp (ms)
 * @param reference      comparison mode (default 'auto')
 */
export function deriveTrendWindows(minMs: number, maxMs: number, reference: TrendReference = 'auto'): TrendWindows {
  const spanDays = (maxMs - minMs) / DAY
  const bucketUnit = pickBucketUnit(spanDays)
  const base: TrendWindows = {
    bucketUnit, domainStartMs: minMs, domainEndMs: maxMs, recent: null, prior: null, windowLabel: null,
  }

  // Need a meaningful span before any recent-vs-prior comparison is honest.
  if (spanDays < 45) return base

  if (reference === 'yoy') {
    // Recent = trailing ~quarter (or a quarter of the span if shorter), prior =
    // the same calendar window one year earlier. Requires ≥ ~13 months of data.
    const recentDays = Math.min(91, Math.max(30, Math.round(spanDays / 4)))
    const recentStart = maxMs - recentDays * DAY
    const priorEndMs = maxMs - 365 * DAY                 // same window, one year back
    const priorStartMs = priorEndMs - recentDays * DAY
    if (priorStartMs < minMs) return base                // not enough history for YoY
    return {
      ...base,
      recent: { startMs: recentStart, endMs: maxMs, label: `last ${humanDur(recentDays)}` },
      prior:  { startMs: priorStartMs, endMs: priorEndMs, label: 'same period last year' },
      windowLabel: `last ${humanDur(recentDays)} vs same period last year`,
    }
  }

  // Explicit trailing window, or 'auto' (= span/3).
  const recentDays = typeof reference === 'object'
    ? reference.recentDays
    : Math.round(spanDays / 3)
  if (recentDays < 7 || recentDays * 2 > spanDays + 1) return base

  const recentStart = maxMs - recentDays * DAY
  const priorStart = maxMs - 2 * recentDays * DAY
  return {
    ...base,
    recent: { startMs: recentStart, endMs: maxMs, label: `last ${humanDur(recentDays)}` },
    prior:  { startMs: priorStart, endMs: recentStart, label: `prior ${humanDur(recentDays)}` },
    windowLabel: `last ${humanDur(recentDays)} vs prior ${humanDur(recentDays)}`,
  }
}

/** Bucket a timestamp into a label for the chart x-axis, per the chosen unit. */
export function bucketKey(ms: number, unit: BucketUnit): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  if (unit === 'week') {
    // ISO-ish week start (Monday) as YYYY-MM-DD.
    const day = (d.getUTCDay() + 6) % 7
    const monday = new Date(ms - day * DAY)
    return monday.toISOString().slice(0, 10)
  }
  if (unit === 'month') return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}
