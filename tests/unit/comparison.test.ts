import { describe, it, expect } from 'vitest'
import { alignToDate, comparisonDelta, resolvePeriod, resolveComparison } from '@/lib/filterUtils'
import type { TsRange } from '@/lib/filterUtils'

const days = (r: TsRange) => Math.round((r[1] - r[0]) / 86_400_000)

describe('alignToDate (§4.1 to-date alignment)', () => {
  it('completed primary period → full vs full (unchanged)', () => {
    // Primary = Q1 2026 (complete), now in Q2.
    const primary = resolvePeriod({ granularity: 'quarter', anchor: 'last' }, { now: Date.UTC(2026, 4, 15) })
    const comparison = resolveComparison({ granularity: 'quarter', anchor: 'last' }, { unit: 'year', n: -1 }, { now: Date.UTC(2026, 4, 15) })
    const out = alignToDate(primary, comparison, Date.UTC(2026, 4, 15))
    expect(out.primary).toEqual(primary)
    expect(out.comparison).toEqual(comparison)
  })

  it('in-progress current period → both clipped to the same elapsed span', () => {
    // Now = 8 days into Q3 2026 (Jul 8). Primary = current quarter.
    const now = Date.UTC(2026, 6, 8)
    const primary = resolvePeriod({ granularity: 'quarter', anchor: 'current' }, { now })
    const comparison = resolveComparison({ granularity: 'quarter', anchor: 'current' }, { unit: 'year', n: -1 }, { now })
    const out = alignToDate(primary, comparison, now)
    // 8 days elapsed (Jul 1..Jul 8 inclusive) on BOTH sides — no phantom −90%.
    expect(days(out.primary)).toBe(8)
    expect(days(out.comparison)).toBe(8)
    expect(out.primary[0]).toBe(Date.UTC(2026, 6, 1))
    expect(out.comparison[0]).toBe(Date.UTC(2025, 6, 1))
  })

  it('clips to the comparison range end when the source month is longer (short-month cap)', () => {
    // Primary = March (31d), to-date day 31; comparison = same month last year via
    // a month offset is March again — but test the cap with an explicit overrun:
    const primary: TsRange = [Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 1)]      // Mar 2026
    const comparison: TsRange = [Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)]   // Feb 2026 (28d)
    const now = Date.UTC(2026, 2, 31)                                          // Mar 31 — 31 days in
    const out = alignToDate(primary, comparison, now)
    expect(out.comparison[1]).toBe(Date.UTC(2026, 2, 1)) // capped at Feb end, not overrun
    expect(days(out.comparison)).toBe(28)
  })
})

describe('comparisonDelta (§4.2 delta rules)', () => {
  it('prior window predates data → "—", never a fake −100%', () => {
    expect(comparisonDelta(0, 0, false)).toEqual({ kind: 'none', label: '—' })
    expect(comparisonDelta(120, 0, false)).toEqual({ kind: 'none', label: '—' })
  })

  it('genuine zero base → "new", never ∞%', () => {
    expect(comparisonDelta(50, 0, true)).toEqual({ kind: 'new', label: 'new' })
    expect(comparisonDelta(0, 0, true)).toEqual({ kind: 'new', label: '—' })
  })

  it('normal positive / negative deltas', () => {
    expect(comparisonDelta(120, 100, true)).toMatchObject({ kind: 'pct', label: '+20%' })
    expect(comparisonDelta(80, 100, true)).toMatchObject({ kind: 'pct', label: '-20%' })
  })
})
