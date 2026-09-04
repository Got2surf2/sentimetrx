import { describe, it, expect } from 'vitest'
import { buildVisitSnapshot, buildDigest, type VisitSnapshot } from '@/lib/anaDigest'

const NOW = new Date('2026-09-04T12:00:00Z')
const THREE_DAYS_AGO = '2026-09-01T09:00:00Z'

function snap(rowCount: number, themeCounts: Record<string, number>, key = 'liked_least'): VisitSnapshot {
  return { rowCount, themeCounts, themeFieldKey: key }
}

describe('buildVisitSnapshot', () => {
  it('keeps only themes with a real numeric count, keyed by name or label', () => {
    const s = buildVisitSnapshot(100, [
      { name: 'Service', count: 40 },
      { label: 'Food', count: 12 },
      { name: 'Uncounted' },
    ], 'liked_least')
    expect(s.themeCounts).toEqual({ Service: 40, Food: 12 })
    expect(s.rowCount).toBe(100)
    expect(s.themeFieldKey).toBe('liked_least')
  })
})

describe('buildDigest', () => {
  it('returns null on first visit (no previous snapshot)', () => {
    expect(buildDigest(null, snap(100, {}), THREE_DAYS_AGO, NOW)).toBeNull()
  })

  it('reports row growth with the ago label', () => {
    const block = buildDigest(snap(56117, {}), snap(57357, {}), THREE_DAYS_AGO, NOW)!
    expect(block).toContain('56,117 → 57,357')
    expect(block).toContain('+1,240')
    expect(block).toContain('3 days ago')
  })

  it('reports unchanged rows and row shrink honestly', () => {
    expect(buildDigest(snap(100, {}), snap(100, {}), THREE_DAYS_AGO, NOW)).toContain('unchanged at 100')
    expect(buildDigest(snap(100, {}), snap(90, {}), THREE_DAYS_AGO, NOW)).toContain('-10')
  })

  it('says "earlier today" and "1 day ago" at the boundaries', () => {
    expect(buildDigest(snap(1, {}), snap(1, {}), '2026-09-04T08:00:00Z', NOW)).toContain('earlier today')
    expect(buildDigest(snap(1, {}), snap(1, {}), '2026-09-03T08:00:00Z', NOW)).toContain('1 day ago')
  })

  it('lists theme count moves sorted by absolute delta, capped at 4 with an overflow line', () => {
    const prev = snap(100, { A: 10, B: 20, C: 30, D: 40, E: 50, F: 60 })
    const curr = snap(100, { A: 11, B: 25, C: 33, D: 48, E: 48, F: 70 })
    const block = buildDigest(prev, curr, THREE_DAYS_AGO, NOW)!
    // deltas: F +10, D +8, B +5, C +3, E -2, A +1 → top 4 listed
    expect(block).toContain('"F": 60 → 70 matches (+10)')
    expect(block).toContain('"D": 40 → 48 matches (+8)')
    expect(block).toContain('"B": 20 → 25 matches (+5)')
    expect(block).toContain('"C": 30 → 33 matches (+3)')
    expect(block).not.toContain('"E": 50')
    expect(block).not.toContain('"A": 10')
    expect(block).toContain('2 more theme count changes not listed')
  })

  it('flags new and removed themes', () => {
    const block = buildDigest(snap(100, { Old: 5, Kept: 9 }), snap(100, { Kept: 9, Fresh: 12 }), THREE_DAYS_AGO, NOW)!
    expect(block).toContain('New theme since the last visit: "Fresh" (12 matches)')
    expect(block).toContain('Theme removed since the last visit: "Old"')
  })

  it('skips all theme comparison when the framework field changed', () => {
    const block = buildDigest(snap(100, { A: 10 }, 'liked_least'), snap(100, { A: 99 }, 'liked_most'), THREE_DAYS_AGO, NOW)!
    expect(block).not.toContain('Theme')
    expect(block).toContain('unchanged at 100')
  })
})
