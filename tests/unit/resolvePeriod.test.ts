import { describe, it, expect } from 'vitest'
import { resolvePeriod, resolveComparison, periodToDateFilter } from '@/lib/filterUtils'
import type { TsRange } from '@/lib/filterUtils'

// Reference instant: 15 May 2026 (UTC) — Q2, mid-month, mid-year.
const NOW = Date.UTC(2026, 4, 15)
const opts = { now: NOW }

const days = (r: TsRange) => (r[1] - r[0]) / 86_400_000

describe('resolvePeriod — calendar boundaries (half-open, UTC)', () => {
  it('current month', () => {
    expect(resolvePeriod({ granularity: 'month', anchor: 'current' }, opts))
      .toEqual([Date.UTC(2026, 4, 1), Date.UTC(2026, 5, 1)])
  })

  it('last month', () => {
    expect(resolvePeriod({ granularity: 'month', anchor: 'last' }, opts))
      .toEqual([Date.UTC(2026, 3, 1), Date.UTC(2026, 4, 1)])
  })

  it('current quarter (Q2 contains May)', () => {
    expect(resolvePeriod({ granularity: 'quarter', anchor: 'current' }, opts))
      .toEqual([Date.UTC(2026, 3, 1), Date.UTC(2026, 6, 1)])
  })

  it('last quarter (Q1)', () => {
    expect(resolvePeriod({ granularity: 'quarter', anchor: 'last' }, opts))
      .toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1)])
  })

  it('current year', () => {
    expect(resolvePeriod({ granularity: 'year', anchor: 'current' }, opts))
      .toEqual([Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1)])
  })

  it('specific anchor resolves the period CONTAINING the date', () => {
    expect(resolvePeriod({ granularity: 'quarter', anchor: { specific: '2025-08-10' } }, opts))
      .toEqual([Date.UTC(2025, 6, 1), Date.UTC(2025, 9, 1)]) // Q3 2025
  })
})

describe('resolvePeriod — half-open semantics', () => {
  it('end boundary is exclusive; periodToDateFilter clips it to inclusive end-1ms', () => {
    const q2 = resolvePeriod({ granularity: 'quarter', anchor: 'current' }, opts)
    const f = periodToDateFilter(q2)
    // Jul 1 00:00 (the exclusive end) must NOT be inside the inclusive filter.
    expect(f.values[1]).toBe(Date.UTC(2026, 6, 1) - 1)
    expect(f.values[0]).toBe(Date.UTC(2026, 3, 1))
  })
})

describe('resolveComparison — offset rolls forward', () => {
  it('current quarter vs same quarter last year', () => {
    const primary = { granularity: 'quarter' as const, anchor: 'current' as const }
    expect(resolveComparison(primary, { unit: 'year', n: -1 }, opts))
      .toEqual([Date.UTC(2025, 3, 1), Date.UTC(2025, 6, 1)])
  })

  it('current month vs previous month via offset', () => {
    const primary = { granularity: 'month' as const, anchor: 'current' as const }
    expect(resolveComparison(primary, { unit: 'month', n: -1 }, opts))
      .toEqual([Date.UTC(2026, 3, 1), Date.UTC(2026, 4, 1)])
  })
})

describe('leap year self-corrects (no millisecond math)', () => {
  it('Q1 2024 is 91 days; same quarter 2023 is 90 days', () => {
    const inQ1_2024 = { now: Date.UTC(2024, 1, 10) } // Feb 2024
    const primary = { granularity: 'quarter' as const, anchor: 'current' as const }
    const cur = resolvePeriod(primary, inQ1_2024)
    const prev = resolveComparison(primary, { unit: 'year', n: -1 }, inQ1_2024)
    expect(days(cur)).toBe(91)  // Jan31 + Feb29 + Mar31
    expect(days(prev)).toBe(90) // Jan31 + Feb28 + Mar31
  })
})

describe('fiscal year start (param reserved for retrofit)', () => {
  it('fiscalYearStartMonth=4 → Q1 is Apr–Jun', () => {
    const o = { now: NOW, fiscalYearStartMonth: 4 }
    expect(resolvePeriod({ granularity: 'quarter', anchor: 'current' }, o))
      .toEqual([Date.UTC(2026, 3, 1), Date.UTC(2026, 6, 1)])
  })

  it('fiscalYearStartMonth=4 → year starts in April', () => {
    const o = { now: NOW, fiscalYearStartMonth: 4 }
    expect(resolvePeriod({ granularity: 'year', anchor: 'current' }, o))
      .toEqual([Date.UTC(2026, 3, 1), Date.UTC(2027, 3, 1)])
  })
})
