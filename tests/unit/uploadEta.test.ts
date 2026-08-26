// The upload modal shows a time-remaining estimate. It is derived from MEASURED
// throughput (mean seconds-per-batch so far × batches left), not a guess — but
// how it's WORDED matters as much as the arithmetic: a per-second countdown on a
// number that keeps moving reads as broken, so the output is deliberately coarse.
import { describe, it, expect } from 'vitest'
import { formatEta } from '@/app/analyze/new/UploadClient'

describe('formatEta', () => {
  it('does not pretend to second-level precision', () => {
    expect(formatEta(3_000)).toBe('a few seconds')
    expect(formatEta(9_400)).toBe('a few seconds')
  })

  it('rounds sub-minute estimates to 5s buckets', () => {
    expect(formatEta(12_000)).toBe('about 15 seconds')
    expect(formatEta(31_000)).toBe('about 35 seconds')
  })

  it('switches to minutes, singular at one', () => {
    expect(formatEta(60_000)).toBe('about a minute')
    expect(formatEta(100_000)).toBe('about 2 minutes')
    expect(formatEta(9 * 60_000)).toBe('about 9 minutes')
  })

  it('stays sane on a long upload', () => {
    expect(formatEta(45 * 60_000)).toBe('about 45 minutes')
  })
})

// The estimator itself, as applied in the loop. Kept here rather than in the
// component so the arithmetic is pinned independently of React.
function etaFor(doneBatches: number, totalBatches: number, elapsedMs: number): number | null {
  return doneBatches >= 3 ? Math.round((elapsedMs / doneBatches) * (totalBatches - doneBatches)) : null
}

describe('eta estimator', () => {
  it('is withheld for the first two batches', () => {
    // Batch 1-2 include connection setup and would produce a wild figure.
    expect(etaFor(1, 2518, 900)).toBeNull()
    expect(etaFor(2, 2518, 1_800)).toBeNull()
    expect(etaFor(3, 2518, 2_700)).not.toBeNull()
  })

  it('projects the measured rate across the remaining batches', () => {
    // 100 batches done in 50s = 0.5s each; 2418 left → ~1209s.
    expect(etaFor(100, 2518, 50_000)).toBe(1_209_000)
  })

  it('reaches zero on the final batch rather than going negative', () => {
    expect(etaFor(2518, 2518, 500_000)).toBe(0)
  })
})
