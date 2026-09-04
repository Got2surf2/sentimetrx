// lib/usageRates.estimateCost — pins the cache-read accounting direction.
// Anthropic's usage.input_tokens EXCLUDES cache reads (they arrive in the
// separate cache_read_input_tokens counter), so the components ADD. The
// pre-2026-09-04 implementation subtracted cache reads from input and drove
// every heavily-cached call NEGATIVE in /admin/usage.
import { describe, it, expect } from 'vitest'
import { estimateCost, RATES } from '@/lib/usageRates'

describe('estimateCost', () => {
  it('adds input + cache-read + output components (never subtracts)', () => {
    // A real Ana-shaped call: 28K uncached in, 144K cache reads, 1.2K out (Sonnet)
    const c = estimateCost('claude-sonnet-4-6', 28000, 1200, 144000)
    const expected = (28000 / 1e6) * 3 + (144000 / 1e6) * 0.3 + (1200 / 1e6) * 15
    expect(c).toBeCloseTo(expected, 6)
    expect(c).toBeGreaterThan(0)
  })

  it('a cache-dominated call can never go negative', () => {
    expect(estimateCost('claude-sonnet-4-6', 1000, 100, 500000)).toBeGreaterThan(0)
  })

  it('unknown models price at the standard tier, not the cheapest', () => {
    expect(estimateCost('claude-unknown-99', 1e6, 0, 0)).toBeCloseTo(RATES['claude-sonnet-4-6'].input, 6)
  })
})
