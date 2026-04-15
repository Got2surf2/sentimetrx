// lib/timeBucket.ts — Smart time-axis bucketing utility
// Picks optimal bucket granularity based on data range, with user override support.

export type TimeBucket = 'hour' | 'day' | 'week' | 'month'

export const BUCKET_OPTIONS: { value: TimeBucket; label: string }[] = [
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
]

/**
 * Pick the best bucket granularity for a date range.
 * - < 3 days → hourly
 * - 3–90 days → daily
 * - 90–365 days → weekly
 * - > 365 days → monthly
 */
export function autoBucket(minDate: Date | string, maxDate: Date | string): TimeBucket {
  const lo = typeof minDate === 'string' ? new Date(minDate) : minDate
  const hi = typeof maxDate === 'string' ? new Date(maxDate) : maxDate
  const days = (hi.getTime() - lo.getTime()) / (1000 * 60 * 60 * 24)
  if (days < 3) return 'hour'
  if (days < 90) return 'day'
  if (days < 365) return 'week'
  return 'month'
}

/**
 * Bucket a JS Date into a string key for the given granularity.
 */
export function bucketKey(date: Date | string, bucket: TimeBucket): string {
  const d = typeof date === 'string' ? new Date(date) : date
  switch (bucket) {
    case 'hour':
      return d.toISOString().slice(0, 13) + ':00' // YYYY-MM-DDTHH:00
    case 'day':
      return d.toISOString().slice(0, 10) // YYYY-MM-DD
    case 'week': {
      // Snap to Monday
      const day = d.getUTCDay()
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff))
      return monday.toISOString().slice(0, 10)
    }
    case 'month':
      return d.toISOString().slice(0, 7) // YYYY-MM
  }
}

/**
 * Format a bucket key for display.
 */
export function formatBucketLabel(key: string, bucket: TimeBucket): string {
  switch (bucket) {
    case 'hour': {
      const d = new Date(key)
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })
    }
    case 'day': {
      const d = new Date(key + 'T00:00:00Z')
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
    }
    case 'week': {
      const d = new Date(key + 'T00:00:00Z')
      return 'W/O ' + d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
    }
    case 'month': {
      const d = new Date(key + '-01T00:00:00Z')
      return d.toLocaleString(undefined, { month: 'short', year: '2-digit' })
    }
  }
}
