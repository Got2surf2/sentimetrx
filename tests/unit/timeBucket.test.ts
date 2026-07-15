import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { bucketKey } from '@/lib/timeBucket'

// Regression for the timezone day-shift: `new Date("2024-01-01")` is UTC
// midnight, so local getters read the PREVIOUS day in any negative-UTC zone,
// misbucketing period-boundary dates and disagreeing with the SQL ::date path.
// bucketKey now parses ISO date-only strings as local calendar dates.
describe('bucketKey — timezone-safe boundary dates', () => {
  const orig = process.env.TZ
  beforeAll(() => { process.env.TZ = 'America/New_York' })
  afterAll(() => { process.env.TZ = orig })

  it('buckets a first-of-period date to the correct period in a negative-UTC zone', () => {
    expect(bucketKey('2024-01-01', 'day')).toBe('2024-01-01')
    expect(bucketKey('2024-01-01', 'month')).toBe('2024-01')
    expect(bucketKey('2024-01-01', 'quarter')).toBe('2024-Q1')
    expect(bucketKey('2024-01-01', 'year')).toBe('2024')
    // 2024-01-01 is a Monday → its own week key
    expect(bucketKey('2024-01-01', 'week')).toBe('2024-01-01')
  })

  it('preserves the calendar date for datetime strings without a zone', () => {
    expect(bucketKey('2024-03-31T23:30', 'month')).toBe('2024-03')
    expect(bucketKey('2024-12-31T12:00', 'year')).toBe('2024')
  })
})
