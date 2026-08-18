import { describe, it, expect } from 'vitest'
import { validateVerbatims, pickPriorityThemes } from '@/lib/outletActionPlan'

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

// The narrated plan and the lever cards sit on ONE page. Before 2026-08-18 the
// plan ranked by READ severity while the cards ranked by peer-relative impact,
// so "Priority 1 · BIGGEST LEVER" could name a different theme from the card
// directly beneath it — one page recommending two different first moves.
describe('pickPriorityThemes', () => {
  const row = (theme: string, read: 'FIX' | 'WATCH' | 'SOLID' | 'STRENGTH', avgStar: number) =>
    ({ theme, read, avgStar, mentions: 10, pctNegative: 0.3 })

  const table = [
    row('Value & Pricing', 'FIX', 2.5),        // worst avg★ — used to win
    row('Operational Issues', 'FIX', 3.49),
    row('Atmosphere & Ambiance', 'WATCH', 4.18),
    row('Service Excellence', 'STRENGTH', 4.89),
  ]

  it('orders by the outlet impact ranking when one is supplied', () => {
    const out = pickPriorityThemes(table, ['Operational Issues', 'Value & Pricing', 'Atmosphere & Ambiance'])
    expect(out.map((t) => t.theme)).toEqual(['Operational Issues', 'Value & Pricing', 'Atmosphere & Ambiance'])
  })

  it('falls back to READ severity then worst avg★ with no ranking', () => {
    expect(pickPriorityThemes(table).map((t) => t.theme))
      .toEqual(['Value & Pricing', 'Operational Issues', 'Atmosphere & Ambiance'])
  })

  it('keeps the candidate set on ABSOLUTE health — never promotes a SOLID/STRENGTH theme', () => {
    // Service Excellence tops the impact list but scores well here, so it must
    // not become a "thing to work on next".
    const out = pickPriorityThemes(table, ['Service Excellence', 'Operational Issues'])
    expect(out.map((t) => t.theme)).not.toContain('Service Excellence')
    expect(out[0].theme).toBe('Operational Issues')
  })

  it('sorts themes missing from the ranking last, not first', () => {
    // Lagging OUTCOME themes (brand loyalty) are excluded from levers by the
    // predictor, so they carry no impact rank — they must sink, not float.
    const withOutcome = [...table, row('Return Intent & Loyalty', 'FIX', 4.03)]
    const out = pickPriorityThemes(withOutcome, ['Operational Issues', 'Value & Pricing'])
    expect(out.map((t) => t.theme)).toEqual(['Operational Issues', 'Value & Pricing', 'Return Intent & Loyalty'])
  })

  it('caps at three', () => {
    expect(pickPriorityThemes(table, ['Atmosphere & Ambiance', 'Operational Issues', 'Value & Pricing'])).toHaveLength(3)
  })
})
