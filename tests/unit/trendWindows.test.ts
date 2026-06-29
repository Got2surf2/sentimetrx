import { describe, it, expect } from 'vitest'
import { deriveTrendWindows, pickBucketUnit, bucketKey } from '@/lib/trendWindows'

const DAY = 86_400_000
const iso = (s: string) => Date.parse(s + 'T00:00:00Z')

describe('pickBucketUnit — adaptive granularity', () => {
  it('weekly for short spans, monthly for ~1yr, quarterly for multi-year', () => {
    expect(pickBucketUnit(60)).toBe('week')
    expect(pickBucketUnit(300)).toBe('month')
    expect(pickBucketUnit(1200)).toBe('quarter')
  })
})

describe('deriveTrendWindows — auto (data-driven)', () => {
  it('splits the in-view span into most-recent-third vs prior-third', () => {
    const min = iso('2025-01-01'), max = iso('2026-01-01')   // ~365 days
    const w = deriveTrendWindows(min, max)
    expect(w.bucketUnit).toBe('month')
    expect(w.domainStartMs).toBe(min)
    expect(w.domainEndMs).toBe(max)
    expect(w.recent).not.toBeNull()
    // recent ≈ last 122 days; prior the 122 days before it; windows abut.
    expect(w.recent!.endMs).toBe(max)
    expect(w.prior!.endMs).toBe(w.recent!.startMs)
    expect(w.windowLabel).toContain('vs prior')
  })

  it('returns no comparison window when the span is too short', () => {
    const min = iso('2026-06-01'), max = iso('2026-06-20')   // 19 days
    const w = deriveTrendWindows(min, max)
    expect(w.recent).toBeNull()
    expect(w.prior).toBeNull()
    expect(w.bucketUnit).toBe('week')   // chart still renders
  })

  it('honours an explicit trailing window', () => {
    const min = iso('2024-01-01'), max = iso('2026-01-01')
    const w = deriveTrendWindows(min, max, { recentDays: 90 })
    expect(Math.round((w.recent!.endMs - w.recent!.startMs) / DAY)).toBe(90)
    expect(w.windowLabel).toContain('3 months vs prior 3 months')
  })
})

describe('deriveTrendWindows — year-over-year', () => {
  it('compares the recent window to the same window 12 months earlier', () => {
    const min = iso('2023-01-01'), max = iso('2026-01-01')
    const w = deriveTrendWindows(min, max, 'yoy')
    expect(w.recent).not.toBeNull()
    expect(w.prior!.label).toBe('same period last year')
    // prior window ends exactly one year before the recent window ends
    expect(Math.round((w.recent!.endMs - w.prior!.endMs) / DAY)).toBe(365)
    expect(w.windowLabel).toContain('same period last year')
  })

  it('falls back (no comparison) when there is < ~13 months of history', () => {
    const min = iso('2025-09-01'), max = iso('2026-01-01')
    const w = deriveTrendWindows(min, max, 'yoy')
    expect(w.recent).toBeNull()
  })
})

describe('bucketKey', () => {
  it('keys by week/month/quarter', () => {
    expect(bucketKey(iso('2026-02-15'), 'month')).toBe('2026-02')
    expect(bucketKey(iso('2026-02-15'), 'quarter')).toBe('2026-Q1')
    expect(bucketKey(iso('2026-11-10'), 'quarter')).toBe('2026-Q4')
  })
})
