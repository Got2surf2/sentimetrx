// lib/filterUtils.ts
// Filter types and application function.
// Shared between client (TextMine, Charts, Stats) and server.

export interface CatFilter {
  type: 'cat'
  // 'include' = allowlist (keep rows whose value is in `values`).
  // 'exclude' = denylist (drop rows whose value is in `values`).
  // The modal picks 'exclude' when the user starts from "All" and unchecks
  // a few values, so long-tail values not visible in the top-N list still
  // pass. 'include' is used when the user clicks "None" then re-selects.
  // Old saved filters (no mode field) deserialize as 'include' for back-
  // compat, matching pre-refactor behavior.
  mode: 'include' | 'exclude'
  values: Set<string>
  excludeBlanks: boolean
}

export interface RangeFilter {
  type: 'range'
  values: [number, number]
  includeBlanks: boolean
}

export interface DateRangeFilter {
  type: 'daterange'
  values: [number, number] // timestamps
  includeBlanks: boolean
}

export type FieldFilter = CatFilter | RangeFilter | DateRangeFilter

export type Filters = Record<string, FieldFilter>

// Serializable versions (for JSON storage — Sets become arrays)
export interface SerializedCatFilter { type: 'cat'; mode?: 'include' | 'exclude'; values: string[]; excludeBlanks: boolean }
export interface SerializedRangeFilter { type: 'range'; values: [number, number]; includeBlanks: boolean }
export interface SerializedDateRangeFilter { type: 'daterange'; values: [number, number]; includeBlanks: boolean }
export type SerializedFilter = SerializedCatFilter | SerializedRangeFilter | SerializedDateRangeFilter
export type SerializedFilters = Record<string, SerializedFilter>

export function serializeFilters(filters: Filters): SerializedFilters {
  const out: SerializedFilters = {}
  Object.entries(filters).forEach(function(entry) {
    const field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      out[field] = { type: 'cat', mode: f.mode, values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = { type: 'range', values: f.values, includeBlanks: f.includeBlanks }
    } else if (f.type === 'daterange') {
      out[field] = { type: 'daterange', values: f.values, includeBlanks: f.includeBlanks }
    }
  })
  return out
}

export function deserializeFilters(raw: SerializedFilters): Filters {
  const out: Filters = {}
  Object.entries(raw).forEach(function(entry) {
    const field = entry[0], f = entry[1]
    if (f.type === 'cat') {
      // Default to 'include' for filters serialized before mode existed —
      // matches their old applyFilters behavior so saved sessions don't
      // suddenly invert.
      out[field] = { type: 'cat', mode: f.mode || 'include', values: new Set(f.values), excludeBlanks: f.excludeBlanks }
    } else if (f.type === 'range') {
      out[field] = f as RangeFilter
    } else if (f.type === 'daterange') {
      out[field] = f as DateRangeFilter
    }
  })
  return out
}

