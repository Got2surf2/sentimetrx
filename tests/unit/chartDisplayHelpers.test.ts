import { describe, it, expect } from 'vitest'
import { percentShareSeries, detJitter, compareCells } from '@/components/analyze/ChartsModule'

// Pure display helpers behind the 2026-09-03 chart-options pass:
// % share lines on Time Series breakdowns, deterministic scatter jitter,
// and numeric-aware table sorting.

describe('percentShareSeries', () => {
  it('converts aligned category series to per-bucket % shares that sum to 100', () => {
    const out = percentShareSeries({
      A: [30, 10, 0],
      B: [70, 30, 0],
    })
    expect(out.A).toEqual([30, 25, null])   // bucket totals 100, 40, 0
    expect(out.B).toEqual([70, 75, null])   // an empty bucket is null, not 0%
    expect(out.A[0]! + out.B[0]!).toBe(100)
  })

  it('treats null (metric-mode gap) as missing, not zero', () => {
    const out = percentShareSeries({ A: [null, 5], B: [10, 5] })
    expect(out.A).toEqual([null, 50])
    expect(out.B).toEqual([100, 50])
  })
})

describe('detJitter', () => {
  it('is deterministic and bounded to ±0.35', () => {
    for (let i = 0; i < 500; i++) {
      const v = detJitter(i, 1)
      expect(v).toBe(detJitter(i, 1))          // same index → same offset
      expect(Math.abs(v)).toBeLessThanOrEqual(0.35)
    }
    expect(detJitter(3, 1)).not.toBe(detJitter(3, 2)) // x and y salts differ
  })
})

describe('compareCells', () => {
  it('compares numbers numerically and text case-insensitively', () => {
    expect(compareCells('9', '10')).toBeLessThan(0)   // numeric, not lexical
    expect(compareCells('apple', 'Banana')).toBeLessThan(0)
  })
  it('sorts blanks last regardless of direction base', () => {
    expect(compareCells('', 'x')).toBeGreaterThan(0)
    expect(compareCells('x', null)).toBeLessThan(0)
  })
})
