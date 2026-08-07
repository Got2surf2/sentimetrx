import { describe, it, expect } from 'vitest'
import { validateVerbatims } from '@/lib/outletActionPlan'

// The action-plan verbatim MUST be an exact real review substring — never the
// model's reconstruction. norm() ignores case/punctuation, so a re-punctuated
// or lightly-reworded model quote can "match"; we must still render the real
// candidate text. A wrong verbatim reads as fabricated and destroys trust.
describe('validateVerbatims', () => {
  const REAL = "We had 6 o'clock reservations and showed up at about 4:30 to have a cocktail at the bar."
  const candidates = new Map([['Operational Issues', REAL]])

  it('renders the exact real candidate, not the model\'s altered punctuation', () => {
    const modelReturned = [{ rating: 2, quote: 'we had 6 oclock reservations and showed up at about 430 to have a cocktail at the bar' }]
    const out = validateVerbatims(modelReturned, 'Operational Issues', candidates)
    expect(out).toEqual([{ rating: 2, quote: REAL }])
  })

  it('replaces a model quote that trimmed/reworded but normalized-matches', () => {
    const out = validateVerbatims([{ rating: 1, quote: 'showed up at about 4:30 to have a cocktail!' }], 'Operational Issues', candidates)
    expect(out[0].quote).toBe(REAL)   // real text, not the model's trim
  })

  it('falls back to the theme candidate when the model returns nothing usable', () => {
    const out = validateVerbatims([{ rating: 2, quote: 'totally invented text about parking' }], 'Operational Issues', candidates)
    expect(out).toEqual([{ rating: 2, quote: REAL }])
  })

  it('de-dupes two model trims that map to the same real quote', () => {
    const out = validateVerbatims([
      { rating: 2, quote: 'we had 6 oclock reservations' },
      { rating: 1, quote: 'showed up at about 430 to have a cocktail at the bar' },
    ], 'Operational Issues', candidates)
    expect(out).toHaveLength(1)
    expect(out[0].quote).toBe(REAL)
  })

  it('returns empty when there is no candidate for the theme and no match', () => {
    expect(validateVerbatims([{ rating: 2, quote: 'anything' }], 'Unknown Theme', new Map())).toEqual([])
  })
})