function parseDate(s: string): Date | null {
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function applyFilters(rows: Record<string, unknown>[], filters: Filters): Record<string, unknown>[] {
  if (!filters || !Object.keys(filters).length) return rows
  return rows.filter(function(r) {
    return Object.entries(filters).every(function(entry) {
      const field = entry[0], f = entry[1]
      const val = r[field]
      if (f.type === 'cat') {
        // Blank rows are governed solely by `excludeBlanks` (regardless of
        // mode) so the modal's "Include blanks" checkbox actually means what
        // it says.
        const isBlank = val == null || String(val).trim() === ''
        if (isBlank) return !f.excludeBlanks
        // mode='exclude': drop rows whose value is in the denylist (long-tail
        // values never present in the modal's top-N list still pass).
        // mode='include': keep only rows whose value is in the allowlist (so
        // "None" → pick a few" still works as expected).
        if (f.mode === 'exclude') return !f.values.has(String(val))
        return f.values.has(String(val))
      }
      if (f.type === 'range') {
        const n = parseFloat(String(val ?? ''))
        if (isNaN(n)) return f.includeBlanks !== false
        return n >= f.values[0] && n <= f.values[1]
      }
      if (f.type === 'daterange') {
        if (val == null || String(val).trim() === '') return f.includeBlanks !== false
        const dd = parseDate(String(val))
        if (!dd) return f.includeBlanks !== false
        const ts = dd.getTime()
        return ts >= f.values[0] && ts <= f.values[1]
      }
      return true
    })
  })
}

export function filterCount(filters: Filters): number {
  return Object.keys(filters).length
}

export function filterSummary(filters: Filters, aliases: Record<string, string>): string {
  if (!Object.keys(filters).length) return ''
  return Object.entries(filters).map(function(entry) {
    const field = entry[0], f = entry[1]
    const label = aliases[field] || field
    if (f.type === 'cat') {
      const vals = Array.from(f.values)
      const prefix = f.mode === 'exclude' ? 'not ' : ''
      if (vals.length <= 2) return label + ': ' + prefix + vals.join(', ')
      return label + ': ' + prefix + vals.length + ' values'
    }
    if (f.type === 'range') return label + ': ' + f.values[0] + '\u2013' + f.values[1]
    if (f.type === 'daterange') {
      const fmt = function(ts: number) { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() }
      return label + ': ' + fmt(f.values[0]) + '\u2013' + fmt(f.values[1])
    }
    return label
  }).join(' \u00B7 ')
}

// ---------------------------------------------------------------------------
// Saved-view PERIODS \u2014 relative date ranges. See docs/SAVED_VIEWS.md \u00A73.
//
// resolvePeriod turns a relative spec ("current quarter") into a concrete
// half-open [startTs, endTs) range using CALENDAR arithmetic (never millisecond
// math) so month-length and leap differences self-correct. v1 resolves in UTC;
// the org-timezone boundary is a reserved retrofit \u2014 the opts carry the seam
// (fiscalYearStartMonth today, a tz later) so it's a setting, not a rewrite.
// ---------------------------------------------------------------------------

export type PeriodGranularity = 'month' | 'quarter' | 'year'
// 'current' / 'last' resolve relative to opts.now; { specific } anchors to the
// period CONTAINING the given ISO date.
export type PeriodAnchor = 'current' | 'last' | { specific: string }

export interface PeriodPrimary {
  granularity: PeriodGranularity
  anchor:      PeriodAnchor
}

export interface PeriodOffset {
  unit: PeriodGranularity
  n:    number          // e.g. { unit: 'year', n: -1 } = "same period last year"
}

export interface PeriodSpec {
  field:    string                      // date column the period filters
  primary:  PeriodPrimary
  compare?: { offset: PeriodOffset }    // v1: one comparison; shape allows N later
}

export interface ResolvePeriodOpts {
  now:                  number          // reference instant (ms since epoch)
  fiscalYearStartMonth?: number         // 1-12, default 1 (January); v1 UI is calendar-only
}

export type TsRange = [number, number]  // half-open [start, end)

const GRANULARITY_MONTHS: Record<PeriodGranularity, number> = { month: 1, quarter: 3, year: 12 }

// Absolute month index (year*12 + monthIndex) of the UTC month containing `ms`.
function utcMonthIndex(ms: number): number {
  const d = new Date(ms)
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

// UTC midnight on the 1st of the month at absolute month index `ami`.
function amiToTs(ami: number): number {
  const y = Math.floor(ami / 12)
  const m = ami - y * 12
  return Date.UTC(y, m, 1)
}

// Start (absolute month index) + length in months of the `granularity` period
// that CONTAINS month index `ami`, honoring the fiscal-year start month (1-12).
function periodBounds(ami: number, granularity: PeriodGranularity, fiscalStartMonth: number): { startAmi: number; months: number } {
  const months = GRANULARITY_MONTHS[granularity]
  if (granularity === 'month') return { startAmi: ami, months: 1 }
  // Shift onto a line whose zero is the fiscal-year start, snap down to the
  // period boundary, then shift back. (ami is always large+positive, so the
  // floor is safe even when the fiscal offset is non-zero.)
  const fOffset = fiscalStartMonth - 1
  const snapped = Math.floor((ami - fOffset) / months) * months
  return { startAmi: snapped + fOffset, months: months }
}

function rangeFromStart(startAmi: number, months: number): TsRange {
  return [amiToTs(startAmi), amiToTs(startAmi + months)]
}

export function resolvePeriod(primary: PeriodPrimary, opts: ResolvePeriodOpts): TsRange {
  const fiscalStart = opts.fiscalYearStartMonth || 1
  const refMs = (typeof primary.anchor === 'object' && primary.anchor.specific)
    ? Date.parse(primary.anchor.specific)
    : opts.now
  const bounds = periodBounds(utcMonthIndex(refMs), primary.granularity, fiscalStart)
  let startAmi = bounds.startAmi
  if (primary.anchor === 'last') startAmi -= bounds.months
  return rangeFromStart(startAmi, bounds.months)
}

// Comparison range = the primary period shifted by an offset (NOT an absolute
// range), so "current quarter vs same quarter last year" rolls forward forever.
// (To-date alignment for in-progress periods is a render-time concern \u2014 \u00A74.1 \u2014
// applied on top of these full ranges, not here.)
export function resolveComparison(primary: PeriodPrimary, offset: PeriodOffset, opts: ResolvePeriodOpts): TsRange {
  const fiscalStart = opts.fiscalYearStartMonth || 1
  const primaryRange = resolvePeriod(primary, opts)
  const startAmi = utcMonthIndex(primaryRange[0])
  const months = periodBounds(startAmi, primary.granularity, fiscalStart).months
  return rangeFromStart(startAmi + offset.n * GRANULARITY_MONTHS[offset.unit], months)
}

// Bridge a resolved half-open period into the existing DateRangeFilter, whose
// applyFilters branch is INCLUSIVE on both ends ([start, end]). Subtracting 1ms
// from the exclusive end keeps a boundary-instant row in exactly one period.
export function periodToDateFilter(range: TsRange, includeBlanks = false): DateRangeFilter {
  return { type: 'daterange', values: [range[0], range[1] - 1], includeBlanks: includeBlanks }
}
