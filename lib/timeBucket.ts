// lib/timeBucket.ts — Smart time-axis bucketing utility
// Picks optimal bucket granularity based on data range, with user override support.

export type TimeBucket = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year'

export const BUCKET_OPTIONS: { value: TimeBucket; label: string }[] = [
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Annual' },
]

/**
 * Pick the best bucket granularity for a date range.
 * - < 3 days → hourly
 * - 3–90 days → daily
 * - 90–365 days → weekly
 * - 365–730 days → monthly
 * - 730–1825 days → quarterly
 * - > 1825 days (5yr) → annual
 */
export function autoBucket(minDate: Date | string, maxDate: Date | string): TimeBucket {
  const lo = typeof minDate === 'string' ? new Date(minDate) : minDate
  const hi = typeof maxDate === 'string' ? new Date(maxDate) : maxDate
  const days = (hi.getTime() - lo.getTime()) / (1000 * 60 * 60 * 24)
  if (days < 3) return 'hour'
  if (days < 90) return 'day'
  if (days < 365) return 'week'
  if (days < 730) return 'month'
  if (days < 1825) return 'quarter'
  return 'year'
}

/**
 * Pad a number to 2 digits.
 */
function pad2(n: number): string { return n < 10 ? '0' + n : '' + n }

/**
 * Bucket a JS Date into a string key for the given granularity.
 * Uses local time so labels match the viewer's timezone.
 */
export function bucketKey(date: Date | string, bucket: TimeBucket): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const yyyy = d.getFullYear()
  const mm = pad2(d.getMonth() + 1)
  const dd = pad2(d.getDate())
  const hh = pad2(d.getHours())
  switch (bucket) {
    case 'hour':
      return `${yyyy}-${mm}-${dd}T${hh}:00`
    case 'day':
      return `${yyyy}-${mm}-${dd}`
    case 'week': {
      // Snap to Monday (local time)
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(yyyy, d.getMonth(), diff)
      return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`
    }
    case 'month':
      return `${yyyy}-${mm}`
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3) + 1
      return yyyy + '-Q' + q
    }
    case 'year':
      return String(yyyy)
  }
}

/**
 * Format a bucket key for display.
 */
export function formatBucketLabel(key: string, bucket: TimeBucket): string {
  switch (bucket) {
    case 'hour': {
      // key: YYYY-MM-DDTHH:00 (local time) — parse without Z to keep local
      const d = new Date(key)
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
    }
    case 'day': {
      // key: YYYY-MM-DD — parse as local midnight (no Z suffix)
      const d = new Date(key + 'T00:00:00')
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
    }
    case 'week': {
      const d = new Date(key + 'T00:00:00')
      return 'W/O ' + d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
    }
    case 'month': {
      const d = new Date(key + '-01T00:00:00')
      return d.toLocaleString(undefined, { month: 'short', year: '2-digit' })
    }
    case 'quarter': {
      const parts = key.split('-Q')
      return 'Q' + parts[1] + ' ' + parts[0]
    }
    case 'year':
      return key
  }
}
